import { describe, expect, it } from 'vitest'

import { CommandBus } from '../core/command-bus.ts'
import { EngineError, ok } from '../envelope.ts'

describe('CommandBus', () => {
  it('dispatches a registered command', async () => {
    const bus = new CommandBus()
    bus.register('ping', () => ok('ping', { pong: true }))
    expect(await bus.dispatch('ping', {})).toEqual({ ok: true, action: 'ping', pong: true })
  })

  it('passes the payload through to the handler', async () => {
    const bus = new CommandBus()
    bus.register('echo', (payload) => ok('echo', { payload }))
    expect(await bus.dispatch('echo', { a: 1 })).toEqual({ ok: true, action: 'echo', payload: { a: 1 } })
  })

  it('returns a coded error envelope for an unknown command', async () => {
    const bus = new CommandBus()
    expect(await bus.dispatch('nope', {})).toEqual({
      ok: false,
      action: 'error',
      error: 'Unknown command: nope',
      details: { code: 'UNKNOWN_COMMAND', message: 'Unknown command: nope' },
    })
  })

  it('maps a plain thrown Error to a BACKEND_ERROR envelope', async () => {
    const bus = new CommandBus()
    bus.register('boom', () => {
      throw new Error('kaboom')
    })
    expect(await bus.dispatch('boom', {})).toEqual({
      ok: false,
      action: 'error',
      error: 'kaboom',
      details: { code: 'BACKEND_ERROR', message: 'kaboom' },
    })
  })

  it('preserves an EngineError code + field', async () => {
    const bus = new CommandBus()
    bus.register('bad', () => {
      throw new EngineError('quest is required', { code: 'VALIDATION', field: 'quest' })
    })
    expect(await bus.dispatch('bad', {})).toEqual({
      ok: false,
      action: 'error',
      error: 'quest is required',
      details: { code: 'VALIDATION', path: 'quest', message: 'quest is required' },
    })
  })

  it('awaits async handlers', async () => {
    const bus = new CommandBus()
    bus.register('slow', async () => {
      await Promise.resolve()
      return ok('slow', { done: true })
    })
    expect(await bus.dispatch('slow', {})).toEqual({ ok: true, action: 'slow', done: true })
  })

  it('lists registered command names sorted', () => {
    const bus = new CommandBus()
    bus.register('b', () => ok('b'))
    bus.register('a', () => ok('a'))
    expect(bus.has('a')).toBe(true)
    expect(bus.has('z')).toBe(false)
    expect(bus.names()).toEqual(['a', 'b'])
  })

  it('rejects duplicate registration', () => {
    const bus = new CommandBus()
    bus.register('dup', () => ok('dup'))
    expect(() => bus.register('dup', () => ok('dup'))).toThrow(/already registered/)
  })
})
