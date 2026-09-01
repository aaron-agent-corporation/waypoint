import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, unknown>
}

describe('package build readiness', () => {
  it('declares a build pipeline and package entrypoints that target emitted JavaScript', () => {
    const rootPackage = readJson('package.json')
    const folderHostPackage = readJson('packages/waypoint-folder-host/package.json')
    const cliPackage = readJson('packages/waypoint-cli/package.json')

    expect(rootPackage.scripts).toMatchObject({
      build: 'tsc -p tsconfig.build.json && node scripts/stage-package-builds.mjs',
      clean: 'rm -rf dist packages/waypoint-folder-host/dist packages/waypoint-cli/dist',
    })
    expect(rootPackage.main).toBe('./dist/src/index.js')
    expect(rootPackage.types).toBe('./dist/src/index.d.ts')
    expect(rootPackage.exports).toEqual({
      '.': {
        types: './dist/src/index.d.ts',
        import: './dist/src/index.js',
      },
    })

    expect(folderHostPackage.main).toBe('./dist/index.js')
    expect(folderHostPackage.types).toBe('./dist/index.d.ts')
    expect(folderHostPackage.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    })

    expect(cliPackage.bin).toEqual({ waypoint: './dist/bin.js' })
    expect(cliPackage.main).toBe('./dist/index.js')
    expect(cliPackage.types).toBe('./dist/index.d.ts')
    expect(cliPackage.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    })
  })

  it('defines the build tsconfig and staging script used by pnpm build', () => {
    const buildConfig = readJson('tsconfig.build.json')
    const compilerOptions = buildConfig.compilerOptions as Record<string, unknown>

    expect(compilerOptions.noEmit).toBe(false)
    expect(compilerOptions.rewriteRelativeImportExtensions).toBe(true)
    expect(compilerOptions.outDir).toBe('./dist')
    expect(existsSync(resolve(repoRoot, 'scripts/stage-package-builds.mjs'))).toBe(true)
  })
})
