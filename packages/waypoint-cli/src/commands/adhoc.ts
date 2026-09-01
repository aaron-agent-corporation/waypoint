import { readFile } from 'node:fs/promises'

import {
  buildAdhocRecipeQuestYaml,
  getWaypointProjectPaths,
  loadWorkspaceWaypointCatalog,
  readWaypointProjectConfig,
  startAdhocRoute,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

/**
 * `waypoint adhoc --recipe <slug>` — run one catalog recipe as its own route
 * (rsc-6al remediation gap, 2026-07-14): both live referral runs needed one
 * artifact regenerated under a fixed recipe, but the placement node was
 * `done` — `tasks retry` correctly refuses done tasks, and a completed
 * durable node cannot be reopened. An ad-hoc route is the honest shape: a
 * fresh one-plan route over the same project root, executed by the bridge
 * with the full verify-then-apply + artifact-contract seam, leaving the
 * original run untouched and its failed downstream task retryable.
 *
 * The recipe resolves from the workspace catalog and is copied into the
 * route's session overlay (ad-hoc routes resolve recipes from their overlay
 * ONLY — D5), so later catalog edits never mutate a started route.
 */
export async function runAdhocCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  try {
    const recipe = readOption(args, '--recipe')
    if (recipe === undefined) {
      io.stderr('waypoint adhoc requires --recipe <slug>')
      return 1
    }
    const produces = readMultiOption(args, '--produces')
    const contract = readOption(args, '--contract')
    const title = readOption(args, '--title')
    const access: Record<string, string> = {}
    for (const entry of readMultiOption(args, '--access')) {
      const sep = entry.indexOf(':')
      if (sep === -1) {
        io.stderr(`--access must be '<binding>:ro|rw', got '${entry}'`)
        return 1
      }
      access[entry.slice(0, sep).trim()] = entry.slice(sep + 1).trim()
    }
    const dryRun = args.includes('--dry-run')

    const projectRoot = io.cwd ?? process.cwd()
    const catalog = await loadWorkspaceWaypointCatalog(projectRoot)
    const entry = catalog.recipeEntries.find((candidate) => candidate.slug === recipe)
    if (!entry) {
      io.stderr(`Recipe not found in local catalog: ${recipe} (waypoint recipes lists what this project can run)`)
      return 1
    }
    const recipeYaml = await readFile(entry.path, 'utf8')

    // No --access given? Grant the project's own declared roots at their
    // configured modes — the same thing prose's `Access: all` means.
    // Without this an adhoc run of a perfectly ordinary catalog recipe is
    // refused before it spawns ("the plan declares no access map — with the
    // jail enabled that means no spawn"), which is what happened trying to
    // re-run the coverage sensors on 2026-08-08. An adhoc run is an operator
    // re-running a vetted recipe on their own case; the useful default is the
    // access that case already grants, and `--access` still narrows it.
    let granted = access
    if (Object.keys(granted).length === 0) {
      try {
        const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
        granted = Object.fromEntries(
          Object.entries(config.roots ?? {}).map(([binding, root]) => [binding, root.access === 'rw' ? 'rw' : 'ro']),
        )
        if (Object.keys(granted).length > 0) {
          io.stderr(
            `No --access given; granting this project's declared roots: ` +
              Object.entries(granted)
                .map(([binding, mode]) => `${binding}:${mode}`)
                .join(', '),
          )
        }
      } catch {
        // Unreadable config leaves the map empty and the existing refusal stands.
      }
    }

    const quest = buildAdhocRecipeQuestYaml({
      recipe,
      ...(title !== undefined ? { title } : {}),
      ...(produces.length > 0 ? { produces } : {}),
      ...(contract !== undefined ? { contract } : {}),
      ...(Object.keys(granted).length > 0 ? { access: granted } : {}),
      slugSuffix: Date.now().toString(36),
    })

    const route = await startAdhocRoute(projectRoot, {
      sessionId: `cli-${quest.slug}`,
      questYaml: quest.yaml,
      recipeYamls: [recipeYaml],
      dryRun,
    })

    io.stdout(`Started ad-hoc run ${route.id}`)
    io.stdout(`recipe: ${recipe}`)
    io.stdout(`quest: ${route.quest}`)
    io.stdout(`status: ${route.status}`)
    io.stdout(`overlay: ${route.overlay}`)
    if (dryRun) {
      io.stdout('dry run: route + tasks materialized, nothing dispatched')
    } else {
      io.stdout(`watch: waypoint tasks --route-id ${route.id}`)
    }
    return 0
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function readMultiOption(args: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== name) continue
    const value = args[i + 1]
    if (value && !value.startsWith('--')) values.push(value)
  }
  return values
}
