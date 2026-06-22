import type { EngineEnvelope, EngineWsMessage } from './types'

export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: ((...args: unknown[]) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((...args: unknown[]) => void) | null
  onerror: ((...args: unknown[]) => void) | null
}

export interface BrowserEngineClientOptions {
  /** Absolute engine base URL. Defaults to same-origin (browser). */
  baseUrl?: string
  /** Extra headers (used by tests to inject the bearer token; the dev proxy injects it in the browser). */
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  /** Factory for the socket; defaults to the native WebSocket. Tests pass a node `ws`-backed factory. */
  wsFactory?: (url: string) => WebSocketLike
}

export interface BrowserEngineClient {
  cmd(name: string, payload?: unknown): Promise<EngineEnvelope>
  subscribe(topics: string[], onMessage: (msg: EngineWsMessage) => void, opts?: { lastSeq?: number }): () => void
}

export function createBrowserEngineClient(options: BrowserEngineClientOptions = {}): BrowserEngineClient {
  const baseUrl = options.baseUrl ?? ''
  const headers = options.headers ?? {}
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const wsFactory = options.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)

  return {
    async cmd(name, payload = {}) {
      const res = await doFetch(`${baseUrl}/cmd/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      })
      return (await res.json()) as EngineEnvelope
    },

    subscribe(topics, onMessage, opts) {
      const origin = baseUrl || (typeof location !== 'undefined' ? location.origin : '')
      const wsUrl = `${origin.replace(/^http/, 'ws')}/ws`
      const ws = wsFactory(wsUrl)
      ws.onopen = () => {
        ws.send(JSON.stringify({ subscribe: { topics, ...(opts?.lastSeq != null ? { lastSeq: opts.lastSeq } : {}) } }))
      }
      ws.onmessage = (event) => {
        try {
          onMessage(JSON.parse(String(event.data)) as EngineWsMessage)
        } catch {
          // ignore non-JSON frames
        }
      }
      return () => ws.close()
    },
  }
}
