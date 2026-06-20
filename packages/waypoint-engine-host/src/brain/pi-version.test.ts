import type { SpawnSyncReturns } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { PI_PINNED_RANGE, piAvailable, piVersionOk, type VersionProbe } from './pi-version.ts'

function probeReturning(status: number, stdout: string): VersionProbe {
  return () => ({ status, stdout, stderr: '', signal: null, output: [], pid: 1 }) as unknown as SpawnSyncReturns<string>
}

function probeThrowing(): VersionProbe {
  return () => {
    throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' })
  }
}

describe('pi-version', () => {
  it('pins the 0.55.x range', () => {
    expect(PI_PINNED_RANGE).toBe('0.55.x')
  })

  it('piAvailable is true only when pi answers --version with exit 0', () => {
    expect(piAvailable(probeReturning(0, 'pi 0.55.3'))).toBe(true)
    expect(piAvailable(probeReturning(1, ''))).toBe(false)
    expect(piAvailable(probeThrowing())).toBe(false)
  })

  it('piVersionOk accepts an in-range version and reports it', () => {
    expect(piVersionOk(probeReturning(0, 'pi 0.55.3'))).toEqual({ ok: true, version: '0.55.3' })
    expect(piVersionOk(probeReturning(0, '0.55.0'))).toEqual({ ok: true, version: '0.55.0' })
  })

  it('piVersionOk rejects an out-of-range version but still reports it', () => {
    expect(piVersionOk(probeReturning(0, 'pi 0.56.0'))).toEqual({ ok: false, version: '0.56.0' })
    expect(piVersionOk(probeReturning(0, '1.0.0'))).toEqual({ ok: false, version: '1.0.0' })
  })

  it('piVersionOk handles a missing/failed binary', () => {
    expect(piVersionOk(probeReturning(127, ''))).toEqual({ ok: false, version: null })
    expect(piVersionOk(probeThrowing())).toEqual({ ok: false, version: null })
  })
})
