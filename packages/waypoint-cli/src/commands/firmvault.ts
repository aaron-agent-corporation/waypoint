import type { WaypointCliIo } from '../bin.ts'

interface InitFirmVaultCaseStateResult {
  readonly stateDir: string
  readonly projection: FirmVaultLandmarkProjection
}

interface BootstrapFirmVaultCaseResult {
  readonly caseRoot: string
  readonly caseSlug: string
  readonly createdPaths: readonly string[]
  readonly project: { readonly config: { readonly quest: string } }
  readonly catalog: { readonly recipes: readonly unknown[] }
  readonly firmvaultState: InitFirmVaultCaseStateResult
  readonly route?: { readonly id: string }
}

interface FirmVaultLandmarkProjection {
  readonly schema_version: 1
  readonly generated_at: string
  readonly landmarks: Record<string, { readonly satisfied: boolean; readonly evidence: readonly unknown[] }>
  readonly warnings: readonly string[]
}

type FirmVaultStateModule = {
  readonly bootstrapFirmVaultCase: (
    input: {
      readonly casesRoot: string
      readonly caseName: string
      readonly caseType: 'personal_injury'
      readonly caseSlug?: string
      readonly startRoute?: boolean
    },
  ) => Promise<BootstrapFirmVaultCaseResult>
  readonly initFirmVaultCaseState: (
    root: string,
    options: { readonly caseType: 'personal_injury'; readonly caseSlug?: string },
  ) => Promise<InitFirmVaultCaseStateResult>
  readonly readFirmVaultLandmarkProjection: (root: string) => Promise<FirmVaultLandmarkProjection>
  readonly addFirmVaultDocument: (
    root: string,
    input: { readonly source: string; readonly kind: FirmVaultDocumentKind; readonly note?: string },
  ) => Promise<{ readonly document: FirmVaultDocumentIndexEntry }>
  readonly updateFirmVaultDocumentHandoff: (
    root: string,
    input: {
      readonly documentId: string
      readonly handoff: FirmVaultDocumentHandoff
    },
  ) => Promise<{ readonly document: FirmVaultDocumentIndexEntry }>
}

type FirmVaultDocumentKind = 'medical_records' | 'bill' | 'insurance' | 'police_report' | 'correspondence' | 'unknown'

type FirmVaultDocumentHandoffStatus = 'not_started' | 'submitted' | 'pr_opened' | 'merged' | 'deferred' | 'failed'

interface FirmVaultDocumentHandoff {
  readonly system: 'firmvault-document-pipeline'
  readonly status: FirmVaultDocumentHandoffStatus
  readonly pr_number?: number
  readonly pr_url?: string
  readonly branch?: string
  readonly submitted_at?: string
  readonly completed_at?: string
}

interface FirmVaultDocumentIndexEntry {
  readonly id: string
  readonly kind: FirmVaultDocumentKind
  readonly path: string
  readonly original_name: string
  readonly added_at: string
  readonly note?: string
  readonly handoff?: FirmVaultDocumentHandoff
}

const usageLines = [
  'Usage: waypoint firmvault bootstrap --cases-root <path> --case-name <name> [--case-type personal-injury] [--case-slug <slug>] [--start] [--json]',
  'Usage: waypoint firmvault add-document --source <path> --kind medical-records|bill|insurance|police-report|correspondence|unknown [--note <note>] [--json]',
  'Usage: waypoint firmvault document-handoff --document-id <id> --status not-started|submitted|pr-opened|merged|deferred|failed [--pr-number <number>] [--pr-url <url>] [--branch <branch>] [--submitted-at <iso>] [--completed-at <iso>] [--json]',
  'Usage: waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]',
  '       waypoint firmvault landmarks [--json]',
]

export async function runFirmVaultCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand, ...rest] = args

  if (subcommand === 'init-case') {
    return runInitCase(rest, io)
  }

  if (subcommand === 'bootstrap') {
    return runBootstrap(rest, io)
  }

  if (subcommand === 'add-document') {
    return runAddDocument(rest, io)
  }

  if (subcommand === 'document-handoff') {
    return runDocumentHandoff(rest, io)
  }

  if (subcommand === 'landmarks') {
    return runLandmarks(rest, io)
  }

  usageLines.forEach((line) => io.stderr(line))
  return 1
}

async function runBootstrap(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const parsed = parseBootstrapArgs(args)
  if (!parsed.ok) {
    const error = 'error' in parsed ? parsed.error : 'Invalid firmvault bootstrap arguments'
    io.stderr(error)
    usageLines.forEach((line) => io.stderr(line))
    return 1
  }

  const module = await importFirmVaultStateModule()
  const result = await module.bootstrapFirmVaultCase({
    casesRoot: parsed.casesRoot,
    caseName: parsed.caseName,
    caseType: parsed.caseType,
    ...(parsed.caseSlug ? { caseSlug: parsed.caseSlug } : {}),
    ...(parsed.startRoute ? { startRoute: true } : {}),
  })
  const satisfied = countSatisfiedLandmarks(result.firmvaultState.projection)
  const total = Object.keys(result.firmvaultState.projection.landmarks).length

  if (parsed.json) {
    io.stdout(JSON.stringify({
      case_root: result.caseRoot,
      case_slug: result.caseSlug,
      quest: result.project.config.quest,
      route_id: result.route?.id ?? null,
      created_paths: result.createdPaths,
      recipes_installed: result.catalog.recipes.length,
      landmarks: {
        satisfied,
        total,
      },
    }, null, 2))
    return 0
  }

  io.stdout('Waypoint FirmVault case bootstrapped')
  io.stdout(`case_root: ${result.caseRoot}`)
  io.stdout(`case_slug: ${result.caseSlug}`)
  io.stdout(`quest: ${result.project.config.quest}`)
  io.stdout(`recipes installed: ${result.catalog.recipes.length}`)
  io.stdout(`route_id: ${result.route?.id ?? 'null'}`)
  io.stdout(`landmarks satisfied: ${satisfied}/${total}`)
  return 0
}

async function runAddDocument(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const parsed = parseAddDocumentArgs(args)
  if (!parsed.ok) {
    const error = 'error' in parsed ? parsed.error : 'Invalid firmvault add-document arguments'
    io.stderr(error)
    usageLines.forEach((line) => io.stderr(line))
    return 1
  }

  const module = await importFirmVaultStateModule()
  const result = await module.addFirmVaultDocument(io.cwd ?? process.cwd(), {
    source: parsed.source,
    kind: parsed.kind,
    ...(parsed.note ? { note: parsed.note } : {}),
  })

  if (parsed.json) {
    io.stdout(JSON.stringify({
      document_id: result.document.id,
      kind: result.document.kind,
      path: result.document.path,
      original_name: result.document.original_name,
      added_at: result.document.added_at,
      note: result.document.note ?? null,
    }, null, 2))
    return 0
  }

  io.stdout('Waypoint FirmVault document added')
  io.stdout(`document_id: ${result.document.id}`)
  io.stdout(`kind: ${result.document.kind}`)
  io.stdout(`path: ${result.document.path}`)
  return 0
}

async function runDocumentHandoff(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const parsed = parseDocumentHandoffArgs(args)
  if (!parsed.ok) {
    const error = 'error' in parsed ? parsed.error : 'Invalid firmvault document-handoff arguments'
    io.stderr(error)
    usageLines.forEach((line) => io.stderr(line))
    return 1
  }

  const module = await importFirmVaultStateModule()
  const result = await module.updateFirmVaultDocumentHandoff(io.cwd ?? process.cwd(), {
    documentId: parsed.documentId,
    handoff: {
      system: 'firmvault-document-pipeline',
      status: parsed.status,
      ...(parsed.prNumber !== undefined ? { pr_number: parsed.prNumber } : {}),
      ...(parsed.prUrl ? { pr_url: parsed.prUrl } : {}),
      ...(parsed.branch ? { branch: parsed.branch } : {}),
      ...(parsed.submittedAt ? { submitted_at: parsed.submittedAt } : {}),
      ...(parsed.completedAt ? { completed_at: parsed.completedAt } : {}),
    },
  })

  if (parsed.json) {
    io.stdout(JSON.stringify({
      document_id: result.document.id,
      handoff: result.document.handoff,
    }, null, 2))
    return 0
  }

  io.stdout('Waypoint FirmVault document handoff updated')
  io.stdout(`document_id: ${result.document.id}`)
  io.stdout(`status: ${result.document.handoff?.status ?? 'null'}`)
  if (result.document.handoff?.pr_url) io.stdout(`pr_url: ${result.document.handoff.pr_url}`)
  return 0
}

async function runInitCase(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const parsed = parseInitCaseArgs(args)
  if (!parsed.ok) {
    const error = 'error' in parsed ? parsed.error : 'Invalid firmvault init-case arguments'
    io.stderr(error)
    usageLines.forEach((line) => io.stderr(line))
    return 1
  }

  const module = await importFirmVaultStateModule()
  const result = await module.initFirmVaultCaseState(io.cwd ?? process.cwd(), {
    caseType: parsed.caseType,
    ...(parsed.caseSlug ? { caseSlug: parsed.caseSlug } : {}),
  })
  const satisfied = countSatisfiedLandmarks(result.projection)
  const total = Object.keys(result.projection.landmarks).length

  io.stdout('Waypoint FirmVault case state initialized')
  io.stdout(`state_dir: ${result.stateDir}`)
  io.stdout(`case_type: ${parsed.caseType}`)
  io.stdout(`case_slug: ${parsed.caseSlug ?? 'null'}`)
  io.stdout(`landmarks satisfied: ${satisfied}/${total}`)
  return 0
}

async function runLandmarks(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const unknown = args.filter((arg) => arg !== '--json')
  if (unknown.length > 0) {
    io.stderr(`Unknown firmvault landmarks option: ${unknown[0]}`)
    usageLines.forEach((line) => io.stderr(line))
    return 1
  }

  const module = await importFirmVaultStateModule()
  const projection = await module.readFirmVaultLandmarkProjection(io.cwd ?? process.cwd())
  if (json) {
    io.stdout(JSON.stringify(projection, null, 2))
    return 0
  }

  io.stdout('Waypoint FirmVault landmarks')
  for (const [slug, landmark] of Object.entries(projection.landmarks)) {
    io.stdout(`${slug}: ${landmark.satisfied}`)
    for (const evidence of landmark.evidence) {
      if (isRecord(evidence) && typeof evidence.path === 'string') {
        io.stdout(`  - evidence: ${evidence.path}`)
      }
    }
  }
  if (projection.warnings.length > 0) {
    io.stdout(`warnings:\n${projection.warnings.map((warning) => `  - ${warning}`).join('\n')}`)
  }
  return 0
}

function parseAddDocumentArgs(args: readonly string[]):
  | {
    readonly ok: true
    readonly source: string
    readonly kind: FirmVaultDocumentKind
    readonly note?: string
    readonly json: boolean
  }
  | { readonly ok: false; readonly error: string } {
  let source: string | undefined
  let kind: FirmVaultDocumentKind | undefined
  let note: string | undefined
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--source') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --source' }
      source = value
      index += 1
      continue
    }
    if (arg === '--kind') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --kind' }
      const parsedKind = parseDocumentKind(value)
      if (!parsedKind) return { ok: false, error: `Unsupported FirmVault document kind: ${value}` }
      kind = parsedKind
      index += 1
      continue
    }
    if (arg === '--note') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --note' }
      note = value
      index += 1
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    return { ok: false, error: `Unknown firmvault add-document option: ${arg}` }
  }

  if (!source) return { ok: false, error: 'Missing required --source' }
  if (!kind) return { ok: false, error: 'Missing required --kind' }

  return { ok: true, source, kind, json, ...(note ? { note } : {}) }
}

function parseDocumentKind(value: string): FirmVaultDocumentKind | null {
  if (value === 'medical-records' || value === 'medical_records') return 'medical_records'
  if (value === 'bill') return 'bill'
  if (value === 'insurance') return 'insurance'
  if (value === 'police-report' || value === 'police_report') return 'police_report'
  if (value === 'correspondence') return 'correspondence'
  if (value === 'unknown') return 'unknown'
  return null
}

function parseDocumentHandoffArgs(args: readonly string[]):
  | {
    readonly ok: true
    readonly documentId: string
    readonly status: FirmVaultDocumentHandoffStatus
    readonly prNumber?: number
    readonly prUrl?: string
    readonly branch?: string
    readonly submittedAt?: string
    readonly completedAt?: string
    readonly json: boolean
  }
  | { readonly ok: false; readonly error: string } {
  let documentId: string | undefined
  let status: FirmVaultDocumentHandoffStatus | undefined
  let prNumber: number | undefined
  let prUrl: string | undefined
  let branch: string | undefined
  let submittedAt: string | undefined
  let completedAt: string | undefined
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--document-id') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --document-id' }
      documentId = value
      index += 1
      continue
    }
    if (arg === '--status') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --status' }
      const parsedStatus = parseDocumentHandoffStatus(value)
      if (!parsedStatus) return { ok: false, error: `Unsupported FirmVault document handoff status: ${value}` }
      status = parsedStatus
      index += 1
      continue
    }
    if (arg === '--pr-number') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --pr-number' }
      const parsedNumber = Number(value)
      if (!Number.isInteger(parsedNumber) || parsedNumber < 1) return { ok: false, error: `Invalid FirmVault document handoff PR number: ${value}` }
      prNumber = parsedNumber
      index += 1
      continue
    }
    if (arg === '--pr-url') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --pr-url' }
      prUrl = value
      index += 1
      continue
    }
    if (arg === '--branch') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --branch' }
      branch = value
      index += 1
      continue
    }
    if (arg === '--submitted-at') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --submitted-at' }
      submittedAt = value
      index += 1
      continue
    }
    if (arg === '--completed-at') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --completed-at' }
      completedAt = value
      index += 1
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    return { ok: false, error: `Unknown firmvault document-handoff option: ${arg}` }
  }

  if (!documentId) return { ok: false, error: 'Missing required --document-id' }
  if (!status) return { ok: false, error: 'Missing required --status' }

  return {
    ok: true,
    documentId,
    status,
    json,
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(prUrl ? { prUrl } : {}),
    ...(branch ? { branch } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
  }
}

function parseDocumentHandoffStatus(value: string): FirmVaultDocumentHandoffStatus | null {
  if (value === 'not-started' || value === 'not_started') return 'not_started'
  if (value === 'submitted') return 'submitted'
  if (value === 'pr-opened' || value === 'pr_opened') return 'pr_opened'
  if (value === 'merged') return 'merged'
  if (value === 'deferred') return 'deferred'
  if (value === 'failed') return 'failed'
  return null
}

function parseInitCaseArgs(args: readonly string[]):
  | { readonly ok: true; readonly caseType: 'personal_injury'; readonly caseSlug?: string }
  | { readonly ok: false; readonly error: string } {
  let caseType: 'personal_injury' = 'personal_injury'
  let caseSlug: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--case-type') {
      const value = args[index + 1]
      if (value !== 'personal-injury' && value !== 'personal_injury') {
        return { ok: false, error: `Unsupported FirmVault case type: ${value ?? '<missing>'}` }
      }
      caseType = 'personal_injury'
      index += 1
      continue
    }
    if (arg === '--case-slug') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --case-slug' }
      caseSlug = value
      index += 1
      continue
    }
    return { ok: false, error: `Unknown firmvault init-case option: ${arg}` }
  }

  return { ok: true, caseType, ...(caseSlug ? { caseSlug } : {}) }
}

function parseBootstrapArgs(args: readonly string[]):
  | {
    readonly ok: true
    readonly casesRoot: string
    readonly caseName: string
    readonly caseType: 'personal_injury'
    readonly caseSlug?: string
    readonly startRoute: boolean
    readonly json: boolean
  }
  | { readonly ok: false; readonly error: string } {
  let casesRoot: string | undefined
  let caseName: string | undefined
  let caseType: 'personal_injury' = 'personal_injury'
  let caseSlug: string | undefined
  let startRoute = false
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cases-root') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --cases-root' }
      casesRoot = value
      index += 1
      continue
    }
    if (arg === '--case-name') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --case-name' }
      caseName = value
      index += 1
      continue
    }
    if (arg === '--case-type') {
      const value = args[index + 1]
      if (value !== 'personal-injury' && value !== 'personal_injury') {
        return { ok: false, error: `Unsupported FirmVault case type: ${value ?? '<missing>'}` }
      }
      caseType = 'personal_injury'
      index += 1
      continue
    }
    if (arg === '--case-slug') {
      const value = args[index + 1]
      if (!value) return { ok: false, error: 'Missing value for --case-slug' }
      caseSlug = value
      index += 1
      continue
    }
    if (arg === '--start') {
      startRoute = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    return { ok: false, error: `Unknown firmvault bootstrap option: ${arg}` }
  }

  if (!casesRoot) return { ok: false, error: 'Missing required --cases-root' }
  if (!caseName) return { ok: false, error: 'Missing required --case-name' }

  return {
    ok: true,
    casesRoot,
    caseName,
    caseType,
    startRoute,
    json,
    ...(caseSlug ? { caseSlug } : {}),
  }
}

function countSatisfiedLandmarks(projection: FirmVaultLandmarkProjection): number {
  return Object.values(projection.landmarks).filter((landmark) => landmark.satisfied).length
}

async function importFirmVaultStateModule(): Promise<FirmVaultStateModule> {
  return await import('@waypoint/folder-host') as unknown as FirmVaultStateModule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
