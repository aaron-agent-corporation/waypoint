import type { Server } from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

import { ENGINE_API_VERSION } from '../../core/commands/meta.ts'
import type { EngineHost } from '../../core/engine-host.ts'
import type { EngineEvent } from '../../types.ts'

const MAX_BUFFERED_BYTES = 1_000_000

interface SubscribeMessage {
  readonly subscribe?: { readonly topics?: string[]; readonly lastSeq?: number }
}

/** Any known token (global or scoped) may open a watch stream; unknown is rejected. */
function tokenOk(header: string | undefined, host: EngineHost): boolean {
  if (!header || !header.startsWith('Bearer ')) return false
  return host.tokens.resolve(header.slice('Bearer '.length)).kind !== 'unknown'
}

/**
 * Attach a WebSocket server to the HTTP server. Token is checked on the upgrade
 * (Authorization header — not the query string). On subscribe we register a
 * queueing subscriber FIRST, take the snapshot, then flush queued events newer
 * than the snapshot seq — closing the snapshot/subscribe missed-delta race.
 */
export function attachWebSocket(server: Server, host: EngineHost): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws' || !tokenOk(req.headers.authorization, host)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
  })

  wss.on('connection', (ws: WebSocket) => {
    let unsubscribe: (() => void) | null = null

    const sendEvent = (event: EngineEvent): void => {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        ws.send(JSON.stringify({ type: 'resnapshot' }))
        return
      }
      ws.send(JSON.stringify({ type: 'event', topic: event.topic, seq: event.seq, record: event.record }))
    }
    const sendResnapshot = (): void => ws.send(JSON.stringify({ type: 'resnapshot' }))

    ws.on('message', async (raw) => {
      let msg: SubscribeMessage
      try {
        msg = JSON.parse(raw.toString()) as SubscribeMessage
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }))
        return
      }
      if (!msg.subscribe) return
      if (unsubscribe) unsubscribe()

      const topicList = msg.subscribe.topics ?? ['*']
      const topics = topicList.includes('*') ? ('*' as const) : new Set(topicList)
      const lastSeq = msg.subscribe.lastSeq

      if (typeof lastSeq === 'number') {
        // Reconnect: direct delivery + ring replay (or resnapshot on gap).
        unsubscribe = host.hub.subscribe({ topics, deliver: sendEvent, requestResnapshot: sendResnapshot }, lastSeq)
        return
      }

      // Fresh subscribe: queue → snapshot → flush.
      let flushing = true
      const queue: EngineEvent[] = []
      const asOf = host.hub.currentSeq()
      unsubscribe = host.hub.subscribe({
        topics,
        deliver: (e) => (flushing ? queue.push(e) : sendEvent(e)),
        requestResnapshot: sendResnapshot,
      })

      let snapshot: { routes: unknown[]; tasks: unknown[] }
      try {
        snapshot = await host.snapshot()
      } catch {
        snapshot = { routes: [], tasks: [] }
      }
      ws.send(JSON.stringify({ type: 'snapshot', apiVersion: ENGINE_API_VERSION, seq: asOf, ...snapshot }))
      for (const event of queue) {
        if (event.seq > asOf) sendEvent(event)
      }
      flushing = false
      queue.length = 0
    })

    ws.on('close', () => {
      if (unsubscribe) unsubscribe()
    })
  })

  return wss
}
