import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PiCliBrainAdapter, buildPiArgs, type SpawnFn } from './pi-cli-adapter.ts'
import type { BrainEvent } from './brain-adapter.ts'

const TOOL = readFileSync(join(import.meta.dirname, '__fixtures__', 'pi-stream', 'tool-session.jsonl'), 'utf8')

interface FakeChild extends EventEmitter {
  stdout: EventEmitter & { setEncoding(enc: string): void }
  stderr: EventEmitter & { setEncoding(enc: string): void }
  kill(signal: NodeJS.Signals): boolean
  signals: NodeJS.Signals[]
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
  child.signals = []
  child.kill = (signal: NodeJS.Signals) => {
    child.signals.push(signal)
    return true
  }
  return child
}

interface Captured {
  command: string
  args: readonly string[]
  options: SpawnOptions
}

function fakeSpawn(child: FakeChild, captured: Captured[]): SpawnFn {
  return (command, args, options) => {
    captured.push({ command, args, options })
    return child as unknown as ChildProcess
  }
}

function collector(): { events: BrainEvent[]; onEvent: (e: BrainEvent) => void } {
  const events: BrainEvent[] = []
  return { events, onEvent: (e) => events.push(e) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('buildPiArgs', () => {
  it('scopes to extension tools only and pins json mode', () => {
    const args = buildPiArgs({ intent: 'make a recipe', systemPrompt: 'be good', extensionPath: '/ext.ts' })
    expect(args).toEqual(['-p', '--mode', 'json', '--no-tools', '-e', '/ext.ts', '--system', 'be good', 'make a recipe'])
  })
})

describe('PiCliBrainAdapter', () => {
  it('spawns with stdin ignored + the scoped token in env, streams events, returns completed', async () => {
    const child = makeFakeChild()
    const captured: Captured[] = []
    const adapter = new PiCliBrainAdapter({
      hostUrl: 'http://127.0.0.1:9999/',
      hostToken: 'scoped-xyz',
      extensionPath: '/ext.ts',
      spawnFn: fakeSpawn(child, captured),
    })
    const sink = collector()

    const promise = adapter.runSession({ intent: 'ping', tools: [], systemPrompt: 'sp', onEvent: sink.onEvent })

    child.stdout.emit('data', TOOL)
    child.emit('close', 0)
    const result = await promise

    expect(captured[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect((captured[0].options.env as NodeJS.ProcessEnv).WAYPOINT_HOST_TOKEN).toBe('scoped-xyz')
    expect((captured[0].options.env as NodeJS.ProcessEnv).WAYPOINT_HOST_URL).toBe('http://127.0.0.1:9999/')
    expect(sink.events.map((e) => e.kind)).toContain('agent.tool_result')
    expect(result.status).toBe('completed')
    expect(result.summary).toBe('Done.')
  })

  it('aborts with SIGTERM then escalates to SIGKILL after the grace period', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild()
    const adapter = new PiCliBrainAdapter({
      hostUrl: 'u',
      hostToken: 't',
      extensionPath: '/ext.ts',
      spawnFn: fakeSpawn(child, []),
      killGraceMs: 2000,
    })
    const controller = new AbortController()
    const sink = collector()
    const promise = adapter.runSession({ intent: 'x', tools: [], systemPrompt: 'sp', signal: controller.signal, onEvent: sink.onEvent })

    controller.abort()
    expect(child.signals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(2000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])

    child.emit('close', null)
    expect(await promise).toEqual({ status: 'cancelled' })
  })

  it('returns cancelled immediately if the signal is already aborted', async () => {
    const adapter = new PiCliBrainAdapter({ hostUrl: 'u', hostToken: 't', extensionPath: '/ext.ts', spawnFn: fakeSpawn(makeFakeChild(), []) })
    const result = await adapter.runSession({
      intent: 'x',
      tools: [],
      systemPrompt: 'sp',
      signal: AbortSignal.abort(),
      onEvent: () => {},
    })
    expect(result).toEqual({ status: 'cancelled' })
  })

  it('maps a non-zero exit without a terminal event to error with the stderr tail', async () => {
    const child = makeFakeChild()
    const adapter = new PiCliBrainAdapter({ hostUrl: 'u', hostToken: 't', extensionPath: '/ext.ts', spawnFn: fakeSpawn(child, []) })
    const sink = collector()
    const promise = adapter.runSession({ intent: 'x', tools: [], systemPrompt: 'sp', onEvent: sink.onEvent })

    child.stdout.emit('data', '{"type":"turn_start"}\n')
    child.stderr.emit('data', 'boom: model error')
    child.emit('close', 1)
    const result = await promise

    expect(result.status).toBe('error')
    expect(result.error).toContain('boom: model error')
  })

  it('honors a terminal agent.end even on a non-zero exit', async () => {
    const child = makeFakeChild()
    const adapter = new PiCliBrainAdapter({ hostUrl: 'u', hostToken: 't', extensionPath: '/ext.ts', spawnFn: fakeSpawn(child, []) })
    const promise = adapter.runSession({ intent: 'x', tools: [], systemPrompt: 'sp', onEvent: () => {} })

    child.stdout.emit('data', TOOL)
    child.emit('close', 3)
    expect((await promise).status).toBe('completed')
  })

  it('maps a spawn failure (ENOENT) to error including stderr', async () => {
    const child = makeFakeChild()
    const adapter = new PiCliBrainAdapter({ hostUrl: 'u', hostToken: 't', extensionPath: '/ext.ts', spawnFn: fakeSpawn(child, []) })
    const promise = adapter.runSession({ intent: 'x', tools: [], systemPrompt: 'sp', onEvent: () => {} })

    child.emit('error', Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }))
    const result = await promise
    expect(result.status).toBe('error')
    expect(result.error).toContain('ENOENT')
  })
})
