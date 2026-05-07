import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export interface WaypointProjectConfig {
  readonly schema_version: 1
  readonly enabled: boolean
  readonly quest: string
  readonly runtime: {
    readonly recipe: string | null
  }
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

export function parseWaypointProjectConfig(text: string): WaypointProjectConfig {
  const parsed = yamlParse(text) as Partial<WaypointProjectConfig> | null

  if (!parsed || parsed.schema_version !== 1 || typeof parsed.quest !== 'string') {
    throw new Error('Invalid Waypoint project config')
  }

  return {
    schema_version: 1,
    enabled: parsed.enabled === true,
    quest: parsed.quest,
    runtime: {
      recipe: parsed.runtime?.recipe ?? null,
    },
    created_at: String(parsed.created_at ?? ''),
    updated_at: String(parsed.updated_at ?? ''),
  }
}
