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

  it('keeps package manifests publishable and workspace-linked while targeting built CLI output', () => {
    const rootPackage = JSON.parse(readRepoFile('package.json'))
    const cliPackage = JSON.parse(readRepoFile('packages/waypoint-cli/package.json'))
    const hostPackage = JSON.parse(readRepoFile('packages/waypoint-folder-host/package.json'))

    expect(rootPackage.private).toBe(false)
    expect(rootPackage.main).toBe('./dist/src/index.js')
    expect(rootPackage.scripts.build).toBe('tsc -p tsconfig.build.json && node scripts/stage-package-builds.mjs')
    expect(rootPackage.scripts['verify:package-distribution']).toBe('node scripts/verify-package-distribution.mjs')

    expect(cliPackage.private).toBe(false)
    expect(cliPackage.bin.waypoint).toBe('./dist/bin.js')
    expect(cliPackage.dependencies['@waypoint/core']).toBe('workspace:*')
    expect(cliPackage.dependencies['@waypoint/folder-host']).toBe('workspace:*')

    expect(hostPackage.private).toBe(false)
    expect(hostPackage.main).toBe('./dist/index.js')
    expect(hostPackage.dependencies['@waypoint/core']).toBe('workspace:*')
  })
})
