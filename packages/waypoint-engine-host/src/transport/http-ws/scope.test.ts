import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createEngineHost, type EngineHost } from '../../core/engine-host.ts'

let host: EngineHost | null = null
let url = ''
let globalToken = ''

async function startHost(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'wp-scope-'))
  host = createEngineHost()
  const started = await host.start()
  url = started.url
  globalToken = started.token
  await host.dispatch('workspace.open', { root, backend: 'folder' })
}

async function cmd(token: string, name: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/cmd/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: '{}',
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

afterEach(async () => {
  if (host) await host.stop()
  host = null
})

describe('transport per-session token scope', () => {
  it('blocks a scoped agent token from calling approveProposal / workspace.open with HTTP 403', async () => {
    await startHost()
    const scoped = host!.tokens.mintScoped('agent-001', new Set(['author.recipe', 'run.adhoc']))

    const forbidden = await cmd(scoped, 'author.approveProposal')
    expect(forbidden.status).toBe(403)
    expect((forbidden.body.details as { code: string }).code).toBe('FORBIDDEN')

    const openForbidden = await cmd(scoped, 'workspace.open')
    expect(openForbidden.status).toBe(403)

    // ...but an in-grant command is allowed through the bus (validation error, not FORBIDDEN).
    const allowed = await cmd(scoped, 'author.recipe')
    expect(allowed.status).toBe(200)
    expect((allowed.body.details as { code?: string } | undefined)?.code).not.toBe('FORBIDDEN')
  })

  it('the global token is unrestricted; an unknown token is 401', async () => {
    await startHost()
    const ok = await cmd(globalToken, 'routes.list')
    expect(ok.status).toBe(200)
    const bad = await cmd('not-a-real-token', 'routes.list')
    expect(bad.status).toBe(401)
  })
})
