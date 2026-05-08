#!/usr/bin/env node
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const casesRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-bootstrap-smoke-'))
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

function run(args) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd: casesRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
  if (!output.endsWith('\n')) process.stdout.write('\n')
  return output
}

function parseJsonOutput(command, output) {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Expected ${command} to print JSON. Output:\n${output}\nParse error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireFile(caseRoot, relativePath) {
  const path = join(caseRoot, relativePath)
  if (!existsSync(path)) throw new Error(`Expected bootstrap smoke artifact missing: ${relativePath}`)
  return path
}

async function requireNonEmptyFile(caseRoot, relativePath) {
  const path = requireFile(caseRoot, relativePath)
  const info = await stat(path)
  if (info.size <= 0) throw new Error(`Expected bootstrap smoke artifact to be non-empty: ${relativePath}`)
}

try {
  const output = run([
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot,
    '--case-name',
    'Smoke Client v. Bootstrap Co',
    '--case-type',
    'personal-injury',
    '--start',
    '--json',
  ])
  const bootstrap = parseJsonOutput('waypoint firmvault bootstrap --json', output)
  if (bootstrap.case_slug !== 'smoke-client-v-bootstrap-co') {
    throw new Error(`Expected smoke case slug smoke-client-v-bootstrap-co, got ${bootstrap.case_slug}`)
  }
  if (bootstrap.case_root !== join(casesRoot, 'smoke-client-v-bootstrap-co')) {
    throw new Error(`Expected case root under cases root, got ${bootstrap.case_root}`)
  }
  if (bootstrap.quest !== 'firmvault') throw new Error(`Expected quest firmvault, got ${bootstrap.quest}`)
  if (bootstrap.route_id !== 'route-001') throw new Error(`Expected route-001, got ${bootstrap.route_id}`)
  if (bootstrap.landmarks?.total !== 82) throw new Error(`Expected 82 landmarks, got ${bootstrap.landmarks?.total}`)
  if (bootstrap.landmarks?.satisfied !== 0) throw new Error(`Expected 0 satisfied landmarks, got ${bootstrap.landmarks?.satisfied}`)

  const caseRoot = bootstrap.case_root
  const requiredArtifacts = [
    'smoke-client-v-bootstrap-co.md',
    'AGENTS.md',
    'Dashboard.md',
    'documents/',
    '.waypoint/config.yaml',
    '.waypoint/quests/firmvault.yaml',
    '.waypoint/lifecycle/workstreams.yaml',
    '.waypoint/routes/route-001.yaml',
    '.waypoint/events/route-001.jsonl',
    '.waypoint/tasks/tasks.yaml',
    '.waypoint/firmvault/case.yaml',
    '.waypoint/firmvault/landmarks.yaml',
  ]

  for (const artifact of requiredArtifacts) {
    await requireNonEmptyFile(caseRoot, artifact)
  }

  const doctor = parseJsonOutput('waypoint doctor firmvault --json', execFileSync(process.execPath, [cli, 'doctor', 'firmvault', '--json'], {
    cwd: caseRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  if (doctor.looksLikeFirmVaultCase !== true) {
    throw new Error(`Expected FirmVault doctor to accept bootstrapped folder. Inspection:\n${JSON.stringify(doctor, null, 2)}`)
  }
  if (doctor.caseSlug !== 'smoke-client-v-bootstrap-co') {
    throw new Error(`Expected doctor case slug smoke-client-v-bootstrap-co, got ${doctor.caseSlug}`)
  }

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`FirmVault bootstrap smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`FirmVault bootstrap smoke case: ${caseRoot}\n`)
  process.stdout.write('Waypoint FirmVault bootstrap smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(casesRoot, { recursive: true, force: true })
  }
}
