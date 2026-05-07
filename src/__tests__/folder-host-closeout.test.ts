import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('folder host closeout', () => {
  it('records workspace/package shape and exposes a folder-host smoke script', () => {
    expect(existsSync(resolve(repoRoot, 'pnpm-workspace.yaml'))).toBe(true)
    expect(existsSync(resolve(repoRoot, 'scripts/folder-host-smoke.mjs'))).toBe(true)

    const rootPackage = JSON.parse(readRepoFile('package.json'))
    expect(rootPackage.packageManager).toBe('pnpm@10.2.1')
    expect(rootPackage.scripts['smoke:folder-host']).toBe('node scripts/folder-host-smoke.mjs')

    const workspace = readRepoFile('pnpm-workspace.yaml')
    expect(workspace).toContain("'.'")
    expect(workspace).toContain("'packages/*'")
  })

  it('keeps package manifests private and workspace-linked while targeting built CLI output', () => {
    const rootPackage = JSON.parse(readRepoFile('package.json'))
    const cliPackage = JSON.parse(readRepoFile('packages/waypoint-cli/package.json'))
    const hostPackage = JSON.parse(readRepoFile('packages/waypoint-folder-host/package.json'))

    expect(rootPackage.private).toBe(true)
    expect(rootPackage.main).toBe('./dist/src/index.js')
    expect(rootPackage.scripts.build).toBe('tsc -p tsconfig.build.json && node scripts/stage-package-builds.mjs')

    expect(cliPackage.private).toBe(true)
    expect(cliPackage.bin.waypoint).toBe('./dist/bin.js')
    expect(cliPackage.dependencies['@waypoint/core']).toBe('workspace:*')
    expect(cliPackage.dependencies['@waypoint/folder-host']).toBe('workspace:*')

    expect(hostPackage.private).toBe(true)
    expect(hostPackage.main).toBe('./dist/index.js')
    expect(hostPackage.dependencies['@waypoint/core']).toBe('workspace:*')
  })

  it('documents Track 1 closeout evidence, limitations, and deferred follow-ups', () => {
    expect(existsSync(resolve(repoRoot, 'docs/plans/waypoint-folder-host-closeout.md'))).toBe(true)

    const closeout = readRepoFile('docs/plans/waypoint-folder-host-closeout.md')
    for (const phrase of [
      'Track 1 — Standalone Folder Host + CLI closeout',
      'pnpm smoke:folder-host',
      'pnpm test',
      'pnpm typecheck',
      'private development package',
      'not a globally published CLI',
      'network sync',
      'multi-user collaboration',
      'Mission Control cutover',
      'Hermes gateway integration',
      'runtime.recipe: local',
    ]) {
      expect(closeout).toContain(phrase)
    }
  })

  it('marks Track 1 complete and records package readiness as the active roadmap destination', () => {
    const roadmap = readRepoFile('docs/plans/waypoint-remaining-roadmap.md')

    expect(roadmap).toContain('### Track 1 — Standalone Folder Host + CLI')
    expect(roadmap).toContain('**Status:** Complete through F12')
    expect(roadmap).toContain('docs/plans/waypoint-folder-host-closeout.md')
    expect(roadmap).toContain('### Track 5 — Package + Install Readiness')
    expect(roadmap).toContain('**Status:** Active — selected by Aaron after cleanup close-out.')
  })
})
