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

/** Swap only the `http:`/`https:` scheme (case-insensitively) to `ws:`/`wss:`, leaving other schemes untouched. */
function toWsScheme(url: string): string {
  const lower = url.toLowerCase()
  if (lower.startsWith('https:')) return `wss:${url.slice('https:'.length)}`
  if (lower.startsWith('http:')) return `ws:${url.slice('http:'.length)}`
  return url
}

export function createBrowserEngineClient(options: BrowserEngineClientOptions = {}): BrowserEngineClient {
  // Normalize once so cmd() (`${baseUrl}/cmd/...`) and subscribe() (`${baseUrl}/ws`)
  // share identical base handling — a trailing slash would otherwise yield `//cmd`.
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
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
      const base = baseUrl || (typeof location !== 'undefined' ? location.origin : '')
      // Contract: the WebSocket connects under the SAME path prefix as HTTP
      // commands. `cmd()` posts to `${baseUrl}/cmd/<name>`, so the socket is
      // `${baseUrl}/ws` with the scheme swapped to ws/wss — a path-bearing
      // baseUrl (e.g. http://host/prefix) yields ws://host/prefix/ws. With no
      // base (SSR/tests) fall back to a relative `/ws`. (base is already
      // trailing-slash-normalized at construction.)
      const wsUrl = base ? `${toWsScheme(base)}/ws` : '/ws'
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
      return () => {
        // Detach handlers before closing so a frame already queued on the socket
        // can't still invoke onMessage after the caller has unsubscribed.
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    },
  }
}
