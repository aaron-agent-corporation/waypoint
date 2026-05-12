#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as yamlParse } from 'yaml'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const defaultManifestPath = join(repoRoot, 'examples/firmvault-lifecycle-simulation/completed-case-replay.example.yaml')
const manifestPath = process.env.FIRMVAULT_COMPLETED_CASE_REPLAY_MANIFEST
  ? resolve(process.env.FIRMVAULT_COMPLETED_CASE_REPLAY_MANIFEST)
  : defaultManifestPath
const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-completed-case-replay-'))
const casesRoot = join(tempRoot, 'cases')
const syntheticSourceRoot = join(tempRoot, 'synthetic-source-case')
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

function runWaypoint(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (process.env.WAYPOINT_VERBOSE_SMOKE === '1') {
    process.stdout.write(`$ waypoint ${args.join(' ')}\n${redact(output)}`)
    if (!output.endsWith('\n')) process.stdout.write('\n')
  }
  return output
}

function redact(value) {
  return String(value)
    .replace(/(token|api[_-]?key|password|secret|connection[_-]?string)(["'\s:=]+)([^\s"']+)/gi, '$1$2[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [REDACTED]')
}

function parseJson(command, output) {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Expected ${command} to print JSON. Output:\n${redact(output)}\nParse error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Expected ${label} ${expected}, got ${actual}`)
}

function requireTruthy(value, label) {
  if (!value) throw new Error(`Expected ${label}`)
}

function assertRelativeSafe(pathValue, label) {
  if (typeof pathValue !== 'string' || pathValue.length === 0) throw new Error(`${label} must be a non-empty string`)
  if (pathValue.includes('\0')) throw new Error(`${label} must not contain null bytes`)
  if (isAbsolute(pathValue)) throw new Error(`${label} must be relative: ${pathValue}`)
  const normalized = pathValue.split(/[\\/]+/)
  if (normalized.some((part) => part === '..')) throw new Error(`${label} must stay inside its root: ${pathValue}`)
  return pathValue
}

function resolveInside(root, relativePath, label) {
  assertRelativeSafe(relativePath, label)
  const target = resolve(root, relativePath)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes root: ${relativePath}`)
  }
  return target
}

function requireManifest(value) {
  if (!value || value.schema_version !== 1 || !value.source || !value.case || !Array.isArray(value.steps)) {
    throw new Error(`Invalid FirmVault completed-case replay manifest: ${manifestPath}`)
  }
  if (value.case.type !== 'personal_injury') throw new Error(`Unsupported replay case type: ${value.case.type}`)
  if (!value.case.slug || !/^[a-z0-9][a-z0-9-]*$/.test(value.case.slug)) throw new Error(`Unsafe replay case slug: ${value.case.slug}`)
  for (const step of value.steps) {
    if (!step.fact || !step.status) throw new Error(`Replay step must include fact and status: ${JSON.stringify(step)}`)
    assertRelativeSafe(step.source, `source path for ${step.fact}`)
    assertRelativeSafe(step.evidence, `evidence path for ${step.fact}`)
  }
  return value
}

async function prepareSyntheticSourceIfNeeded(manifest) {
  if (manifest.source.root !== '__SYNTHETIC_SOURCE__') return manifest.source.root
  for (const step of manifest.steps) {
    const sourcePath = resolveInside(syntheticSourceRoot, step.source, `synthetic source path for ${step.fact}`)
    await mkdir(dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, `# Synthetic completed-case source evidence\n\nfact: ${step.fact}\nstatus: ${step.status}\n`, 'utf8')
  }
  return syntheticSourceRoot
}

try {
  const manifest = requireManifest(yamlParse(await readFile(manifestPath, 'utf8')))
  const sourceRoot = await prepareSyntheticSourceIfNeeded(manifest)
  if (!isAbsolute(sourceRoot)) throw new Error(`source.root must be absolute or __SYNTHETIC_SOURCE__: ${sourceRoot}`)
  if (!existsSync(sourceRoot)) throw new Error(`source.root does not exist: ${redact(sourceRoot)}`)

  await mkdir(casesRoot, { recursive: true })
  const bootstrap = parseJson('waypoint firmvault bootstrap --json', runWaypoint([
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot,
    '--case-name',
    manifest.case.name,
    '--case-type',
    'personal-injury',
    '--case-slug',
    manifest.case.slug,
    '--start',
    '--json',
  ], casesRoot))

  requireEqual(bootstrap.case_slug, manifest.case.slug, 'case slug')
  requireEqual(bootstrap.route_id, 'route-001', 'route id')
  requireEqual(bootstrap.landmarks?.satisfied, 0, 'initial satisfied landmarks')
  requireEqual(bootstrap.landmarks?.total, 82, 'initial landmark total')

  const caseRoot = bootstrap.case_root
  requireTruthy(existsSync(join(caseRoot, '.waypoint/routes/route-001.yaml')), 'route artifact')
  requireTruthy(existsSync(join(caseRoot, '.waypoint/tasks/tasks.yaml')), 'task artifact')

  let previousSatisfied = 0
  for (const step of manifest.steps) {
    const sourcePath = resolveInside(sourceRoot, step.source, `source path for ${step.fact}`)
    const evidencePath = resolveInside(caseRoot, step.evidence, `evidence path for ${step.fact}`)
    if (!existsSync(sourcePath)) throw new Error(`Mapped source evidence does not exist for ${step.fact}: ${redact(step.source)}`)

    await mkdir(dirname(evidencePath), { recursive: true })
    copyFileSync(sourcePath, evidencePath)

    const check = parseJson('waypoint firmvault evidence check --json', runWaypoint([
      'firmvault',
      'evidence',
      'check',
      '--path',
      step.evidence,
      '--json',
    ], caseRoot))
    requireEqual(check.ok, true, `evidence check ok for ${step.fact}`)
    requireEqual(check.safe, true, `evidence check safe for ${step.fact}`)
    requireEqual(check.exists, true, `evidence check exists for ${step.fact}`)

    const result = parseJson(`waypoint firmvault state set --fact ${step.fact}`, runWaypoint([
      'firmvault',
      'state',
      'set',
      '--fact',
      step.fact,
      '--status',
      step.status,
      '--evidence',
      step.evidence,
      '--note',
      step.note ? redact(step.note) : 'Completed-case replay evidence mapped into sandbox.',
      '--json',
    ], caseRoot))
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
  requireEqual(stateUpdateEvents.length, manifest.steps.length, 'state update event count')

  requireTruthy(existsSync(join(caseRoot, '.waypoint/routes/route-001.yaml')), 'route artifact after completed-case replay')
  requireTruthy(existsSync(join(caseRoot, '.waypoint/tasks/tasks.yaml')), 'task artifact after completed-case replay')

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`FirmVault completed-case replay smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`FirmVault completed-case replay smoke case: ${caseRoot}\n`)
  process.stdout.write(`manifest: ${manifestPath === defaultManifestPath ? 'synthetic example' : '[REDACTED external manifest]'}\n`)
  process.stdout.write(`steps_applied: ${manifest.steps.length}\n`)
  process.stdout.write('landmarks_satisfied: 82/82\n')
  process.stdout.write('Waypoint FirmVault completed-case replay smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
