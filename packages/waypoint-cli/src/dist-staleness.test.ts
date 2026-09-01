import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { evaluateDistStaleness, guardDistFreshness } from './dist-staleness.ts'

/**
 * rsc-2ff — the dev-checkout guard that makes a stale built dist LOUD instead
 * of letting the CLI silently run old code. These build a fake
 * `<root>/packages/<pkg>/{src,dist}` layout with controlled mtimes so the
 * comparison and its skip branches are pinned without a real build.
 */
describe('dist staleness guard (rsc-2ff)', () => {
  const roots: string[] = []
  const OLD = new Date(1_600_000_000_000)
  const NEW = new Date(1_700_000_000_000)

  /** Build a workspace layout; return the path a built bin would run from. */
  function layout(opts: { srcMtime?: Date; distMtime?: Date; withSrc?: boolean }): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'stale-dist-')))
    roots.push(root)
    const pkg = join(root, 'packages', 'waypoint-cli')
    const dist = join(pkg, 'dist')
    mkdirSync(dist, { recursive: true })
    const binJs = join(dist, 'bin.js')
    writeFileSync(binJs, '// built\n')
    if (opts.distMtime) utimesSync(binJs, opts.distMtime, opts.distMtime)
    if (opts.withSrc !== false) {
      const src = join(pkg, 'src')
      mkdirSync(src, { recursive: true })
      const srcTs = join(src, 'thing.ts')
      writeFileSync(srcTs, 'export const x = 1\n')
      if (opts.srcMtime) utimesSync(srcTs, opts.srcMtime, opts.srcMtime)
    }
    return binJs
  }

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })))
  })

  it('flags stale when a src file is newer than the built dist', () => {
    const bin = layout({ srcMtime: NEW, distMtime: OLD })
    const result = evaluateDistStaleness(bin)
    expect(result.checked).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.newestSrc).toContain('thing.ts')
  })

  it('is fresh when the built dist is newer than src', () => {
    const bin = layout({ srcMtime: OLD, distMtime: NEW })
    const result = evaluateDistStaleness(bin)
    expect(result.checked).toBe(true)
    expect(result.stale).toBe(false)
  })

  it('skips a published install (dist only, no src sibling)', () => {
    const bin = layout({ distMtime: NEW, withSrc: false })
    expect(evaluateDistStaleness(bin).checked).toBe(false)
  })

  it('skips an entry that is in neither src/ nor dist/', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'stale-dist-odd-')))
    roots.push(root)
    const odd = join(root, 'packages', 'waypoint-cli', 'bundle')
    mkdirSync(odd, { recursive: true })
    const entry = join(odd, 'bin.js')
    writeFileSync(entry, '// ???\n')
    expect(evaluateDistStaleness(entry).checked).toBe(false)
  })

  /**
   * A source run used to be skipped outright, on the belief that running from
   * source is never stale. It is not: only the RUNNING package loads from
   * source, and every `@waypoint/*` import resolves through that package's
   * `main`, which is dist. `~/.waypoint/bin/runner` — the shim on every worker's
   * PATH, and how the deployed bridge starts — execs `waypoint-cli/src/bin.ts`, so
   * the guard was skipping the one configuration that ships.
   */
  describe('a source run is checked too (Phase 0, item 6)', () => {
    /** `<root>/packages/{waypoint-cli,waypoint-folder-host}/{src,dist}`; returns the src entry. */
    function sourceRunLayout(opts: { cliSrc: Date; hostSrc: Date; distMtime: Date }): string {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'stale-dist-srcrun-')))
      roots.push(root)
      for (const [pkg, srcMtime] of [['waypoint-cli', opts.cliSrc], ['waypoint-folder-host', opts.hostSrc]] as const) {
        const src = join(root, 'packages', pkg, 'src')
        const dist = join(root, 'packages', pkg, 'dist')
        mkdirSync(src, { recursive: true })
        mkdirSync(dist, { recursive: true })
        const srcTs = join(src, 'thing.ts')
        writeFileSync(srcTs, 'export const x = 1\n')
        utimesSync(srcTs, srcMtime, srcMtime)
        const distJs = join(dist, 'thing.js')
        writeFileSync(distJs, '// built\n')
        utimesSync(distJs, opts.distMtime, opts.distMtime)
      }
      const entry = join(root, 'packages', 'waypoint-cli', 'src', 'bin.ts')
      writeFileSync(entry, '// source\n')
      utimesSync(entry, opts.cliSrc, opts.cliSrc)
      return entry
    }

    it('flags a stale ANOTHER package — the deployed bridge case', () => {
      const entry = sourceRunLayout({ cliSrc: OLD, hostSrc: NEW, distMtime: OLD })
      const result = evaluateDistStaleness(entry)
      expect(result.checked).toBe(true)
      expect(result.entry).toBe('src')
      expect(result.stale).toBe(true)
      expect(result.newestSrc).toContain('waypoint-folder-host')
    })

    it('does NOT flag edits to the running package — those really are what executes', () => {
      const entry = sourceRunLayout({ cliSrc: NEW, hostSrc: OLD, distMtime: OLD })
      const result = evaluateDistStaleness(entry)
      expect(result.checked).toBe(true)
      expect(result.stale).toBe(false)
    })

    it('names the source run in the warning, since the fix is the same but the reason differs', () => {
      const entry = sourceRunLayout({ cliSrc: OLD, hostSrc: NEW, distMtime: OLD })
      const lines: string[] = []
      guardDistFreshness(pathToFileURL(entry).href, (l) => lines.push(l), {})
      expect(lines.join('\n')).toContain('running the CLI from source')
      expect(lines.join('\n')).toContain('pnpm build')
    })
  })

  it('ignores *.test.ts / *.d.ts churn (they are not emitted to dist)', () => {
    const bin = layout({ srcMtime: OLD, distMtime: NEW })
    // A brand-new test file must NOT make dist look stale.
    const src = join(bin, '..', '..', 'src')
    const testFile = join(src, 'thing.test.ts')
    writeFileSync(testFile, '// test\n')
    utimesSync(testFile, NEW, NEW)
    expect(evaluateDistStaleness(bin).stale).toBe(false)
  })

  it('guardDistFreshness WARNS but does not abort by default; REFUSES under the env flag', () => {
    const bin = layout({ srcMtime: NEW, distMtime: OLD })
    const url = pathToFileURL(bin).href

    const warned: string[] = []
    expect(guardDistFreshness(url, (l) => warned.push(l), {})).toBe(false)
    expect(warned.join('\n')).toMatch(/WARNING: waypoint dist is STALE/)
    expect(warned.join('\n')).toContain('pnpm build')

    const refused: string[] = []
    expect(guardDistFreshness(url, (l) => refused.push(l), { WAYPOINT_STALE_DIST_GUARD: 'refuse' })).toBe(true)
    expect(refused.join('\n')).toMatch(/ERROR: waypoint dist is STALE/)
  })

  it('guardDistFreshness stays silent when dist is fresh', () => {
    const bin = layout({ srcMtime: OLD, distMtime: NEW })
    const lines: string[] = []
    expect(guardDistFreshness(pathToFileURL(bin).href, (l) => lines.push(l), {})).toBe(false)
    expect(lines).toEqual([])
  })
})
