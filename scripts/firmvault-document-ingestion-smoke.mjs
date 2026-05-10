#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as yamlParse } from 'yaml'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const casesRoot = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-document-ingestion-smoke-'))
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

function runWaypoint(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
  if (!output.endsWith('\n')) process.stdout.write('\n')
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

function requireIncludes(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`Expected ${label} to include ${expected}. Contents:\n${source}`)
}

try {
  const bootstrap = parseJson('waypoint firmvault bootstrap --json', runWaypoint([
    'firmvault',
    'bootstrap',
    '--cases-root',
    casesRoot,
    '--case-name',
    'Document Smoke v. Pipeline Co',
    '--case-type',
    'personal-injury',
    '--start',
    '--json',
  ], casesRoot))

  requireEqual(bootstrap.case_slug, 'document-smoke-v-pipeline-co', 'case slug')
  requireEqual(bootstrap.route_id, 'route-001', 'route id')
  requireEqual(bootstrap.landmarks?.satisfied, 0, 'initial satisfied landmarks')
  requireEqual(bootstrap.landmarks?.total, 82, 'initial landmark total')

  const caseRoot = bootstrap.case_root
  const sourcePdf = join(casesRoot, 'daily-mail-scan.pdf')
  await writeFile(sourcePdf, 'fake daily mail pdf bytes')

  const added = parseJson('waypoint firmvault add-document --json', runWaypoint([
    'firmvault',
    'add-document',
    '--source',
    sourcePdf,
    '--kind',
    'unknown',
    '--note',
    'document ingestion smoke source',
    '--json',
  ], caseRoot))

  requireEqual(added.document_id, 'document-001', 'document id')
  requireEqual(added.path, 'documents/inbox/daily-mail-scan.pdf', 'document inbox path')
  if (!existsSync(join(caseRoot, 'documents/inbox/daily-mail-scan.pdf'))) {
    throw new Error('Expected scanned source to be copied into documents/inbox/')
  }

  const opened = parseJson('waypoint firmvault document-handoff --json', runWaypoint([
    'firmvault',
    'document-handoff',
    '--document-id',
    'document-001',
    '--status',
    'pr-opened',
    '--pr-number',
    '321',
    '--pr-url',
    'http://localhost:3001/aaron/FirmVault/pulls/321',
    '--branch',
    'ingest/2026-05-10-smoke',
    '--submitted-at',
    '2026-05-10T18:00:00.000Z',
    '--json',
  ], caseRoot))

  requireEqual(opened.document_id, 'document-001', 'opened handoff document id')
  requireEqual(opened.handoff?.status, 'pr_opened', 'opened handoff status')

  const merged = parseJson('waypoint firmvault document-handoff --json', runWaypoint([
    'firmvault',
    'document-handoff',
    '--document-id',
    'document-001',
    '--status',
    'merged',
    '--pr-number',
    '321',
    '--pr-url',
    'http://localhost:3001/aaron/FirmVault/pulls/321',
    '--branch',
    'ingest/2026-05-10-smoke',
    '--completed-at',
    '2026-05-10T18:05:00.000Z',
    '--json',
  ], caseRoot))

  requireEqual(merged.document_id, 'document-001', 'merged handoff document id')
  requireEqual(merged.handoff?.status, 'merged', 'merged handoff status')
  requireEqual(merged.handoff?.completed_at, '2026-05-10T18:05:00.000Z', 'merged completed_at')

  const documentsYamlText = await readFile(join(caseRoot, '.waypoint/firmvault/documents.yaml'), 'utf8')
  const documentsYaml = yamlParse(documentsYamlText)
  const document = documentsYaml?.documents?.[0]
  requireEqual(document?.id, 'document-001', 'documents.yaml document id')
  requireEqual(document?.handoff?.system, 'firmvault-document-pipeline', 'handoff system')
  requireEqual(document?.handoff?.status, 'merged', 'handoff final status')
  requireEqual(document?.handoff?.pr_number, 321, 'handoff PR number')
  requireEqual(document?.handoff?.pr_url, 'http://localhost:3001/aaron/FirmVault/pulls/321', 'handoff PR URL')
  requireEqual(document?.handoff?.branch, 'ingest/2026-05-10-smoke', 'handoff branch')

  const eventsJsonl = await readFile(join(caseRoot, '.waypoint/firmvault/events.jsonl'), 'utf8')
  requireIncludes(eventsJsonl, 'firmvault.document.added', 'events.jsonl')
  requireIncludes(eventsJsonl, 'firmvault.document.handoff_updated', 'events.jsonl')
  requireIncludes(eventsJsonl, 'pr_opened', 'events.jsonl')
  requireIncludes(eventsJsonl, 'merged', 'events.jsonl')

  const landmarks = parseJson('waypoint firmvault landmarks --json', runWaypoint([
    'firmvault',
    'landmarks',
    '--json',
  ], caseRoot))
  const satisfied = Object.values(landmarks.landmarks ?? {}).filter((landmark) => landmark.satisfied === true)
  requireEqual(satisfied.length, 0, 'legal landmarks satisfied by ingestion flow')

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`FirmVault document ingestion smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`FirmVault document ingestion smoke case: ${caseRoot}\n`)
  process.stdout.write('legalLandmarksUpdated: false\n')
  process.stdout.write('Waypoint FirmVault document ingestion smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(casesRoot, { recursive: true, force: true })
  }
}
