/**
 * Cross-process mutex for one OAuth / Console subscription lane (L3 of the
 * lane conversion, docs/designs/sprite-lane-conversion.md; ported from the
 * Waypoint guide).
 *
 * Uses a Postgres **session** advisory lock (not xact): the lock must span
 * ensure-install → wipe → sync → enter → pull → cleanup across awaits.
 * In-process queues fail when two bridge processes share a schema.
 *
 * The key prefix is `waypoint:oauth-lane:` — DELIBERATELY the same
 * keyspace Waypoint uses (delta 4): both products share the Console's
 * Postgres on :5435 and may hold subscriptions on the same accounts, so one
 * keyspace buys cross-product mutual exclusion for free. Never rename it.
 */

import type pg from 'pg'

export interface OauthLaneLockHandle {
  readonly lane_id: string
  /** Time spent blocked waiting for the lock (0 for an uncontended try). */
  readonly queue_wait_ms: number
  release(): Promise<void>
}

export type OauthLaneLockAcquire = (laneId: string) => Promise<OauthLaneLockHandle>

const LOCK_PREFIX = 'waypoint:oauth-lane:'

function lockKey(laneId: string): string {
  const id = laneId.trim()
  if (!id) throw new Error('oauth lane lock refused: empty lane id')
  return `${LOCK_PREFIX}${id}`
}

function handleFromClient(
  client: pg.PoolClient,
  laneId: string,
  queue_wait_ms: number,
  key: string,
): OauthLaneLockHandle {
  let released = false
  return {
    lane_id: laneId,
    queue_wait_ms,
    async release() {
      if (released) return
      released = true
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
      } finally {
        client.release()
      }
    },
  }
}

/**
 * How long a dispatch may wait for a busy lane before refusing. Must exceed
 * the longest LEGITIMATE hold — a lane is held for the whole worker exec, and
 * the host exec deadline is 45 minutes — or a queue under real contention
 * would refuse work that was only waiting its turn.
 */
export const LANE_LOCK_WAIT_MS = 50 * 60 * 1000

/** How often a still-waiting acquire says so. Silence is the bug being fixed. */
export const LANE_LOCK_NOTICE_MS = 60_000

/**
 * Session advisory lock keyed on a stable hash of the opaque lane id.
 *
 * Waits for a busy lane — that is the point, it is how a queue deeper than the
 * lane pool still completes — but it waits VISIBLY and it gives up. The old
 * implementation issued a bare `pg_advisory_lock`, which blocks forever and
 * says nothing: on 2026-08-29 a leaked lock left a run wedged for 1h50m
 * looking exactly like work in progress, because a blocked acquire and a busy
 * fleet are indistinguishable from outside. A wait nobody can see is not a
 * queue, it is a hang.
 *
 * Polls `pg_try_advisory_lock` on ONE pinned client so the lock, when it comes,
 * belongs to the session the handle will unlock.
 */
export async function acquireOauthLaneLock(
  pool: pg.Pool,
  laneId: string,
  opts: {
    readonly waitMs?: number
    readonly noticeMs?: number
    readonly onNotice?: (message: string) => void
    readonly sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<OauthLaneLockHandle> {
  const key = lockKey(laneId)
  const id = laneId.trim()
  const waitMs = opts.waitMs ?? LANE_LOCK_WAIT_MS
  const noticeMs = opts.noticeMs ?? LANE_LOCK_NOTICE_MS
  const notice = opts.onNotice ?? ((message: string) => console.error(message))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const client = await pool.connect()
  const started = Date.now()
  let nextNotice = noticeMs
  try {
    for (;;) {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key],
      )
      if (result.rows[0]?.locked) break
      const waited = Date.now() - started
      if (waited >= waitMs) {
        throw new Error(
          `lane lock '${id}' still held after ${Math.round(waited / 1000)}s ` +
            `(limit ${Math.round(waitMs / 1000)}s) — another dispatch is holding it, or a previous ` +
            'one leaked it. Check pg_locks for granted advisory locks whose session is idle.',
        )
      }
      if (waited >= nextNotice) {
        notice(`[lane-lock] still waiting for lane '${id}' after ${Math.round(waited / 1000)}s`)
        nextNotice += noticeMs
      }
      await sleep(Math.min(2000, 250 + waited / 10))
    }
  } catch (error) {
    client.release()
    throw error
  }
  return handleFromClient(client, id, Date.now() - started, key)
}

/**
 * Non-blocking lane lock. Returns null when another session holds it — the
 * free-lane picker uses this to skip busy subscription homes.
 */
export async function tryAcquireOauthLaneLock(
  pool: pg.Pool,
  laneId: string,
): Promise<OauthLaneLockHandle | null> {
  const key = lockKey(laneId)
  const id = laneId.trim()
  const client = await pool.connect()
  const started = Date.now()
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [key],
    )
    if (!result.rows[0]?.locked) {
      client.release()
      return null
    }
  } catch (error) {
    client.release()
    throw error
  }
  return handleFromClient(client, id, Date.now() - started, key)
}

export interface OauthLaneLocks {
  readonly acquire: OauthLaneLockAcquire
  readonly tryAcquire: (laneId: string) => Promise<OauthLaneLockHandle | null>
}

/** The pg-backed lock pair the picker consumes (the `acquireLaneLock` seam). */
export function createPgOauthLaneLocks(pool: pg.Pool): OauthLaneLocks {
  return {
    acquire: (laneId) => acquireOauthLaneLock(pool, laneId),
    tryAcquire: (laneId) => tryAcquireOauthLaneLock(pool, laneId),
  }
}

/** Test double: in-process mutex with the same acquire/release/try shape. */
export function createInProcessOauthLaneLocks(): OauthLaneLocks {
  /** FIFO of resolvers waiting to enter the critical section for a lane. */
  const waiters = new Map<string, Array<() => void>>()
  const held = new Set<string>()

  const releaseWaiter = (id: string): void => {
    const queue = waiters.get(id)
    if (!queue || queue.length === 0) {
      waiters.delete(id)
      return
    }
    const next = queue.shift()!
    if (queue.length === 0) waiters.delete(id)
    next()
  }

  const acquire: OauthLaneLockAcquire = async (laneId: string) => {
    const id = laneId.trim()
    if (!id) throw new Error('oauth lane lock refused: empty lane id')
    const started = Date.now()
    if (held.has(id)) {
      await new Promise<void>((resolve) => {
        const queue = waiters.get(id) ?? []
        queue.push(resolve)
        waiters.set(id, queue)
      })
    }
    held.add(id)
    const queue_wait_ms = Date.now() - started
    let released = false
    return {
      lane_id: id,
      queue_wait_ms,
      async release() {
        if (released) return
        released = true
        held.delete(id)
        releaseWaiter(id)
      },
    }
  }

  const tryAcquire = async (laneId: string): Promise<OauthLaneLockHandle | null> => {
    const id = laneId.trim()
    if (!id) throw new Error('oauth lane lock refused: empty lane id')
    if (held.has(id)) return null
    held.add(id)
    let released = false
    return {
      lane_id: id,
      queue_wait_ms: 0,
      async release() {
        if (released) return
        released = true
        held.delete(id)
        releaseWaiter(id)
      },
    }
  }

  return { acquire, tryAcquire }
}
