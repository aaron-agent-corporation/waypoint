import { describe, expect, it, vi } from 'vitest'

import { resolveEngineTarget } from './target'

describe('resolveEngineTarget', () => {
  it('reads url + token from the handshake file named by WAYPOINT_ENGINE_HANDSHAKE', () => {
    const read = vi.fn(() => JSON.stringify({ url: 'http://127.0.0.1:7777', token: 'tok-abc', port: 7777 }))
    expect(resolveEngineTarget({ WAYPOINT_ENGINE_HANDSHAKE: '/tmp/hs.json' }, read)).toEqual({ url: 'http://127.0.0.1:7777', token: 'tok-abc' })
    expect(read).toHaveBeenCalledWith('/tmp/hs.json', 'utf8')
  })

  it('returns null when the env var is unset', () => {
    expect(resolveEngineTarget({}, () => '')).toBeNull()
  })

  it('returns null when the handshake is missing or malformed', () => {
    const throwing = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }
    expect(resolveEngineTarget({ WAYPOINT_ENGINE_HANDSHAKE: '/nope' }, throwing)).toBeNull()
    expect(resolveEngineTarget({ WAYPOINT_ENGINE_HANDSHAKE: '/bad' }, () => '{not json')).toBeNull()
  })
})
