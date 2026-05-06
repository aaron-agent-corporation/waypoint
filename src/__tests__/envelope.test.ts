import { describe, expect, it } from 'vitest'
import { makeErrorEnvelope } from '../envelope/error-envelope'
import { normalizeValidationDetails } from '../envelope/validation-details'

describe('waypoint-core contract: envelope', () => {
  it('builds minimal error envelope without details', () => {
    expect(makeErrorEnvelope('Invalid request body')).toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid request body',
    })
  })

  it('builds error envelope with normalized details array', () => {
    expect(
      makeErrorEnvelope('Invalid request body', [
        { code: 'invalid_type', path: '$', message: 'Expected object' },
      ]),
    ).toEqual({
      ok: false,
      action: 'error',
      error: 'Invalid request body',
      details: [{ code: 'invalid_type', path: '$', message: 'Expected object' }],
    })
  })

  it('normalizes empty validation path to $ root', () => {
    const details = normalizeValidationDetails([
      { code: 'unrecognized_keys', path: [], message: 'Unknown key(s)' },
    ])
    expect(details).toEqual([
      { code: 'unrecognized_keys', path: '$', message: 'Unknown key(s)' },
    ])
  })

  it('normalizes nested paths to dotted strings', () => {
    const details = normalizeValidationDetails([
      { code: 'invalid_type', path: ['discussion', 'agent'], message: 'Expected string' },
    ])
    expect(details).toEqual([
      { code: 'invalid_type', path: 'discussion.agent', message: 'Expected string' },
    ])
  })
})
