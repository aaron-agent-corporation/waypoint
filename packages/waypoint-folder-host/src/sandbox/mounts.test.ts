import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { assembleSandboxMounts, toMountArgs } from './mounts.ts'

const PROJECT = '/projects/demo-app'

// A representative project access-root shape.
const ACCESS_ROOTS = {
  case_work: { path: '.', access: 'rw' as const },
  raw_source: { path: 'documents/inbox', access: 'ro' as const },
  machine_state: { path: '.waypoint', access: 'ro' as const },
}

const CLAIM_DIR = path.join(PROJECT, '.waypoint', 'claims', 'route-001')
const CLAIM_MOUNT = { hostPath: CLAIM_DIR, mountPath: '/work/.waypoint/claims/route-001', readOnly: false, isDirectory: true }

const assemble = (access: Record<string, string> | undefined, roots = ACCESS_ROOTS) =>
  assembleSandboxMounts({
    projectRoot: PROJECT,
    roots,
    access,
    scratchDir: path.join(PROJECT, '.waypoint', 'scratch', 'route-001', 'task-1'),
    claimDir: CLAIM_DIR,
    mountPath: '/work',
  })

describe('assembleSandboxMounts (rsc-wxk) — the access map compiled to mounts', () => {
  it('mounts the rw root writable and the nested ro roots read-only', async () => {
    const mounts = await assemble({ case_work: 'rw', raw_source: 'ro', machine_state: 'ro' })
    // isDirectory: true throughout — these paths do not exist on disk, and a root
    // we cannot stat is treated as a directory (roots are directories by
    // convention). The file case is covered against a real .git/config below.
    expect(mounts).toEqual([
      { hostPath: '/projects/demo-app', mountPath: '/work', readOnly: false, isDirectory: true },
      { hostPath: '/projects/demo-app/.waypoint', mountPath: '/work/.waypoint', readOnly: true, isDirectory: true },
      { hostPath: '/projects/demo-app/documents/inbox', mountPath: '/work/documents/inbox', readOnly: true, isDirectory: true },
      CLAIM_MOUNT,
      {
        hostPath: '/projects/demo-app/.waypoint/scratch/route-001/task-1',
        mountPath: '/work/.waypoint/scratch/route-001/task-1',
        readOnly: false,
        isDirectory: true,
      },
    ])
  })

  it('orders ancestor before descendant so a ro hole overlays its rw parent instead of being shadowed', async () => {
    const mounts = await assemble({ case_work: 'rw', raw_source: 'ro', machine_state: 'ro' })
    const depths = mounts.map((m) => m.mountPath.split('/').filter(Boolean).length)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
    // The load-bearing pair: /work (rw) must precede /work/documents/inbox (ro).
    const parent = mounts.findIndex((m) => m.mountPath === '/work')
    const hole = mounts.findIndex((m) => m.mountPath === '/work/documents/inbox')
    expect(parent).toBeLessThan(hole)
  })

  it('keeps the scratch dir writable even when it sits inside a read-only root', async () => {
    // .waypoint is ro, but the attempt's scratch lives under it and must be
    // writable — the deeper mount wins, which is why ordering is load-bearing.
    const mounts = await assemble({ case_work: 'rw', machine_state: 'ro' })
    const scratch = mounts.at(-1)!
    expect(scratch.mountPath).toBe('/work/.waypoint/scratch/route-001/task-1')
    expect(scratch.readOnly).toBe(false)
    expect(mounts.find((m) => m.mountPath === '/work/.waypoint')?.readOnly).toBe(true)
  })

  it('mounts only what the access map names — unnamed paths are invisible, not merely unwritable', async () => {
    const mounts = await assemble({ raw_source: 'ro' })
    // Plus the always-present claim dir (rw), which never depends on the map.
    expect(mounts.map((m) => m.mountPath)).toEqual(['/work/documents/inbox', '/work/.waypoint/claims/route-001', '/work/.waypoint/scratch/route-001/task-1'])
    // No /work mount at all: the project tree is not there to read.
    expect(mounts.some((m) => m.mountPath === '/work')).toBe(false)
  })

  it('gives a scratch-only plan (access: {}) nothing but its scratch and its claim dir', async () => {
    const mounts = await assemble({})
    expect(mounts).toEqual([
      CLAIM_MOUNT,
      {
        hostPath: '/projects/demo-app/.waypoint/scratch/route-001/task-1',
        mountPath: '/work/.waypoint/scratch/route-001/task-1',
        readOnly: false,
        isDirectory: true,
      },
    ])
  })

  it('mounts the claim dir rw even when the access map grants only a narrow rw root (rsc-clm)', async () => {
    // The bug this closes: a recipe whose map covers only documents/inbox (ro)
    // would have no writable path for .waypoint/claims — the claim would land in the
    // guest overlay and the host would read null. The explicit grant fixes it.
    const mounts = await assemble({ raw_source: 'ro' })
    const claim = mounts.find((m) => m.mountPath === '/work/.waypoint/claims/route-001')
    expect(claim, 'the claim dir was not mounted — a narrow-rw recipe cannot file its claim').toBeDefined()
    expect(claim!.readOnly).toBe(false)
    // and it sorts after any ancestor the map mounted, so it overlays rather than hides
    const depths = mounts.map((m) => m.mountPath.split('/').filter(Boolean).length)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('honors a non-default mount path', async () => {
    const mounts = await assembleSandboxMounts({
      projectRoot: PROJECT,
      roots: ACCESS_ROOTS,
      access: { case_work: 'rw' },
      scratchDir: path.join(PROJECT, 'scratch'),
      claimDir: path.join(PROJECT, '.waypoint', 'claims', 'route-001'),
      mountPath: '/case',
    })
    expect(mounts.map((m) => m.mountPath)).toEqual(['/case', '/case/scratch', '/case/.waypoint/claims/route-001'])
  })

  // Fail-closed parity with the seatbelt: the SAME resolver enforces these, so
  // a boundary the host spawn refuses is refused here too.
  it('refuses a plan with no access map (no spawn)', async () => {
    await expect(assemble(undefined)).rejects.toThrow(/declares no access map/)
  })

  it('refuses a binding naming no declared root', async () => {
    await expect(assemble({ ghost_root: 'rw' })).rejects.toThrow(/declares no such root/)
  })

  it('refuses escalation: rw on a base-ro root', async () => {
    await expect(assemble({ raw_source: 'rw' })).rejects.toThrow(/escalation refused/)
  })

  it('refuses a root outside the project root — it has no path inside the sandbox', async () => {
    await expect(
      assemble({ elsewhere: 'rw' }, { ...ACCESS_ROOTS, elsewhere: { path: '/etc', access: 'rw' as const } } as never),
    ).rejects.toThrow(/outside the project root/)
  })

  it('refuses two roots that mount at one path with different capabilities', async () => {
    await expect(
      assemble({ case_work: 'rw', mirror: 'ro' }, { ...ACCESS_ROOTS, mirror: { path: '.', access: 'ro' as const } } as never),
    ).rejects.toThrow(/different capabilities/)
  })
})

/**
 * rsc-dqj on the sandbox backend. Because resolveAccessRoots is the single
 * resolver for both backends, the mandatory holes arrive here for free — these
 * lock that they are actually MOUNTED read-only rather than resolved and
 * dropped. Kernel-proven against a real microVM in docs/spikes/microsandbox.md
 * (guest remount refused; host file byte-identical).
 */
describe('assembleSandboxMounts — mandatory holes (rsc-dqj)', () => {
  it('mounts an existing .git/hooks read-only without the access map naming it', async () => {
    const { mkdtemp, mkdir } = await import('node:fs/promises')
    const os = await import('node:os')
    const root = await mkdtemp(path.join(os.tmpdir(), 'mounts-holes-'))
    await mkdir(path.join(root, '.git', 'hooks'), { recursive: true })

    const mounts = await assembleSandboxMounts({
      projectRoot: root,
      roots: { case_work: { path: '.', access: 'rw' } },
      access: { case_work: 'rw' }, // never mentions .git
      scratchDir: path.join(root, '.waypoint', 'scratch', 'r', 't'),
      claimDir: path.join(root, '.waypoint', 'claims', 'r'),
      mountPath: '/work',
    })

    const hook = mounts.find((m) => m.mountPath === '/work/.git/hooks')
    expect(hook, '.git/hooks was not mounted — the sandbox backend is still exposed').toBeDefined()
    expect(hook!.readOnly).toBe(true)
    // And it must sort AFTER /work, or the rw parent would shadow it.
    expect(mounts.findIndex((m) => m.mountPath === '/work')).toBeLessThan(mounts.findIndex((m) => m.mountPath === '/work/.git/hooks'))
  })

  /**
   * The in-vivo run's find (rsc-wxk): `.git/hooks` and `.git/modules` are
   * DIRECTORIES but `.git/config` is a FILE. msb refuses the wrong flag outright,
   * so a dir-only compiler refused every dispatch into a real git repo — which is
   * every real project, because `git init` always writes that file. The earlier
   * fixtures hand-made `.git/hooks` alone and never `.git/config`, which is why
   * the suite stayed green over a total functional break.
   */
  it('mounts the .git/config FILE with --mount-file, not --mount-dir', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const os = await import('node:os')
    const root = await mkdtemp(path.join(os.tmpdir(), 'mounts-gitconfig-'))
    await mkdir(path.join(root, '.git', 'hooks'), { recursive: true })
    await writeFile(path.join(root, '.git', 'config'), '[core]\n', 'utf8')

    const mounts = await assembleSandboxMounts({
      projectRoot: root,
      roots: { case_work: { path: '.', access: 'rw' } },
      access: { case_work: 'rw' },
      scratchDir: path.join(root, '.waypoint', 'scratch', 'r', 't'),
      claimDir: path.join(root, '.waypoint', 'claims', 'r'),
      mountPath: '/work',
    })

    const config = mounts.find((m) => m.mountPath === '/work/.git/config')
    const hooks = mounts.find((m) => m.mountPath === '/work/.git/hooks')
    expect(config, '.git/config was not mounted — the hole is not protected').toBeDefined()
    expect(config!.isDirectory, '.git/config is a FILE; --mount-dir on it makes msb refuse the whole dispatch').toBe(false)
    expect(hooks!.isDirectory, '.git/hooks is a directory').toBe(true)

    const args = toMountArgs(mounts)
    expect(args[args.indexOf(`${path.join(root, '.git', 'config')}:/work/.git/config:ro`) - 1]).toBe('--mount-file')
    expect(args[args.indexOf(`${path.join(root, '.git', 'hooks')}:/work/.git/hooks:ro`) - 1]).toBe('--mount-dir')
  })

  it('skips a mandatory hole that does not exist — a non-git project is not a failed dispatch', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const os = await import('node:os')
    const root = await mkdtemp(path.join(os.tmpdir(), 'mounts-nogit-'))

    const mounts = await assembleSandboxMounts({
      projectRoot: root,
      roots: { case_work: { path: '.', access: 'rw' } },
      access: { case_work: 'rw' },
      scratchDir: path.join(root, 'scratch'),
      claimDir: path.join(root, '.waypoint', 'claims', 'r'),
      mountPath: '/work',
    })
    expect(mounts.some((m) => m.mountPath.startsWith('/work/.git'))).toBe(false)
    expect(mounts.some((m) => m.mountPath === '/work')).toBe(true)
  })
})

describe('toMountArgs — rendering to msb argv', () => {
  it('renders rw as SRC:DST and ro as SRC:DST:ro, in order', async () => {
    const mounts = await assemble({ case_work: 'rw', raw_source: 'ro' })
    expect(toMountArgs(mounts)).toEqual([
      '--mount-dir',
      '/projects/demo-app:/work',
      '--mount-dir',
      '/projects/demo-app/documents/inbox:/work/documents/inbox:ro',
      '--mount-dir',
      '/projects/demo-app/.waypoint/claims/route-001:/work/.waypoint/claims/route-001',
      '--mount-dir',
      '/projects/demo-app/.waypoint/scratch/route-001/task-1:/work/.waypoint/scratch/route-001/task-1',
    ])
  })

  it('REFUSES a host path containing the field separator rather than emitting a misparsed mount', () => {
    // ':' is positional in SRC:DST:OPTIONS — no quoting saves this, and a
    // misparse would silently change the mount's options (e.g. drop :ro).
    expect(() => toMountArgs([{ hostPath: '/projects/od:d', mountPath: '/work', readOnly: true, isDirectory: true }])).toThrow(
      /host path .* contains ':'/,
    )
  })

  it('REFUSES a mount path containing the field separator', () => {
    expect(() => toMountArgs([{ hostPath: '/projects/x', mountPath: '/work/o:d', readOnly: false, isDirectory: true }])).toThrow(
      /mount path .* contains ':'/,
    )
  })
})
