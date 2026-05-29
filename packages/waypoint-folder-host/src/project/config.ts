import { readFile } from 'node:fs/promises'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export type WaypointRecipeRuntimeMode = 'null' | 'local'
export type WaypointRouteBackendMode = 'folder' | 'beads'

export interface WaypointProjectBackendConfig {
  readonly route: WaypointRouteBackendMode
}

export interface WaypointProjectRuntimeConfig {
  readonly recipe: WaypointRecipeRuntimeMode | null
  readonly command?: string
  readonly args?: readonly string[]
  readonly gascity?: WaypointProjectGasCityRuntimeConfig
}

export interface WaypointProjectGasCityRuntimeConfig {
  readonly enabled: boolean
  readonly city?: string
  readonly rig?: string
  readonly target?: string
  readonly provider?: string
  readonly auto_start?: boolean
  readonly sling?: {
    readonly mode?: string
    readonly no_formula?: boolean
    readonly nudge?: boolean
  }
  readonly repair_policy?: {
    readonly route_metadata?: string
    readonly stranded_assignment?: string
  }
}

export interface WaypointProjectConfig {
  readonly schema_version: 1
  readonly enabled: boolean
  readonly quest: string
  readonly backend: WaypointProjectBackendConfig
  readonly runtime: WaypointProjectRuntimeConfig
  readonly created_at: string
  readonly updated_at: string
}

export function createWaypointProjectConfig(input: {
  quest: string
  backend?: WaypointRouteBackendMode
  now?: Date
}): WaypointProjectConfig {
  const now = (input.now ?? new Date()).toISOString()

  return {
    schema_version: 1,
    enabled: true,
    quest: input.quest,
    backend: {
      route: input.backend ?? 'folder',
    },
    runtime: {
      recipe: null,
    },
    created_at: now,
    updated_at: now,
  }
}

export function serializeWaypointProjectConfig(config: WaypointProjectConfig): string {
  return yamlStringify(config)
}

export async function readWaypointProjectConfig(configPath: string): Promise<WaypointProjectConfig> {
  return parseWaypointProjectConfig(await readFile(configPath, 'utf8'))
}

export function parseWaypointProjectConfig(text: string): WaypointProjectConfig {
  const parsed = yamlParse(text) as Partial<WaypointProjectConfig> | null

  if (!parsed || parsed.schema_version !== 1 || typeof parsed.quest !== 'string') {
    throw new Error('Invalid Waypoint project config')
  }

  return {
    schema_version: 1,
    enabled: parsed.enabled === true,
    quest: parsed.quest,
    backend: parseBackendConfig(parsed.backend),
    runtime: parseRuntimeConfig(parsed.runtime),
    created_at: String(parsed.created_at ?? ''),
    updated_at: String(parsed.updated_at ?? ''),
  }
}

function parseBackendConfig(value: unknown): WaypointProjectBackendConfig {
  const backend = isRecord(value) ? value : {}
  return {
    route: backend.route === 'beads' ? 'beads' : 'folder',
  }
}

function parseRuntimeConfig(value: unknown): WaypointProjectRuntimeConfig {
  const runtime = isRecord(value) ? value : {}
  const recipe = runtime.recipe === 'local' || runtime.recipe === 'null' ? runtime.recipe : null
  const command = typeof runtime.command === 'string' ? runtime.command : undefined
  const args = Array.isArray(runtime.args) ? runtime.args.filter((arg): arg is string => typeof arg === 'string') : undefined
  const gascity = parseGasCityRuntimeConfig(runtime.gascity)
  return {
    recipe,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(gascity ? { gascity } : {}),
  }
}

function parseGasCityRuntimeConfig(value: unknown): WaypointProjectGasCityRuntimeConfig | undefined {
  if (!isRecord(value)) return undefined
  const sling = isRecord(value.sling)
    ? {
        ...(typeof value.sling.mode === 'string' ? { mode: value.sling.mode } : {}),
        ...(typeof value.sling.no_formula === 'boolean' ? { no_formula: value.sling.no_formula } : {}),
        ...(typeof value.sling.nudge === 'boolean' ? { nudge: value.sling.nudge } : {}),
      }
    : undefined
  const repairPolicy = isRecord(value.repair_policy)
    ? {
        ...(typeof value.repair_policy.route_metadata === 'string' ? { route_metadata: value.repair_policy.route_metadata } : {}),
        ...(typeof value.repair_policy.stranded_assignment === 'string' ? { stranded_assignment: value.repair_policy.stranded_assignment } : {}),
      }
    : undefined
  return {
    enabled: value.enabled === true,
    ...(typeof value.city === 'string' ? { city: value.city } : {}),
    ...(typeof value.rig === 'string' ? { rig: value.rig } : {}),
    ...(typeof value.target === 'string' ? { target: value.target } : {}),
    ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
    ...(typeof value.auto_start === 'boolean' ? { auto_start: value.auto_start } : {}),
    ...(sling && Object.keys(sling).length > 0 ? { sling } : {}),
    ...(repairPolicy && Object.keys(repairPolicy).length > 0 ? { repair_policy: repairPolicy } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
