import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'

import { readWaypointProjectConfig, type WaypointPostgresBackendConfig } from './config.ts'
import { getWaypointProjectPaths } from './root.ts'

/**
 * Resolved connection settings for the postgres route backend.
 * Environment overrides (WAYPOINT_POSTGRES_URL / WAYPOINT_POSTGRES_SCHEMA) win over
 * `.waypoint/config.yaml` so operators can point a checkout at another database
 * without editing project state.
 */
export interface ResolvedPostgresBackend {
  readonly url: string
  readonly schema: string
  /** Route execution driven by the pg_durable engine (P2/B2). Config-only; no env override. */
  readonly durable: boolean
}

const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/

/** Guards direct SQL interpolation of schema names — every connect path validates through this. */
export function assertValidPostgresSchemaName(schema: string): string {
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error(`Postgres route backend schema must match ${SCHEMA_NAME_PATTERN}: ${schema}`)
  }
  return schema
}

/**
 * The Console-managed local instance (deploy/postgres, P5/F0): one launchd
 * Postgres per machine, schema-per-project on it (endstate Q1). Projects
 * that don't name a URL land here; WAYPOINT_POSTGRES_URL still wins.
 */
export const DEFAULT_POSTGRES_URL = 'postgresql://waypoint@localhost:5433/postgres'

/**
 * Schema-per-project (endstate Q1): a deterministic schema name derived from
 * the project folder — sanitized basename slug + an 8-hex digest of the
 * absolute path, so re-init is idempotent and two folders with the same name
 * never collide. Always matches SCHEMA_NAME_PATTERN (63-byte PG limit).
 */
export function deriveProjectSchemaName(projectRoot: string): string {
  const absolute = resolve(projectRoot)
  const hash = createHash('sha256').update(absolute).digest('hex').slice(0, 8)
  const slug = basename(absolute)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, (digit) => `p${digit}`)
    .slice(0, 40)
  return `waypoint_${slug || 'project'}_${hash}`
}

/**
 * True when the durable engine drives route execution
 * (backend.postgres.durable: true). Missing config file → false —
 * a plain-postgres project must never be mistaken for an engine-driven one.
 */
export async function isDurablePostgresRouteBackend(projectRoot: string): Promise<boolean> {
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    return config.backend.postgres?.durable === true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

export async function resolvePostgresBackend(projectRoot: string): Promise<ResolvedPostgresBackend> {
  let configured: WaypointPostgresBackendConfig | undefined
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    configured = config.backend.postgres
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
    // No .waypoint/config.yaml: refuse unless the env names a schema
    // explicitly. Deriving a schema from an unconfigured directory meant a
    // mistyped `cd` + any route/task read minted a permanent schema —
    // 530 grew to 694 during the as-built audit alone (PLAN item 25).
    if (!process.env.WAYPOINT_POSTGRES_SCHEMA?.trim()) {
      throw new Error(
        `Not a Waypoint project: no .waypoint/config.yaml under ${projectRoot}. ` +
          'Refusing to touch postgres from an unconfigured directory (this used to ' +
          "silently create a schema derived from the path). Run 'waypoint init' here, " +
          'or cd to a project.',
      )
    }
  }

  // Fall through to the Console-managed instance (F0) when neither the env
  // nor the project names a URL — postgres works out of the box locally.
  const url = process.env.WAYPOINT_POSTGRES_URL?.trim() || configured?.url || DEFAULT_POSTGRES_URL

  // Schema-per-project (endstate Q1, judgment call 5): a project that names
  // no schema resolves to its derived one — never a shared default schema.
  const schema = assertValidPostgresSchemaName(
    process.env.WAYPOINT_POSTGRES_SCHEMA?.trim() || configured?.schema || deriveProjectSchemaName(projectRoot),
  )

  return { url, schema, durable: configured?.durable === true }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
