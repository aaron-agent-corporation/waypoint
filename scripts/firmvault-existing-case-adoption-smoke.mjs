#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const corpusRoot = process.env.FIRMVAULT_CASES_ROOT
  ? resolve(process.env.FIRMVAULT_CASES_ROOT)
  : '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases'

const samples = [
  { slug: 'amaree-stewart-premise-06-17-2022', expectedPhase: null },
  { slug: 'brandon-robinson-jr', expectedPhase: 'phase_1_file_setup' },
  { slug: 'abigail-whaley', expectedPhase: 'phase_3_demand' },
  { slug: 'amy-mills', expectedPhase: 'phase_4_negotiation' },
  { slug: 'abby-sitgraves', expectedPhase: 'phase_7_litigation' },
  { slug: 'ashlee-williams', expectedPhase: 'phase_8_closed' },
]

function runWaypoint(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (process.env.WAYPOINT_VERBOSE_SMOKE === '1') {
    process.stdout.write(`$ waypoint ${args.join(' ')} [cwd=${cwd}]\n${output}`)
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

try {
  requireTruthy(existsSync(corpusRoot), `FirmVault case corpus at ${corpusRoot}`)

  for (const sample of samples) {
    const caseRoot = join(corpusRoot, sample.slug)
    requireTruthy(existsSync(caseRoot), `sample case ${sample.slug}`)
    const hadWaypoint = existsSync(join(caseRoot, '.waypoint', 'firmvault'))
    const preview = parseJson('waypoint firmvault adopt preview --json', runWaypoint([
      'firmvault',
      'adopt',
      'preview',
      '--json',
    ], caseRoot))

    requireEqual(preview.schema_version, 1, `${sample.slug} schema_version`)
    requireEqual(preview.mutates_state, false, `${sample.slug} preview mutates_state`)
    requireEqual(preview.case_slug, sample.slug, `${sample.slug} case_slug`)
    requireEqual(preview.legacy_phase ?? null, sample.expectedPhase, `${sample.slug} legacy phase`)
    requireTruthy(preview.source_summary.total_files > 0, `${sample.slug} source files`)    
    requireTruthy(Array.isArray(preview.proposed_facts), `${sample.slug} proposed_facts array`)
    requireEqual(existsSync(join(caseRoot, '.waypoint', 'firmvault')), hadWaypoint, `${sample.slug} preview does not create Waypoint state`)

    process.stdout.write(`preview ${sample.slug}: phase=${preview.legacy_phase ?? 'none'}, files=${preview.source_summary.total_files}, proposed=${preview.proposed_facts.length}, confirm=${preview.blocked_or_needs_confirmation.length}\n`)
  }

  const tmp = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-existing-case-adoption-'))
  const copiedCase = join(tmp, 'brandon-robinson-jr')
  await cp(join(corpusRoot, 'brandon-robinson-jr'), copiedCase, { recursive: true })

  const guidanceBefore = parseJson('waypoint firmvault guidance --json', runWaypoint([
    'firmvault',
    'guidance',
    '--json',
  ], copiedCase))
  requireEqual(guidanceBefore.stage, 'needs_adoption', 'copied legacy guidance stage before adoption')
  requireEqual(guidanceBefore.next_actions.required[0].fact, 'firmvault.adopt.preview', 'copied legacy guidance adoption action')

  const adopted = parseJson('waypoint firmvault adopt init --apply-safe --json', runWaypoint([
    'firmvault',
    'adopt',
    'init',
    '--apply-safe',
    '--json',
  ], copiedCase))
  requireEqual(adopted.schema_version, 1, 'adoption schema_version')
  requireEqual(adopted.mutates_state, true, 'adoption mutates_state')
  requireTruthy(existsSync(join(copiedCase, '.waypoint', 'firmvault', 'case.yaml')), 'copied case Waypoint state')
  requireTruthy(adopted.applied_facts.length > 0, 'adoption applied safe facts')
  requireTruthy(adopted.landmarks_after.satisfied > adopted.landmarks_before.satisfied, 'adoption improves landmark count')

  const eventsJsonl = await readFile(join(copiedCase, '.waypoint', 'firmvault', 'events.jsonl'), 'utf8')
  requireTruthy(eventsJsonl.includes('firmvault.case_state.initialized'), 'adoption init event')
  requireTruthy(eventsJsonl.includes('firmvault.state.updated'), 'adoption state update events')

  const guidanceAfter = parseJson('waypoint firmvault guidance --json', runWaypoint([
    'firmvault',
    'guidance',
    '--json',
  ], copiedCase))
  requireTruthy(guidanceAfter.stage !== 'needs_adoption', 'guidance exits adoption stage after init')

  await rm(tmp, { recursive: true, force: true })

  process.stdout.write(`adopted copied brandon-robinson-jr: applied=${adopted.applied_facts.length}, landmarks=${adopted.landmarks_after.satisfied}/${adopted.landmarks_after.total}\n`)
  process.stdout.write('Waypoint FirmVault existing case adoption smoke passed\n')
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
