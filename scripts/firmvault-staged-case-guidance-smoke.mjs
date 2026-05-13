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
const casesRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-staged-guidance-'))

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

function requireIncludes(values, expected, label) {
  if (!values.includes(expected)) throw new Error(`Expected ${label} to include ${expected}; got ${values.join(', ')}`)
}

function requireNotIncludes(values, expected, label) {
  if (values.includes(expected)) throw new Error(`Expected ${label} not to include ${expected}; got ${values.join(', ')}`)
}

function requireFixture(value) {
  if (!value || value.schema_version !== 1 || !value.case || !Array.isArray(value.steps)) {
    throw new Error(`Invalid FirmVault lifecycle fixture: ${fixturePath}`)
  }
  return value
}

async function createCase(stageName, caseName) {
  const bootstrap = parseJson('waypoint firmvault bootstrap --json', runWaypoint([
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot,
    '--case-name',
    caseName,
    '--case-type',
    'personal-injury',
    '--case-slug',
    stageName,
    '--json',
  ], casesRoot))
  return bootstrap.case_root
}

async function ensureEvidence(caseRoot, step) {
  for (const evidence of step.evidence ?? []) {
    const path = join(caseRoot, evidence)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `# Synthetic staged guidance evidence\n\nfact: ${step.fact}\nstatus: ${step.status}\n`, 'utf8')
  }
}

async function applySteps(caseRoot, steps) {
  for (const step of steps) {
    await ensureEvidence(caseRoot, step)
    const args = ['firmvault', 'state', 'set', '--fact', step.fact, '--status', step.status]
    for (const evidence of step.evidence ?? []) args.push('--evidence', evidence)
    if (step.note) args.push('--note', step.note)
    args.push('--json')
    const result = parseJson(`waypoint ${args.join(' ')}`, runWaypoint(args, caseRoot))
    requireEqual(result.ok, true, `state set ok for ${step.fact}`)
  }
}

function guidance(caseRoot) {
  return parseJson('waypoint firmvault guidance --json', runWaypoint(['firmvault', 'guidance', '--json'], caseRoot))
}

function requiredFacts(result) {
  return (result.next_actions?.required ?? []).map((action) => action.fact)
}

try {
  const fixture = requireFixture(yamlParse(await readFile(fixturePath, 'utf8')))
  const stages = [
    { name: 'empty', steps: 0, expectStage: 'intake_not_started', expectSatisfied: 0, includes: ['case.setup', 'client.intake'], notIncludes: [] },
    { name: 'documents-only', steps: 0, documentsOnly: true, expectStage: 'intake_not_started', expectSatisfied: 0, includes: ['case.setup', 'client.intake'], notIncludes: [] },
    { name: 'intake-complete', steps: 5, expectStage: 'intake_complete', expectSatisfied: 3, includes: ['providers.setup', 'insurance.bi.carrier_identified'], notIncludes: ['client.intake'] },
    { name: 'demand-ready', throughFact: 'demand.readiness.review', expectStage: 'pre_demand', includes: ['demand.liens.final_process_check', 'demand.draft'], notIncludes: ['client.intake'] },
    { name: 'settlement-close-needed', beforeFact: 'settlement.closing.readiness', expectStage: 'close_case', includes: ['settlement.closing.readiness', 'settlement.closing.letter.prepared'], notIncludes: ['demand.send'] },
    { name: 'closed', steps: fixture.steps.length, expectStage: 'closed', expectSatisfied: 82, includes: [], notIncludes: ['settlement.closing.case'] },
  ]

  for (const stage of stages) {
    const caseRoot = await createCase(stage.name, `FirmVault ${stage.name} Guidance Smoke`)
    if (stage.documentsOnly) {
      const source = join(casesRoot, `${stage.name}-client-upload.pdf`)
      await writeFile(source, 'synthetic document only fixture')
      parseJson('waypoint firmvault add-document --json', runWaypoint([
        'firmvault',
        'add-document',
        '--source',
        source,
        '--kind',
        'police-report',
        '--note',
        'documents-only smoke fixture; does not satisfy legal state',
        '--json',
      ], caseRoot))
      if (!existsSync(join(caseRoot, 'documents/inbox', `${stage.name}-client-upload.pdf`))) {
        throw new Error(`Expected documents-only upload to exist in ${caseRoot}`)
      }
    }

    let steps = fixture.steps.slice(0, stage.steps ?? 0)
    if (stage.throughFact) {
      const index = fixture.steps.findIndex((step) => step.fact === stage.throughFact)
      if (index < 0) throw new Error(`Missing fixture fact ${stage.throughFact}`)
      steps = fixture.steps.slice(0, index + 1)
    }
    if (stage.beforeFact) {
      const index = fixture.steps.findIndex((step) => step.fact === stage.beforeFact)
      if (index < 0) throw new Error(`Missing fixture fact ${stage.beforeFact}`)
      steps = fixture.steps.slice(0, index)
    }
    await applySteps(caseRoot, steps)

    const result = guidance(caseRoot)
    const facts = requiredFacts(result)
    requireEqual(result.mutates_state, false, `${stage.name} guidance mutates_state`)
    requireEqual(result.stage, stage.expectStage, `${stage.name} stage`)
    if (stage.expectSatisfied !== undefined) requireEqual(result.landmarks.satisfied, stage.expectSatisfied, `${stage.name} satisfied landmarks`)
    requireEqual(result.landmarks.total, 82, `${stage.name} total landmarks`)
    for (const fact of stage.includes) requireIncludes(facts, fact, `${stage.name} required facts`)
    for (const fact of stage.notIncludes) requireNotIncludes(facts, fact, `${stage.name} required facts`)
    if (stage.name === 'closed') requireEqual(facts.length, 0, 'closed next required actions')
    process.stdout.write(`stage ${stage.name}: ${result.landmarks.satisfied}/${result.landmarks.total}, next=${facts.slice(0, 4).join(',') || 'none'}\n`)
  }

  process.stdout.write(`FirmVault staged guidance smoke root: ${casesRoot}\n`)
  process.stdout.write('Waypoint FirmVault staged guidance smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(casesRoot, { recursive: true, force: true })
  }
}
