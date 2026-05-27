import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

const realBdSmoke = realBdAvailable() ? it : it.skip

describe('waypoint Beads backend CLI smoke', () => {
  it('runs init, start, route reads, autopilot, gate, and resume through a Beads command boundary', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-beads-smoke-'))
    const fakeBd = await installFakeBd(cwd)
    const originalPath = process.env.PATH
    const originalState = process.env.WAYPOINT_FAKE_BD_STATE
    process.env.PATH = `${fakeBd.binDir}:${originalPath ?? ''}`
    process.env.WAYPOINT_FAKE_BD_STATE = fakeBd.statePath
    try {
      await expect(runWaypointCli(['init', '--quest', 'waypoint', '--backend', 'beads'], silentIo(cwd))).resolves.toBe(0)

      const start = makeIo(cwd)
      await expect(runWaypointCli(['start', '--quest', 'waypoint'], start.io)).resolves.toBe(0)
      expect(start.stderr).toEqual([])
      expect(start.stdout.join('\n')).toContain('route backend: beads')
      expect(start.stdout.join('\n')).toContain('beads root issue: bd-001')

      const routes = makeIo(cwd)
      await expect(runWaypointCli(['routes', '--json'], routes.io)).resolves.toBe(0)
      expect(JSON.parse(routes.stdout.join('\n'))).toMatchObject({
        routes: [{ id: 'route-001', quest: 'waypoint', status: 'active' }],
      })

      const route = makeIo(cwd)
      await expect(runWaypointCli(['route', '--route-id', 'route-001'], route.io)).resolves.toBe(0)
      expect(route.stdout.join('\n')).toContain('Waypoint route route-001')
      expect(route.stdout.join('\n')).toContain('metadata:')

      const tasks = makeIo(cwd)
      await expect(runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasks.io)).resolves.toBe(0)
      const parsedTasks = JSON.parse(tasks.stdout.join('\n')) as { tasks: Array<{ id: string; route_id: string; plan_ref: string }> }
      expect(parsedTasks.tasks).toHaveLength(12)
      expect(parsedTasks.tasks[0]).toMatchObject({ id: 'bd-002', route_id: 'route-001', plan_ref: 'initialize-context' })

      const auto = makeIo(cwd)
      await expect(runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '1', '--json'], auto.io)).resolves.toBe(0)
      expect(JSON.parse(auto.stdout.join('\n'))).toMatchObject({
        status: 'iteration_cap',
        routeId: 'route-001',
        iterations: 1,
        completedTasks: ['bd-002'],
      })

      const gate = makeIo(cwd)
      await expect(
        runWaypointCli(
          ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--approve', '--note', 'Smoke approved'],
          gate.io,
        ),
      ).resolves.toBe(0)
      expect(gate.stdout.join('\n')).toContain('Approved gate plan-approval-gate on route route-001')

      const resume = makeIo(cwd)
      await expect(runWaypointCli(['resume', '--route-id', 'route-001', '--json'], resume.io)).resolves.toBe(0)
      expect(JSON.parse(resume.stdout.join('\n'))).toMatchObject({ route: { id: 'route-001', status: 'active' } })

      const state = JSON.parse(await readFile(fakeBd.statePath, 'utf8')) as FakeBdState
      expect(state.issues.find((issue) => issue.id === 'bd-001')?.metadata).toMatchObject({
        waypoint: { kind: 'route', quest_slug: 'waypoint', route_id: 'route-001' },
      })
      expect(state.dependencies.length).toBeGreaterThan(0)
      expect(state.comments.some((comment) => comment.id === 'bd-002' && comment.text.includes('Waypoint autopilot completed'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
      if (originalState === undefined) {
        delete process.env.WAYPOINT_FAKE_BD_STATE
      } else {
        process.env.WAYPOINT_FAKE_BD_STATE = originalState
      }
    }
  })

  realBdSmoke('runs init, status, start, auto, gate, resume, and route-events against a real bd workspace', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'waypoint-cli-real-bd-smoke-'))
    try {
      const init = makeIo(cwd)
      await expect(runWaypointCli(['init', '--quest', 'waypoint', '--backend', 'beads', '--init-beads'], init.io)).resolves.toBe(0)
      expect(init.stderr).toEqual([])
      expect(init.stdout.join('\n')).toContain('beads workspace: ready')

      const status = makeIo(cwd)
      await expect(runWaypointCli(['status', '--json'], status.io)).resolves.toBe(0)
      expect(JSON.parse(status.stdout.join('\n'))).toMatchObject({
        backend: 'beads',
        beads: { readiness: { ok: true, status: 'ready' } },
      })

      const start = makeIo(cwd)
      await expect(runWaypointCli(['start', '--quest', 'waypoint'], start.io)).resolves.toBe(0)
      expect(start.stderr).toEqual([])
      expect(start.stdout.join('\n')).toContain('route backend: beads')
      expect(start.stdout.join('\n')).toContain('beads root issue:')

      const tasks = makeIo(cwd)
      await expect(runWaypointCli(['tasks', '--route-id', 'route-001', '--json'], tasks.io)).resolves.toBe(0)
      const parsedTasks = JSON.parse(tasks.stdout.join('\n')) as { tasks: Array<{ id: string; kind: string; plan_ref: string }> }
      expect(parsedTasks.tasks.length).toBeGreaterThan(1)

      const auto = makeIo(cwd)
      await expect(runWaypointCli(['auto', '--route-id', 'route-001', '--max-iterations', '10', '--json'], auto.io)).resolves.toBe(0)
      expect(JSON.parse(auto.stdout.join('\n'))).toMatchObject({
        routeId: 'route-001',
        status: 'blocked',
        blockedNode: 'plan-approval-gate',
      })

      const gateTask = parsedTasks.tasks.find((task) => task.kind === 'gate')
      expect(gateTask).toBeTruthy()
      const gate = makeIo(cwd)
      await expect(runWaypointCli([
        'gate',
        '--route-id',
        'route-001',
        '--node',
        gateTask!.plan_ref,
        '--approve',
        '--note',
        'Real bd smoke approved.',
      ], gate.io)).resolves.toBe(0)

      const resume = makeIo(cwd)
      await expect(runWaypointCli([
        'resume',
        '--route-id',
        'route-001',
        '--json',
      ], resume.io)).resolves.toBe(0)

      const routeEvents = makeIo(cwd)
      await expect(runWaypointCli(['route-events', '--route-id', 'route-001', '--json'], routeEvents.io)).resolves.toBe(0)
      const events = JSON.parse(routeEvents.stdout.join('\n')) as { items: Array<{ kind: string }> }
      expect(events.items.map((event) => event.kind)).toEqual(expect.arrayContaining([
        'route.started',
        'route.gate.approved',
        'route.resumed',
      ]))

      const finalStatus = makeIo(cwd)
      await expect(runWaypointCli(['status', '--json'], finalStatus.io)).resolves.toBe(0)
      expect(JSON.parse(finalStatus.stdout.join('\n'))).toMatchObject({
        beads: { root_issue_ids: [expect.any(String)] },
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 120000)
})

interface FakeBdIssue {
  readonly id: string
  readonly title: string
  status: string
  readonly issue_type: string
  readonly labels: readonly string[]
  readonly metadata: unknown
  readonly parent?: string
  readonly created_at: string
  updated_at: string
}

interface FakeBdState {
  readonly issues: FakeBdIssue[]
  readonly dependencies: Array<{ issue_id: string; depends_on_id: string; type: string }>
  readonly comments: Array<{ id: string; text: string }>
}

function silentIo(cwd: string) {
  return { cwd, stdout: () => undefined, stderr: () => undefined }
}

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

function realBdAvailable(): boolean {
  const result = spawnSync('bd', ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

async function installFakeBd(cwd: string): Promise<{ readonly binDir: string; readonly statePath: string }> {
  const binDir = join(cwd, 'bin')
  const statePath = join(cwd, 'fake-bd-state.json')
  await mkdir(binDir, { recursive: true })
  await writeFile(statePath, JSON.stringify({ issues: [], dependencies: [], comments: [] }), 'utf8')
  const scriptPath = join(binDir, 'bd')
  await writeFile(scriptPath, fakeBdScript(), 'utf8')
  await chmod(scriptPath, 0o755)
  return { binDir, statePath }
}

function fakeBdScript(): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const statePath = process.env.WAYPOINT_FAKE_BD_STATE
if (!statePath) throw new Error('WAYPOINT_FAKE_BD_STATE is required')
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(statePath, 'utf8'))

function write() {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n')
}

function nextId() {
  return 'bd-' + String(state.issues.length + 1).padStart(3, '0')
}

const command = args[0]
if (command === 'where') {
  output({ path: process.cwd() + '/.beads', database_path: process.cwd() + '/.beads/embeddeddolt', prefix: 'waypoint' })
} else if (command === 'create') {
  const title = args[1]
  const issue = {
    id: nextId(),
    title,
    status: 'open',
    issue_type: valueAfter('--type') || 'task',
    labels: (valueAfter('--labels') || '').split(',').filter(Boolean),
    metadata: JSON.parse(valueAfter('--metadata') || '{}'),
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    ...(valueAfter('--parent') ? { parent: valueAfter('--parent') } : {}),
  }
  state.issues.push(issue)
  write()
  output(issue)
} else if (command === 'dep' && args[1] === 'add') {
  const dependency = { issue_id: args[2], depends_on_id: args[3], type: valueAfter('--type') || 'blocks' }
  state.dependencies.push(dependency)
  write()
  output({ status: 'added', ...dependency })
} else if (command === 'list') {
  output(state.issues.map((issue) => ({
    ...issue,
    dependencies: state.dependencies.filter((dependency) => dependency.issue_id === issue.id),
  })))
} else if (command === 'close') {
  const issue = state.issues.find((entry) => entry.id === args[1])
  if (!issue) throw new Error('missing issue ' + args[1])
  issue.status = 'closed'
  issue.updated_at = '2026-05-27T00:00:01.000Z'
  write()
  output([issue])
} else if (command === 'update') {
  const issue = state.issues.find((entry) => entry.id === args[1])
  if (!issue) throw new Error('missing issue ' + args[1])
  issue.status = valueAfter('--status') || issue.status
  issue.updated_at = '2026-05-27T00:00:02.000Z'
  write()
  output([issue])
} else if (command === 'comment') {
  state.comments.push({ id: args[1], text: args[2] || '' })
  write()
  output({ status: 'commented' })
} else {
  console.error('unsupported fake bd command: ' + args.join(' '))
  process.exit(2)
}
`
}
