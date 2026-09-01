import { createHash } from 'node:crypto'

import pg from 'pg'

import {
  assertValidPostgresSchemaName,
  deriveProjectSchemaName,
  resolvePostgresBackend,
  type ResolvedPostgresBackend,
} from '../project/backend.ts'
import { splitSqlStatements } from './split-sql.ts'

/**
 * Shared connection handling for the postgres route backend. Pools are cached
 * per connection URL; schema DDL is idempotent and ensured once per
 * (url, schema) pair per process. `allowExitOnIdle` keeps one-shot CLI
 * invocations from hanging on open sockets.
 */
export interface WaypointPostgresHandle {
  readonly pool: pg.Pool
  readonly schema: string
}

const pools = new Map<string, pg.Pool>()
const ensureRuns = new Map<string, Promise<void>>()

export async function getWaypointPostgres(projectRoot: string): Promise<WaypointPostgresHandle> {
  return getWaypointPostgresFor(await resolvePostgresBackend(projectRoot))
}

/**
 * Connect from an explicit resolution instead of a project config. The one
 * production caller is `waypoint migrate` (P5/F2): a legacy folder config
 * fails the strict parser by design, so the migration tool resolves its
 * target connection itself.
 */
export async function getWaypointPostgresFor(resolved: ResolvedPostgresBackend): Promise<WaypointPostgresHandle> {
  assertValidPostgresSchemaName(resolved.schema)
  const pool = poolFor(resolved)
  await ensureSchema(pool, resolved)
  return { pool, schema: resolved.schema }
}

function poolFor(resolved: ResolvedPostgresBackend): pg.Pool {
  const existing = pools.get(resolved.url)
  if (existing) return existing
  const pool = new pg.Pool({ connectionString: resolved.url, max: 4, allowExitOnIdle: true })
  pools.set(resolved.url, pool)
  return pool
}

async function ensureSchema(pool: pg.Pool, resolved: ResolvedPostgresBackend): Promise<void> {
  const key = `${resolved.url}|${resolved.schema}`
  // In-flight promise dedup, not just completed-ensure dedup: concurrent
  // first-touch ensures (e.g. the engine host's snapshot Promise.all racing
  // a command) would otherwise each run the DDL, and concurrent
  // CREATE SCHEMA IF NOT EXISTS on one name races inside Postgres itself
  // (SQLSTATE 23505 on pg_namespace).
  const inFlight = ensureRuns.get(key)
  if (inFlight) return inFlight
  const run = runEnsureSchemaDdl(pool, resolved).catch((error: unknown) => {
    ensureRuns.delete(key)
    throw error
  })
  ensureRuns.set(key, run)
  return run
}

async function runEnsureSchemaDdl(pool: pg.Pool, resolved: ResolvedPostgresBackend): Promise<void> {
  try {
    await ensureSchemaDdl(pool, resolved)
  } catch (error) {
    // Cross-process race on the same schema name: the loser sees 23505 after
    // the winner's CREATE SCHEMA commits — one retry lands on IF NOT EXISTS.
    if ((error as { code?: string }).code !== '23505') throw error
    await ensureSchemaDdl(pool, resolved)
  }
}

/**
 * Schemas this process created while under test, for the reaper
 * (`testing/schema-reaper.ts`).
 *
 * A schema is created per PROJECT, and every suite that builds a temp project
 * root with `mkdtemp` gets a fresh one. Nothing dropped them, so a local
 * Postgres reached 6,664 schemas and 525,817 relations by 2026-08-22 against
 * three real projects.
 *
 * `PostgresTestProjects` already cleans up and is still the right thing for a
 * suite to use, but it is opt-in and 51 of the 135 suites that call `mkdtemp`
 * do not. This set is the backstop underneath it, so correctness does not
 * depend on the next author remembering.
 *
 * Gated on `WAYPOINT_TEST_SCHEMAS`, which only the test setup file sets: a
 * production process records nothing, so the reaper can never be handed a
 * real case's schema.
 */
const createdTestSchemas = new Set<string>()

/** Schemas recorded since the last {@link takeCreatedTestSchemas}. */
export function takeCreatedTestSchemas(): string[] {
  const schemas = [...createdTestSchemas]
  createdTestSchemas.clear()
  return schemas
}

function recordSchemaForReaping(schema: string): void {
  if (!process.env.WAYPOINT_TEST_SCHEMAS) return
  createdTestSchemas.add(schema)
}

async function ensureSchemaDdl(pool: pg.Pool, resolved: ResolvedPostgresBackend): Promise<void> {
  // resolved.schema is validated against a strict identifier pattern in
  // resolvePostgresBackend, so direct interpolation is safe here.
  const s = quoteIdent(resolved.schema)
  recordSchemaForReaping(resolved.schema)
  const ddl = `
    CREATE SCHEMA IF NOT EXISTS ${s};
    CREATE TABLE IF NOT EXISTS ${s}.routes (
      id           text PRIMARY KEY,
      quest        text NOT NULL,
      status       text NOT NULL,
      current_node text,
      subject      jsonb NOT NULL,
      metadata     jsonb,
      created_at   text NOT NULL,
      updated_at   text NOT NULL,
      instance_id  text
    );
    CREATE TABLE IF NOT EXISTS ${s}.tasks (
      id         text PRIMARY KEY,
      route_id   text NOT NULL,
      plan_ref   text NOT NULL,
      title      text NOT NULL,
      phase      text NOT NULL,
      wave       integer,
      kind       text NOT NULL,
      status     text NOT NULL,
      metadata   jsonb,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      evidence   jsonb
    );
    CREATE TABLE IF NOT EXISTS ${s}.route_events (
      ord        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id         text NOT NULL,
      route_id   text NOT NULL,
      kind       text NOT NULL,
      payload    jsonb,
      created_at text NOT NULL,
      dedupe_key text,
      UNIQUE (route_id, id)
    );
    CREATE TABLE IF NOT EXISTS ${s}.dispatches (
      id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      route_id     text NOT NULL,
      task_ref     text NOT NULL,
      recipe       text NOT NULL,
      instance_id  text NOT NULL,
      status       text NOT NULL DEFAULT 'pending',
      -- Vestigial (rsc-svg, the beads exit): never written, never read, and
      -- the only occurrence of the name in the tree. Kept on purpose — this
      -- DDL runs against live schemas, so dropping the column is a migration,
      -- not an edit. Do not reintroduce beads into product code.
      bead_id      text,
      close_reason text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      closed_at    timestamptz,
      claimed_at   timestamptz,
      claimed_by   text,
      report       jsonb
    );
    -- Pre-production upgrade path: CREATE TABLE IF NOT EXISTS skips existing
    -- P1 tables, so the columns the durable engine writes (B2) are ensured
    -- idempotently here too.
    ALTER TABLE ${s}.routes ADD COLUMN IF NOT EXISTS instance_id text;
    ALTER TABLE ${s}.tasks ADD COLUMN IF NOT EXISTS evidence jsonb;
    -- B4.5: engine-write idempotency (dedupe_key on engine-inserted events;
    -- store-written events leave it NULL) and bridge claim leases.
    ALTER TABLE ${s}.route_events ADD COLUMN IF NOT EXISTS dedupe_key text;
    ALTER TABLE ${s}.dispatches ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
    -- P3/W1: the agent report seam — workers report attempts onto their
    -- claimed dispatch row via 'waypoint tasks report'. The report is the
    -- agent's CLAIM; the host derives the outcome (never agent say-so).
    ALTER TABLE ${s}.dispatches ADD COLUMN IF NOT EXISTS report jsonb;
    -- P3/W4: claim ownership — which bridge holds the lease. Heartbeats are
    -- guarded on it, so a bridge whose claim was reclaimed and re-claimed
    -- elsewhere DETECTS the loss and kills its process group instead of
    -- racing the new owner.
    ALTER TABLE ${s}.dispatches ADD COLUMN IF NOT EXISTS claimed_by text;
    -- S2 (item 52): which sandbox the attempt actually entered — the ADMITTED
    -- binding (provider, instance, image digest, policy/mount hashes), stamped
    -- by the bridge at close from the runtime's output. NULL means the attempt
    -- ran outside a VM (local composition, deterministic step, or a crash
    -- before admission) — never "unknown sandbox".
    ALTER TABLE ${s}.dispatches ADD COLUMN IF NOT EXISTS sandbox jsonb;
    -- Dispatch push (B3): every insert notifies the bridge's LISTEN channel,
    -- so the compiled graph needs no knowledge of the channel name.
    CREATE OR REPLACE FUNCTION ${s}.notify_dispatch() RETURNS trigger AS $fn$
    BEGIN
      PERFORM pg_notify('${dispatchChannelName(resolved.schema)}', NEW.id::text);
      RETURN NEW;
    END
    $fn$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS dispatches_notify ON ${s}.dispatches;
    CREATE TRIGGER dispatches_notify AFTER INSERT ON ${s}.dispatches
      FOR EACH ROW EXECUTE FUNCTION ${s}.notify_dispatch();
  `

  // One statement at a time, NOT one query. A single `pool.query` of the whole
  // script is a single implicit transaction holding a lock on every object
  // this schema contains, and the lock table is only
  // `max_locks_per_transaction x max_connections` slots for the entire server
  // — so ~35 concurrent project creates exhausted it with `out of shared
  // memory` (docs/ERRORS-AND-FIXES.md, 2026-08-22). Per statement, the same
  // DDL peaks at a handful of locks.
  //
  // The atomicity given up costs nothing here: every statement is
  // `IF NOT EXISTS`/idempotent, so an interrupted ensure leaves a partial
  // schema that the next ensure completes, and concurrent creators already
  // race through the 23505 retry in runEnsureSchemaDdl.
  for (const statement of splitSqlStatements(ddl)) {
    await pool.query(statement)
  }
}

/**
 * LISTEN/NOTIFY channel for dispatch inserts in one schema. Hash-derived so it
 * always fits Postgres's 63-byte identifier limit regardless of schema-name
 * length, and deterministic so the trigger (written at ensure time) and the
 * bridge (listening at run time) agree without coordination.
 */
export function dispatchChannelName(schema: string): string {
  return `waypoint_dispatch_${createHash('sha256').update(schema).digest('hex').slice(0, 16)}`
}

export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * Test hook (rsc-0f3): cancel any running/pending df engine instance whose
 * route lives in `schema` before a suite drops it. A bare DROP SCHEMA leaves
 * the instance parked 'running' against a schema that no longer exists,
 * where it sits forever burning engine worker cycles. Safe on schemas that
 * were never durable or never got this far — a missing routes table/schema
 * is swallowed, not thrown.
 */
export async function cancelSchemaDurableInstances(pool: pg.Pool, schema: string): Promise<void> {
  let instanceIds: string[]
  try {
    const result = await pool.query(`SELECT DISTINCT instance_id FROM ${quoteIdent(schema)}.routes WHERE instance_id IS NOT NULL`)
    instanceIds = (result.rows as { instance_id: string }[]).map((row) => row.instance_id)
  } catch {
    return
  }
  for (const instanceId of instanceIds) {
    const statusResult = await pool.query('SELECT df.status($1) AS status', [instanceId]).catch(() => undefined)
    const status = (statusResult?.rows[0] as { status?: string } | undefined)?.status
    if (status === 'running' || status === 'pending') {
      await pool.query('SELECT df.cancel($1, $2)', [instanceId, 'test teardown cleanup (rsc-0f3)']).catch(() => undefined)
    }
  }
}

/** The minimal pool surface dropProjectSchemas needs — a real pg.Pool
 * satisfies it, and a fake can too, so the resilience is unit-testable
 * without a live Postgres. */
export interface QueryablePool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface DropProjectSchemasResult {
  /** Schemas whose cancel + DROP SCHEMA both completed (or were already gone). */
  readonly dropped: string[]
  /** Schemas that could not be dropped, with the failure reason. */
  readonly failed: { schema: string; error: string }[]
}

/**
 * Test teardown (rsc-g5v): for every tracked project root, cancel its
 * running/pending durable instances then drop its schema — each schema in its
 * OWN try/catch so one that cannot be dropped does not strand the rest. That
 * resilience is the whole point: rsc-0f3 made the happy path cancel-before-drop,
 * but a red run (an assertion threw mid-suite, a bad WAYPOINT_POSTGRES_TEST_URL, a
 * schema a superuser created that the waypoint role cannot drop) would abort the
 * old single `for` loop at the first failure and leak every remaining schema.
 * Roots are deduped to schema names first (several roots can resolve to one
 * schema). Failures are RETURNED, not thrown, so a caller in `afterAll` can warn
 * without turning an otherwise-green suite red on a transient drop error.
 *
 * Note this cancels but cannot DELETE the df.instances rows — the non-superuser
 * waypoint role has no DELETE on pg_durable's tables and pg_durable exposes no
 * purge, so terminal rows accumulate until pg_durable's own retention. That
 * store-bloat is tracked separately (route-reaping.md); a suite that always
 * cleans up keeps its own instances from adding to it.
 */
export async function dropProjectSchemas(
  pool: QueryablePool,
  roots: readonly string[],
): Promise<DropProjectSchemasResult> {
  const schemas = [...new Set(roots.map((root) => deriveProjectSchemaName(root)))]
  const dropped: string[] = []
  const failed: { schema: string; error: string }[] = []
  for (const schema of schemas) {
    try {
      await cancelSchemaDurableInstances(pool as unknown as pg.Pool, schema)
      await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`)
      dropped.push(schema)
    } catch (error) {
      failed.push({ schema, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { dropped, failed }
}

/** Test hook: close and forget all cached pools (e.g. between vitest suites). */
export async function closeWaypointPostgresPools(): Promise<void> {
  const open = [...pools.values()]
  pools.clear()
  ensureRuns.clear()
  await Promise.all(open.map((pool) => pool.end()))
}
