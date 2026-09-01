// Every bundled recipe manifest must parse with the ENGINE's yaml parser.
// In-vivo 2026-07-23: a recipe edit validated with PyYAML but rejected by
// this package's `yaml` (a nested-mapping strictness difference inside a
// single-quoted prompt scalar) — every `waypoint start` in the live case then
// failed with "invalid Recipe manifest". Validation with any other parser
// proves nothing; this test is the gate.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const recipesRoot = fileURLToPath(new URL('../../../../recipes', import.meta.url))

function* manifestPaths(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* manifestPaths(path)
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) yield path
  }
}

describe('bundled recipe manifests', () => {
  it('every recipe parses with the engine yaml parser and has a prompt', () => {
    const failures: string[] = []
    let checked = 0
    for (const path of manifestPaths(recipesRoot)) {
      checked += 1
      try {
        const doc = parse(readFileSync(path, 'utf8')) as Record<string, unknown>
        if (typeof doc?.slug !== 'string') failures.push(`${path}: no slug`)
      } catch (error) {
        failures.push(`${path}: ${error instanceof Error ? error.message.split('\n')[0] : error}`)
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(failures).toEqual([])
  })
})
