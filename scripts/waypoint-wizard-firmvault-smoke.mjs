#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// Smoke command surface: waypoint wizard scan, waypoint wizard shadow,
// waypoint wizard questions, waypoint wizard answer, waypoint wizard plan,
// waypoint wizard apply, waypoint firmvault init-case, waypoint firmvault guidance.
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const fixtureSource = join(repoRoot, 'examples/waypoint-wizard/firmvault-messy-source')
const repoRootWaypointDir = join(repoRoot, '.waypoint')
const repoRootHadWaypointDir = existsSync(repoRootWaypointDir)

function run(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(`$ waypoint ${args.join(' ')} [cwd=${cwd}]\n${output}`)
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

function requireTruthy(value, label) {
  if (!value) throw new Error(`Expected ${label}`)
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Expected ${label} ${expected}, got ${actual}`)
}

function requireIncludes(values, expected, label) {
  if (!values.includes(expected)) throw new Error(`Expected ${label} to include ${expected}; got ${JSON.stringify(values)}`)
}

async function fileFingerprint(path) {
  const info = await stat(path)
  return `${info.size}:${info.mtimeMs}`
}

async function snapshotFixture() {
  const files = [
    'Intake Docs.pdf.txt',
    'medical/Smith Records.pdf.txt',
    'random/DocuSign Complete.pdf.txt',
    'unknown/scan001.txt',
  ]
  const entries = []
  for (const file of files) {
    entries.push([file, await fileFingerprint(join(fixtureSource, file))])
  }
  return new Map(entries)
}

async function assertFixtureUnchanged(snapshot) {
  for (const [file, fingerprint] of snapshot.entries()) {
    const current = await fileFingerprint(join(fixtureSource, file))
    if (current !== fingerprint) {
      throw new Error(`Wizard smoke mutated fixture source file ${file}: before ${fingerprint}, after ${current}`)
    }
  }
}

try {
  requireTruthy(existsSync(fixtureSource), `Waypoint Wizard fixture source at ${fixtureSource}`)
  const sourceSnapshot = await snapshotFixture()
  const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-wizard-firmvault-smoke-'))
  const sourceRoot = join(tempRoot, 'messy-source')
  const caseRoot = join(tempRoot, 'waypoint-case')

  await cp(fixtureSource, sourceRoot, { recursive: true })
  await writeFile(
    join(sourceRoot, 'random', 'Fee Agreement Final.pdf.txt'),
    'Synthetic signed fee agreement for smoke-only approved apply coverage.\nNo real PII is present.\n',
    'utf8',
  )

  const scan = parseJson('waypoint wizard scan --json', run([
    'wizard',
    'scan',
    '--source',
    sourceRoot,
    '--domain',
    'firmvault',
    '--json',
  ], tempRoot))
  requireEqual(scan.domain, 'firmvault', 'scan domain')
  requireEqual(scan.files_found, 5, 'scan files_found')
  requireTruthy(scan.files.every((file) => file.sha256 && file.path.startsWith(sourceRoot)), 'scan source pointers and hashes')

  const shadow = parseJson('waypoint wizard shadow --json', run([
    'wizard',
    'shadow',
    '--source',
    sourceRoot,
    '--target',
    caseRoot,
    '--domain',
    'firmvault',
    '--json',
  ], tempRoot))
  requireEqual(shadow.shadows_created, 5, 'shadows_created')
  requireTruthy(shadow.shadow_paths.every((path) => path.startsWith(join(caseRoot, '.waypoint', 'shadows', 'firmvault'))), 'shadow paths under case .waypoint/shadows/firmvault')
  const shadowMarkdown = await readFile(shadow.shadow_paths[0], 'utf8')
  requireTruthy(shadowMarkdown.includes('sha256:'), 'shadow frontmatter sha256')
  requireTruthy(shadowMarkdown.includes('masked: true'), 'shadow PII metadata')
  requireTruthy(shadowMarkdown.includes('Source contents were not copied'), 'shadow raw source exclusion body')

  const questionsBefore = parseJson('waypoint wizard questions --json', run([
    'wizard',
    'questions',
    '--case',
    caseRoot,
    '--json',
  ], tempRoot))
  requireEqual(questionsBefore.questions_found, 0, 'questions before plan generation')

  const planBeforeAnswer = parseJson('waypoint wizard plan --json', run([
    'wizard',
    'plan',
    '--case',
    caseRoot,
    '--json',
  ], tempRoot))
  requireTruthy(planBeforeAnswer.questions_count > 0, 'plan generated pending Wizard question')
  requireTruthy(planBeforeAnswer.proposed_facts_count >= 1, 'plan proposed FirmVault facts')
  requireIncludes(planBeforeAnswer.warnings, 'Shadow requires classification review before it can support a FirmVault fact.', 'plan warnings')
  const questionId = planBeforeAnswer.plan.questions[0]?.id
  requireTruthy(questionId, 'first generated question id')

  const answer = parseJson('waypoint wizard answer --json', run([
    'wizard',
    'answer',
    '--case',
    caseRoot,
    '--question',
    questionId,
    '--answer',
    'Treat the ambiguous scan as review-only; do not use it to satisfy any FirmVault fact.',
    '--json',
  ], tempRoot))
  requireEqual(answer.answer.question_id, questionId, 'recorded answer question id')

  const planAfterAnswer = parseJson('waypoint wizard plan --json after answer', run([
    'wizard',
    'plan',
    '--case',
    caseRoot,
    '--json',
  ], tempRoot))
  requireEqual(planAfterAnswer.answers_count, 1, 'plan answers_count')

  const planPath = join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml')
  const rawPlan = await readFile(planPath, 'utf8')
  const parsedPlan = parseYaml(rawPlan)
  const approvedFacts = parsedPlan.proposed_facts.map((fact) => ({
    ...fact,
    approved: fact.fact === 'client.contracts.fee_agreement',
  }))
  parsedPlan.proposed_facts = approvedFacts
  parsedPlan.approvals = {
    approved_facts: approvedFacts.filter((fact) => fact.approved).length,
    unapproved_facts: approvedFacts.filter((fact) => !fact.approved).length,
  }
  await writeFile(planPath, stringifyYaml(parsedPlan), 'utf8')

  run(['firmvault', 'init-case', '--case-type', 'personal-injury', '--case-slug', 'wizard-smoke'], caseRoot)

  const apply = parseJson('waypoint wizard apply --json', run([
    'wizard',
    'apply',
    '--case',
    caseRoot,
    '--json',
  ], tempRoot))
  requireEqual(apply.applied_facts.length, 1, 'applied facts count')
  requireEqual(apply.applied_facts[0].fact, 'client.contracts.fee_agreement', 'applied fact')
  requireTruthy(apply.applied_facts[0].state_result.file === 'client.yaml', 'safe FirmVault state API result')
  requireTruthy(apply.skipped_facts.every((fact) => fact.reason === 'unapproved'), 'unapproved facts skipped')
  requireTruthy(apply.guidance?.stage, 'post-apply guidance stage')

  const guidance = parseJson('waypoint firmvault guidance --json', run([
    'firmvault',
    'guidance',
    '--json',
  ], caseRoot))
  requireTruthy(guidance.landmarks.satisfied >= 0, 'guidance returns landmark counts after approved apply')

  const clientState = parseYaml(await readFile(join(caseRoot, '.waypoint', 'firmvault', 'client.yaml'), 'utf8'))
  requireEqual(clientState.client.contracts.fee_agreement.status, 'signed', 'fee agreement status')
  requireTruthy(clientState.client.authorizations?.hipaa?.status !== 'signed', 'unapproved HIPAA remains unapplied')

  requireTruthy(existsSync(join(caseRoot, '.waypoint', 'shadows', 'firmvault')), 'shadow directory exists')
  requireTruthy(existsSync(join(caseRoot, '.waypoint', 'wizard', 'questions.yaml')), 'questions artifact exists')
  requireTruthy(existsSync(join(caseRoot, '.waypoint', 'wizard', 'answers.yaml')), 'answers artifact exists')
  requireTruthy(existsSync(planPath), 'adoption plan artifact exists')
  requireTruthy(existsSync(join(caseRoot, '.waypoint', 'firmvault', 'events.jsonl')), 'FirmVault event log exists')

  await assertFixtureUnchanged(sourceSnapshot)
  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`Waypoint Wizard smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`Waypoint Wizard smoke project: ${caseRoot}\n`)
  process.stdout.write('Waypoint Wizard FirmVault smoke passed\n')

  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
