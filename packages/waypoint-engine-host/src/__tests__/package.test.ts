import { describe, expect, it } from 'vitest'

import { getEngineHostInfo } from '../index.ts'

describe('engine-host package', () => {
  it('reports its package identity', () => {
    expect(getEngineHostInfo()).toEqual({
      packageName: '@waypoint/engine-host',
      corePackage: 'waypoint-core',
    })
  })
})
