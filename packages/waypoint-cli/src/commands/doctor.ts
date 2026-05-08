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

type FirmVaultCaseFolderModule = {
  readonly inspectFirmVaultCaseFolder: (root: string) => Promise<FirmVaultCaseFolderInspection>
}

export async function runDoctorCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [target, ...rest] = args
  const json = rest.includes('--json')

  if (target !== 'firmvault') {
    io.stderr('Usage: waypoint doctor firmvault [--json]')
    return 1
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
