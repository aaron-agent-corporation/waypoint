import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

function realBdAvailable(): boolean {
  const result = spawnSync('bd', ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

// No fake-bd: "Beads first-class" is only validated against real bd/Dolt.
// Skipped locally when bd is absent; REQUIRED in CI where bd + Dolt are installed.
describe.runIf(realBdAvailable())('engine-host Beads/Dolt (real bd)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir('wp-engine-beads-')
    host = createEngineHost()
    await host.start()
  })
  afterEach(async () => {
    await host.stop()
    await cleanup(dir)
  })

  it(
    'runs the full lifecycle against a real Beads/Dolt workspace',
    async () => {
      expect(await host.dispatch('workspace.open', { root: dir, backend: 'beads', initBeads: true })).toMatchObject({
        ok: true,
        workspace: { backend: 'beads' },
      })
      const started = (await host.dispatch('run.start', { quest: 'waypoint' })) as unknown as {
        ok: boolean
        route: { id: string; status: string }
      }
      expect(started.ok).toBe(true)
      expect(started.route.status).toBe('active')

      const routes = (await host.dispatch('routes.list', {})) as unknown as { routes: unknown[] }
      expect(routes.routes).toHaveLength(1)

      const events = (await host.dispatch('route.events', { routeId: started.route.id })) as unknown as {
        events: unknown[]
      }
      expect(events.events.length).toBeGreaterThan(0)
    },
    120_000,
  )

  it(
    'handles many sequential + concurrent commands without lock contention',
    async () => {
      await host.dispatch('workspace.open', { root: dir, backend: 'beads', initBeads: true })
      await host.dispatch('run.start', { quest: 'waypoint' })

      for (let i = 0; i < 25; i += 1) {
        const res = await host.dispatch('routes.list', {})
        expect(res.ok).toBe(true)
      }

      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          host.dispatch(i % 2 === 0 ? 'routes.list' : 'tasks.list', {}),
        ),
      )
      for (const res of results) expect(res.ok).toBe(true)
    },
    120_000,
  )
})
