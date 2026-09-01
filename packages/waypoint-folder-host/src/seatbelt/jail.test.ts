import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assembleSeatbeltJailRoots,
  MANDATORY_RO_HOLES,
  prepareSeatbeltJail,
  resolveAccessRoots,
  SEATBELT_ENV,
  seatbeltEnabledForProject,
  seatbeltJailEnabled,
} from './jail.ts'

const ROOTS = {
  case_source: { path: 'case', access: 'ro' as const },
  shadow: { path: 'shadow', access: 'rw' as const },
}

function input(overrides: Partial<Parameters<typeof assembleSeatbeltJailRoots>[0]> = {}) {
  return {
    projectRoot: '/proj',
    roots: ROOTS,
    access: { case_source: 'ro', shadow: 'rw' },
    scratchDir: '/proj/.waypoint/scratch/task-1',
    tmpDir: '/proj/.waypoint/tmp/task-1',
    ...overrides,
  }
}

describe('seatbeltJailEnabled', () => {
  it('reads the gate env var', () => {
    expect(seatbeltJailEnabled({})).toBe(false)
    for (const on of ['1', 'true', 'on', 'TRUE', ' On ']) {
      expect(seatbeltJailEnabled({ [SEATBELT_ENV]: on }), on).toBe(true)
    }
    expect(seatbeltJailEnabled({ [SEATBELT_ENV]: 'off' })).toBe(false)
  })
})

describe('seatbeltEnabledForProject (rsc-w0z)', () => {
  it('jails a project that declares roots, with or without the env var', () => {
    // A case project (roots declared) is jailed by default — no env needed.
    expect(seatbeltEnabledForProject(ROOTS, {})).toBe(true)
    expect(seatbeltEnabledForProject(ROOTS, { [SEATBELT_ENV]: 'off' })).toBe(true)
  })

  it('leaves a rootless project (e.g. a coding quest) unjailed unless the env forces it', () => {
    // No roots + no env = no jail: coding quests with no access maps must not
    // fail closed. The global env var remains an override.
    expect(seatbeltEnabledForProject(undefined, {})).toBe(false)
    expect(seatbeltEnabledForProject({}, {})).toBe(false)
    expect(seatbeltEnabledForProject(undefined, { [SEATBELT_ENV]: '1' })).toBe(true)
  })
})

describe('assembleSeatbeltJailRoots', () => {
  it('grants plan bindings at their effective access plus the baseline', () => {
    const roots = assembleSeatbeltJailRoots(input())
    const byName = new Map(roots.map((r) => [r.name, r]))

    expect(byName.get('shadow')).toEqual({ name: 'shadow', path: '/proj/shadow', access: 'rw' })
    // The ro binding rides along to arm the compiler's ancestor-overlap check.
    expect(byName.get('case_source')).toEqual({ name: 'case_source', path: '/proj/case', access: 'ro' })
    expect(byName.get('scratch')).toEqual({ name: 'scratch', path: '/proj/.waypoint/scratch/task-1', access: 'rw' })
    for (const baseline of ['tmp', 'dev']) {
      expect(byName.get(baseline)?.access, baseline).toBe('rw')
    }
  })

  /**
   * rsc-g0p. The jail used to grant rw on `os.tmpdir()` and `/tmp` as "baseline
   * viability". On macOS os.tmpdir() is /private/var/folders/... — EVERY app's
   * temp space — so a worker the operator is told is confined to the case folder
   * could scribble into any other application's temp. A write-boundary hole in
   * the layer whose whole job is the write boundary.
   */
  describe('the shared system temp is NOT granted', () => {
    it('grants the attempt its OWN temp, inside the case folder', () => {
      const roots = assembleSeatbeltJailRoots(input())
      expect(roots.find((r) => r.name === 'tmp')).toEqual({ name: 'tmp', path: '/proj/.waypoint/tmp/task-1', access: 'rw' })
    })

    it('grants NOTHING under the host\'s shared temp — not os.tmpdir(), not /tmp', () => {
      const roots = assembleSeatbeltJailRoots(input())
      const shared = [os.tmpdir(), '/tmp', '/private/tmp']
      for (const root of roots) {
        for (const dir of shared) {
          expect(
            root.path === dir,
            `root '${root.name}' grants ${root.access} on the SHARED system temp ${dir} — every other app's scratch space`,
          ).toBe(false)
        }
      }
    })

    it('the only write grants outside the project are the two named exceptions', () => {
      // The property that makes the temp reparenting safe: every writable root
      // is under the case folder (scratch and tmp both live under .waypoint/)
      // EXCEPT two deliberate, enumerated ones — /dev, because a process needs
      // /dev/null, the narrow agent-state roots, because our worker is a
      // real agent CLI that needs ~/.claude for auth on the host path, and a
      // lane's own credential home, which is that same need for a lane bound
      // to a second subscription. The test names them so a FOURTH escape has
      // to be added here on purpose.
      const roots = assembleSeatbeltJailRoots(input({ access: {}, agentHomes: ['/subs/kimi-a'] }))
      const exempt = (name: string) =>
        name === 'dev' || name.startsWith('agent-state:') || name.startsWith('agent-home:')
      for (const root of roots.filter((r) => r.access === 'rw' && !exempt(r.name))) {
        expect(root.path.startsWith('/proj/'), `writable root '${root.name}' at ${root.path} escapes the project`).toBe(true)
      }
    })
  })

  it("grants a lane its own credential home — the CLI's session state lives there", () => {
    const roots = assembleSeatbeltJailRoots(
      input({ access: {}, agentHomes: ['/subs/kimi-a', '  ', '/subs/kimi-a'] }),
    )
    const homes = roots.filter((r) => r.name.startsWith('agent-home:'))
    expect(homes).toEqual([{ name: 'agent-home:kimi-a', path: '/subs/kimi-a', access: 'rw' }])
  })

  it('grants no credential home when the lane declares none', () => {
    const roots = assembleSeatbeltJailRoots(input({ access: {} }))
    expect(roots.some((r) => r.name.startsWith('agent-home:'))).toBe(false)
  })

  it('a plan-ro binding on a base-rw root carries no write grant', () => {
    const roots = assembleSeatbeltJailRoots(input({ access: { shadow: 'ro' } }))
    expect(roots.find((r) => r.name === 'shadow')).toEqual({ name: 'shadow', path: '/proj/shadow', access: 'ro' })
  })

  it('fails closed on a missing access map', () => {
    expect(() => assembleSeatbeltJailRoots(input({ access: undefined }))).toThrow('no access map')
  })

  it('an explicitly empty access map grants scratch plus baseline only', () => {
    const roots = assembleSeatbeltJailRoots(input({ access: {} }))
    expect(roots.some((r) => r.name === 'shadow' || r.name === 'case_source')).toBe(false)
    expect(roots.find((r) => r.name === 'scratch')?.access).toBe('rw')
  })

  it('fails closed on an unknown binding', () => {
    expect(() => assembleSeatbeltJailRoots(input({ access: { nonesuch: 'rw' } }))).toThrow('no such root')
  })

  it('fails closed on escalation past the base capability', () => {
    expect(() => assembleSeatbeltJailRoots(input({ access: { case_source: 'rw' } }))).toThrow('escalation refused')
  })

  it('fails closed on an invalid access value', () => {
    expect(() => assembleSeatbeltJailRoots(input({ access: { shadow: 'write' } }))).toThrow('want ro|rw')
  })
})

describe('prepareSeatbeltJail', () => {
  it('compiles, installs the profile under .waypoint/seatbelt, and wraps argv', async () => {
    // rw-only bindings: the test project lives under the OS temp dir, where a
    // ro binding would (correctly) fail closed against the tmpdir baseline
    // grant — that case is asserted separately below.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-jail-'))
    const jail = await prepareSeatbeltJail({
      projectRoot,
      roots: ROOTS,
      access: { shadow: 'rw' },
      scratchDir: path.join(projectRoot, '.waypoint', 'scratch', 'task-1'),
      tmpDir: path.join(projectRoot, '.waypoint', 'tmp', 'task-1'),
      name: 'task-1/attempt 2',
    })

    expect(jail.profilePath).toBe(path.join(projectRoot, '.waypoint', 'seatbelt', 'task-1_attempt_2.sb'))
    const profile = await readFile(jail.profilePath, 'utf8')
    expect(profile).toContain('(deny file-write*)')
    expect(profile).toContain('shadow')
    expect(jail.wrapArgv(['claude', '-p', 'go'])).toEqual([
      '/usr/bin/sandbox-exec',
      '-f',
      jail.profilePath,
      'claude',
      '-p',
      'go',
    ])
  })

  it('needs NO ro hole for a case under the OS temp dir — nothing grants that dir any more', async () => {
    // This test used to assert the opposite. The rsc-w0z viability baseline
    // granted os.tmpdir() rw, so a case living beneath it was enclosed by a
    // baseline allow, and a ro root inside it survived only because the
    // compiler punched a deny hole after that allow (rsc-dqj). rsc-g0p removed
    // the grant, which removes the enclosure, which removes the need for the
    // hole: a ro root under the OS temp dir is now protected by the plain
    // `(deny file-write*)` default. The hole-punching MECHANISM is still
    // exercised by the scratch-encloses-ro test below — this asserts that the
    // shared temp is simply not in the profile.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-jail-'))
    const jail = await prepareSeatbeltJail({
      projectRoot,
      roots: ROOTS,
      access: { case_source: 'ro' },
      scratchDir: path.join(projectRoot, '.waypoint', 'scratch', 'task-1'),
      tmpDir: path.join(projectRoot, '.waypoint', 'tmp', 'task-1'),
      name: 'task-3',
    })
    const profile = await readFile(jail.profilePath, 'utf8')
    // `case` is not created; the compiler canonicalizes via the real projectRoot.
    const caseReal = path.join(await realpath(projectRoot), 'case')
    expect(profile).not.toContain(`(allow file-write* (subpath "${await realpath(os.tmpdir())}"))`)
    expect(profile).not.toContain(`(deny file-write* (subpath "${caseReal}"))`)
    // The write grants the profile DOES carry are the attempt's own two dirs.
    for (const dir of ['scratch', 'tmp']) {
      expect(profile).toContain(`(allow file-write* (subpath "${path.join(await realpath(projectRoot), '.waypoint', dir, 'task-1')}"))`)
    }
  })

  it('punches a ro hole when a scratch grant encloses a read-only root', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-jail-'))
    // scratch dir as an ancestor of the ro case source: the ro root becomes a
    // hole denied after the enclosing scratch allow, not a refusal.
    const caseDir = path.join(projectRoot, 'work', 'case')
    await mkdir(caseDir, { recursive: true })
    const jail = await prepareSeatbeltJail({
      projectRoot,
      roots: { case_source: { path: 'work/case', access: 'ro' } },
      access: { case_source: 'ro' },
      scratchDir: path.join(projectRoot, 'work'),
      tmpDir: path.join(projectRoot, '.waypoint', 'tmp', 'task-1'),
      name: 'task-2',
    })
    const profile = await readFile(jail.profilePath, 'utf8')
    const caseReal = await realpath(caseDir)
    expect(profile).toContain(`(deny file-write* (subpath "${caseReal}"))`)
  })
})

/**
 * rsc-dqj — the mandatory holes. The bug these close was not that .git/hooks
 * was writable; it was that a hole only existed if a plan NAMED it. Protection
 * contingent on 43 quest authors each remembering is protection in name only,
 * so these hold whether or not the access map mentions them, and no plan can
 * grant them back.
 */
describe('mandatory read-only holes (rsc-dqj)', () => {
  const acme = {
    projectRoot: '/cases/dl',
    roots: {
      case_work: { path: '.', access: 'rw' as const },
      raw_source: { path: 'documents/inbox', access: 'ro' as const },
    },
    scratchDir: '/cases/dl/.waypoint/scratch/r/t',
    tmpDir: '/cases/dl/.waypoint/tmp/r/t',
  }

  it('punches the holes for a plan that never mentions them', () => {
    // The shipped acme map names only case_work + raw_source.
    const roots = resolveAccessRoots({ ...acme, access: { case_work: 'rw', raw_source: 'ro' } })
    const holes = roots.filter((r) => r.mandatory === true)
    expect(holes.map((r) => r.path)).toEqual(['/cases/dl/.git/hooks', '/cases/dl/.git/config', '/cases/dl/.git/modules'])
    expect(holes.every((r) => r.access === 'ro')).toBe(true)
  })

  it('applies to a scratch-only plan too', () => {
    const roots = resolveAccessRoots({ ...acme, access: {} })
    expect(roots.filter((r) => r.mandatory === true)).toHaveLength(MANDATORY_RO_HOLES.length)
  })

  it('sorts after the enclosing rw root, so the deny actually re-closes it', () => {
    // The SBPL compiler is last-match-wins; a hole that sorted before its
    // parent would be swallowed. Proven at the kernel in enforcement.test.ts —
    // this locks the resolver's half of it.
    const roots = resolveAccessRoots({ ...acme, access: { case_work: 'rw' } })
    const caseIndex = roots.findIndex((r) => r.name === 'case_work')
    const holeIndex = roots.findIndex((r) => r.path === '/cases/dl/.git/hooks')
    expect(caseIndex).toBeLessThan(holeIndex)
  })

  it('REFUSES a plan that tries to grant rw on a hole', () => {
    expect(() =>
      resolveAccessRoots({
        ...acme,
        roots: { ...acme.roots, hooks: { path: '.git/hooks', access: 'rw' as const } },
        access: { hooks: 'rw' },
      }),
    ).toThrow(/at or under the mandatory read-only hole .*escalation refused/s)
  })

  it('REFUSES an rw root nested UNDER a hole (which would re-open it, deepest-rule-wins)', () => {
    expect(() =>
      resolveAccessRoots({
        ...acme,
        roots: { ...acme.roots, sneaky: { path: '.git/hooks/sub', access: 'rw' as const } },
        access: { sneaky: 'rw' },
      }),
    ).toThrow(/at or under the mandatory read-only hole/)
  })

  it('still allows a ro root on a hole path (redundant, but not a contradiction)', () => {
    expect(() =>
      resolveAccessRoots({
        ...acme,
        roots: { ...acme.roots, hooks: { path: '.git/hooks', access: 'ro' as const } },
        access: { hooks: 'ro' },
      }),
    ).not.toThrow()
  })
})

describe('optional access modes rw?/ro? (rsc-rvz two-tree seam)', () => {
  const acme = {
    projectRoot: '/cases/dl',
    roots: {
      case_work: { path: '.', access: 'rw' as const },
    },
    scratchDir: '/cases/dl/.waypoint/scratch/r/t',
    tmpDir: '/cases/dl/.waypoint/tmp/r/t',
  }

  it('skips an optional binding whose root is undeclared (single-tree case)', () => {
    const roots = resolveAccessRoots({ ...acme, access: { case_work: 'rw', user_case: 'rw?' } })
    expect(roots.find((r) => r.name === 'user_case')).toBeUndefined()
    expect(roots.find((r) => r.name === 'case_work')?.access).toBe('rw')
  })

  it('grants an optional binding whose root IS declared (onboarded two-tree case)', () => {
    const roots = resolveAccessRoots({
      ...acme,
      roots: { ...acme.roots, user_case: { path: '/Users/op/Cases/vance', access: 'rw' as const } },
      access: { case_work: 'rw', user_case: 'rw?' },
    })
    const grant = roots.find((r) => r.name === 'user_case')
    expect(grant).toEqual({ name: 'user_case', path: '/Users/op/Cases/vance', access: 'rw' })
  })

  it('still refuses escalation: rw? on a base-ro root', () => {
    expect(() =>
      resolveAccessRoots({
        ...acme,
        roots: { ...acme.roots, user_case: { path: '/Users/op/Cases/vance', access: 'ro' as const } },
        access: { user_case: 'rw?' },
      }),
    ).toThrow(/escalation refused/)
  })

  it('a REQUIRED (unsuffixed) binding with no declared root still fails closed', () => {
    expect(() => resolveAccessRoots({ ...acme, access: { user_case: 'rw' } })).toThrow(/fail closed/)
  })

  it('rejects a malformed suffixed mode', () => {
    expect(() =>
      resolveAccessRoots({
        ...acme,
        roots: { ...acme.roots, user_case: { path: '/x', access: 'rw' as const } },
        access: { user_case: 'rwx?' },
      }),
    ).toThrow(/want ro\|rw/)
  })
})
