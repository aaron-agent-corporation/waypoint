#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parse as yamlParse } from 'yaml'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const fixturePath = join(repoRoot, 'examples/firmvault-lifecycle-simulation/fixture.yaml')
const casesRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-lifecycle-simulation-'))
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

function runWaypoint(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (process.env.WAYPOINT_VERBOSE_SMOKE === '1') {
    process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
    if (!output.endsWith('\n')) process.stdout.write('\n')
  }
  return output
}

function parseJson(command, output) {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Expected ${command} to print JSON. Output:\n${output}\nParse error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Expected ${label} ${expected}, got ${actual}`)
}

function requireTruthy(value, label) {
  if (!value) throw new Error(`Expected ${label}`)
}

function requireFixture(value) {
  if (!value || value.schema_version !== 1 || !value.case || !Array.isArray(value.steps)) {
    throw new Error(`Invalid FirmVault lifecycle simulation fixture: ${fixturePath}`)
  }
  if (value.case.type !== 'personal_injury') throw new Error(`Unsupported fixture case type: ${value.case.type}`)
  return value
}

function stepEvidence(step) {
  if (!Array.isArray(step.evidence) || step.evidence.length === 0) {
    throw new Error(`Fixture step ${step.fact} must include at least one evidence path`)
  }
  return step.evidence
}

try {
  const fixture = requireFixture(yamlParse(await readFile(fixturePath, 'utf8')))
  const bootstrap = parseJson('waypoint firmvault bootstrap --json', runWaypoint([
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot,
    '--case-name',
    fixture.case.name,
    '--case-type',
    'personal-injury',
    '--case-slug',
    fixture.case.slug,
    '--start',
    '--json',
  ], casesRoot))

  requireEqual(bootstrap.case_slug, fixture.case.slug, 'case slug')
  requireEqual(bootstrap.route_id, 'route-001', 'route id')
  requireEqual(bootstrap.landmarks?.satisfied, 0, 'initial satisfied landmarks')
  requireEqual(bootstrap.landmarks?.total, 82, 'initial landmark total')

  const caseRoot = bootstrap.case_root
  requireTruthy(existsSync(join(caseRoot, '.waypoint/routes/route-001.yaml')), 'route artifact')
  requireTruthy(existsSync(join(caseRoot, '.waypoint/tasks/tasks.yaml')), 'task artifact')

  const seenEvidence = new Set()
  for (const step of fixture.steps) {
    if (!step.fact || !step.status) throw new Error(`Invalid fixture step: ${JSON.stringify(step)}`)
    for (const evidence of stepEvidence(step)) {
      if (seenEvidence.has(evidence)) continue
      seenEvidence.add(evidence)
      const path = join(caseRoot, evidence)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `# Synthetic lifecycle evidence\n\nfact: ${step.fact}\nstatus: ${step.status}\n`, 'utf8')
      const check = parseJson('waypoint firmvault evidence check --json', runWaypoint([
        'firmvault',
        'evidence',
        'check',
        '--path',
        evidence,
        '--json',
      ], caseRoot))
      requireEqual(check.ok, true, `evidence check ok for ${evidence}`)
      requireEqual(check.safe, true, `evidence check safe for ${evidence}`)
      requireEqual(check.exists, true, `evidence check exists for ${evidence}`)
    }
  }

  let previousSatisfied = 0
  for (const step of fixture.steps) {
    const args = [
      'firmvault',
      'state',
      'set',
      '--fact',
      step.fact,
      '--status',
      step.status,
    ]
    for (const evidence of stepEvidence(step)) {
      args.push('--evidence', evidence)
    }
    if (step.note) args.push('--note', step.note)
    args.push('--json')

    const result = parseJson(`waypoint ${args.join(' ')}`, runWaypoint(args, caseRoot))
    requireEqual(result.ok, true, `state set ok for ${step.fact}`)
    requireEqual(result.fact, step.fact, `state set fact for ${step.fact}`)
    requireEqual(result.status, step.status, `state set status for ${step.fact}`)
    if (result.landmarks_after.satisfied < previousSatisfied) {
      throw new Error(`Landmark count regressed after ${step.fact}: ${result.landmarks_after.satisfied} < ${previousSatisfied}`)
    }
    previousSatisfied = result.landmarks_after.satisfied
  }

  const landmarks = parseJson('waypoint firmvault landmarks --json', runWaypoint([
    'firmvault',
    'landmarks',
    '--json',
  ], caseRoot))
  const entries = Object.entries(landmarks.landmarks ?? {})
  const satisfied = entries.filter(([, landmark]) => landmark?.satisfied === true)
  const unsatisfied = entries.filter(([, landmark]) => landmark?.satisfied !== true).map(([slug]) => slug)
  requireEqual(entries.length, 82, 'final landmark total')
  requireEqual(satisfied.length, 82, `satisfied landmarks; unsatisfied=${unsatisfied.join(', ')}`)
  requireEqual(landmarks.warnings?.length ?? 0, 0, 'final landmark warnings')

  const eventsJsonl = await readFile(join(caseRoot, '.waypoint/firmvault/events.jsonl'), 'utf8')
  if (!eventsJsonl.includes('firmvault.state.updated')) throw new Error('Expected firmvault.state.updated audit events')
  const stateUpdateEvents = eventsJsonl.split('\n').filter((line) => line.includes('firmvault.state.updated'))
  requireEqual(stateUpdateEvents.length, fixture.steps.length, 'state update event count')

  requireTruthy(existsSync(join(caseRoot, '.waypoint/routes/route-001.yaml')), 'route artifact after lifecycle simulation')
  requireTruthy(existsSync(join(caseRoot, '.waypoint/tasks/tasks.yaml')), 'task artifact after lifecycle simulation')

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`FirmVault lifecycle simulation smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`FirmVault lifecycle simulation smoke case: ${caseRoot}\n`)
  process.stdout.write(`steps_applied: ${fixture.steps.length}\n`)
  process.stdout.write('landmarks_satisfied: 82/82\n')
  process.stdout.write('Waypoint FirmVault lifecycle simulation smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(casesRoot, { recursive: true, force: true })
  }
}
