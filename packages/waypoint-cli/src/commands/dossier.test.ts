import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

const pgProjects = new PostgresTestProjects()

/** Minimal fake Console: /v1/sessions lists two sessions (one whose
 * workspace is the project's PARENT dir — the auto-link case — and one
 * unrelated), plus per-session /items transcripts. */
function fakeConsole(parentWorkspace: string): Promise<{ server: Server; url: string }> {
  const now = Math.floor(Date.now() / 1000)
  const sessions = {
    object: 'list',
    data: [
      { id: 'conv_linked', title: 'organize run', agent_name: 'waypoint', workspace: parentWorkspace, updated_at: now },
      { id: 'conv_unrelated', title: 'other work', agent_name: 'waypoint', workspace: '/somewhere/else', updated_at: now },
    ],
  }
  const items = {
    object: 'list',
    data: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'patched the worker command to an absolute path' }] },
      { type: 'function_call', name: 'sys_os_shell', arguments: '{"command":"waypoint tasks retry --task-id task-001"}' },
      { type: 'function_call_output', output: '{"stdout":"retry dispatched"}' },
    ],
  }
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v1/sessions') res.end(JSON.stringify(sessions))
      else if (req.url?.startsWith('/v1/sessions/') && req.url.endsWith('/items')) res.end(JSON.stringify(items))
      else {
        res.statusCode = 404
        res.end('{}')
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
})

describe('waypoint dossier (rsc-9y6)', () => {
  it('writes the run record + auto-linked parent-workspace session transcript', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-dossier-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
    await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))

    const { server, url } = await fakeConsole(dirname(cwd))
    try {
      const { io, stdout } = makeIo(cwd)
      const exitCode = await runWaypointCli(
        ['dossier', '--route-id', 'route-001', '--console-url', url, '--note', 'first attempt failed: ENOENT bare claude'],
        io,
      )
      expect(exitCode).toBe(0)
      expect(stdout.join('\n')).toContain('operator sessions captured: 1')

      const markdown = await readFile(join(cwd, '.waypoint/reports/route-001/dossier.md'), 'utf8')
      expect(markdown).toContain('# Run dossier — route-001 (runner)')
      expect(markdown).toContain('## Tasks')
      expect(markdown).toContain('first attempt failed: ENOENT bare claude')
      expect(markdown).toContain('conv_linked')
      expect(markdown).not.toContain('conv_unrelated')
      expect(markdown).toContain('patched the worker command to an absolute path')
      expect(markdown).toContain('## Project config snapshot')

      const dossier = JSON.parse(await readFile(join(cwd, '.waypoint/reports/route-001/dossier.json'), 'utf8')) as {
        route: { id: string; quest: string }
        tasks: unknown[]
        sessions: { id: string; items?: unknown[] }[]
        sessions_unavailable: boolean
      }
      expect(dossier.route.quest).toBe('runner')
      expect(dossier.tasks.length).toBeGreaterThan(0)
      expect(dossier.sessions_unavailable).toBe(false)
      expect(dossier.sessions.map((s) => s.id)).toEqual(['conv_linked'])
      expect(dossier.sessions[0]!.items?.length).toBe(3)
    } finally {
      server.close()
    }
  })

  /**
   * The stamped session id (rsc-9y6 follow-up 2). The Console exports
   * WAYPOINT_SESSION_ID into every terminal it owns; `waypoint start`
   * records it in route metadata; the dossier links it by identity.
   *
   * The session under test has a workspace the heuristic CANNOT match
   * (`/somewhere/else`, not the project root or its parent) — the same session
   * the first test asserts is correctly EXCLUDED when nothing stamped it. So
   * this passes only if the stamp is doing the work, not the path guess.
   */
  it('links the session that started the run, even when its workspace matches nothing', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-dossier-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))

    const previous = process.env.WAYPOINT_SESSION_ID
    process.env.WAYPOINT_SESSION_ID = 'conv_unrelated'
    try {
      await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
    } finally {
      if (previous === undefined) delete process.env.WAYPOINT_SESSION_ID
      else process.env.WAYPOINT_SESSION_ID = previous
    }

    const { server, url } = await fakeConsole(dirname(cwd))
    try {
      const exitCode = await runWaypointCli(['dossier', '--route-id', 'route-001', '--console-url', url], silentIo(cwd))
      expect(exitCode).toBe(0)
      const dossier = JSON.parse(await readFile(join(cwd, '.waypoint/reports/route-001/dossier.json'), 'utf8')) as {
        route: { metadata: { runner: { console_session_id?: string } } }
        sessions: { id: string; items?: unknown[] }[]
      }
      expect(dossier.route.metadata.runner.console_session_id, 'start did not record the session that launched it').toBe(
        'conv_unrelated',
      )
      // Its transcript is fetched, not merely named.
      const linked = dossier.sessions.find((s) => s.id === 'conv_unrelated')
      expect(linked, 'the stamped session was not linked — the dossier fell back to guessing').toBeTruthy()
      expect(linked!.items?.length).toBe(3)
      // And the heuristic still contributes: the parent-workspace session is here too.
      expect(dossier.sessions.map((s) => s.id).sort()).toEqual(['conv_linked', 'conv_unrelated'])
    } finally {
      server.close()
    }
  })

  it('a run started outside a Console terminal stamps nothing and still links by workspace', async () => {
    // The fallback must survive: cron, a plain shell, and every route started
    // before the stamp existed have no session id, and must not regress to
    // zero linked sessions.
    const cwd = await pgProjects.mkProjectRoot('waypoint-dossier-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
    const previous = process.env.WAYPOINT_SESSION_ID
    delete process.env.WAYPOINT_SESSION_ID
    try {
      await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
    } finally {
      if (previous !== undefined) process.env.WAYPOINT_SESSION_ID = previous
    }

    const { server, url } = await fakeConsole(dirname(cwd))
    try {
      await runWaypointCli(['dossier', '--route-id', 'route-001', '--console-url', url], silentIo(cwd))
      const dossier = JSON.parse(await readFile(join(cwd, '.waypoint/reports/route-001/dossier.json'), 'utf8')) as {
        route: { metadata: { runner: { console_session_id?: string } } }
        sessions: { id: string }[]
      }
      expect(dossier.route.metadata.runner.console_session_id).toBeUndefined()
      expect(dossier.sessions.map((s) => s.id)).toEqual(['conv_linked'])
    } finally {
      server.close()
    }
  })

  it('degrades to a run-record-only dossier when the Console is unreachable', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-dossier-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
    await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))

    const { io, stdout } = makeIo(cwd)
    const exitCode = await runWaypointCli(
      ['dossier', '--route-id', 'route-001', '--console-url', 'http://127.0.0.1:1'],
      io,
    )
    expect(exitCode).toBe(0)
    expect(stdout.join('\n')).toContain('Console unavailable')

    const markdown = await readFile(join(cwd, '.waypoint/reports/route-001/dossier.md'), 'utf8')
    expect(markdown).toContain('Console unavailable at generation time')
    expect(markdown).toContain('## Tasks')
  })

  it('refuses an unknown route id', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-dossier-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))

    const { io, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['dossier', '--route-id', 'route-404', '--console-url', 'http://127.0.0.1:1'], io)).toBe(1)
    expect(stderr.join('\n')).toContain('Route not found: route-404')
  })
})
