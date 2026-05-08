import type { WaypointCliIo } from '../bin.ts'

interface InitFirmVaultCaseStateResult {
  readonly stateDir: string
  readonly projection: FirmVaultLandmarkProjection
}

interface FirmVaultLandmarkProjection {
  readonly schema_version: 1
  readonly generated_at: string
  readonly landmarks: Record<string, { readonly satisfied: boolean; readonly evidence: readonly unknown[] }>
  readonly warnings: readonly string[]
}

type FirmVaultStateModule = {
  readonly initFirmVaultCaseState: (
    root: string,
    options: { readonly caseType: 'personal_injury'; readonly caseSlug?: string },
  ) => Promise<InitFirmVaultCaseStateResult>
  readonly readFirmVaultLandmarkProjection: (root: string) => Promise<FirmVaultLandmarkProjection>
}

const usageLines = [
  'Usage: waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]',
  '       waypoint firmvault landmarks [--json]',
]

export async function runFirmVaultCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand, ...rest] = args

  if (subcommand === 'init-case') {
    return runInitCase(rest, io)
  }

  if (subcommand === 'landmarks') {
    return runLandmarks(rest, io)
  }

  usageLines.forEach((line) => io.stderr(line))
  return 1
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

function countSatisfiedLandmarks(projection: FirmVaultLandmarkProjection): number {
  return Object.values(projection.landmarks).filter((landmark) => landmark.satisfied).length
}

async function importFirmVaultStateModule(): Promise<FirmVaultStateModule> {
  return await import('@waypoint/folder-host') as unknown as FirmVaultStateModule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
