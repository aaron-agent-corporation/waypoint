import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

import { parseRecipeManifest } from '@waypoint/core'
import { appendRouteEvent } from '../events/jsonl.ts'
import { readWaypointProjectConfig, type WaypointProjectConfig } from '../project/config.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { WaypointBeadsCliIssueClient, type WaypointBeadsIssueMutationClient } from '../beads/cli-client.ts'
import { planWaypointBeadsRecipeExecution, type WaypointBeadsRecipeRuntimePolicy } from '../beads/execution.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsRunReconstruction, type WaypointBeadsRunTask } from '../beads/reconstruct.ts'
import { verifyWaypointBeadsTaskCompletion } from '../beads/verification.ts'
import { listWaypointRuntimeRoutes } from '../routes/read-model.ts'
import { getWaypointRoute, listWaypointRoutes, updateWaypointRoute } from '../routes/store.ts'
import { listWaypointTasks, updateWaypointTask } from '../tasks/store.ts'
import { LocalRecipeRuntime } from '../runtime/local-runtime.ts'
import { NullRecipeRuntime } from '../runtime/null-runtime.ts'

import type { RecipeManifest } from '@waypoint/core'
import type {
  RunWaypointAutopilotOptions,
  RunWaypointAutopilotResult,
  WaypointAutopilotRunPage,
  WaypointAutopilotRunRecord,
  WaypointAutopilotRunStatus,
} from './types.ts'
import type { WaypointFolderTask } from '../tasks/types.ts'

const DEFAULT_MAX_ITERATIONS = 20

export async function runWaypointAutopilot(
  projectRoot: string,
  options: RunWaypointAutopilotOptions = {},
): Promise<RunWaypointAutopilotResult> {
  const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
  if (config.backend.route === 'beads') return runWaypointBeadsAutopilot(projectRoot, config, options)

  const routeId = options.routeId ?? (await defaultRouteId(projectRoot))
  const route = await getWaypointRoute(projectRoot, routeId)
  if (!route) throw new Error(`Route not found: ${routeId}`)

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(`Autopilot max iterations must be a positive integer: ${maxIterations}`)
  }

  const runtime = await createRecipeRuntime(projectRoot)
  const completedTasks: string[] = []
  let iterations = 0
  let status: WaypointAutopilotRunStatus = 'complete'
  let blockedNode: string | null = null

  while (iterations < maxIterations) {
    if (options.signal?.aborted) {
      status = 'cancelled'
      await updateWaypointRoute(projectRoot, routeId, { status: 'cancelled', updated_at: timestampFor(options.now) })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.cancelled',
        now: options.now,
        payload: { completed_tasks: completedTasks },
      })
      break
    }

    const nextTask = await nextOpenTask(projectRoot, routeId)
    if (!nextTask) {
      status = 'complete'
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'complete',
        current_node: null,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.complete',
        now: options.now,
        payload: { completed_tasks: completedTasks },
      })
      break
    }

    iterations += 1

    if (nextTask.kind === 'gate') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'blocked',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'blocked',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.blocked',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, reason: 'human_gate' },
      })
      break
    }

    if (nextTask.kind === 'checkpoint') {
      const missingArtifacts = await missingOutputArtifacts(projectRoot, nextTask)
      if (missingArtifacts.length > 0) {
        status = 'blocked'
        blockedNode = nextTask.plan_ref
        await blockTaskForMissingArtifacts(projectRoot, routeId, nextTask, missingArtifacts, options.now)
        break
      }
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'done',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'active',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.checkpoint.completed',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref },
      })
      completedTasks.push(nextTask.id)
      continue
    }

    if (isUnsupportedAutopilotTask(nextTask)) {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'blocked',
        updated_at: timestampFor(options.now),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'blocked',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.unsupported_node',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, kind: nextTask.kind },
      })
      break
    }

    const recipeSlug = recipeSlugForTask(nextTask)
    const recipe = runtime instanceof LocalRecipeRuntime ? await loadRecipeManifest(projectRoot, recipeSlug, options.catalogDir) : null
    const output = await runtime.runRecipe({
      routeId,
      taskId: nextTask.id,
      recipe: recipe?.slug ?? recipeSlug,
      prompt: recipe?.prompt ?? '',
      projectRoot,
      signal: options.signal,
    })
    if (output.status === 'cancelled') {
      status = 'cancelled'
      blockedNode = nextTask.plan_ref
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'cancelled',
        updated_at: timestampFor(options.now),
        metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'cancelled',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.cancelled',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
      })
      break
    }
    if (output.status === 'failed') {
      status = 'failed'
      await updateWaypointTask(projectRoot, nextTask.id, {
        status: 'failed',
        updated_at: timestampFor(options.now),
        metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
      })
      await updateWaypointRoute(projectRoot, routeId, {
        status: 'failed',
        current_node: nextTask.plan_ref,
        updated_at: timestampFor(options.now),
      })
      await appendRouteEvent(projectRoot, routeId, {
        kind: 'route.autopilot.task.failed',
        now: options.now,
        payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
      })
      break
    }
    const missingArtifacts = await missingOutputArtifacts(projectRoot, nextTask)
    if (missingArtifacts.length > 0) {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockTaskForMissingArtifacts(projectRoot, routeId, nextTask, missingArtifacts, options.now, output)
      break
    }
    await updateWaypointTask(projectRoot, nextTask.id, {
      status: 'done',
      updated_at: timestampFor(options.now),
      metadata: mergeTaskMetadata(nextTask.metadata, { autopilot: output }),
    })
    await updateWaypointRoute(projectRoot, routeId, {
      status: 'active',
      current_node: nextTask.plan_ref,
      updated_at: timestampFor(options.now),
    })
    await appendRouteEvent(projectRoot, routeId, {
      kind: output.runtime === 'local' ? 'route.autopilot.task.executed' : 'route.autopilot.task.simulated',
      now: options.now,
      payload: { task_id: nextTask.id, node: nextTask.plan_ref, runtime: output },
    })
    completedTasks.push(nextTask.id)
  }

  if (iterations >= maxIterations && status === 'complete') {
    status = 'iteration_cap'
    await appendRouteEvent(projectRoot, routeId, {
      kind: 'route.autopilot.iteration_cap',
      now: options.now,
      payload: { max_iterations: maxIterations, completed_tasks: completedTasks },
    })
  }

  const run = await appendAutopilotRun(projectRoot, {
    route_id: routeId,
    status,
    iterations,
    completed_tasks: completedTasks,
    blocked_node: blockedNode,
    now: options.now,
  })

  return { run, status, routeId, iterations, completedTasks, blockedNode }
}

async function runWaypointBeadsAutopilot(
  projectRoot: string,
  config: WaypointProjectConfig,
  options: RunWaypointAutopilotOptions,
): Promise<RunWaypointAutopilotResult> {
  const routeId = options.routeId ?? (await defaultBeadsRouteId(projectRoot, options))
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(`Autopilot max iterations must be a positive integer: ${maxIterations}`)
  }

  const mutator = beadsMutationClient(projectRoot, options)
  const runtimePolicy = options.beadsRuntimePolicy ?? beadsRuntimePolicyFor(config)
  const completedTasks: string[] = []
  let iterations = 0
  let status: WaypointAutopilotRunStatus = 'complete'
  let blockedNode: string | null = null

  while (iterations < maxIterations) {
    const run = await loadBeadsRun(projectRoot, routeId, options)
    const nextTask = run.tasks.find((task) => task.status === 'open' && task.blockers.length === 0)
    if (!nextTask) {
      status = run.route.status === 'complete' ? 'complete' : 'blocked'
      blockedNode = run.route.current_node
      break
    }

    iterations += 1

    if (nextTask.kind === 'gate' || nextTask.kind === 'wait') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockBeadsTask(mutator, nextTask, `Waypoint autopilot stopped at ${nextTask.kind} ${nextTask.plan_ref}`)
      break
    }

    if (nextTask.kind === 'checkpoint' || nextTask.kind === 'discussion') {
      await closeBeadsAutopilotTask(mutator, nextTask, `Waypoint autopilot completed ${nextTask.kind} ${nextTask.plan_ref}`)
      completedTasks.push(nextTask.beads_id)
      continue
    }

    if (nextTask.kind !== 'recipe') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockBeadsTask(mutator, nextTask, `Waypoint autopilot does not support ${nextTask.kind} tasks yet`)
      break
    }

    const plan = planWaypointBeadsRecipeExecution(nextTask, runtimePolicy)
    if (plan.action !== 'run') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockBeadsTask(mutator, nextTask, `Waypoint autopilot recipe blocked: ${plan.block_reason ?? 'blocked'}`)
      break
    }

    const runtime = await createRecipeRuntime(projectRoot)
    const recipe = runtime instanceof LocalRecipeRuntime ? await loadRecipeManifest(projectRoot, plan.recipe_slug!) : null
    const output = await runtime.runRecipe({
      routeId,
      taskId: nextTask.beads_id,
      recipe: recipe?.slug ?? plan.recipe_slug!,
      prompt: recipe?.prompt ?? '',
      projectRoot,
    })
    if (output.status === 'failed') {
      status = 'failed'
      blockedNode = nextTask.plan_ref
      await mutator.addIssueComment({
        id: nextTask.beads_id,
        text: `Waypoint autopilot recipe failed for ${nextTask.plan_ref}\n\n${JSON.stringify(output)}`,
      })
      await mutator.updateIssueStatus({ id: nextTask.beads_id, status: 'failed' })
      break
    }

    const verification = await verifyWaypointBeadsTaskCompletion(nextTask, { artifactVerifier: options.artifactVerifier })
    if (verification.action === 'block_close') {
      status = 'blocked'
      blockedNode = nextTask.plan_ref
      await blockBeadsTask(
        mutator,
        nextTask,
        `Waypoint autopilot cannot close ${nextTask.plan_ref}: ${verification.block_reasons.join(', ')}`,
      )
      break
    }

    await closeBeadsAutopilotTask(
      mutator,
      nextTask,
      `Waypoint autopilot ${output.runtime === 'local' ? 'executed' : 'simulated'} recipe ${plan.recipe_slug}`,
      output,
    )
    completedTasks.push(nextTask.beads_id)
  }

  if (iterations >= maxIterations && status === 'complete') {
    status = 'iteration_cap'
  }

  const run = await appendAutopilotRun(projectRoot, {
    route_id: routeId,
    status,
    iterations,
    completed_tasks: completedTasks,
    blocked_node: blockedNode,
    now: options.now,
  })

  return { run, status, routeId, iterations, completedTasks, blockedNode }
}

export async function listWaypointAutopilotRuns(
  projectRoot: string,
  options: { readonly limit?: number; readonly offset?: number } = {},
): Promise<WaypointAutopilotRunPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Autopilot run limit must be a positive integer: ${limit}`)
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`Autopilot run offset must be a non-negative integer: ${offset}`)
  const runs = await readAllAutopilotRuns(projectRoot)
  return { items: runs.slice(offset, offset + limit), total: runs.length, limit, offset }
}

async function defaultBeadsRouteId(projectRoot: string, options: RunWaypointAutopilotOptions): Promise<string> {
  const routes = await listWaypointRuntimeRoutes(projectRoot, { beadsReader: options.beadsReader })
  const route = routes.find((item) => item.status === 'active') ?? routes[0]
  if (!route) throw new Error('No Waypoint Beads routes found')
  return route.id
}

async function loadBeadsRun(
  projectRoot: string,
  routeId: string,
  options: RunWaypointAutopilotOptions,
): Promise<WaypointBeadsRunReconstruction> {
  const reader = options.beadsReader ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
  return reconstructWaypointRunFromBeads({ ...(await reader.listIssueSnapshots()), routeId })
}

function beadsMutationClient(projectRoot: string, options: RunWaypointAutopilotOptions): WaypointBeadsIssueMutationClient {
  return options.beadsMutator ?? new WaypointBeadsCliIssueClient({ cwd: projectRoot })
}

function beadsRuntimePolicyFor(config: WaypointProjectConfig): WaypointBeadsRecipeRuntimePolicy {
  return {
    external_side_effects: config.runtime.recipe === 'local' ? 'allowed' : 'none',
  }
}

async function closeBeadsAutopilotTask(
  mutator: WaypointBeadsIssueMutationClient,
  task: WaypointBeadsRunTask,
  reason: string,
  runtimeOutput?: unknown,
): Promise<void> {
  await mutator.addIssueComment({
    id: task.beads_id,
    text: runtimeOutput ? `${reason}\n\n${JSON.stringify(runtimeOutput)}` : reason,
  })
  await mutator.closeIssue({ id: task.beads_id, reason })
}

async function blockBeadsTask(
  mutator: WaypointBeadsIssueMutationClient,
  task: WaypointBeadsRunTask,
  reason: string,
): Promise<void> {
  await mutator.addIssueComment({ id: task.beads_id, text: reason })
  await mutator.updateIssueStatus({ id: task.beads_id, status: 'blocked', note: reason })
}

async function createRecipeRuntime(projectRoot: string): Promise<NullRecipeRuntime | LocalRecipeRuntime> {
  const paths = getWaypointProjectPaths(projectRoot)
  const config = await readWaypointProjectConfig(paths.configPath)
  if (config.runtime.recipe !== 'local') return new NullRecipeRuntime()
  if (!config.runtime.command) throw new Error('Local Recipe runtime requires runtime.command in .waypoint/config.yaml')
  return new LocalRecipeRuntime({ command: config.runtime.command, args: config.runtime.args ?? [] })
}

async function loadRecipeManifest(projectRoot: string, recipeSlug: string, catalogDir?: string): Promise<RecipeManifest> {
  const recipeDirectory = catalogDir
    ? join(catalogDir, 'recipes')
    : join(getWaypointProjectPaths(projectRoot).waypointDir, 'recipes')
  for (const filePath of await walkYamlFiles(recipeDirectory)) {
    const parsed = parseRecipeManifest(await readFile(filePath, 'utf8'))
    if (parsed.ok && parsed.manifest.slug === recipeSlug) return parsed.manifest
  }
  throw new Error(`Recipe not found in local catalog: ${recipeSlug}`)
}

async function walkYamlFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkYamlFiles(full)))
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      out.push(full)
    }
  }
  return out.sort()
}

async function blockTaskForMissingArtifacts(
  projectRoot: string,
  routeId: string,
  task: WaypointFolderTask,
  missingArtifacts: readonly string[],
  now?: Date,
  runtimeOutput?: unknown,
): Promise<void> {
  await updateWaypointTask(projectRoot, task.id, {
    status: 'blocked',
    updated_at: timestampFor(now),
    metadata: mergeTaskMetadata(task.metadata, {
      ...(runtimeOutput ? { autopilot: runtimeOutput } : {}),
      missing_artifacts: missingArtifacts,
      block_reason: 'required_artifacts_missing',
    }),
  })
  await updateWaypointRoute(projectRoot, routeId, {
    status: 'blocked',
    current_node: task.plan_ref,
    updated_at: timestampFor(now),
  })
  await appendRouteEvent(projectRoot, routeId, {
    kind: 'route.autopilot.required_artifacts_missing',
    now,
    payload: { task_id: task.id, node: task.plan_ref, missing_artifacts: missingArtifacts },
  })
}

async function missingOutputArtifacts(projectRoot: string, task: WaypointFolderTask): Promise<string[]> {
  const artifacts = outputArtifactsForTask(task)
  const missing: string[] = []
  for (const artifact of artifacts) {
    const safePath = safeRelativeArtifactPath(artifact)
    if (!safePath) {
      missing.push(artifact)
      continue
    }
    try {
      const fullPath = join(projectRoot, safePath)
      await stat(fullPath)
      const invalidReason = await invalidOutputArtifactReason(projectRoot, safePath)
      if (invalidReason) missing.push(`${artifact} (${invalidReason})`)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        missing.push(artifact)
        continue
      }
      throw error
    }
  }
  return missing
}

function outputArtifactsForTask(task: WaypointFolderTask): string[] {
  const waypoint = isRecord(task.metadata?.waypoint) ? task.metadata.waypoint : {}
  if (!Array.isArray(waypoint.output_artifacts)) return []
  return waypoint.output_artifacts.filter((artifact): artifact is string => typeof artifact === 'string' && artifact.trim().length > 0)
}

async function invalidOutputArtifactReason(projectRoot: string, safePath: string): Promise<string | null> {
  if (safePath !== '03-medical/medical-chronology-output/medical-chronology.html') return null
  const html = await readFile(join(projectRoot, safePath), 'utf8')
  return await invalidMedicalChronologyHtmlReason(projectRoot, safePath, html)
}

async function invalidMedicalChronologyHtmlReason(projectRoot: string, safePath: string, html: string): Promise<string | null> {
  const requiredFragments = [
    "class='visit-card'",
    "class=\"visit-card\"",
    "class='visit-head'",
    "class=\"visit-head\"",
    "class='summary'",
    "class=\"summary\"",
    'Visit Summary:',
    "class='details-grid'",
    "class=\"details-grid\"",
    "class='box'",
    "class=\"box\"",
    "class='source-row'",
    "class=\"source-row\"",
  ]
  const hasVisitCard = requiredFragments.slice(0, 2).some((fragment) => html.includes(fragment))
  const missingRequired = [
    hasVisitCard ? null : 'visit-card',
    requiredFragments.slice(2, 4).some((fragment) => html.includes(fragment)) ? null : 'visit-head',
    requiredFragments.slice(4, 6).some((fragment) => html.includes(fragment)) ? null : 'summary',
    html.includes('Visit Summary:') ? null : 'Visit Summary label',
    requiredFragments.slice(7, 9).some((fragment) => html.includes(fragment)) ? null : 'details-grid',
    requiredFragments.slice(9, 11).some((fragment) => html.includes(fragment)) ? null : 'box',
    requiredFragments.slice(11, 13).some((fragment) => html.includes(fragment)) ? null : 'source-row',
  ].filter((item): item is string => Boolean(item))
  const processLanguage = [
    'Quest task-',
    '<strong>Generated:</strong>',
    'Internal reports:',
    'Internal citations',
    'source-visual-inspection-ledger',
  ].filter((fragment) => html.includes(fragment))
  const unresolvedSourceLinks = await unresolvedChronologySourceLinks(projectRoot, safePath, html)
  const reasons = [
    ...missingRequired.map((item) => `missing ${item}`),
    ...processLanguage.map((item) => `attorney-facing process/meta text: ${item}`),
    ...unresolvedSourceLinks.map((item) => `missing source PDF link target: ${item}`),
  ]
  return reasons.length > 0 ? `invalid chronology template: ${reasons.join('; ')}` : null
}

async function unresolvedChronologySourceLinks(projectRoot: string, safePath: string, html: string): Promise<string[]> {
  const out: string[] = []
  const linkPattern = /href=["']([^"']+\.pdf)["']/gi
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1]
    if (!href || href.startsWith('http:') || href.startsWith('https:') || href.startsWith('mailto:') || isAbsolute(href)) continue
    const artifactDir = safePath.split('/').slice(0, -1).join('/')
    const target = safeRelativeArtifactPath(join(artifactDir, href))
    if (!target) {
      out.push(href)
      continue
    }
    try {
      await stat(join(projectRoot, target))
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        out.push(href)
        continue
      }
      throw error
    }
  }
  return out
}

function safeRelativeArtifactPath(artifact: string): string | null {
  const normalized = normalize(artifact.trim())
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) return null
  return normalized
}

async function defaultRouteId(projectRoot: string): Promise<string> {
  const routes = await listWaypointRoutes(projectRoot)
  const route = routes.find((item) => item.status === 'active') ?? routes[0]
  if (!route) throw new Error('No Waypoint routes found')
  return route.id
}

async function nextOpenTask(projectRoot: string, routeId: string): Promise<WaypointFolderTask | null> {
  const tasks = await listWaypointTasks(projectRoot)
  return tasks.find((task) => task.route_id === routeId && task.status === 'open') ?? null
}

async function appendAutopilotRun(
  projectRoot: string,
  input: {
    readonly route_id: string
    readonly status: WaypointAutopilotRunStatus
    readonly iterations: number
    readonly completed_tasks: readonly string[]
    readonly blocked_node: string | null
    readonly now?: Date
  },
): Promise<WaypointAutopilotRunRecord> {
  const existing = await readAllAutopilotRuns(projectRoot)
  const timestamp = timestampFor(input.now)
  const run: WaypointAutopilotRunRecord = {
    id: `autopilot-run-${String(existing.length + 1).padStart(3, '0')}`,
    route_id: input.route_id,
    status: input.status,
    iterations: input.iterations,
    completed_tasks: input.completed_tasks,
    blocked_node: input.blocked_node,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await mkdir(autopilotDirectory(projectRoot), { recursive: true })
  await appendFile(autopilotRunsPath(projectRoot), `${JSON.stringify(run)}\n`, 'utf8')
  return run
}

async function readAllAutopilotRuns(projectRoot: string): Promise<WaypointAutopilotRunRecord[]> {
  let raw: string
  try {
    raw = await readFile(autopilotRunsPath(projectRoot), 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WaypointAutopilotRunRecord)
}

function recipeSlugForTask(task: WaypointFolderTask): string {
  const waypoint = isRecord(task.metadata?.waypoint) ? task.metadata.waypoint : {}
  if (task.kind === 'discussion') {
    const discussion = isRecord(waypoint.discussion) ? waypoint.discussion : {}
    if (typeof discussion.agent === 'string' && discussion.agent.trim()) return discussion.agent.trim()
    throw new Error(`Discussion task ${task.id} (${task.plan_ref}) is missing metadata.waypoint.discussion.agent`)
  }
  if (task.kind === 'recipe') {
    const recipe = isRecord(waypoint.recipe) ? waypoint.recipe : {}
    if (typeof recipe.slug === 'string' && recipe.slug.trim()) return recipe.slug.trim()
    throw new Error(`Recipe task ${task.id} (${task.plan_ref}) is missing metadata.waypoint.recipe.slug`)
  }
  throw new Error(`Task ${task.id} (${task.plan_ref}) of kind ${task.kind} is not executable as a Recipe`)
}

function isUnsupportedAutopilotTask(task: WaypointFolderTask): boolean {
  return task.kind === 'wait' || task.kind === 'delay' || task.kind === 'timer' || task.kind === 'dependency' || task.kind === 'system'
}

function mergeTaskMetadata(
  metadata: Record<string, unknown> | undefined,
  waypointPatch: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadata ?? {}
  const waypoint = isRecord(existing.waypoint) ? existing.waypoint : {}
  return { ...existing, waypoint: { ...waypoint, ...waypointPatch } }
}

function autopilotDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'autopilot')
}

function autopilotRunsPath(projectRoot: string): string {
  return join(autopilotDirectory(projectRoot), 'runs.jsonl')
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
