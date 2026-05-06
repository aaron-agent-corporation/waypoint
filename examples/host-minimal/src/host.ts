/**
 * Minimal Waypoint host — portability proof (M5.1).
 *
 * This module demonstrates that `@waypoint/core` is host-agnostic by
 * wiring in-memory stub adapters for the core's host contracts:
 *   - IWaypointStore
 *   - IWaypointAuthz
 *   - IEventBus
 *   - IRecipeRuntime
 *
 * It MUST NOT import from Mission Control (`@/lib/...`) or Next.js.
 */

import {
  parseWaypointCommand,
  buildWaypointRouteKey,
  makeErrorEnvelope,
  type IEventBus,
  type IWaypointAuthz,
  type IWaypointStore,
  type IRecipeRuntime,
  type RecipeRunHandle,
  type RecipeRunRequest,
  type WaypointActor,
  type WaypointEventRecord,
  type WaypointParsedCommand,
  type WaypointRouteRecord,
} from '@waypoint/core'

// ---------- In-memory stub adapters (host-specific, not in core) ----------

class InMemoryStore implements IWaypointStore {
  private routes = new Map<number, WaypointRouteRecord>()
  private events: WaypointEventRecord[] = []
  private nextRouteId = 1
  private nextEventId = 1

  async createRoute(
    route: Omit<WaypointRouteRecord, 'id'>,
  ): Promise<WaypointRouteRecord> {
    const id = this.nextRouteId++
    const stored: WaypointRouteRecord = { ...route, id }
    this.routes.set(id, stored)
    return stored
  }

  async getRouteById(routeId: number): Promise<WaypointRouteRecord | null> {
    return this.routes.get(routeId) ?? null
  }

  async listRoutes(input: {
    projectId: number
    status?: WaypointRouteRecord['status']
    limit: number
    offset: number
  }): Promise<{ items: WaypointRouteRecord[]; total: number }> {
    const all = [...this.routes.values()].filter(
      (r) =>
        r.projectId === input.projectId &&
        (input.status ? r.status === input.status : true),
    )
    const items = all.slice(input.offset, input.offset + input.limit)
    return { items, total: all.length }
  }

  async appendRouteEvent(input: {
    routeId: number
    kind: string
    payload?: unknown
    createdAt: number
  }): Promise<WaypointEventRecord> {
    const rec: WaypointEventRecord = {
      id: this.nextEventId++,
      routeId: input.routeId,
      kind: input.kind,
      createdAt: input.createdAt,
      payload: input.payload,
    }
    this.events.push(rec)
    return rec
  }
}

class AllowAllAuthz implements IWaypointAuthz {
  async requireProjectReadAccess(_input: {
    actor: WaypointActor
    projectId: number
  }): Promise<void> {
    /* no-op stub */
  }
  async requireProjectMutateAccess(_input: {
    actor: WaypointActor
    projectId: number
  }): Promise<void> {
    /* no-op stub */
  }
}

interface CapturedEvent {
  type: string
  timestamp: number
  payload?: unknown
}

class CapturingEventBus implements IEventBus {
  readonly events: CapturedEvent[] = []
  publish(event: CapturedEvent): void {
    this.events.push(event)
  }
}

class StubRecipeRuntime implements IRecipeRuntime {
  private runs = new Map<string, RecipeRunHandle>()
  private counter = 0

  async startRecipe(_req: RecipeRunRequest): Promise<RecipeRunHandle> {
    const runId = `run-${++this.counter}`
    const handle: RecipeRunHandle = { runId, status: 'queued' }
    this.runs.set(runId, handle)
    return handle
  }
  async getRun(runId: string): Promise<RecipeRunHandle | null> {
    return this.runs.get(runId) ?? null
  }
  async cancelRun(runId: string): Promise<void> {
    const h = this.runs.get(runId)
    if (h) this.runs.set(runId, { ...h, status: 'cancelled' })
  }
}

// ---------- Host driver ----------

export interface MinimalWaypointScenarioInput {
  command: string
  actor: WaypointActor
  projectId: number
}

export interface MinimalWaypointScenarioResult {
  parsed?: WaypointParsedCommand
  routeKey?: string
  route?: WaypointRouteRecord
  listedRoutes: { items: WaypointRouteRecord[]; total: number }
  events: CapturedEvent[]
  recipeRun?: RecipeRunHandle
  error?: ReturnType<typeof makeErrorEnvelope>
}

export async function runMinimalWaypointHostScenario(
  input: MinimalWaypointScenarioInput,
): Promise<MinimalWaypointScenarioResult> {
  const store = new InMemoryStore()
  const authz = new AllowAllAuthz()
  const bus = new CapturingEventBus()
  const recipes = new StubRecipeRuntime()

  let parsed: WaypointParsedCommand | undefined
  try {
    parsed = parseWaypointCommand(input.command)
  } catch (err) {
    return {
      listedRoutes: { items: [], total: 0 },
      events: bus.events,
      error: makeErrorEnvelope((err as Error).message || 'Invalid command'),
    }
  }

  if (parsed.name !== 'start') {
    return {
      parsed,
      listedRoutes: { items: [], total: 0 },
      events: bus.events,
      error: makeErrorEnvelope(`Unsupported scenario for command: ${parsed.name}`),
    }
  }

  await authz.requireProjectMutateAccess({ actor: input.actor, projectId: input.projectId })

  const routeKey = buildWaypointRouteKey({
    subjectType: 'waypoint_plan',
    subjectId: parsed.planId,
    definitionSlug: parsed.definitionSlug,
    definitionVersion: parsed.definitionVersion,
  })

  const route = await store.createRoute({
    projectId: input.projectId,
    subjectType: 'waypoint_plan',
    subjectId: parsed.planId,
    status: 'active',
  })

  const recipeRun = await recipes.startRecipe({
    recipe: parsed.definitionSlug,
    input: { planId: parsed.planId, routeKey },
  })

  const now = Date.now()
  await store.appendRouteEvent({
    routeId: route.id,
    kind: 'waypoint.route.started',
    createdAt: now,
    payload: { routeKey, recipeRunId: recipeRun.runId },
  })
  bus.publish({
    type: 'waypoint.route.started',
    timestamp: now,
    payload: { routeId: route.id, routeKey, recipeRunId: recipeRun.runId },
  })

  const listed = await store.listRoutes({
    projectId: input.projectId,
    limit: 50,
    offset: 0,
  })

  return {
    parsed,
    routeKey,
    route,
    listedRoutes: listed,
    events: bus.events,
    recipeRun,
  }
}
