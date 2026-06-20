import type { SpawnSyncReturns } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { selectBrain } from './select.ts'
import type { VersionProbe } from './pi-version.ts'

function probe(status: number, stdout: string): VersionProbe {
  return () => ({ status, stdout, stderr: '', signal: null, output: [], pid: 1 }) as unknown as SpawnSyncReturns<string>
}

describe('selectBrain', () => {
  it('defaults to the fake brain when WAYPOINT_BRAIN is unset', () => {
    const selection = selectBrain({})
    expect(selection.brain).toBe('fake')
    expect(selection.version).toBeUndefined()
    expect(typeof selection.factory.forSession).toBe('function')
  })

  it('selects pi when the CLI is present, in range, and an extension path is given', () => {
    const selection = selectBrain({ brain: 'pi', piExtensionPath: '/ext.js', versionProbe: probe(0, 'pi 0.55.3') })
    expect(selection.brain).toBe('pi')
    expect(selection.version).toBe('0.55.3')
    expect(typeof selection.factory.forSession).toBe('function')
  })

  it('fails loud (no silent fake) when pi is missing', () => {
    expect(() => selectBrain({ brain: 'pi', piExtensionPath: '/ext.js', versionProbe: probe(127, '') })).toThrow(/WAYPOINT_BRAIN=pi/)
  })

  it('fails loud when pi is version-mismatched', () => {
    expect(() => selectBrain({ brain: 'pi', piExtensionPath: '/ext.js', versionProbe: probe(0, 'pi 0.56.0') })).toThrow(/0\.56\.0/)
  })

  it('fails loud when the extension path is missing', () => {
    expect(() => selectBrain({ brain: 'pi', versionProbe: probe(0, 'pi 0.55.3') })).toThrow(/WAYPOINT_PI_EXTENSION/)
  })
})
