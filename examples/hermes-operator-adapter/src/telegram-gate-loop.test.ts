import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runHermesTelegramGateLoop, buildTelegramGatePrompt } from './telegram-gate-loop.ts'
import type { HermesProjectRecord } from './project-registry.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')

function makeProject(): { project: HermesProjectRecord; cleanup: () => void } {
  const path = mkdtempSync(resolve(tmpdir(), 'waypoint-telegram-gate-'))
  return {
    project: { name: 'fixture', path, waypointCli },
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  }
}

async function runUnsafeSetupCommand(project: HermesProjectRecord, args: readonly string[]): Promise<string> {
  const result = await spawnCommand(process.execPath, [project.waypointCli, ...args], project.path)
  if (result.exitCode !== 0) throw new Error(`setup failed: ${result.stderr}\n${result.stdout}`)
  return result.stdout
}

async function startedBlockedProject(): Promise<{ project: HermesProjectRecord; cleanup: () => void }> {
  const fixture = makeProject()
  await runUnsafeSetupCommand(fixture.project, ['init', '--quest', 'waypoint'])
  await runUnsafeSetupCommand(fixture.project, ['start', '--quest', 'waypoint'])
  await runUnsafeSetupCommand(fixture.project, ['auto', '--route-id', 'route-001', '--max-iterations', '10'])
  return fixture
}

async function spawnCommand(command: string, args: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr }))
    child.on('error', (error) => resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }))
  })
}

describe('Hermes Telegram gate loop reference adapter', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
  })

  it('builds a concise gate prompt for Telegram replies', () => {
    expect(
      buildTelegramGatePrompt({ routeId: 'route-001', node: 'plan-approval-gate', summary: 'Plan is ready.' }),
    ).toContain('route-001 is blocked at plan-approval-gate.')
    expect(
      buildTelegramGatePrompt({ routeId: 'route-001', node: 'plan-approval-gate', summary: 'Plan is ready.' }),
    ).toContain('Reply: approve, reject, revise, show tasks, or show events.')
  })

  it('maps an approve reply to waypoint gate and quotes the updated route status', async () => {
    const fixture = await startedBlockedProject()
    cleanups.push(fixture.cleanup)

    const result = await runHermesTelegramGateLoop(fixture.project, {
      routeId: 'route-001',
      node: 'plan-approval-gate',
      reply: 'approve',
      nextNode: 'execute',
    })

    expect(result.action).toBe('approve')
    expect(result.command).toBe('waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute')
    expect(result.message).toContain('Approved gate plan-approval-gate on route route-001')
    expect(result.message).toContain('status: active')
    expect(result.message).toContain('current node: execute')

    const events = await runUnsafeSetupCommand(fixture.project, ['route-events', '--route-id', 'route-001', '--limit', '20'])
    expect(events).toContain('route.gate.approved')
  }, 30000)

  it('maps reject, revise, show tasks, and show events replies through safe Waypoint commands', async () => {
    const calls: string[][] = []
    const project: HermesProjectRecord = { name: 'fixture', path: '/tmp/fixture', waypointCli: '/tmp/fixture/packages/waypoint-cli/src/bin.ts' }
    const executor = async (spec: { readonly args: readonly string[] }) => {
      calls.push([...spec.args.slice(1)])
      const command = spec.args[1]
      if (command === 'gate') return { exitCode: 0, stdout: 'Rejected gate plan-approval-gate on route route-001\nstatus: blocked\ncurrent node: plan-approval-gate\nnote: needs changes\n', stderr: '' }
      if (command === 'tasks') return { exitCode: 0, stdout: 'Waypoint tasks\ntotal: 12\n- task-001 initialize-context\n', stderr: '' }
      if (command === 'route-events') return { exitCode: 0, stdout: 'Waypoint route events route-001\ntotal: 2\n- event-002 route.gate.rejected\n', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: `unexpected command ${command}` }
    }

    const reject = await runHermesTelegramGateLoop(project, { routeId: 'route-001', node: 'plan-approval-gate', reply: 'reject needs changes', executor })
    const revise = await runHermesTelegramGateLoop(project, { routeId: 'route-001', node: 'plan-approval-gate', reply: 'revise: needs more evidence', executor })
    const tasks = await runHermesTelegramGateLoop(project, { routeId: 'route-001', node: 'plan-approval-gate', reply: 'show tasks', executor })
    const events = await runHermesTelegramGateLoop(project, { routeId: 'route-001', node: 'plan-approval-gate', reply: 'show events', executor })

    expect(reject.action).toBe('reject')
    expect(revise.action).toBe('revise')
    expect(tasks.action).toBe('show_tasks')
    expect(events.action).toBe('show_events')
    expect(calls).toEqual([
      ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--reject', '--note', 'needs changes'],
      ['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--reject', '--note', 'revise: needs more evidence'],
      ['tasks', '--route-id', 'route-001'],
      ['route-events', '--route-id', 'route-001', '--limit', '20'],
    ])
  })
})
