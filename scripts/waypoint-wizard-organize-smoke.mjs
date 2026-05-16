#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
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

async function writeFixtureFile(root, relativePath, content) {
  const filePath = join(root, relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function listFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, path))
    } else if (entry.isFile()) {
      files.push(relative(root, path).split('\\').join('/'))
    }
  }
  return files.sort()
}

async function fileHash(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function treeManifest(root) {
  const files = await listFiles(root)
  const manifest = []
  for (const file of files) {
    const path = join(root, file)
    const info = await stat(path)
    manifest.push({ file, size: info.size, sha256: await fileHash(path) })
  }
  return manifest
}

function sameManifest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readYaml(path) {
  return parseYaml(await readFile(path, 'utf8'))
}

try {
  const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-wizard-organize-smoke-'))
  const sourceRoot = join(tempRoot, 'messy-source')
  const caseRoot = join(tempRoot, 'organized-waypoint-case')

  await writeFixtureFile(sourceRoot, 'Desktop Dump/001 Intake Packet.txt', 'Client intake packet. Incident date listed. No real PII.\n')
  await writeFixtureFile(sourceRoot, 'contracts/Fee Agreement Final.txt', 'Synthetic signed fee agreement for smoke-only approved apply coverage. No real PII.\n')
  await writeFixtureFile(sourceRoot, 'insurance/BI policy declarations.txt', 'Bodily injury insurance carrier declarations. No real PII.\n')
  await writeFixtureFile(sourceRoot, 'medical/provider records batch.txt', 'Provider treatment records and bills packet. No real PII.\n')
  await writeFixtureFile(sourceRoot, 'demand/Demand Package Draft.txt', 'Demand package draft with settlement demand summary. No real PII.\n')
  await writeFixtureFile(sourceRoot, 'misc/scan001 unknown.txt', 'Ambiguous scanned page. Classification review required. No real PII.\n')

  const beforeSourceManifest = await treeManifest(sourceRoot)

  const organize = parseJson('waypoint wizard organize --json', run([
    'wizard',
    'organize',
    '--source',
    sourceRoot,
    '--target',
    caseRoot,
    '--domain',
    'firmvault',
    '--copy-files',
    '--json',
  ], tempRoot))

  requireEqual(organize.domain, 'firmvault', 'organize domain')
  requireEqual(organize.target_root, caseRoot, 'organize target_root')
  requireEqual(organize.documents_planned, 6, 'documents planned')
  requireEqual(organize.source_files_copied, 6, 'source files copied')
  requireEqual(organize.source_files_read_only, true, 'source files read-only flag')

  const afterOrganizeSourceManifest = await treeManifest(sourceRoot)
  if (!sameManifest(beforeSourceManifest, afterOrganizeSourceManifest)) {
    throw new Error(`Source tree changed during organize. Before ${JSON.stringify(beforeSourceManifest)} After ${JSON.stringify(afterOrganizeSourceManifest)}`)
  }

  const requiredArtifacts = [
    'README.md',
    'documents/intake/README.md',
    'documents/contracts/README.md',
    'documents/insurance/README.md',
    'documents/medical-records/README.md',
    'documents/demand/README.md',
    'documents/unknown/README.md',
    '.waypoint/wizard/source-manifest.yaml',
    '.waypoint/wizard/organization-plan.yaml',
    '.waypoint/wizard/organize-report.md',
    '.waypoint/wizard/missing-documents-checklist.md',
  ]
  for (const artifact of requiredArtifacts) {
    requireTruthy(existsSync(join(caseRoot, artifact)), `organized artifact ${artifact}`)
  }

  const organizationPlan = await readYaml(join(caseRoot, '.waypoint', 'wizard', 'organization-plan.yaml'))
  requireEqual(organizationPlan.legal_facts_from_organization, 'forbidden', 'organization legal boundary')
  requireTruthy(organizationPlan.documents.every((document) => document.copy_decision?.status === 'copied'), 'all organization documents copied')
  requireTruthy(organizationPlan.documents.every((document) => document.legal_boundary?.requires_approved_apply === true), 'all organization documents require approved apply')
  const categories = organizationPlan.documents.map((document) => document.canonical_document_path.split('/')[1])
  for (const expected of ['intake', 'contracts', 'insurance', 'medical-records', 'demand', 'unknown']) {
    requireIncludes(categories, expected, 'organized categories')
  }

  const copiedPaths = organizationPlan.documents.map((document) => document.copy_decision.destination_path).filter(Boolean)
  for (const copiedPath of copiedPaths) {
    requireTruthy(existsSync(join(caseRoot, copiedPath)), `copied evidence ${copiedPath}`)
  }

  const shadowDir = join(caseRoot, '.waypoint', 'shadows', 'firmvault')
  requireTruthy(existsSync(shadowDir), 'shadow directory')
  const shadowFiles = (await listFiles(shadowDir)).filter((file) => file.endsWith('.md'))
  requireEqual(shadowFiles.length, 6, 'shadow files count')

  const planResponse = parseJson('waypoint wizard plan --json', run([
    'wizard',
    'plan',
    '--case',
    caseRoot,
    '--write-plan',
    '.waypoint/wizard/adoption-plan.yaml',
    '--json',
  ], tempRoot))
  requireTruthy(planResponse.proposed_facts_count >= 1, 'adoption plan proposed facts')
  requireTruthy(planResponse.plan.shadow_map.some((entry) => entry.copied_evidence_path), 'adoption plan copied evidence path')
  requireTruthy(planResponse.plan.proposed_facts.some((fact) => fact.copied_evidence_path), 'proposed facts copied evidence path')
  requireTruthy(planResponse.plan.proposed_facts.every((fact) => fact.approved === false), 'proposed facts pending review')

  const questions = parseJson('waypoint wizard questions --json after plan', run([
    'wizard',
    'questions',
    '--case',
    caseRoot,
    '--json',
  ], tempRoot))
  requireTruthy(questions.questions_found >= 1, 'questions artifact after adoption-plan generation')

  run(['firmvault', 'init-case', '--case-type', 'personal-injury', '--case-slug', 'wizard-organize-smoke'], caseRoot)
  const guidanceBeforeApply = parseJson('waypoint firmvault guidance --json before apply', run([
    'firmvault',
    'guidance',
    '--json',
  ], caseRoot))
  requireEqual(guidanceBeforeApply.landmarks.satisfied, 0, 'landmarks satisfied before approved apply')

  const planPath = join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml')
  const persistedPlan = await readYaml(planPath)
  persistedPlan.proposed_facts = persistedPlan.proposed_facts.map((fact) => ({
    ...fact,
    approved: fact.fact === 'client.contracts.fee_agreement',
  }))
  persistedPlan.approvals = {
    approved_facts: persistedPlan.proposed_facts.filter((fact) => fact.approved).length,
    unapproved_facts: persistedPlan.proposed_facts.filter((fact) => !fact.approved).length,
  }
  await writeFile(planPath, stringifyYaml(persistedPlan), 'utf8')

  const apply = parseJson('waypoint wizard apply --json', run([
    'wizard',
    'apply',
    '--case',
    caseRoot,
    '--plan',
    '.waypoint/wizard/adoption-plan.yaml',
    '--json',
  ], tempRoot))
  requireEqual(apply.applied_facts.length, 1, 'approved apply fact count')
  requireEqual(apply.applied_facts[0].fact, 'client.contracts.fee_agreement', 'approved apply fact')
  requireTruthy(apply.applied_facts[0].state_result?.file === 'client.yaml', 'approved apply used safe FirmVault state API')
  requireTruthy(apply.skipped_facts.every((fact) => fact.reason === 'unapproved'), 'unapproved facts skipped')

  const clientState = await readYaml(join(caseRoot, '.waypoint', 'firmvault', 'client.yaml'))
  const evidencePaths = clientState.client.contracts.fee_agreement.evidence.map((entry) => entry.path)
  requireTruthy(evidencePaths.some((path) => path.startsWith('.waypoint/shadows/')), 'safe apply retained shadow evidence')
  requireTruthy(evidencePaths.some((path) => path.startsWith('documents/contracts/')), 'safe apply included copied evidence')

  const finalSourceManifest = await treeManifest(sourceRoot)
  if (!sameManifest(beforeSourceManifest, finalSourceManifest)) {
    throw new Error(`Source tree changed during full organize smoke. Before ${JSON.stringify(beforeSourceManifest)} After ${JSON.stringify(finalSourceManifest)}`)
  }

  if (!repoRootHadWaypointDir && existsSync(repoRootWaypointDir)) {
    throw new Error(`Waypoint Wizard organize smoke created unexpected repo-root .waypoint at ${repoRootWaypointDir}`)
  }

  process.stdout.write(`Waypoint Wizard organize smoke project: ${caseRoot}\n`)
  process.stdout.write('Waypoint Wizard organize smoke passed\n')

  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
