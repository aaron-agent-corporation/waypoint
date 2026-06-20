import { describe, expect, it } from 'vitest'

import { fail } from '../envelope.ts'
import type { EngineErrorCode } from '../types.ts'

/**
 * Pins the ONE canonical error-envelope shape (Task 10): every failure is
 * `{ ok:false, action:'error', error, details: { code, path?, message, issues? } }`.
 * An AI agent / host-client parses `details.code` + `details.path` uniformly.
 */
describe('canonical error envelope shape', () => {
  it('always has ok:false, action:error, and details.{code,message}', () => {
    const env = fail('boom', { code: 'BACKEND_ERROR' }) as { ok: boolean; action: string; error: string; details: Record<string, unknown> }
    expect(env.ok).toBe(false)
    expect(env.action).toBe('error')
    expect(env.error).toBe('boom')
    expect(env.details.code).toBe('BACKEND_ERROR')
    expect(env.details.message).toBe('boom')
    expect('path' in env.details).toBe(false)
    expect('field' in env.details).toBe(false)
  })

  it('maps field -> path and never emits a legacy field key', () => {
    const env = fail('nope', { code: 'VALIDATION', field: 'quest' }) as { details: Record<string, unknown> }
    expect(env.details).toEqual({ code: 'VALIDATION', path: 'quest', message: 'nope' })
  })

  it('conforms across FORBIDDEN / VALIDATION / NOT_FOUND with issues', () => {
    const codes: EngineErrorCode[] = ['FORBIDDEN', 'VALIDATION', 'NOT_FOUND']
    for (const code of codes) {
      const env = fail(`${code} happened`, { code, field: 'command', issues: ['a', 'b'] }) as { details: Record<string, unknown> }
      expect(env.details).toEqual({ code, path: 'command', message: `${code} happened`, issues: ['a', 'b'] })
    }
  })
})
