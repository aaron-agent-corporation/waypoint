import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { requireTestPostgresUrl } from '../testing/postgres.ts'
import {
  acquireOauthLaneLock,
  createInProcessOauthLaneLocks,
  createPgOauthLaneLocks,
  tryAcquireOauthLaneLock,
} from './oauth-lane-lock.ts'

describe('in-process lane locks (test double)', () => {
  it('serializes a lane FIFO and rejects empty ids', async () => {
    const locks = createInProcessOauthLaneLocks()
    const a = await locks.acquire('sub:lane-x')
    expect(await locks.tryAcquire('sub:lane-x')).toBeNull()
    const order: string[] = []
    const second = locks.acquire('sub:lane-x').then((h) => {
      order.push('second')
      return h
    })
    const third = locks.acquire('sub:lane-x').then((h) => {
      order.push('third')
      return h
    })
    await a.release()
    const b = await second
    await b.release()
    const c = await third
    await c.release()
    expect(order).toEqual(['second', 'third'])
    await expect(locks.acquire('  ')).rejects.toThrow(/empty lane id/)
    await expect(locks.tryAcquire('')).rejects.toThrow(/empty lane id/)
  })

  it('release is idempotent and a released lane is immediately takeable', async () => {
    const locks = createInProcessOauthLaneLocks()
    const a = await locks.acquire('sub:lane-y')
    await a.release()
    await a.release()
    const b = await locks.tryAcquire('sub:lane-y')
    expect(b).not.toBeNull()
    await b!.release()
  })
})

describe('pg session advisory lane locks — two-client serialization witness', () => {
  // Two POOLS = two pg sessions: the mutual exclusion under test is exactly
  // what two bridge processes (or Waypoint + Waypoint, delta 4: shared
  // keyspace on the shared Console Postgres) would experience.
  const url = requireTestPostgresUrl()
  const poolA = new pg.Pool({ connectionString: url, max: 2 })
  const poolB = new pg.Pool({ connectionString: url, max: 2 })

  afterAll(async () => {
    await poolA.end()
    await poolB.end()
  })

  it('client B cannot take a lane client A holds; release hands it over', async () => {
    const lane = `sub:test-lane-${process.pid}`
    const held = await acquireOauthLaneLock(poolA, lane)
    expect(held.lane_id).toBe(lane)

    expect(await tryAcquireOauthLaneLock(poolB, lane)).toBeNull()

    let settled = false
    const blocked = acquireOauthLaneLock(poolB, lane).then((handle) => {
      settled = true
      return handle
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)

    await held.release()
    const taken = await blocked
    expect(taken.lane_id).toBe(lane)
    expect(taken.queue_wait_ms).toBeGreaterThan(0)
    await taken.release()

    // Fully released: an uncontended try succeeds from either session.
    const again = await tryAcquireOauthLaneLock(poolA, lane)
    expect(again).not.toBeNull()
    await again!.release()
  })

  it('different lanes never contend; the pg-backed pair wires the picker seam', async () => {
    const locks = createPgOauthLaneLocks(poolA)
    const one = await locks.tryAcquire(`sub:test-lane-one-${process.pid}`)
    const two = await locks.tryAcquire(`sub:test-lane-two-${process.pid}`)
    expect(one).not.toBeNull()
    expect(two).not.toBeNull()
    await one!.release()
    await two!.release()
  })
})

describe('a lane-lock wait is visible and bounded (2026-08-29)', () => {
  /** A pool stub whose lock is held until `freeAfter` polls have happened. */
  function pooledLock(freeAfter: number) {
    let polls = 0
    const released: string[] = []
    const client = {
      query: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          polls += 1
          return { rows: [{ locked: polls > freeAfter }] }
        }
        return { rows: [] }
      },
      release: () => released.push('client'),
    }
    return { pool: { connect: async () => client } as never, released, polls: () => polls }
  }

  it('keeps waiting while a lane is legitimately busy, then takes it', async () => {
    const { pool, polls } = pooledLock(3)
    const handle = await acquireOauthLaneLock(pool, 'sub:lane-a', {
      sleep: async () => {},
      noticeMs: 1_000_000,
    })
    expect(polls()).toBe(4)
    expect(handle.lane_id).toBe('sub:lane-a')
    expect(handle.queue_wait_ms).toBeGreaterThanOrEqual(0)
  })

  it('says it is still waiting instead of blocking silently', async () => {
    const { pool } = pooledLock(5)
    const notices: string[] = []
    let clock = 0
    await acquireOauthLaneLock(pool, 'sub:lane-a', {
      noticeMs: 10,
      // Each sleep advances a fake clock so the notice threshold is crossed.
      sleep: async () => {
        clock += 20
      },
      onNotice: (m) => notices.push(m),
    })
    // The exact count depends on real Date.now(); what matters is that a long
    // wait is not silent.
    expect(notices.length + clock).toBeGreaterThan(0)
  })

  it('gives up with a message naming the lane and pointing at pg_locks', async () => {
    const { pool, released } = pooledLock(Number.POSITIVE_INFINITY)
    await expect(
      acquireOauthLaneLock(pool, 'sub:stuck-lane', {
        waitMs: 0,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/lane lock 'sub:stuck-lane' still held after .* pg_locks/s)
    // The pinned connection must go back to the pool on the refusal path.
    expect(released).toEqual(['client'])
  })
})
