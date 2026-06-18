import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { WebSocketServer } from 'ws'

import { fail } from '../../envelope.ts'
import type { EngineHost } from '../../core/engine-host.ts'
import type { Transport, TransportStartResult } from '../transport.ts'
import { attachWebSocket } from './ws.ts'

export interface HttpWsTransportOptions {
  readonly host?: string
  readonly port?: number
  readonly token?: string
  readonly maxBodyBytes?: number
}

const DEFAULT_MAX_BODY = 1_000_000

export function createHttpWsTransport(host: EngineHost, opts: HttpWsTransportOptions = {}): Transport {
  const bindHost = opts.host ?? '127.0.0.1'
  const token = opts.token ?? randomBytes(24).toString('hex')
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY
  let server: Server | null = null
  let wss: WebSocketServer | null = null

  function tokenOk(header: string | undefined): boolean {
    const expected = `Bearer ${token}`
    if (!header || header.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBody) {
          // Stop buffering but keep draining so the response flushes without a reset.
          tooLarge = true
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (tooLarge) {
          reject(Object.assign(new Error('Request body too large'), { code: 'TOO_LARGE' }))
          return
        }
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      req.on('error', reject)
    })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!tokenOk(req.headers.authorization)) {
      send(res, 401, fail('Unauthorized', { code: 'VALIDATION' }))
      return
    }
    const url = new URL(req.url ?? '/', `http://${bindHost}`)
    const match = url.pathname.match(/^\/cmd\/(.+)$/)
    if (req.method !== 'POST' || !match) {
      send(res, 404, fail(`Not found: ${url.pathname}`, { code: 'NOT_FOUND' }))
      return
    }

    let raw: string
    try {
      raw = await readBody(req)
    } catch (error) {
      if ((error as { code?: string }).code === 'TOO_LARGE') {
        send(res, 413, fail('Request body too large', { code: 'VALIDATION' }))
        return
      }
      send(res, 400, fail('Failed to read request body', { code: 'VALIDATION' }))
      return
    }

    let payload: unknown = {}
    if (raw.trim() !== '') {
      try {
        payload = JSON.parse(raw)
      } catch {
        send(res, 400, fail('Invalid JSON body', { code: 'VALIDATION' }))
        return
      }
    }

    const envelope = await host.dispatch(decodeURIComponent(match[1]), payload)
    send(res, 200, envelope)
  }

  return {
    async start(): Promise<TransportStartResult> {
      const srv = createServer((req, res) => {
        void handle(req, res)
      })
      server = srv
      wss = attachWebSocket(srv, host, token)
      await new Promise<void>((resolve) => srv.listen(opts.port ?? 0, bindHost, resolve))
      const port = (srv.address() as AddressInfo).port
      return { port, token, url: `http://${bindHost}:${port}` }
    },
    async stop(): Promise<void> {
      const srv = server
      if (wss) {
        wss.close()
        wss = null
      }
      if (!srv) return
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())))
      server = null
    },
  }
}
