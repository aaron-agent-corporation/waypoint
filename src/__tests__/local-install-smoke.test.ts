import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

describe('local install smoke readiness', () => {
  it('declares a tarball install smoke for the built CLI package stack', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
    const smokeScript = resolve(repoRoot, 'scripts/local-install-smoke.mjs')

    expect(rootPackage.scripts['smoke:install']).toBe('node scripts/local-install-smoke.mjs')
    expect(existsSync(smokeScript)).toBe(true)

    const source = readFileSync(smokeScript, 'utf8')
    expect(source).toContain("run('pnpm', ['pack'")
    expect(source).toContain("run('pnpm', ['install'")
    expect(source).toContain("'init', '--quest', 'waypoint'")
    expect(source).toContain("'start', '--quest', 'waypoint'")
  })
})
