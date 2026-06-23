#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
// ws is a dependency of waypoint-engine-host; resolve it from there so the
// scripts/ directory (which has no package.json ws dep) can find it.
const requireFromEngineHost = createRequire(join(repoRoot, 'packages/waypoint-engine-host/package.json'))
const { WebSocket: NodeWebSocket } = requireFromEngineHost('ws')
const { createEngineHost, FakeBrainAdapter } = await import(join(repoRoot, 'packages/waypoint-engine-host/src/index.ts'))
const { createBrowserEngineClient } = await import(join(repoRoot, 'packages/waypoint-ui/src/engine/client.ts'))

const adapter = new FakeBrainAdapter({
  events: [{ kind: 'agent.message', at: new Date(0).toISOString(), data: { text: 'drafting' } }],
  result: { status: 'completed', summary: 'authored', proposalId: 'recipe/demo' },
})

const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-ui-smoke-'))
const host = createEngineHost({ brainAdapter: adapter, brain: 'fake' })
const started = await host.start()
try {
  const headers = { authorization: `Bearer ${started.token}` }
  const client = createBrowserEngineClient({
    baseUrl: started.url,
    headers,
    fetchImpl: fetch,
    wsFactory: (url) => new NodeWebSocket(url, { headers }),
  })

  const open = await client.cmd('workspace.open', { root: projectRoot, backend: 'folder' })
  if (!open.ok) throw new Error(`workspace.open failed: ${JSON.stringify(open)}`)

  const messages = []
  const unsub = client.subscribe(['*'], (m) => messages.push(m))
  const snapshotDeadline = Date.now() + 3000
  while (!messages.some((m) => m.type === 'snapshot') && Date.now() < snapshotDeadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  if (!messages.some((m) => m.type === 'snapshot')) throw new Error('expected a snapshot message')

  const run = await client.cmd('agent.run', { intent: 'demo' })
  if (!run.ok || run.proposalId !== 'recipe/demo') throw new Error(`agent.run mismatch: ${JSON.stringify(run)}`)
  const agentDeadline = Date.now() + 3000
  while (!messages.some((m) => m.type === 'event' && m.topic.startsWith('agent:')) && Date.now() < agentDeadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  if (!messages.some((m) => m.type === 'event' && m.topic.startsWith('agent:'))) {
    throw new Error('expected agent transcript events on the stream')
  }
  unsub()

  process.stdout.write(`Smoke project: ${projectRoot}\n`)
  process.stdout.write(`ui smoke OK on ${started.url} (snapshot + agent stream + proposal ${run.proposalId})\n`)
} finally {
  await host.stop()
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(projectRoot, { recursive: true, force: true })
  }
}
