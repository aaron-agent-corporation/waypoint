import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  auditCatalogRecipes,
  findingsOfCode,
  findWaypointProjectRoot,
  getWaypointProjectPaths,
  formatCatalogEntryWarning,
  installQuestCatalog,
  loadBundledWaypointCatalog,
  readWaypointProjectConfig,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import { loadCliCatalog } from './catalog-io.ts'

export async function runRecipesCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  if (args[0] === 'refresh') return runRecipesRefresh(args.slice(1), io)
  const quest = readStringOption(args, '--quest')
  const catalog = await loadCliCatalog(io)
  if (!catalog) return 1

  if (quest) {
    // Resolution-only surface: lists the recipe winners THIS quest references.
    // Unrelated malformed files are out of scope; a malformed file the quest does
    // reference fails loud below. Skip-and-warn is for the unscoped listing only.
    const resolved = catalog.resolveQuestRecipes(quest)
    if (!resolved.ok) {
      io.stderr(resolved.message)
      return 1
    }

    io.stdout(`Task quests for quest: ${quest}`)
    for (const recipe of resolved.recipes) {
      io.stdout(`- ${recipe.slug}: ${recipe.name}`)
    }
    return 0
  }

  // Skip-and-warn: a malformed authored manifest is reported, not fatal to the list.
  for (const error of catalog.recipeErrors) io.stderr(formatCatalogEntryWarning(error))
  io.stdout('Task quests')
  for (const recipe of catalog.recipes.list()) {
    io.stdout(`- ${recipe.slug}: ${recipe.name}`)
  }
  // H-7: what parsing cannot see — a named skill that resolves nowhere.
  // Reported here because this is the command an operator runs to see the
  // catalog, and an unresolvable skill would otherwise stay invisible until a
  // case was already running. Warnings on stderr, so the listing on stdout
  // stays pipeable. (The inert-tools warning that used to ride here retired
  // with item 29 — the parser refuses such a recipe outright now, so it
  // surfaces above as a recipeErrors line instead.)
  const findings = await auditCatalogRecipes(catalog)
  const skillProblems = findingsOfCode(findings, 'unresolvable-skill')
  for (const finding of skillProblems) io.stderr(`warning: ${finding.message}`)
  // A recipe the loose discovery loader lists but the authoritative parser
  // refuses would otherwise look healthy here and fail only at a case start.
  for (const finding of findingsOfCode(findings, 'invalid-manifest')) {
    io.stderr(`warning: will refuse at start — ${finding.message}`)
  }
  return 0
}

/**
 * `waypoint recipes refresh [--quest <slug>] [--adopt]`
 *
 * Bring this project's installed recipes back in line with the bundle. Without
 * `--adopt` it only rewrites files the installer can prove it wrote, and REPORTS
 * the rest; with `--adopt` it overwrites files it cannot prove, which is the
 * one-time repair for cases created before the install manifest existed. Adopt
 * discards local edits, so it is never automatic and never the default.
 */
async function runRecipesRefresh(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = await findWaypointProjectRoot(io.cwd ?? process.cwd())
  if (!projectRoot) {
    io.stderr('recipes refresh needs a Waypoint project (no .waypoint found in this directory or its parents).')
    return 1
  }
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath).catch(() => null)
  const named = readStringOption(args, '--quest')
  const adopt = args.includes('--adopt')
  const catalog = await loadBundledWaypointCatalog()

  // EVERY quest the project has, not just the one in config. A project runs
  // its workstreams as their own quests, each carrying its own recipes —
  // refreshing only the config quest reports "already current" while the
  // recipes that actually run the work stay years behind (in-vivo, 2026-07-27).
  const quests = named !== null ? [named] : await installedQuestSlugs(paths.runnerDir, config?.quest ?? null)
  if (quests.length === 0) {
    io.stderr('recipes refresh found no quests to refresh: pass --quest <slug>.')
    return 1
  }

  let installed = 0
  let refreshed = 0
  let diverged = 0
  let refreshable = 0
  for (const quest of quests) {
    if (!catalog.resolveQuestRecipes(quest).ok) {
      if (named !== null) {
        io.stderr(`No bundled quest '${quest}' to refresh from.`)
        return 1
      }
      // An authored-only quest has no bundle to track. Not an error.
      continue
    }
    refreshable += 1
    const result = await installQuestCatalog(projectRoot, catalog, {
      quest,
      preserveExistingQuest: true,
      adoptUnmanaged: adopt,
    })
    for (const path of result.installedRecipePaths) io.stdout(`installed  ${path}`)
    for (const path of result.refreshedRecipePaths) io.stdout(`${adopt ? 'adopted  ' : 'refreshed'}  ${path}`)
    for (const path of result.divergedRecipePaths) {
      io.stdout(`diverged   ${path} (kept — re-run with --adopt to take the bundled copy)`)
    }
    // The quest file rides the same manifest discipline as the recipes now —
    // a silent quest refresh looked like "already current" while the graph
    // the case compiles actually changed.
    for (const path of result.refreshedQuestPaths) io.stdout(`${adopt ? 'adopted  ' : 'refreshed'}  ${path}`)
    for (const path of result.divergedQuestPaths) {
      io.stdout(`diverged   ${path} (kept — re-run with --adopt to take the bundled copy)`)
    }
    // Skills too: a cordis worker's discipline is content the repo ships, so a
    // stale or diverged skill is a worker running on a rule that has since
    // changed — the same thing the recipe manifest exists to make visible.
    for (const path of result.installedSkillPaths) io.stdout(`installed  ${path}`)
    for (const path of result.refreshedSkillPaths) io.stdout(`${adopt ? 'adopted  ' : 'refreshed'}  ${path}`)
    for (const path of result.divergedSkillPaths) {
      io.stdout(`diverged   ${path} (kept — re-run with --adopt to take the bundled copy)`)
    }
    installed += result.installedRecipePaths.length + result.installedSkillPaths.length
    refreshed +=
      result.refreshedRecipePaths.length + result.refreshedQuestPaths.length + result.refreshedSkillPaths.length
    diverged +=
      result.divergedRecipePaths.length + result.divergedQuestPaths.length + result.divergedSkillPaths.length
  }

  if (refreshable === 0) {
    io.stderr('recipes refresh found no bundled quests to refresh from.')
    return 1
  }
  const changed = installed + refreshed
  if (changed === 0 && diverged === 0) {
    io.stdout(`recipes across ${refreshable} quest(s) are already current.`)
    return 0
  }
  io.stdout(
    `${changed} recipe(s) updated across ${refreshable} quest(s)`
    + (diverged > 0 ? `, ${diverged} left diverged.` : '.'),
  )
  // Divergence left standing is not an error — it is the operator's file. It is
  // reported on stdout so a human sees which prompts this project actually runs.
  return 0
}

/** Quest slugs this project has installed, plus the config's own, deduped. */
async function installedQuestSlugs(runnerDir: string, configQuest: string | null): Promise<string[]> {
  const entries = await readdir(join(runnerDir, 'quests')).catch(() => [] as string[])
  const slugs = new Set(
    entries.filter((name) => name.endsWith('.yaml')).map((name) => name.slice(0, -'.yaml'.length)),
  )
  if (configQuest !== null) slugs.add(configQuest)
  return [...slugs].sort()
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
