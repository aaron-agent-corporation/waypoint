import { mkdir, readFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mkdtemp, realpath } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { compileSeatbeltProfile, type SeatbeltRoot } from './profile.ts'

async function tempBase(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'seatbelt-test-'))
}

async function mustMkdir(base: string, ...parts: string[]): Promise<string> {
  const p = path.join(base, ...parts)
  await mkdir(p, { recursive: true })
  return p
}

describe('compileSeatbeltProfile', () => {
  it('emits the header and one grant per writable root', async () => {
    const base = await tempBase()
    const shadow = await mustMkdir(base, 'shadow')

    const profile = await compileSeatbeltProfile([{ name: 'shadow', path: shadow, access: 'rw' }])
    const realShadow = await realpath(shadow)
    expect(profile).toBe(
      `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath "${realShadow}"))\n`,
    )
  })

  it('fails closed on the one unresolvable overlap and on invalid input', async () => {
    const base = await tempBase()
    const src = await mustMkdir(base, 'case-source')
    const shadow = await mustMkdir(base, 'shadow')

    const cases: Array<{ name: string; roots: SeatbeltRoot[]; wantErr: string }> = [
      {
        // rw and ro at the SAME path is the one contradiction no ordering
        // resolves — fail closed. (Ancestor overlap is now a ro-hole, below.)
        name: 'equal path rejected',
        roots: [
          { name: 'a', path: base, access: 'rw' },
          { name: 'b', path: base, access: 'ro' },
        ],
        wantErr: 'same path',
      },
      {
        name: 'empty path fails closed',
        roots: [{ name: 'x', path: '', access: 'rw' }],
        wantErr: 'no path',
      },
      {
        name: 'invalid access fails closed',
        roots: [{ name: 'x', path: src, access: 'readwrite' }],
        wantErr: 'invalid access',
      },
    ]
    for (const tt of cases) {
      await expect(compileSeatbeltProfile(tt.roots), tt.name).rejects.toThrow(tt.wantErr)
    }

    // Disjoint roots compile.
    await expect(
      compileSeatbeltProfile([
        { name: 'case_source', path: src, access: 'ro' },
        { name: 'shadow', path: shadow, access: 'rw' },
      ]),
    ).resolves.toContain('(deny file-write*)')
  })

  it('punches a read-only hole into an enclosing writable root, ordered ancestor-first', async () => {
    // The acme shape and the former E4b Run 1 near-miss: a writable root
    // that is an ancestor of a read-only root no longer fails closed — it
    // emits a deny that re-closes the ro subtree, ordered AFTER the enclosing
    // allow so SBPL last-match-wins protects it.
    const base = await tempBase()
    const src = await mustMkdir(base, 'case-source')
    const realBase = await realpath(base)
    const realSrc = await realpath(src)

    const profile = await compileSeatbeltProfile([
      { name: 'case_work', path: base, access: 'rw' },
      { name: 'case_source', path: src, access: 'ro' },
    ])
    expect(profile).toBe(
      `(version 1)\n(allow default)\n(deny file-write*)\n` +
        `(allow file-write* (subpath "${realBase}"))\n` +
        `(deny file-write* (subpath "${realSrc}"))\n`,
    )
    // The allow (shallower) must come before the deny (deeper) so the hole wins.
    expect(profile.indexOf('(allow file-write*')).toBeLessThan(profile.indexOf('(deny file-write* (subpath'))
  })

  it('re-opens a writable scratch nested inside a read-only hole', async () => {
    // case root rw > .waypoint ro hole > scratch rw: three nested rules whose
    // depth ordering makes the deepest (scratch allow) win for scratch files
    // and the middle (.waypoint deny) win for other .waypoint files.
    const base = await tempBase()
    const runner = await mustMkdir(base, '.waypoint')
    const scratch = await mustMkdir(base, '.waypoint', 'scratch', 'task')

    const profile = await compileSeatbeltProfile([
      { name: 'case_work', path: base, access: 'rw' },
      { name: 'machine_state', path: runner, access: 'ro' },
      { name: 'scratch', path: scratch, access: 'rw' },
    ])
    const iBase = profile.indexOf(`(allow file-write* (subpath "${await realpath(base)}"))`)
    const iRunner = profile.indexOf(`(deny file-write* (subpath "${await realpath(runner)}"))`)
    const iScratch = profile.indexOf(`(allow file-write* (subpath "${await realpath(scratch)}"))`)
    expect(iBase).toBeGreaterThanOrEqual(0)
    expect(iRunner).toBeGreaterThan(iBase)
    expect(iScratch).toBeGreaterThan(iRunner)
  })

  it('emits no hole for a read-only root disjoint from every writable root', async () => {
    // A ro root that is NOT nested inside any rw root needs no deny — the
    // global deny already covers it. (Keeps referral/medical-layer profiles,
    // whose case_source ro is an ANCESTOR of the rw carve-outs, unchanged.)
    const base = await tempBase()
    const src = await mustMkdir(base, 'case-source')
    const medOut = await mustMkdir(base, 'case-source', '03-medical', 'output')

    const profile = await compileSeatbeltProfile([
      { name: 'case_source', path: src, access: 'ro' },
      { name: 'med_out', path: medOut, access: 'rw' },
    ])
    expect(profile).not.toContain('(deny file-write* (subpath')
    expect(profile).toContain(`(subpath "${await realpath(medOut)}")`)
  })

  it('allows a writable carve-out nested inside a read-only root', async () => {
    // med_out (rw) nested inside case_source (ro) is the legitimate carve-out
    // (rsc-8ip G2). It must compile, grant med_out, and NOT grant case_source.
    const base = await tempBase()
    const src = await mustMkdir(base, 'case-source')
    const medOut = await mustMkdir(base, 'case-source', '03-medical', 'output')

    const profile = await compileSeatbeltProfile([
      { name: 'case_source', path: src, access: 'ro' },
      { name: 'med_out', path: medOut, access: 'rw' },
    ])
    expect(profile).toContain(`(subpath "${await realpath(medOut)}")`)
    expect(profile).not.toContain(`(subpath "${await realpath(src)}")`)
  })

  it('does not treat a sibling name prefix as an ancestor', async () => {
    // "/foo" must not be treated as an ancestor of "/foobar".
    const base = await tempBase()
    const foo = await mustMkdir(base, 'foo')
    const foobar = await mustMkdir(base, 'foobar')

    await expect(
      compileSeatbeltProfile([
        { name: 'foo', path: foo, access: 'rw' },
        { name: 'foobar', path: foobar, access: 'ro' },
      ]),
    ).resolves.toBeTruthy()
  })

  it('canonicalizes symlinks to their real target', async () => {
    // A path reached via a symlink must emit its real target — the /tmp ->
    // /private/tmp case that makes the profiles use /private/tmp.
    const base = await tempBase()
    const real = await mustMkdir(base, 'real')
    const link = path.join(base, 'link')
    await symlink(real, link)

    const profile = await compileSeatbeltProfile([{ name: 'w', path: link, access: 'rw' }])
    expect(profile).toContain(await realpath(real))
    expect(profile).not.toContain(`(subpath "${link}")`)
  })

  it('resolves the existing prefix of a not-yet-created path', async () => {
    const base = await tempBase()
    const future = path.join(base, 'not-created-yet', 'build')

    const profile = await compileSeatbeltProfile([{ name: 'build', path: future, access: 'rw' }])
    expect(profile).toContain(path.join(await realpath(base), 'not-created-yet', 'build'))
  })

  it('is deterministic and de-duplicates writable paths', async () => {
    const base = await tempBase()
    const a = await mustMkdir(base, 'a')
    const b = await mustMkdir(base, 'b')

    const roots: SeatbeltRoot[] = [
      { name: 'b', path: b, access: 'rw' },
      { name: 'a', path: a, access: 'rw' },
      { name: 'a-again', path: a, access: 'rw' },
    ]
    const first = await compileSeatbeltProfile(roots)
    const second = await compileSeatbeltProfile(roots)
    expect(first).toBe(second)
    expect(first.split('(allow file-write*').length - 1).toBe(2)
  })
})

describe('golden byte-stability', () => {
  it('matches the pinned goldens byte-for-byte on the shared fixtures', async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const fixtures = JSON.parse(await readFile(path.join(dir, 'goldens', 'fixtures.json'), 'utf8')) as {
      cases: Array<{ name: string; roots: SeatbeltRoot[] }>
    }
    const goldens = JSON.parse(await readFile(path.join(dir, 'goldens', 'goldens.json'), 'utf8')) as {
      cases: Record<string, { profile?: string; error?: string }>
    }

    expect(fixtures.cases.length).toBeGreaterThan(0)
    for (const c of fixtures.cases) {
      const golden = goldens.cases[c.name]
      expect(golden, `golden missing for ${c.name} — regenerate with goldengen`).toBeDefined()
      if (golden!.error !== undefined) {
        // Error strings are part of the pinned contract — the diagnostics are
        // byte-stable so audits can match on them.
        await expect(compileSeatbeltProfile(c.roots), c.name).rejects.toThrow(golden!.error)
        continue
      }
      await expect(compileSeatbeltProfile(c.roots), c.name).resolves.toBe(golden!.profile)
    }
  })
})
