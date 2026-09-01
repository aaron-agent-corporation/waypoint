import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { getWaypointProjectPaths } from '../project/root.ts'
import type { BundledWaypointCatalog } from './bundled.ts'

export interface InstallQuestCatalogOptions {
  readonly quest: string
  readonly preserveExistingQuest?: boolean
  /**
   * Adopt the bundled copy over a workspace recipe we cannot prove we installed
   * — the one-time repair for cases created before the install manifest existed.
   * Operator-invoked only (`waypoint recipes refresh --adopt`): it overwrites
   * files that MIGHT carry hand edits, so it is never the automatic behaviour.
   */
  readonly adoptUnmanaged?: boolean
}

export interface InstallQuestCatalogResult {
  readonly quest: { readonly slug: string }
  readonly recipes: readonly { readonly slug: string }[]
  readonly installedQuestPaths: readonly string[]
  /** Quest files updated in place: the case's copy was ours, and the bundle moved on. */
  readonly refreshedQuestPaths: readonly string[]
  /** Quest files kept despite differing from the bundle — hand edits or pre-manifest. */
  readonly divergedQuestPaths: readonly string[]
  /** Recipes written because the case did not have them. */
  readonly installedRecipePaths: readonly string[]
  /** Recipes updated in place: the case's copy was ours, and the bundle moved on. */
  readonly refreshedRecipePaths: readonly string[]
  /**
   * Recipes left alone that do NOT match the bundle — a hand edit, or a case old
   * enough to predate the manifest. These are the ones running against a prompt
   * the repo has since fixed, so they are reported rather than silently kept.
   */
  readonly divergedRecipePaths: readonly string[]
  /** Skills written because the case did not have them. */
  readonly installedSkillPaths: readonly string[]
  /** Skills updated in place: the case's copy was ours, and the bundle moved on. */
  readonly refreshedSkillPaths: readonly string[]
  /** Skills kept despite differing from the bundle — a hand edit, or pre-manifest. */
  readonly divergedSkillPaths: readonly string[]
}

/** Where we record what we installed, so a later install can tell ours from theirs. */
const INSTALL_MANIFEST = 'catalog-install.yaml'

/**
 * Install a quest's catalog into a case, and KEEP IT CURRENT.
 *
 * The original rule was workspace-wins-always: a recipe present at the target was
 * never rewritten, on the theory that it might carry operator edits. The cost was
 * invisible and total — a case pinned whatever recipes it was created with, so
 * every prompt fix shipped afterwards reached new cases only. Robin Vance's
 * document-intake recipe was 4 days old on 2026-07-27 when the intake filed
 * fifteen individual doctors and nurses as medical providers; the rule forbidding
 * exactly that had been committed six hours earlier and was never read.
 *
 * So we now distinguish the two cases the old rule conflated, using a manifest of
 * what we wrote:
 *   - the case's copy is byte-identical to what we installed → it is OURS, and a
 *     changed bundle refreshes it;
 *   - the case's copy differs from what we installed → an operator edited it;
 *     preserve it, and REPORT it, because divergence is now a fact worth seeing.
 * A file we never recorded is unmanaged: preserved, reported, and adoptable by an
 * explicit operator refresh — we do not guess about bytes we did not write.
 */
export async function installQuestCatalog(
  projectRoot: string,
  catalog: BundledWaypointCatalog,
  options: InstallQuestCatalogOptions,
): Promise<InstallQuestCatalogResult> {
  const resolved = catalog.resolveQuestRecipes(options.quest)
  if (!resolved.ok) {
    throw new Error(resolved.message)
  }

  const paths = getWaypointProjectPaths(projectRoot)
  const manifestPath = join(paths.runnerDir, INSTALL_MANIFEST)
  const manifest = await readInstallManifest(manifestPath)
  const recorded = new Map(Object.entries(manifest.recipes))
  const recordedQuests = new Map(Object.entries(manifest.quests))
  const recordedSkills = new Map(Object.entries(manifest.skills))

  const installedRecipePaths: string[] = []
  const refreshedRecipePaths: string[] = []
  const divergedRecipePaths: string[] = []
  const refreshedQuestPaths: string[] = []
  const divergedQuestPaths: string[] = []
  const installedSkillPaths: string[] = []
  const refreshedSkillPaths: string[] = []
  const divergedSkillPaths: string[] = []
  let manifestChanged = false

  // The quest file gets the same keep-it-current treatment as the recipes.
  // `preserveExistingQuest` used to pin the installed copy FOREVER, which is
  // the recipe-pinning failure all over again: the contact-intake de-gating
  // (2026-08-15) never reached a live case — every new emission compiled the
  // retired gate back into its route. Now "preserve" only protects a copy we
  // cannot prove we wrote; a copy that hashes to what we installed refreshes
  // when the bundle moves on.
  const questTarget = join(paths.runnerDir, 'quests', resolved.questEntry.relativePath)
  const questKey = resolved.questEntry.relativePath
  const bundledQuest = await readFile(resolved.questEntry.path)
  const bundledQuestHash = digest(bundledQuest)
  const currentQuest = await readFile(questTarget).catch(() => null)
  const questProjectPath = toProjectRelative(projectRoot, questTarget)
  if (currentQuest === null || options.preserveExistingQuest !== true) {
    await copyCatalogFile(resolved.questEntry.path, questTarget)
    if (recordedQuests.get(questKey) !== bundledQuestHash) {
      recordedQuests.set(questKey, bundledQuestHash)
      manifestChanged = true
    }
  } else {
    const currentQuestHash = digest(currentQuest)
    if (currentQuestHash === bundledQuestHash) {
      if (recordedQuests.get(questKey) !== bundledQuestHash) {
        recordedQuests.set(questKey, bundledQuestHash)
        manifestChanged = true
      }
    } else if (recordedQuests.get(questKey) === currentQuestHash || options.adoptUnmanaged === true) {
      await copyCatalogFile(resolved.questEntry.path, questTarget)
      refreshedQuestPaths.push(questProjectPath)
      recordedQuests.set(questKey, bundledQuestHash)
      manifestChanged = true
    } else {
      divergedQuestPaths.push(questProjectPath)
    }
  }

  for (const entry of resolved.recipeEntries) {
    const target = join(paths.runnerDir, 'recipes', entry.relativePath)
    const bundledBytes = await readFile(entry.path)
    const bundledHash = digest(bundledBytes)
    const projectPath = toProjectRelative(projectRoot, target)

    const current = await readFile(target).catch(() => null)
    if (current === null) {
      await copyCatalogFile(entry.path, target)
      installedRecipePaths.push(projectPath)
      recorded.set(entry.relativePath, bundledHash)
      manifestChanged = true
      continue
    }

    const currentHash = digest(current)
    if (currentHash === bundledHash) {
      // Already current. Seed the manifest so the NEXT bundle change can refresh
      // it — a case that has never diverged should not stay unmanaged forever.
      if (recorded.get(entry.relativePath) !== bundledHash) {
        recorded.set(entry.relativePath, bundledHash)
        manifestChanged = true
      }
      continue
    }

    const ours = recorded.get(entry.relativePath) === currentHash
    if (ours || options.adoptUnmanaged === true) {
      await copyCatalogFile(entry.path, target)
      refreshedRecipePaths.push(projectPath)
      recorded.set(entry.relativePath, bundledHash)
      manifestChanged = true
      continue
    }

    // Edited by hand, or older than the manifest: keep it, but say so.
    divergedRecipePaths.push(projectPath)
  }

  /**
   * SKILLS RIDE THE SAME RULE AS RECIPES.
   *
   * The whole bundle's skills install, not only the ones this quest's recipes
   * happen to name today: a skill is a few hundred bytes, and the alternative is
   * that adding `skills: [x]` to an installed recipe fails at composition until
   * someone re-runs the installer. Cheap to copy, expensive to be missing.
   */
  for (const skill of await bundledSkillFiles(catalog.skillsDir)) {
    const target = join(paths.runnerDir, 'skills', skill.relativePath)
    const bundledBytes = await readFile(skill.path)
    const bundledHash = digest(bundledBytes)
    const projectPath = toProjectRelative(projectRoot, target)

    const current = await readFile(target).catch(() => null)
    if (current === null) {
      await copyCatalogFile(skill.path, target)
      installedSkillPaths.push(projectPath)
      recordedSkills.set(skill.relativePath, bundledHash)
      manifestChanged = true
      continue
    }
    const currentHash = digest(current)
    if (currentHash === bundledHash) {
      if (recordedSkills.get(skill.relativePath) !== bundledHash) {
        recordedSkills.set(skill.relativePath, bundledHash)
        manifestChanged = true
      }
      continue
    }
    if (recordedSkills.get(skill.relativePath) === currentHash || options.adoptUnmanaged === true) {
      await copyCatalogFile(skill.path, target)
      refreshedSkillPaths.push(projectPath)
      recordedSkills.set(skill.relativePath, bundledHash)
      manifestChanged = true
      continue
    }
    // A skill an operator tuned for this case. Keep it, and say so — a diverged
    // skill is a worker running on discipline the repo has since revised.
    divergedSkillPaths.push(projectPath)
  }

  if (manifestChanged) {
    await writeInstallManifest(manifestPath, {
      recipes: Object.fromEntries(recorded),
      quests: Object.fromEntries(recordedQuests),
      skills: Object.fromEntries(recordedSkills),
    })
  }

  return {
    quest: { slug: resolved.quest.slug },
    recipes: resolved.recipes.map((recipe) => ({ slug: recipe.slug })),
    installedQuestPaths: [questProjectPath],
    installedRecipePaths: installedRecipePaths.sort(),
    refreshedRecipePaths: refreshedRecipePaths.sort(),
    divergedRecipePaths: divergedRecipePaths.sort(),
    refreshedQuestPaths: refreshedQuestPaths.sort(),
    divergedQuestPaths: divergedQuestPaths.sort(),
    installedSkillPaths: installedSkillPaths.sort(),
    refreshedSkillPaths: refreshedSkillPaths.sort(),
    divergedSkillPaths: divergedSkillPaths.sort(),
  }
}

/** Every `<name>.md` under the bundle's skills dir, relative path preserved. */
async function bundledSkillFiles(
  skillsDir: string,
): Promise<readonly { readonly path: string; readonly relativePath: string }[]> {
  const out: { path: string; relativePath: string }[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push({ path: full, relativePath: relative(skillsDir, full) })
      }
    }
  }
  await walk(skillsDir)
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface InstallManifest {
  readonly recipes: Record<string, string>
  readonly quests: Record<string, string>
  readonly skills: Record<string, string>
}

async function readInstallManifest(path: string): Promise<InstallManifest> {
  const empty: InstallManifest = { recipes: {}, quests: {}, skills: {} }
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return empty
  let parsed: unknown
  try {
    parsed = yamlParse(text)
  } catch {
    // An unreadable manifest means we cannot prove anything is ours, which is
    // the safe direction: everything reads as diverged and nothing is clobbered.
    return empty
  }
  if (parsed === null || typeof parsed !== 'object') return empty
  return {
    recipes: stringMap((parsed as Record<string, unknown>).recipes),
    quests: stringMap((parsed as Record<string, unknown>).quests),
    skills: stringMap((parsed as Record<string, unknown>).skills),
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

async function writeInstallManifest(path: string, manifest: InstallManifest): Promise<void> {
  const sortEntries = (map: Record<string, string>) =>
    Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `# Written by installQuestCatalog. Each entry is the sha256 of the bundled
# file as installed into this case: it is how a later install tells a file
# it wrote (safe to refresh) from one an operator edited (never clobbered).
${yamlStringify({
      schema_version: 1,
      recipes: sortEntries(manifest.recipes),
      quests: sortEntries(manifest.quests),
      skills: sortEntries(manifest.skills),
    })}`,
    'utf8',
  )
}

async function copyCatalogFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}

function toProjectRelative(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll('\\', '/')
}
