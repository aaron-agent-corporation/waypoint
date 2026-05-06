/**
 * Portability boundary check:
 * `host.ts` must import only from '@waypoint/core'. Any other import
 * (notably '@/lib/...' or Next.js-specific paths) breaks the portability
 * proof.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('examples/waypoint-host-minimal boundaries', () => {
  it('imports only from @waypoint/core or node built-ins', () => {
    const hostPath = resolve(__dirname, 'host.ts')
    const src = readFileSync(hostPath, 'utf8')

    const importRegex = /import[^'"]+['"]([^'"]+)['"]/g
    const matches: string[] = []
    let m: RegExpExecArray | null
    while ((m = importRegex.exec(src)) !== null) {
      matches.push(m[1])
    }

    const disallowedPrefixes = ['@/', 'next/', 'next']
    const violating = matches.filter((spec) => {
      if (spec === '@waypoint/core') return false
      if (spec.startsWith('node:')) return false
      // no other imports allowed in the host proof
      // (node built-ins, relative files not expected here)
      return disallowedPrefixes.some((p) => spec === p || spec.startsWith(p)) || true
    })

    expect({ imports: matches, violating }).toEqual({
      imports: matches,
      violating: [],
    })
  })
})
