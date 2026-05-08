import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('FirmVault folder smoke readiness', () => {
  it('declares an end-to-end FirmVault folder smoke script', () => {
    const rootPackage = JSON.parse(readRepoFile('package.json'))
    const smokeScript = resolve(repoRoot, 'scripts/firmvault-folder-smoke.mjs')

    expect(rootPackage.scripts['smoke:firmvault-folder']).toBe('node scripts/firmvault-folder-smoke.mjs')
    expect(existsSync(smokeScript)).toBe(true)

    const source = readFileSync(smokeScript, 'utf8')
    for (const phrase of [
      "'init', '--quest', 'firmvault'",
      "'doctor', 'firmvault', '--json'",
      "'firmvault', 'init-case'",
      "'start', '--quest', 'firmvault'",
      "'tasks', '--route-id', 'route-001'",
      "'firmvault', 'landmarks', '--json'",
      '.waypoint/firmvault/case.yaml',
      '.waypoint/firmvault/landmarks.yaml',
    ]) {
      expect(source).toContain(phrase)
    }
  })
})
