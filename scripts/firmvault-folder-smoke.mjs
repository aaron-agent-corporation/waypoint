#!/usr/bin/env node
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const projectRoot = await mkdirTempCaseFolder()
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

const starterFiles = new Map([
  ['AGENTS.md', '# FirmVault case agents\n'],
  ['Dashboard.md', '# Case dashboard\n'],
  ['smith-v-acme.md', '# Smith v. Acme\n'],
  ['client/intake.md', '# Intake\n'],
  ['client/contracts.md', '# Contracts\n'],
  ['client/authorizations.md', '# Authorizations\n'],
  ['client/contactability.md', '# Contactability\n'],
  ['client/check-ins.md', '# Check-ins\n'],
  ['accident/accident.md', '# Accident\n'],
  ['accident/police-report.md', '# Police report\n'],
  ['accident/liability.md', '# Liability\n'],
  ['activity/index.md', '# Activity\n'],
  ['workflow-log/index.md', '# Workflow log\n'],
])

const starterDirs = [
  'client',
  'accident',
  'contacts',
  'insurance',
  'medical-providers',
  'liens',
  'demand',
  'negotiation',
  'settlement',
  'litigation',
  'documents',
  'activity',
  'workflow-log',
]

function run(args) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
  if (!output.endsWith('\n')) process.stdout.write('\n')
  return output
}

async function mkdirTempCaseFolder() {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-folder-smoke-'))
}

async function createStarterCaseFolder() {
  for (const dir of starterDirs) {
    await mkdir(join(projectRoot, dir), { recursive: true })
  }
  for (const [relativePath, content] of starterFiles.entries()) {
    await mkdir(join(projectRoot, relativePath, '..'), { recursive: true })
    await writeFile(join(projectRoot, relativePath), content)
  }
}

function requireFile(relativePath) {
  const path = join(projectRoot, relativePath)
  if (!existsSync(path)) throw new Error(`Expected smoke artifact missing: ${relativePath}`)
  return path
}

async function requireNonEmptyFile(relativePath) {
  const path = requireFile(relativePath)
  const info = await stat(path)
  if (info.size <= 0) throw new Error(`Expected smoke artifact to be non-empty: ${relativePath}`)
}

function parseJsonOutput(command, output) {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Expected ${command} to print JSON. Output:\n${output}\nParse error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assertIncludes(output, phrase, command) {
  if (!output.includes(phrase)) {
    throw new Error(`Expected ${command} output to include ${phrase}. Output:\n${output}`)
  }
}

try {
  await createStarterCaseFolder()

  run(['init', '--quest', 'firmvault'])
  const doctor = parseJsonOutput('waypoint doctor firmvault --json', run(['doctor', 'firmvault', '--json']))
  if (doctor.looksLikeFirmVaultCase !== true) {
    throw new Error(`Expected FirmVault doctor to accept starter folder. Inspection:\n${JSON.stringify(doctor, null, 2)}`)
  }
  if (doctor.caseSlug !== 'smith-v-acme') {
    throw new Error(`Expected FirmVault doctor to derive case slug smith-v-acme, got ${doctor.caseSlug}`)
  }

  const initCaseOutput = run(['firmvault', 'init-case', '--case-type', 'personal-injury', '--case-slug', 'smith-v-acme'])
  assertIncludes(initCaseOutput, 'landmarks satisfied: 0/82', 'waypoint firmvault init-case')

  run(['start', '--quest', 'firmvault'])
  const routesOutput = run(['routes'])
  assertIncludes(routesOutput, 'total: 1', 'waypoint routes')
  assertIncludes(routesOutput, 'quest: firmvault', 'waypoint routes')

  const tasksOutput = run(['tasks', '--route-id', 'route-001'])
  assertIncludes(tasksOutput, 'Waypoint tasks', 'waypoint tasks')
  assertIncludes(tasksOutput, 'total:', 'waypoint tasks')
  assertIncludes(tasksOutput, 'task-001', 'waypoint tasks')

  const projection = parseJsonOutput('waypoint firmvault landmarks --json', run(['firmvault', 'landmarks', '--json']))
  const landmarkCount = Object.keys(projection.landmarks ?? {}).length
  if (landmarkCount !== 82) throw new Error(`Expected 82 FirmVault landmarks, got ${landmarkCount}`)
  const satisfiedCount = Object.values(projection.landmarks).filter((landmark) => landmark.satisfied).length
  if (satisfiedCount !== 0) throw new Error(`Expected 0 initially satisfied FirmVault landmarks, got ${satisfiedCount}`)

  const requiredArtifacts = [
    '.waypoint/config.yaml',
    '.waypoint/quests/firmvault.yaml',
    '.waypoint/lifecycle/workstreams.yaml',
    '.waypoint/routes/route-001.yaml',
    '.waypoint/events/route-001.jsonl',
    '.waypoint/tasks/tasks.yaml',
    '.waypoint/firmvault/case.yaml',
    '.waypoint/firmvault/client.yaml',
    '.waypoint/firmvault/accident.yaml',
    '.waypoint/firmvault/providers.yaml',
    '.waypoint/firmvault/insurance.yaml',
    '.waypoint/firmvault/liens.yaml',
    '.waypoint/firmvault/records.yaml',
    '.waypoint/firmvault/demand.yaml',
    '.waypoint/firmvault/negotiation.yaml',
    '.waypoint/firmvault/settlement.yaml',
    '.waypoint/firmvault/documents.yaml',
    '.waypoint/firmvault/landmarks.yaml',
    '.waypoint/firmvault/events.jsonl',
  ]

  for (const artifact of requiredArtifacts) {
    await requireNonEmptyFile(artifact)
  }

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`FirmVault smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`FirmVault smoke project: ${projectRoot}\n`)
  process.stdout.write('Waypoint FirmVault folder smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(projectRoot, { recursive: true, force: true })
  }
}
