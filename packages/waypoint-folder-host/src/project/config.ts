import { readFile } from 'node:fs/promises'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export type WaypointRecipeRuntimeMode = 'null' | 'local'

export interface WaypointProjectRuntimeConfig {
  readonly recipe: WaypointRecipeRuntimeMode | null
  readonly command?: string
  readonly args?: readonly string[]
}

export interface WaypointProjectConfig {
  readonly schema_version: 1
  readonly enabled: boolean
  readonly quest: string
  readonly runtime: WaypointProjectRuntimeConfig
  readonly created_at: string
  readonly updated_at: string
}

export function createWaypointProjectConfig(input: { quest: string; now?: Date }): WaypointProjectConfig {
  const now = (input.now ?? new Date()).toISOString()

  return {
    schema_version: 1,
    enabled: true,
    quest: input.quest,
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
    runtime: parseRuntimeConfig(parsed.runtime),
    created_at: String(parsed.created_at ?? ''),
    updated_at: String(parsed.updated_at ?? ''),
  }
}

function parseRuntimeConfig(value: unknown): WaypointProjectRuntimeConfig {
  const runtime = isRecord(value) ? value : {}
  const recipe = runtime.recipe === 'local' || runtime.recipe === 'null' ? runtime.recipe : null
  const command = typeof runtime.command === 'string' ? runtime.command : undefined
  const args = Array.isArray(runtime.args) ? runtime.args.filter((arg): arg is string => typeof arg === 'string') : undefined
  return {
    recipe,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
