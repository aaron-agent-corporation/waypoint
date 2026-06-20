import { describe, expect, it } from 'vitest'

import { EngineError, fail, ok } from '../envelope.ts'

describe('engine envelopes', () => {
  it('builds a success envelope with action and data', () => {
    expect(ok('routes.list', { routes: [] })).toEqual({ ok: true, action: 'routes.list', routes: [] })
  })

  it('builds a bare success envelope', () => {
    expect(ok('workspace.status')).toEqual({ ok: true, action: 'workspace.status' })
  })

  it('carries a structured error code + mirrored message in details', () => {
    expect(fail('No workspace open', { code: 'NO_WORKSPACE' })).toMatchObject({
      ok: false,
      action: 'error',
      error: 'No workspace open',
      details: { code: 'NO_WORKSPACE', message: 'No workspace open' },
    })
  })

  it('maps field -> path and carries issues in canonical error details', () => {
    expect(fail('Authoring draft invalid', { code: 'VALIDATION', field: 'slug', issues: ['slug is required'] })).toMatchObject({
      details: { code: 'VALIDATION', path: 'slug', message: 'Authoring draft invalid', issues: ['slug is required'] },
    })
  })

  it('EngineError keeps the ergonomic {code, field} input; fail() emits {code, path, message}', () => {
    const err = new EngineError('Route not found: route-001', { code: 'NOT_FOUND', field: 'routeId' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Route not found: route-001')
    expect(err.details).toEqual({ code: 'NOT_FOUND', field: 'routeId' })
    expect(fail(err.message, err.details)).toMatchObject({
      ok: false,
      action: 'error',
      error: 'Route not found: route-001',
      details: { code: 'NOT_FOUND', path: 'routeId', message: 'Route not found: route-001' },
    })
  })
})
