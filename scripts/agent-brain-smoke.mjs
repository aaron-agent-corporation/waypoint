#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const { createEngineHost, FakeBrainAdapter, AGENT_TOOL_GRANT } = await import(
  join(repoRoot, 'packages/waypoint-engine-host/src/index.ts')
)

// A deterministic fake brain: streams two events, then "authors" a proposal.
const adapter = new FakeBrainAdapter({
  events: [
    { kind: 'agent.message', at: new Date(0).toISOString(), data: { text: 'drafting a demo recipe' } },
    { kind: 'agent.tool_result', at: new Date(0).toISOString(), data: { toolName: 'waypoint_author_promote', text: '{"proposalId":"recipe/demo"}' } },
  ],
  result: { status: 'completed', summary: 'authored a demo recipe', proposalId: 'recipe/demo' },
})

const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-agent-brain-smoke-'))
const host = createEngineHost({ brainAdapter: adapter, brain: 'fake' })
const started = await host.start()
try {
  const open = await host.dispatch('workspace.open', { root: projectRoot, backend: 'folder' })
  if (!open.ok) throw new Error(`workspace.open failed: ${open.error}`)

  // One-call convenience: author + await the terminal result.
  const run = await host.dispatch('agent.run', { intent: 'Author a demo recipe' })
  if (!run.ok) throw new Error(`agent.run failed: ${JSON.stringify(run)}`)
  if (run.status !== 'completed') throw new Error(`expected completed, got ${run.status}`)
  if (run.proposalId !== 'recipe/demo') throw new Error(`expected proposalId recipe/demo, got ${run.proposalId}`)
  const sessionId = run.sessionId

  const list = await host.dispatch('agent.list', {})
  if (!list.ok || !list.sessions.some((s) => s.id === sessionId && s.status === 'completed')) {
    throw new Error(`agent.list mismatch: ${JSON.stringify(list)}`)
  }

  const transcript = await host.dispatch('agent.transcript', { sessionId })
  if (!transcript.ok || transcript.events.length < 2) throw new Error(`expected transcript events: ${JSON.stringify(transcript)}`)

  // Blast-radius guard: a scoped agent token can NEVER call approveProposal,
  // even over direct loopback — the bus rejects it before the handler runs.
  const forbidden = await host.dispatch('author.approveProposal', { id: 'recipe/demo' }, { allow: new Set(AGENT_TOOL_GRANT) })
  if (forbidden.ok || forbidden.details?.code !== 'FORBIDDEN') {
    throw new Error(`expected FORBIDDEN for scoped author.approveProposal, got ${JSON.stringify(forbidden)}`)
  }

  // meta reports the active brain.
  const health = await host.dispatch('meta.health', {})
  if (health.brain !== 'fake') throw new Error(`expected brain fake, got ${health.brain}`)

  process.stdout.write(`Smoke project: ${projectRoot}\n`)
  process.stdout.write(
    `agent-brain smoke OK on ${started.url} (session ${sessionId}, ${transcript.events.length} events, proposal ${run.proposalId}, approveProposal correctly FORBIDDEN)\n`,
  )
} finally {
  await host.stop()
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(projectRoot, { recursive: true, force: true })
  }
}
