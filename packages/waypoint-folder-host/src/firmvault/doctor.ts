import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type FirmVaultOperatorDoctorCheckStatus = 'pass' | 'warn' | 'fail'

export interface FirmVaultOperatorDoctorCheck {
  readonly slug: string
  readonly status: FirmVaultOperatorDoctorCheckStatus
  readonly message: string
  readonly path?: string
  readonly next_action?: string
}

export interface FirmVaultOperatorDoctorUpgradeStep {
  readonly slug: string
  readonly command: string
  readonly reason: string
}

export interface FirmVaultOperatorDoctorUpgradePlan {
  readonly mutates: false
  readonly steps: readonly FirmVaultOperatorDoctorUpgradeStep[]
}

export interface FirmVaultOperatorDoctorResult {
  readonly profile: string
  readonly ready: boolean
  readonly checks: readonly FirmVaultOperatorDoctorCheck[]
  readonly upgrade_plan?: FirmVaultOperatorDoctorUpgradePlan
}

export interface FirmVaultOperatorDoctorOptions {
  readonly profile?: string
  readonly workspaceRoot?: string
  readonly waypointCasesRoot?: string
  readonly sourceCasesRoot?: string
  readonly paralegalSkillPath?: string
  readonly repoRoot?: string
  readonly includeUpgradePlan?: boolean
}

const DEFAULT_PROFILE = 'paralegal'
const DEFAULT_WORKSPACE_ROOT = join(homedir(), '.hermes/agents/paralegal/workspace/FirmVault')
const DEFAULT_PARALEGAL_SKILL_PATH = join(
  homedir(),
  '.hermes/profiles/paralegal/skills/case-management/firmvault-waypoint-case-operations/SKILL.md',
)
const REQUIRED_SMOKE_SCRIPTS = [
  'scripts/firmvault-folder-smoke.mjs',
  'scripts/firmvault-staged-case-guidance-smoke.mjs',
  'scripts/firmvault-completed-case-replay.mjs',
] as const

export async function inspectFirmVaultOperatorReadiness(
  options: FirmVaultOperatorDoctorOptions = {},
): Promise<FirmVaultOperatorDoctorResult> {
  const profile = options.profile ?? DEFAULT_PROFILE
  if (profile !== DEFAULT_PROFILE) {
    const checks: FirmVaultOperatorDoctorCheck[] = [
      {
        slug: 'profile',
        status: 'fail',
        message: `Unsupported FirmVault doctor profile: ${profile}`,
        next_action: 'Use --profile paralegal for the FirmVault paralegal readiness doctor.',
      },
    ]
    return {
      profile,
      ready: false,
      checks,
      ...(options.includeUpgradePlan ? { upgrade_plan: buildFirmVaultOperatorUpgradePlan(checks) } : {}),
    }
  }

  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT
  const repoRoot = options.repoRoot ?? process.cwd()
  const waypointCasesRoot = options.waypointCasesRoot ?? join(workspaceRoot, 'waypoint_cases')
  const sourceCasesRoot = options.sourceCasesRoot ?? join(workspaceRoot, 'cases')
  const paralegalSkillPath = options.paralegalSkillPath ?? DEFAULT_PARALEGAL_SKILL_PATH

  const checks: FirmVaultOperatorDoctorCheck[] = []
  checks.push(
    await pathCheck({
      slug: 'waypoint_cases_root',
      path: waypointCasesRoot,
      missingStatus: 'fail',
      presentMessage: 'Waypoint case root exists for exported or bootstrapped FirmVault cases.',
      missingMessage: 'Waypoint case root is missing.',
      nextAction: 'Create the Waypoint case root before exporting or bootstrapping cases.',
    }),
  )
  checks.push(
    await pathCheck({
      slug: 'source_cases_root',
      path: sourceCasesRoot,
      missingStatus: 'warn',
      presentMessage: 'Legacy/source FirmVault cases root exists for local imports.',
      missingMessage: 'Legacy/source FirmVault cases root is absent; imports can still run from explicit paths.',
      nextAction: 'Create or pass an explicit source case path when importing legacy cases.',
    }),
  )
  checks.push(
    await pathCheck({
      slug: 'paralegal_skill',
      path: paralegalSkillPath,
      missingStatus: 'warn',
      presentMessage: 'Paralegal FirmVault Waypoint skill is installed.',
      missingMessage: 'Paralegal FirmVault Waypoint skill was not found at the configured path.',
      nextAction: 'Install or point the paralegal profile at the FirmVault Waypoint case-operations skill.',
    }),
  )
  checks.push(
    await pathCheck({
      slug: 'operator_manifest',
      path: join(repoRoot, 'operators/firmvault/paralegal.yaml'),
      missingStatus: 'fail',
      presentMessage: 'FirmVault paralegal operator manifest is available.',
      missingMessage: 'FirmVault paralegal operator manifest is missing.',
      nextAction: 'Restore operators/firmvault/paralegal.yaml before using the paralegal operator.',
    }),
  )
  checks.push(
    await pathCheck({
      slug: 'case_export_script',
      path: join(repoRoot, 'scripts/firmvault-waypoint-case-export.mjs'),
      missingStatus: 'fail',
      presentMessage: 'FirmVault Waypoint case export script is available.',
      missingMessage: 'FirmVault Waypoint case export script is missing.',
      nextAction: 'Restore scripts/firmvault-waypoint-case-export.mjs before running case export smoke checks.',
    }),
  )

  const smokeChecks = await Promise.all(REQUIRED_SMOKE_SCRIPTS.map((relativePath) => exists(join(repoRoot, relativePath))))
  const missingSmokeScripts = REQUIRED_SMOKE_SCRIPTS.filter((_, index) => !smokeChecks[index])
  checks.push({
    slug: 'smoke_scripts',
    status: missingSmokeScripts.length === 0 ? 'pass' : 'fail',
    message:
      missingSmokeScripts.length === 0
        ? 'Required FirmVault smoke scripts are available.'
        : `Missing FirmVault smoke scripts: ${missingSmokeScripts.join(', ')}`,
    path: repoRoot,
    ...(missingSmokeScripts.length > 0 ? { next_action: 'Restore missing FirmVault smoke scripts before release verification.' } : {}),
  })

  return {
    profile,
    ready: checks.every((check) => check.status !== 'fail'),
    checks,
    ...(options.includeUpgradePlan ? { upgrade_plan: buildFirmVaultOperatorUpgradePlan(checks) } : {}),
  }
}

function buildFirmVaultOperatorUpgradePlan(checks: readonly FirmVaultOperatorDoctorCheck[]): FirmVaultOperatorDoctorUpgradePlan {
  const steps = checks.flatMap((check): readonly FirmVaultOperatorDoctorUpgradeStep[] => {
    if (check.status === 'pass') return []

    switch (check.slug) {
      case 'profile':
        return [
          {
            slug: 'use_supported_profile',
            command: 'waypoint doctor firmvault --profile paralegal --json --upgrade-plan',
            reason: 'Only the paralegal readiness profile is currently supported.',
          },
        ]
      case 'waypoint_cases_root':
        return check.path
          ? [
              {
                slug: 'create_waypoint_cases_root',
                command: `mkdir -p ${JSON.stringify(check.path)}`,
                reason: 'Required before exporting or bootstrapping FirmVault cases.',
              },
            ]
          : []
      case 'source_cases_root':
        return check.path
          ? [
              {
                slug: 'create_source_cases_root',
                command: `mkdir -p ${JSON.stringify(check.path)}`,
                reason: 'Optional legacy/source case imports can use this root by default.',
              },
            ]
          : []
      case 'paralegal_skill':
        return [
          {
            slug: 'install_paralegal_skill',
            command: 'hermes skills install firmvault-waypoint-case-operations --profile paralegal',
            reason: 'The paralegal operator instructions should be available before autonomous case work.',
          },
        ]
      case 'operator_manifest':
        return [
          {
            slug: 'restore_operator_manifest',
            command: 'git checkout -- operators/firmvault/paralegal.yaml',
            reason: 'The bundled firmvault-paralegal operator manifest is required for operator/tool discovery.',
          },
        ]
      case 'case_export_script':
        return [
          {
            slug: 'restore_case_export_script',
            command: 'git checkout -- scripts/firmvault-waypoint-case-export.mjs',
            reason: 'The case export script is required for local FirmVault migration handoff checks.',
          },
        ]
      case 'smoke_scripts':
        return [
          {
            slug: 'restore_smoke_scripts',
            command: 'git checkout -- scripts/firmvault-folder-smoke.mjs scripts/firmvault-staged-case-guidance-smoke.mjs scripts/firmvault-completed-case-replay.mjs',
            reason: 'Required local smoke scripts should be present before release verification.',
          },
        ]
      default:
        return check.next_action
          ? [
              {
                slug: `review_${check.slug}`,
                command: check.next_action,
                reason: check.message,
              },
            ]
          : []
    }
  })

  return { mutates: false, steps }
}

async function pathCheck(input: {
  readonly slug: string
  readonly path: string
  readonly missingStatus: 'warn' | 'fail'
  readonly presentMessage: string
  readonly missingMessage: string
  readonly nextAction: string
}): Promise<FirmVaultOperatorDoctorCheck> {
  if (await exists(input.path)) {
    return {
      slug: input.slug,
      status: 'pass',
      message: input.presentMessage,
      path: input.path,
    }
  }
  return {
    slug: input.slug,
    status: input.missingStatus,
    message: input.missingMessage,
    path: input.path,
    next_action: input.nextAction,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
