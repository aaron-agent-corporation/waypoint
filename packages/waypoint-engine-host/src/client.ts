import { WebSocket } from 'ws'

import type { EngineEnvelope } from './types.ts'

export interface EngineClientConfig {
  readonly url: string
  readonly token: string
}

export interface EngineClient {
  cmd(name: string, payload?: unknown): Promise<EngineEnvelope>
  subscribe(topics: string[], onEvent: (message: unknown) => void): Promise<() => void>
}

/** Minimal typed client for the engine-host HTTP+WS API (Node `ws` based). */
export function createEngineClient(config: EngineClientConfig): EngineClient {
  const wsUrl = `${config.url.replace(/^http/, 'ws')}/ws`
  return {
    async cmd(name, payload = {}) {
      const res = await fetch(`${config.url}/cmd/${name}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return (await res.json()) as EngineEnvelope
    },
    subscribe(topics, onEvent) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${config.token}` } })
        socket.on('open', () => {
          socket.send(JSON.stringify({ subscribe: { topics } }))
          resolve(() => socket.close())
        })
        socket.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type?: string }
          if (msg.type === 'event') onEvent(msg)
        })
        socket.on('error', reject)
      })
    },
  }
}
