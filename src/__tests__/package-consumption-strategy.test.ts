import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

describe('package consumption strategy', () => {
  it('documents private consumption options and rollback rules before Mission Control cutover', () => {
    const docPath = resolve(repoRoot, 'docs/plans/runner-package-consumption-strategy.md')
    expect(existsSync(docPath)).toBe(true)

    const doc = readFileSync(docPath, 'utf8')
    expect(doc).toContain('Recommended short-term strategy')
    expect(doc).toContain('Git tag / GitHub dependency')
    expect(doc).toContain('Private npm/GitHub Packages')
    expect(doc).toContain('Local path dependency')
    expect(doc).toContain('Rollback rule')
    expect(doc).toContain('Mission Control cutover')
  })
})
