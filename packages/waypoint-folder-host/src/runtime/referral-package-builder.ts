import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { LocalRecipePayload } from './payload.ts'

export interface ReferralPackageBuilderResult {
  readonly adapter: 'waypoint-referral-package-builder'
  readonly recipe_slug: string
  readonly task_id: string
  readonly route_id: string
  readonly project_root: string
  readonly status: 'ok'
  readonly summary: string
  readonly artifacts: readonly string[]
  readonly unresolved: readonly string[]
}

const CHRONOLOGY_ARTIFACTS = [
  '03-medical/medical-chronology-output/medical-chronology.html',
  '03-medical/medical-chronology-output/medical-chronology-timeline.pdf',
  '03-medical/medical-chronology-output/medical-chronology-master-binder.pdf',
  '03-medical/medical-chronology-output/extracted-visit-pdfs',
] as const

const CHRONOLOGY_QC_ARTIFACT = '03-medical/medical-chronology-output/adversarial-qc-report.md'

const LEGAL_TRANSFER_BLOCKERS = [
  'Roy Hamilton service/perfection should be verified before attorney-ready handoff.',
  'Deposition completion/status should be verified and noted for transfer.',
  'Medical specials should be reconciled; confirm Heartland bill and Starlite itemized breakdown if applicable.',
  'Current KFB PIP ledger/exhaustion and lien amounts should be verified; blank lien state should be surfaced.',
  'MMI, cervical treatment/EMG status, expert disclosures, and trial date should be verified if not already documented.',
] as const

export async function runReferralPackageBuilderFromStdin(stdin: NodeJS.ReadStream = process.stdin): Promise<ReferralPackageBuilderResult> {
  const payload = parsePayload(await readAll(stdin))
  const result = await runReferralPackageBuilder(payload)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

export async function runReferralPackageBuilder(payload: LocalRecipePayload): Promise<ReferralPackageBuilderResult> {
  if (payload.schema_version !== 1) throw new Error('Unsupported local recipe payload schema_version')
  const slug = payload.recipe_slug
  if (slug === 'firmvault-medical-chronology-update') {
    return ok(payload, 'Medical chronology is externally produced by the paralegal/runtime; Waypoint will verify declared artifacts before advancing.', [])
  }
  if (slug === 'firmvault-medical-chronology-adversarial-qc') {
    const missing = await missingArtifacts(payload.project_root, [CHRONOLOGY_QC_ARTIFACT])
    if (missing.length > 0) return ok(payload, 'Medical chronology QC is pending; Waypoint will block on the missing QC artifact.', [])
    return ok(payload, 'Medical chronology QC artifact exists.', [CHRONOLOGY_QC_ARTIFACT])
  }
  if (slug === 'referral-package-start-here-builder') {
    const artifacts = await writeStartHereArtifacts(payload.project_root)
    return ok(payload, 'Drafted conservative START_HERE dashboard and package index review aids with unresolved transfer blockers noted.', artifacts)
  }
  if (slug === 'referral-package-package-qc') {
    const artifacts = await writePackageQc(payload.project_root)
    return ok(payload, 'Wrote package QC report; unresolved legal blockers are transfer notes and attorney-ready status remains blocked.', artifacts)
  }
  return ok(payload, `No first-party referral-package builder action for recipe ${slug}; Waypoint artifact gates remain authoritative.`, [])
}

async function writeStartHereArtifacts(projectRoot: string): Promise<string[]> {
  const handoffDir = join(projectRoot, 'referral-package-build', 'attorney-handoff')
  await mkdir(handoffDir, { recursive: true })
  const chronologyLinks = await existingChronologyLinks(projectRoot)
  const blockerList = LEGAL_TRANSFER_BLOCKERS.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')
  const chronologyList = chronologyLinks.map((item) => `<li><a href="../../${escapeHtml(item)}">${escapeHtml(item)}</a></li>`).join('\n')
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>START HERE — Referral Package Review</title></head>
<body>
  <main>
    <h1>Referral Package Review Dashboard</h1>
    <p><strong>Status:</strong> Draft review aid. Not attorney-ready until the human handoff gate is approved.</p>
    <section id="medical">
      <h2>Medical chronology / binder review aid</h2>
      <ul>${chronologyList || '<li>Medical chronology artifacts pending.</li>'}</ul>
    </section>
    <section id="transfer-blockers">
      <h2>Transfer notes / unresolved items</h2>
      <p>These items are noted for transfer/QC and do not by themselves prevent the Quest from reaching the human gate.</p>
      <ul>${blockerList}</ul>
    </section>
  </main>
</body>
</html>
`
  await writeFile(join(handoffDir, 'START_HERE.html'), html, 'utf8')
  await writeFile(join(handoffDir, 'START_HERE.pdf'), '%PDF-1.4\n% Draft referral package dashboard review aid. Render final PDF before handoff.\n', 'utf8')
  await writePackageIndex(projectRoot)
  return [
    'referral-package-build/attorney-handoff/START_HERE.html',
    'referral-package-build/attorney-handoff/START_HERE.pdf',
    'referral-package-build/attorney-handoff/PACKAGE_INDEX.md',
    'referral-package-build/attorney-handoff/PACKAGE_FILE_INDEX.csv',
  ]
}

async function writePackageIndex(projectRoot: string): Promise<void> {
  const handoffDir = join(projectRoot, 'referral-package-build', 'attorney-handoff')
  await mkdir(handoffDir, { recursive: true })
  await writeFile(
    join(handoffDir, 'PACKAGE_INDEX.md'),
    `# Referral Package Index\n\nStatus: draft review aid; attorney-ready handoff requires human gate approval.\n\n## Core files\n\n- START_HERE.html\n- START_HERE.pdf\n- PACKAGE_FILE_INDEX.csv\n- ../build-internal/package-qc-report.json\n\n## Transfer notes\n\n${LEGAL_TRANSFER_BLOCKERS.map((item) => `- ${item}`).join('\n')}\n`,
    'utf8',
  )
  await writeFile(
    join(handoffDir, 'PACKAGE_FILE_INDEX.csv'),
    `path,description,status\nSTART_HERE.html,Attorney review dashboard,draft\nSTART_HERE.pdf,Dashboard PDF placeholder,draft\nPACKAGE_INDEX.md,Package index,draft\nPACKAGE_FILE_INDEX.csv,File index,draft\n`,
    'utf8',
  )
}

async function writePackageQc(projectRoot: string): Promise<string[]> {
  const internalDir = join(projectRoot, 'referral-package-build', 'build-internal')
  await mkdir(internalDir, { recursive: true })
  const missingChronology = await missingArtifacts(projectRoot, [...CHRONOLOGY_ARTIFACTS, CHRONOLOGY_QC_ARTIFACT])
  const report = {
    schema_version: 1,
    determination: 'blocked_not_attorney_ready',
    attorney_ready: false,
    human_gate_required: true,
    source_mutation: 'none_by_builder',
    blockers: {
      medical_chronology: missingChronology.length > 0 ? missingChronology : [],
      transfer_notes: [...LEGAL_TRANSFER_BLOCKERS],
    },
    notes: [
      'Non-chronology legal blockers are recorded for transfer/QC and must be reviewed by a human.',
      'Medical chronology artifacts are Quest-required when medical records are present and are verified by artifact gates.',
    ],
  }
  await writeFile(join(internalDir, 'package-qc-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return ['referral-package-build/build-internal/package-qc-report.json']
}

async function existingChronologyLinks(projectRoot: string): Promise<string[]> {
  const paths = [...CHRONOLOGY_ARTIFACTS, CHRONOLOGY_QC_ARTIFACT]
  const out: string[] = []
  for (const path of paths) {
    try {
      await stat(join(projectRoot, path))
      out.push(path)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue
      throw error
    }
  }
  return out
}

async function missingArtifacts(projectRoot: string, paths: readonly string[]): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    try {
      await stat(join(projectRoot, path))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(path)
        continue
      }
      throw error
    }
  }
  return missing
}

function ok(payload: LocalRecipePayload, summary: string, artifacts: readonly string[]): ReferralPackageBuilderResult {
  return {
    adapter: 'waypoint-referral-package-builder',
    recipe_slug: payload.recipe_slug,
    task_id: payload.task_id,
    route_id: payload.route_id,
    project_root: payload.project_root,
    status: 'ok',
    summary,
    artifacts,
    unresolved: [...LEGAL_TRANSFER_BLOCKERS],
  }
}

async function readAll(stream: NodeJS.ReadStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

function parsePayload(text: string): LocalRecipePayload {
  const parsed = JSON.parse(text) as Partial<LocalRecipePayload>
  if (
    parsed.schema_version !== 1 ||
    typeof parsed.recipe_slug !== 'string' ||
    typeof parsed.task_id !== 'string' ||
    typeof parsed.route_id !== 'string' ||
    typeof parsed.project_root !== 'string'
  ) {
    throw new Error('Invalid local recipe payload')
  }
  return {
    schema_version: 1,
    recipe_slug: parsed.recipe_slug,
    prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
    task_id: parsed.task_id,
    route_id: parsed.route_id,
    project_root: parsed.project_root,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
