import type { WaypointCliIo } from '../bin.ts'

interface FirmVaultCaseFolderInspection {
  readonly root: string
  readonly looksLikeFirmVaultCase: boolean
  readonly caseSlug: string | null
  readonly caseIndexCandidates: readonly string[]
  readonly presentRequiredPaths: readonly string[]
  readonly missingRequiredPaths: readonly string[]
  readonly warnings: readonly string[]
}

interface FirmVaultOperatorDoctorResult {
  readonly profile: string
  readonly ready: boolean
  readonly checks: readonly {
    readonly slug: string
    readonly status: 'pass' | 'warn' | 'fail'
    readonly message: string
    readonly path?: string
    readonly next_action?: string
  }[]
  readonly upgrade_plan?: {
    readonly mutates: false
    readonly steps: readonly {
      readonly slug: string
      readonly command: string
      readonly reason: string
    }[]
  }
}

type FirmVaultCaseFolderModule = {
  readonly inspectFirmVaultCaseFolder: (root: string) => Promise<FirmVaultCaseFolderInspection>
  readonly inspectFirmVaultOperatorReadiness: (options: {
    readonly profile?: string
    readonly workspaceRoot?: string
    readonly repoRoot?: string
    readonly includeUpgradePlan?: boolean
  }) => Promise<FirmVaultOperatorDoctorResult>
}

export async function runDoctorCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [target, ...rest] = args
  const json = rest.includes('--json')
  const profile = valueAfter(rest, '--profile')

  if (target !== 'firmvault') {
    io.stderr('Usage: waypoint doctor firmvault [--profile paralegal] [--workspace-root <path>] [--json]')
    return 1
  }

  if (profile !== undefined) {
    const readiness = await inspectCurrentFirmVaultOperatorReadiness({
      profile,
      workspaceRoot: valueAfter(rest, '--workspace-root'),
      repoRoot: io.cwd ?? process.cwd(),
      includeUpgradePlan: rest.includes('--upgrade-plan'),
    })
    if (json) {
      io.stdout(JSON.stringify(readiness, null, 2))
      return readiness.ready ? 0 : 1
    }

    io.stdout('Waypoint FirmVault operator doctor')
    io.stdout(`profile: ${readiness.profile}`)
    io.stdout(`ready: ${readiness.ready}`)
    for (const check of readiness.checks) {
      io.stdout(`- ${check.status} ${check.slug}: ${check.message}${check.path ? ` (${check.path})` : ''}`)
      if (check.next_action) io.stdout(`  next: ${check.next_action}`)
    }
    return readiness.ready ? 0 : 1
  }

  const inspection = await inspectCurrentFirmVaultCaseFolder(io.cwd ?? process.cwd())
  if (json) {
    io.stdout(JSON.stringify(inspection, null, 2))
    return 0
  }

  io.stdout('Waypoint FirmVault doctor')
  io.stdout(`folder: ${inspection.root}`)
  io.stdout(`looks_like_firmvault_case: ${inspection.looksLikeFirmVaultCase}`)
  io.stdout(`case_slug: ${inspection.caseSlug ?? 'null'}`)
  io.stdout(`present required paths: ${inspection.presentRequiredPaths.length}`)
  io.stdout(
    inspection.missingRequiredPaths.length === 0
      ? 'missing required paths: none'
      : `missing required paths:\n${inspection.missingRequiredPaths.map((relativePath) => `  - ${relativePath}`).join('\n')}`,
  )
  if (inspection.warnings.length > 0) {
    io.stdout(`warnings:\n${inspection.warnings.map((warning) => `  - ${warning}`).join('\n')}`)
  }
  return 0
}

async function inspectCurrentFirmVaultCaseFolder(root: string): Promise<FirmVaultCaseFolderInspection> {
  const module = await import('@waypoint/folder-host') as unknown as FirmVaultCaseFolderModule
  return module.inspectFirmVaultCaseFolder(root)
}

async function inspectCurrentFirmVaultOperatorReadiness(options: {
  readonly profile?: string
  readonly workspaceRoot?: string
  readonly repoRoot?: string
  readonly includeUpgradePlan?: boolean
}): Promise<FirmVaultOperatorDoctorResult> {
  const module = await import('@waypoint/folder-host') as unknown as FirmVaultCaseFolderModule
  return module.inspectFirmVaultOperatorReadiness(options)
}

function valueAfter(args: readonly string[], option: string): string | undefined {
  const index = args.indexOf(option)
  return index === -1 ? undefined : args[index + 1]
}
