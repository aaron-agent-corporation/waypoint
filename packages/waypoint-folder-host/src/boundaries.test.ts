import { describe, expect, it } from 'vitest'
import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const packageRoot = resolve(__dirname, '..')
const srcRoot = resolve(packageRoot, 'src')
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

function extractImports(source: string): string[] {
  const imports: string[] = []
  const staticImportPattern = /import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      imports.push(match[1])
    }
  }

  return imports
}

describe('folder host package boundaries', () => {
  it('allows only @waypoint-engine/core, package-internal relative imports, and Node built-ins', () => {
    const entrypoint = resolve(srcRoot, 'index.ts')
    const source = readFileSync(entrypoint, 'utf8')
    const imports = extractImports(source)

    const disallowed = imports.filter((specifier) => {
      if (specifier === '@waypoint-engine/core' || specifier.startsWith('@waypoint-engine/core/')) return false
      if (nodeBuiltins.has(specifier)) return false
      if (specifier.startsWith('.')) return false
      return true
    })

    expect(disallowed, `${relative(packageRoot, entrypoint)} has disallowed imports`).toEqual([])
  })
})
