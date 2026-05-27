import { mkdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { installQuestCatalog, type InstallQuestCatalogResult } from '../catalog/install.ts'
import {
  checkWaypointBeadsWorkspace,
  formatWaypointBeadsWorkspaceReadinessFailure,
  initializeWaypointBeadsWorkspace,
  type WaypointBeadsWorkspaceOptions,
} from '../beads/workspace.ts'
import type { WaypointRouteBackendMode } from '../project/config.ts'
import { initWaypointProject, type InitWaypointProjectResult } from '../project/init.ts'
import { startQuestRoute, type StartedQuestRoute } from '../routes/start.ts'
import { FIRMVAULT_REQUIRED_CASE_PATHS } from './case-folder'
import { initFirmVaultCaseState, type InitFirmVaultCaseStateResult } from './state.ts'

export interface FirmVaultCaseBootstrapInput {
  readonly casesRoot: string
  readonly caseName: string
  readonly caseType: 'personal_injury'
  readonly caseSlug?: string
  readonly ifExists?: 'fail' | 'reuse_empty'
  readonly now?: Date
}

export interface FirmVaultCaseBootstrapFolderResult {
  readonly caseRoot: string
  readonly caseSlug: string
  readonly createdPaths: readonly string[]
}

export interface FirmVaultCaseActivationInput extends FirmVaultCaseBootstrapInput {
  readonly startRoute?: boolean
  readonly backend?: WaypointRouteBackendMode
  readonly initBeads?: boolean
  readonly beadsWorkspace?: WaypointBeadsWorkspaceOptions
}

export interface FirmVaultCaseActivationResult extends FirmVaultCaseBootstrapFolderResult {
  readonly project: InitWaypointProjectResult
  readonly catalog: InstallQuestCatalogResult
  readonly firmvaultState: InitFirmVaultCaseStateResult
  readonly route?: StartedQuestRoute
}

export async function bootstrapFirmVaultCase(
  input: FirmVaultCaseActivationInput,
): Promise<FirmVaultCaseActivationResult> {
  const backend = input.backend ?? 'folder'
  await assertBeadsBootstrapWorkspacePreconditions(input, backend)

  const folder = await createFirmVaultCaseFolder(input)
  if (backend === 'beads' && input.initBeads) {
    const readiness = await initializeWaypointBeadsWorkspace({
      ...input.beadsWorkspace,
      cwd: input.beadsWorkspace?.cwd ?? folder.caseRoot,
      prefix: input.beadsWorkspace?.prefix ?? folder.caseSlug,
    })
    if (!readiness.ok) {
      throw new Error(formatWaypointBeadsWorkspaceReadinessFailure(readiness))
    }
  }

  const project = await initWaypointProject(folder.caseRoot, {
    quest: 'firmvault',
    ...(input.backend ? { backend: input.backend } : {}),
    now: input.now,
  })
  const catalog = await installQuestCatalog(folder.caseRoot, await loadBundledWaypointCatalog(), {
    quest: 'firmvault',
  })
  const firmvaultState = await initFirmVaultCaseState(folder.caseRoot, {
    caseType: input.caseType,
    caseSlug: folder.caseSlug,
    now: input.now,
  })
  const route = input.startRoute
    ? await startQuestRoute(folder.caseRoot, {
      quest: 'firmvault',
      now: input.now,
      ...(input.beadsWorkspace
        ? {
          beadsWorkspace: {
            ...input.beadsWorkspace,
            cwd: input.beadsWorkspace.cwd ?? folder.caseRoot,
          },
        }
        : {}),
    })
    : undefined

  return {
    ...folder,
    project,
    catalog,
    firmvaultState,
    ...(route ? { route } : {}),
  }
}

async function assertBeadsBootstrapWorkspacePreconditions(
  input: FirmVaultCaseActivationInput,
  backend: WaypointRouteBackendMode,
): Promise<void> {
  if (backend !== 'beads') {
    if (input.initBeads) {
      throw new Error('FirmVault Beads workspace initialization requires --backend beads.')
    }
    return
  }

  if (!input.startRoute && !input.initBeads) return

  const readiness = await checkWaypointBeadsWorkspace({
    ...input.beadsWorkspace,
    cwd: input.beadsWorkspace?.cwd ?? input.casesRoot,
  })

  if (input.initBeads) {
    if (readiness.status === 'missing-command') {
      throw new Error(formatWaypointBeadsWorkspaceReadinessFailure(readiness))
    }
    return
  }

  if (!readiness.ok) {
    throw new Error(
      `Beads-backed FirmVault bootstrap with --start requires an existing Beads workspace at the cases root, or --init-beads to create one in the new case root. ${formatWaypointBeadsWorkspaceReadinessFailure(readiness)}`,
    )
  }
}

export async function createFirmVaultCaseFolder(
  input: FirmVaultCaseBootstrapInput,
): Promise<FirmVaultCaseBootstrapFolderResult> {
  const caseSlug = input.caseSlug ?? slugifyCaseName(input.caseName)
  assertSafeCaseSlug(caseSlug)

  const caseRoot = join(input.casesRoot, caseSlug)
  assertInsideCasesRoot(input.casesRoot, caseRoot)

  if (await pathExists(caseRoot)) {
    throw new Error(`FirmVault case folder already exists: ${caseRoot}`)
  }

  const createdPaths: string[] = []
  await mkdir(caseRoot, { recursive: true })

  for (const relativePath of FIRMVAULT_REQUIRED_CASE_PATHS) {
    await createStarterPath(caseRoot, relativePath)
    createdPaths.push(relativePath)
  }

  const caseIndexPath = `${caseSlug}.md`
  await writeFile(join(caseRoot, caseIndexPath), caseIndexContent({
    caseName: input.caseName,
    caseSlug,
    caseType: input.caseType,
    now: input.now ?? new Date(),
  }))
  createdPaths.push(caseIndexPath)

  return {
    caseRoot,
    caseSlug,
    createdPaths,
  }
}

function slugifyCaseName(caseName: string): string {
  const slug = caseName
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) throw new Error('FirmVault case name must produce a non-empty slug')
  return slug
}

function assertSafeCaseSlug(caseSlug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(caseSlug) && !/^[a-z0-9]$/.test(caseSlug)) {
    throw new Error(`Unsafe FirmVault case slug: ${caseSlug}`)
  }
  if (caseSlug.includes('..') || caseSlug.includes('/') || caseSlug.includes('\\') || isAbsolute(caseSlug)) {
    throw new Error(`Unsafe FirmVault case slug: ${caseSlug}`)
  }
}

function assertInsideCasesRoot(casesRoot: string, caseRoot: string): void {
  const relativePath = relative(casesRoot, caseRoot)
  if (relativePath.startsWith('..') || relativePath === '' || relativePath.split(sep).includes('..')) {
    throw new Error(`FirmVault case root escapes cases root: ${caseRoot}`)
  }
}

async function createStarterPath(caseRoot: string, relativePath: string): Promise<void> {
  const fullPath = join(caseRoot, relativePath)
  if (relativePath.endsWith('/')) {
    await mkdir(fullPath, { recursive: true })
    return
  }
  const parent = relativePath.includes('/') ? join(fullPath, '..') : caseRoot
  await mkdir(parent, { recursive: true })
  await writeFile(fullPath, starterContent(relativePath))
}

function starterContent(relativePath: string): string {
  const title = relativePath
    .replace(/\.md$/, '')
    .split('/')
    .at(-1)
    ?.replace(/-/g, ' ') ?? relativePath
  return `# ${toTitleCase(title)}\n\n_Status: starter file._\n`
}

function caseIndexContent(input: {
  readonly caseName: string
  readonly caseSlug: string
  readonly caseType: 'personal_injury'
  readonly now: Date
}): string {
  return `---\ncase_slug: ${input.caseSlug}\ncase_type: ${input.caseType}\ncreated_at: ${input.now.toISOString()}\n---\n\n# ${input.caseName}\n\nFirmVault case folder created by Waypoint bootstrap.\n`
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      return false
    }
    throw error
  }
}
