import { chmod, rename, rm, writeFile } from 'node:fs/promises'

import { createEngineHost } from './core/engine-host.ts'
import type { EngineBackend } from './types.ts'

export interface EngineHostHandle {
  readonly port: number
  readonly token: string
  readonly url: string
  readonly pid: number
  stop(): Promise<void>
}

interface HandshakeRecord {
  readonly schemaVersion: 1
  readonly pid: number
  readonly port: number
  readonly url: string
  readonly token: string
  readonly createdAt: string
  readonly workspaceRoot: string | null
}

async function writeHandshake(path: string, record: HandshakeRecord): Promise<void> {
  await rm(path, { force: true }) // clear any stale handshake first
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600, encoding: 'utf8' })
  await chmod(tmp, 0o600)
  await rename(tmp, path)
}

export async function startEngineHostFromEnv(
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<EngineHostHandle> {
  const host = createEngineHost()
  const started = await host.start()
  const workspaceRoot = env.WAYPOINT_ENGINE_ROOT ?? null
  if (workspaceRoot) {
    await host.dispatch('workspace.open', {
      root: workspaceRoot,
      backend: (env.WAYPOINT_ENGINE_BACKEND as EngineBackend | undefined) ?? 'folder',
    })
  }

  const record: HandshakeRecord = {
    schemaVersion: 1,
    pid: process.pid,
    port: started.port,
    url: started.url,
    token: started.token,
    createdAt: new Date().toISOString(),
    workspaceRoot,
  }
  const handshakePath = env.WAYPOINT_ENGINE_HANDSHAKE
  if (handshakePath) await writeHandshake(handshakePath, record)

  return {
    port: started.port,
    token: started.token,
    url: started.url,
    pid: process.pid,
    async stop() {
      await host.stop()
      if (handshakePath) await rm(handshakePath, { force: true })
    },
  }
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  startEngineHostFromEnv(process.argv.slice(2))
    .then((handle) => {
      // Full record (incl. token) or nothing — never a token-less line that disagrees with the file.
      process.stdout.write(`${JSON.stringify({ port: handle.port, url: handle.url, token: handle.token, pid: handle.pid })}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    })
}
