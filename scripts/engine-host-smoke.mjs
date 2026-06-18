#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const { createEngineHost } = await import(join(repoRoot, 'packages/waypoint-engine-host/src/index.ts'))

const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-engine-host-smoke-'))
const host = createEngineHost()
const started = await host.start()
try {
  const open = await host.dispatch('workspace.open', { root: projectRoot, backend: 'folder' })
  if (!open.ok) throw new Error(`workspace.open failed: ${open.error}`)

  const run = await host.dispatch('run.start', { quest: 'waypoint' })
  if (!run.ok) throw new Error(`run.start failed: ${run.error}`)

  const routes = await host.dispatch('routes.list', {})
  if (!routes.ok || routes.routes.length !== 1) {
    throw new Error(`routes.list mismatch: ${JSON.stringify(routes)}`)
  }

  const events = await host.dispatch('route.events', { routeId: run.route.id })
  if (!events.ok || events.events.length === 0) throw new Error('expected route events')

  process.stdout.write(`Smoke project: ${projectRoot}\n`)
  process.stdout.write(`engine-host smoke OK on ${started.url} (route ${run.route.id}, ${events.events.length} events)\n`)
} finally {
  await host.stop()
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(projectRoot, { recursive: true, force: true })
  }
}
