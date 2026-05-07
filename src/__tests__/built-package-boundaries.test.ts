import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

describe('built package boundaries', () => {
  it('verifies built core, folder-host, and CLI imports without source aliases', () => {
    const verifier = resolve(repoRoot, 'scripts/verify-built-package-imports.mjs')
    expect(existsSync(verifier)).toBe(true)

    const output = execFileSync('node', [verifier], { cwd: repoRoot, encoding: 'utf8' })

    expect(output).toContain('built core import: ok')
    expect(output).toContain('built folder-host import: ok')
    expect(output).toContain('built cli import: ok')
    expect(output).toContain('built cli bin: ok')
  })
})
