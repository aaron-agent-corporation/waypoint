import { describe, expect, it } from 'vitest'

import { createHostClient, HostCommandError, type FetchImpl, type FetchInit, type FetchResponse } from './host-client.ts'

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function recordingFetch(response: FetchResponse): { fetchImpl: FetchImpl; calls: { url: string; init: FetchInit }[] } {
  const calls: { url: string; init: FetchInit }[] = []
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return response
    },
  }
}

describe('createHostClient', () => {
  it('POSTs /cmd/<name> with a bearer token and JSON body', async () => {
    const { fetchImpl, calls } = recordingFetch(jsonResponse(200, { ok: true, routes: [] }))
    const client = createHostClient({ url: 'http://127.0.0.1:9999/', token: 'scoped-abc', fetchImpl })

    const result = await client.command('routes.list', { routeId: 'route-001' })

    expect(calls[0].url).toBe('http://127.0.0.1:9999/cmd/routes.list')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.authorization).toBe('Bearer scoped-abc')
    expect(calls[0].init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body)).toEqual({ routeId: 'route-001' })
    expect(result).toEqual({ ok: true, routes: [] })
  })

  it('requires a non-empty url and token', () => {
    expect(() => createHostClient({ url: '', token: 't' })).toThrow(/url/)
    expect(() => createHostClient({ url: 'http://x', token: '' })).toThrow(/token/)
  })

  it('maps 401 to an actionable authentication error', async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(401, { ok: false }))
    const client = createHostClient({ url: 'http://x', token: 't', fetchImpl })
    await expect(client.command('routes.list')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
  })

  it('maps 403 to a "not in grant" error naming the tool', async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(403, { ok: false, details: { code: 'FORBIDDEN' } }))
    const client = createHostClient({ url: 'http://x', token: 't', fetchImpl })
    await expect(client.command('author.approveProposal')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    await expect(client.command('author.approveProposal')).rejects.toThrow(/author\.approveProposal/)
  })

  it('throws a coded HostCommandError on an ok:false envelope', async () => {
    const { fetchImpl } = recordingFetch(jsonResponse(200, { ok: false, error: 'bad spec', details: { code: 'VALIDATION', field: 'spec' } }))
    const client = createHostClient({ url: 'http://x', token: 't', fetchImpl })
    const error = await client.command('author.recipe').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HostCommandError)
    expect(error).toMatchObject({ code: 'VALIDATION', field: 'spec', message: 'bad spec' })
  })
})
