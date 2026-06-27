import { describe, expect, it } from 'vitest'

import { listField } from './engine'

describe('listField', () => {
  it('returns the keyed field on an ok envelope', () => {
    expect(listField({ ok: true, routes: [1, 2] } as never, 'routes.list', 'routes')).toEqual([1, 2])
  })

  it('throws the envelope error message when not ok', () => {
    expect(() => listField({ ok: false, error: 'boom' }, 'routes.list', 'routes')).toThrow('boom')
  })

  it('throws a default message when not ok and no error string', () => {
    expect(() => listField({ ok: false }, 'tasks.list', 'tasks')).toThrow('tasks.list failed')
  })
})
