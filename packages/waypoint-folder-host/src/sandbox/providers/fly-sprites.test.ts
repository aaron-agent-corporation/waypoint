import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { guestWorkspacePath, policyHashForEgress, stableOauthSandboxName } from '../provider.ts'
import { pullManagedResultsAfterEnter } from '../../runtime/managed-workspace-sync.ts'
import { createCloudProjectSandboxProvider, createProjectSandboxProvider } from './cloud.ts'
import {
  FlySpritesProjectSandboxProvider,
  GUEST_REVISION_MARKER,
  SPRITES_TOKEN_ENV,
  assertRealBundleRevision,
  assertWipeSafeGuestPath,
  normalizeSdkBaseURL,
  type FlySpritesClientLike,
  type FlySpritesCommandLike,
  type FlySpritesSpriteLike,
} from './fly-sprites.ts'
import { FakeProjectSandboxProvider } from './fake.ts'

/** Egress every provider double in this file is constructed with; the fixture's
 *  policy_hash is the ENFORCED digest of that list (L5) — a placeholder hash
 *  now refuses at #ensureNetworkPolicy. */
const TEST_EGRESS = ['api.openai.com'] as const

function createInput(projectId = 'prj_sprites_a') {
  return {
    project_id: projectId,
    project_root: `/projects/${projectId}`,
    image_digest: `localhost/waypoint/pi-worker@sha256:${'a'.repeat(64)}`,
    policy_hash: policyHashForEgress(TEST_EGRESS),
    mount_hash: 'c'.repeat(64),
    workspace_id: `workspace-${projectId}`,
  }
}

/** Scripted SDK command: consumes stdin (a real Writable), then exits 0 with the given stdout. */
function commandDouble(stdout = 'hello\n', exitCode = 0): FlySpritesCommandLike {
  let resolveExit!: (code: number) => void
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
    final(cb) {
      resolveExit(exitCode)
      cb()
    },
  })
  return {
    stdin,
    stdout: (async function* () {
      await exit
      yield Buffer.from(stdout)
    })(),
    stderr: (async function* () {
      await exit
    })(),
    wait: () => exit,
    once(event, listener) {
      if (event === 'spawn') queueMicrotask(() => (listener as () => void)())
      return this
    },
  }
}

/** Command whose exit never arrives — the wedged-transport case. */
function wedgedCommandDouble(): FlySpritesCommandLike {
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
    final(cb) {
      cb()
    },
  })
  const never = new Promise<never>(() => {})
  return {
    stdin,
    stdout: (async function* () {
      await never
    })(),
    stderr: (async function* () {
      await never
    })(),
    wait: () => never,
    once(event, listener) {
      if (event === 'spawn') queueMicrotask(() => (listener as () => void)())
      return this
    },
  }
}

function spriteDouble(
  over: Partial<FlySpritesSpriteLike> & {
    name: string
    /** Scripted execFile exit code, by joined argv. Defaults to 0. */
    execExit?: (joinedArgv: string) => number
  },
): FlySpritesSpriteLike & {
  killed: string[]
  policies: Array<Array<{ action?: string; domain?: string }>>
  execs: string[][]
  spawns: string[][]
} {
  const killed: string[] = []
  const policies: Array<Array<{ action?: string; domain?: string }>> = []
  const execs: string[][] = []
  const spawns: string[][] = []
  const { execExit, ...overrides } = over
  return {
    id: 'sprite-uuid-0001',
    status: 'running',
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    filesystem: () => {
      throw new Error('no filesystem double configured — pass one in the spriteDouble overrides')
    },
    execFile: async (file: string, args: string[] = []) => {
      execs.push([file, ...args])
      const exitCode = execExit?.([file, ...args].join(' ')) ?? 0
      const result = { stdout: '', stderr: '', exitCode }
      // Faithful to @fly/sprites 0.2.0: execFile REJECTS on nonzero exit with
      // an ExecError carrying the result — the provider maps it back to data.
      if (exitCode !== 0) throw Object.assign(new Error(`Command failed with exit code ${exitCode}`), { result })
      return result
    },
    spawn: (command: string, args: string[] = []) => {
      spawns.push([command, ...args])
      return commandDouble()
    },
    updateNetworkPolicy: async (policy) => {
      policies.push(policy.rules)
    },
    getNetworkPolicy: async () => ({
      rules: policies.at(-1) ?? [{ action: 'allow', domain: 'api.openai.com' }],
    }),
    listSessions: async () => [{ id: '9' }],
    killSession: async (id: string) => {
      killed.push(id)
    },
    killed,
    policies,
    execs,
    spawns,
    ...overrides,
  }
}

function clientDouble(sprite: FlySpritesSpriteLike, opts: { existsRemotely?: boolean } = {}): FlySpritesClientLike & {
  created: string[]
  deleted: string[]
} {
  let exists = opts.existsRemotely ?? false
  const created: string[] = []
  const deleted: string[] = []
  return {
    sprite: () => sprite,
    createSprite: async (name: string) => {
      created.push(name)
      exists = true
      return sprite
    },
    getSprite: async (name: string) => {
      if (!exists) throw Object.assign(new Error(`sprite ${name} not found`), { statusCode: 404 })
      return sprite
    },
    deleteSprite: async (name: string) => {
      if (!exists) throw Object.assign(new Error(`sprite ${name} not found`), { statusCode: 404 })
      deleted.push(name)
      exists = false
    },
    created,
    deleted,
  }
}

describe('FlySpritesProjectSandboxProvider (SDK)', () => {
  it('fails closed with no token in the env OR the token file', () => {
    const prior = process.env[SPRITES_TOKEN_ENV]
    const priorFile = process.env.SPRITES_TOKEN_FILE
    delete process.env[SPRITES_TOKEN_ENV]
    // Pin the file home to nowhere: on a machine where the operator HAS
    // installed ~/.waypoint/secrets/sprites-token, the fallback would serve it
    // and this test would prove nothing (found live 2026-08-29).
    process.env.SPRITES_TOKEN_FILE = '/nonexistent/sprites-token'
    try {
      expect(() => new FlySpritesProjectSandboxProvider({ token: '' })).toThrow(/no Sprites token/i)
      expect(() => new FlySpritesProjectSandboxProvider({})).toThrow(/no Sprites token/i)
      // The refusal names every place it looked.
      expect(() => new FlySpritesProjectSandboxProvider({})).toThrow(/\$SPRITES_TOKEN.*\/nonexistent\/sprites-token/s)
    } finally {
      if (prior === undefined) delete process.env[SPRITES_TOKEN_ENV]
      else process.env[SPRITES_TOKEN_ENV] = prior
      if (priorFile === undefined) delete process.env.SPRITES_TOKEN_FILE
      else process.env.SPRITES_TOKEN_FILE = priorFile
    }
  })

  it('create/inspect/enter/stop against the SDK-client double', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-a' })
    const client = clientDouble(sprite)
    const provider = new FlySpritesProjectSandboxProvider({
      client,
      egressAllow: ['api.openai.com'],
    })

    const created = await provider.create(createInput())
    expect(created.provider).toBe('fly-sprites')
    expect(created.sandbox_name).toBe('project-prj-sprites-a')
    expect(created.sandbox_instance_id).toBe('sprite-uuid-0001')
    expect(client.created).toEqual(['project-prj-sprites-a'])

    const inspected = await provider.inspect(created)
    expect(inspected?.sandbox_instance_id).toBe('sprite-uuid-0001')

    const entered = await provider.enter(created, { argv: ['/bin/echo', 'hello'] })
    expect(entered.exit_code).toBe(0)
    expect(entered.stdout).toContain('hello')
    // Deny-by-default policy was POSTed (and read back) before the workload.
    expect(sprite.policies.length).toBeGreaterThan(0)
    expect(sprite.policies.at(-1)).toEqual([{ action: 'allow', domain: 'api.openai.com' }])

    await provider.stop(created)
    expect(sprite.killed).toEqual(['9'])
    const health = await provider.health(created)
    expect(health.status).toBe('stopped')
    expect(health.virtualization).toBe('microvm')
  })

  it('recycleSandbox destroys the sprite AND clears the create short-circuit — the next create re-asks the API', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-a' })
    const client = clientDouble(sprite)
    const provider = new FlySpritesProjectSandboxProvider({
      client,
      egressAllow: ['api.openai.com'],
    })

    const created = await provider.create(createInput())
    expect(client.created).toEqual(['project-prj-sprites-a'])

    await provider.recycleSandbox(created, 'transport-death exhaustion (test)')
    expect(client.deleted).toEqual(['project-prj-sprites-a'])

    // Without the in-memory clear, create() would short-circuit to the stale
    // state of a DESTROYED sprite — the mid-run redraw depends on this.
    const again = await provider.create(createInput())
    expect(client.created).toEqual(['project-prj-sprites-a', 'project-prj-sprites-a'])
    expect(again.sandbox_name).toBe('project-prj-sprites-a')

    // An already-gone sprite counts as recycled (404 tolerated), and the
    // short-circuit is cleared either way.
    await provider.recycleSandbox(again, 'redraw (test)')
    expect(client.deleted).toEqual(['project-prj-sprites-a', 'project-prj-sprites-a'])
    await expect(provider.recycleSandbox(again, 'double-tap (test)')).resolves.toBeUndefined()
    expect(client.deleted).toHaveLength(2)
  })

  it('pullGuestPaths brings a >64KB archive home over the filesystem API and keeps the path jail', async () => {
    // Route-010 regression size: the exec-WS stdout path truncated 8 pulls at
    // ~65535 bytes. The archive must ride the filesystem API instead.
    const tarBytes = Buffer.alloc(200_000, 7)
    const removed: string[] = []
    const sprite = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => commandDouble('/tmp/waypoint-pull-abc123', 0),
      filesystem: () => ({
        readFile: async (path: string) => {
          if (path !== '/tmp/waypoint-pull-abc123') throw new Error(`ENOENT: ${path}`)
          return tarBytes
        },
        stat: async () => ({ size: tarBytes.length }),
        rm: async (path: string) => {
          removed.push(path)
        },
      }),
    })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite, { existsRemotely: true }),
      egressAllow: ['api.openai.com'],
    })
    const binding = {
      ...createInput(),
      provider: 'fly-sprites' as const,
      sandbox_instance_id: 'sprite-uuid-0001',
      sandbox_name: 'project-prj-sprites-a',
      generation: 1,
      lifecycle: 'running' as const,
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    }
    await expect(
      provider.pullGuestPaths(binding, { mountPath: '/work', relPaths: ['../escape'] }),
    ).rejects.toThrow(/not a safe mount-relative path/)
    await expect(
      provider.pullGuestPaths(binding, { mountPath: '/work', relPaths: ['/abs'] }),
    ).rejects.toThrow(/not a safe mount-relative path/)
    const pulled = await provider.pullGuestPaths(binding, {
      mountPath: '/work',
      relPaths: ['.waypoint/claims/r/t.json'],
    })
    expect(pulled?.length).toBe(200_000)
    expect(pulled?.equals(tarBytes)).toBe(true)
    // The guest temp archive is removed after a good read.
    expect(removed).toEqual(['/tmp/waypoint-pull-abc123'])
  })

  it('pullGuestPaths refuses stdout noise and partial filesystem reads by name', async () => {
    const noisy = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => commandDouble('Last login: garbage\n/tmp/waypoint-pull-abc123', 0),
    })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(noisy, { existsRemotely: true }),
      egressAllow: ['api.openai.com'],
    })
    const binding = {
      ...createInput(),
      provider: 'fly-sprites' as const,
      sandbox_instance_id: 'sprite-uuid-0001',
      sandbox_name: 'project-prj-sprites-a',
      generation: 1,
      lifecycle: 'running' as const,
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    }
    await expect(
      provider.pullGuestPaths(binding, { mountPath: '/work', relPaths: ['a.json'] }),
    ).rejects.toThrow(/expected a \/tmp\/waypoint-pull-\* path on stdout/)

    const short = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => commandDouble('/tmp/waypoint-pull-abc123', 0),
      filesystem: () => ({
        readFile: async () => Buffer.alloc(65_535, 1),
        stat: async () => ({ size: 200_000 }),
        rm: async () => {},
      }),
    })
    const provider2 = new FlySpritesProjectSandboxProvider({
      client: clientDouble(short, { existsRemotely: true }),
      egressAllow: ['api.openai.com'],
    })
    await expect(
      provider2.pullGuestPaths(binding, { mountPath: '/work', relPaths: ['a.json'] }),
    ).rejects.toThrow(/returned 65535 bytes but the archive is 200000/)
  })

  it('kills sprite sessions and fails loudly when an exec breaches the host deadline', async () => {
    const sprite = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => wedgedCommandDouble(),
    })
    const client = clientDouble(sprite)
    const provider = new FlySpritesProjectSandboxProvider({
      client,
      egressAllow: ['api.openai.com'],
      execDeadlineMs: 50,
    })
    const created = await provider.create(createInput('prj_sprites_deadline'))
    await expect(provider.enter(created, { argv: ['/bin/sleep', 'forever'] })).rejects.toThrow(
      /exec deadline exceeded after 50ms.*sessions killed/,
    )
    expect(sprite.killed).toEqual(['9'])
  })

  it('factory createCloudProjectSandboxProvider / createProjectSandboxProvider', () => {
    const priorFile = process.env.SPRITES_TOKEN_FILE
    // Pin the file home to nowhere so a locally installed operator token
    // cannot satisfy the no-token branch (found live 2026-08-29).
    process.env.SPRITES_TOKEN_FILE = '/nonexistent/sprites-token'
    try {
      const cloud = createCloudProjectSandboxProvider('fly-sprites', {
        token: 'x',
        skipAdmission: true,
      })
      expect(cloud).toBeInstanceOf(FlySpritesProjectSandboxProvider)
      expect(createProjectSandboxProvider('fake')).toBeInstanceOf(FakeProjectSandboxProvider)
      expect(() =>
        createCloudProjectSandboxProvider('fly-sprites', { token: '', skipAdmission: true }),
      ).toThrow(/no Sprites token/i)
    } finally {
      if (priorFile === undefined) delete process.env.SPRITES_TOKEN_FILE
      else process.env.SPRITES_TOKEN_FILE = priorFile
    }
  })

  it('refuses empty egress allowlist before claiming deny-by-default', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-b' })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: [],
    })
    const created = await provider.create(createInput('prj_sprites_b'))
    await expect(provider.verify(created)).rejects.toThrow(/empty egress allowlist|fail closed/i)
    // Nothing was ever POSTed while refusing.
    expect(sprite.policies).toEqual([])
  })

  it('L5: refuses when the binding policy_hash does not match the enforced egress allowlist', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-pol' })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: ['api.openai.com'],
    })
    const created = await provider.create({
      ...createInput('prj_sprites_pol'),
      // Admitted under a DIFFERENT allowlist than the provider enforces.
      policy_hash: policyHashForEgress(['api.example.com']),
    })
    await expect(provider.verify(created)).rejects.toThrow(/policy_hash does not match/)
    // The mismatched policy was never POSTed.
    expect(sprite.policies).toEqual([])
  })

  it('L5: lane bindings realize the shared oauth sprite, keyed per project × lane', async () => {
    const laneId = 'sub:codex-agent-example-com'
    const laneName = stableOauthSandboxName(laneId, 'codex')
    expect(laneName).toMatch(/^oauth-codex-[0-9a-f]{8}$/)
    const sprite = spriteDouble({ name: laneName })
    const client = clientDouble(sprite)
    const provider = new FlySpritesProjectSandboxProvider({
      client,
      egressAllow: ['api.openai.com'],
    })

    const laneInput = (projectId: string) => ({
      ...createInput(projectId),
      oauth_lane_id: laneId,
      oauth_provider_slug: 'codex',
    })
    const a = await provider.create(laneInput('prj_lane_a'))
    const b = await provider.create(laneInput('prj_lane_b'))
    // One shared sprite identity for the lane…
    expect(a.sandbox_name).toBe(laneName)
    expect(b.sandbox_name).toBe(laneName)
    // …but state stays keyed per project × lane: each project keeps its own row.
    expect((await provider.inspect(a))?.project_id).toBe('prj_lane_a')
    expect((await provider.inspect(b))?.project_id).toBe('prj_lane_b')

    // A lane binding never falls back to per-project sprite resolution: an
    // unknown project on the lane resolves to null instead of the project path.
    const unknown = { ...a, project_id: 'prj_lane_never_created' }
    await expect(provider.inspect(unknown)).resolves.toBeNull()
  })

  it('strips the /v1 suffix for the SDK base URL', () => {
    expect(normalizeSdkBaseURL('https://api.sprites.dev/v1')).toBe('https://api.sprites.dev')
    expect(normalizeSdkBaseURL('https://api.sprites.dev/v1/')).toBe('https://api.sprites.dev')
    expect(normalizeSdkBaseURL('https://api.sprites.dev')).toBe('https://api.sprites.dev')
  })

  it('never uses vi-level network — the double is the whole boundary', () => {
    // Guard against the guide's latent gap: a "mocked" test that still opens a
    // real socket. The SDK client is injected; no fetch/WebSocket global is
    // touched by construction.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const sprite = spriteDouble({ name: 'project-prj-sprites-c' })
    void new FlySpritesProjectSandboxProvider({ client: clientDouble(sprite), egressAllow: ['api.openai.com'] })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('L2 shared-lane hygiene', () => {
  it('derives per-project guest workspaces and refuses unsafe wipe targets', () => {
    expect(guestWorkspacePath('/work', 'prj_sprites_a')).toBe('/work/prj-sprites-a')
    expect(guestWorkspacePath('/work/', 'prj_sprites_a')).toBe('/work/prj-sprites-a')
    expect(() => guestWorkspacePath('work', 'prj_sprites_a')).toThrow(/absolute/)

    expect(assertWipeSafeGuestPath('/work/prj-x')).toBe('/work/prj-x')
    expect(assertWipeSafeGuestPath('/opt/cordis-worker/')).toBe('/opt/cordis-worker')
    for (const unsafe of ['/work', '/', '/opt', '/work/..', '/work/../etc', 'work/x', '/work/./x']) {
      expect(() => assertWipeSafeGuestPath(unsafe), unsafe).toThrow(/guest wipe refused/)
    }
  })

  it('workspace sync wipes the slug dir first and refuses the bare mount base', async () => {
    const hostTree = await mkdtemp(join(tmpdir(), 'fly-l2-sync-'))
    await writeFile(join(hostTree, 'kept.txt'), 'kept', 'utf8')
    const sprite = spriteDouble({ name: 'project-prj-sprites-a' })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: ['api.openai.com'],
    })
    const created = await provider.create(createInput())

    await provider.syncProjectWorkspace(created, { projectRoot: hostTree, mountPath: '/work/prj-sprites-a' })
    // Wipe precedes mkdir precedes the tar extract — the guest EXACTLY mirrors
    // the host; nothing host-deleted can survive to resurrect on the pull leg.
    expect(sprite.execs).toEqual([
      ['/bin/rm', '-rf', '--', '/work/prj-sprites-a'],
      ['/bin/mkdir', '-p', '/work/prj-sprites-a'],
    ])
    expect(sprite.spawns).toEqual([['/bin/tar', '-xf', '-', '-C', '/work/prj-sprites-a']])

    sprite.execs.length = 0
    sprite.spawns.length = 0
    await expect(
      provider.syncProjectWorkspace(created, { projectRoot: hostTree, mountPath: '/work' }),
    ).rejects.toThrow(/guest wipe refused/)
    expect(sprite.execs).toEqual([])
    expect(sprite.spawns).toEqual([])
  })

  it('deleteGuestWorkspace removes the slug dir and refuses shared bases', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-a' })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: ['api.openai.com'],
    })
    const created = await provider.create(createInput())

    await provider.deleteGuestWorkspace(created, { guestPath: '/work/prj-sprites-a' })
    expect(sprite.execs).toEqual([['/bin/rm', '-rf', '--', '/work/prj-sprites-a']])

    for (const unsafe of ['/work', '/']) {
      await expect(provider.deleteGuestWorkspace(created, { guestPath: unsafe })).rejects.toThrow(
        /guest wipe refused/,
      )
    }
    expect(sprite.execs).toHaveLength(1)
  })

  it('ensureGuestBundle refuses placeholder revisions and empty tree probes before any exec', async () => {
    const sprite = spriteDouble({ name: 'project-prj-sprites-a' })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: ['api.openai.com'],
    })
    const created = await provider.create(createInput())

    await expect(
      provider.ensureGuestBundle(created, {
        hostDist: '/nowhere',
        guestPath: '/opt/cordis-worker',
        revision: `localhost/waypoint/cordis-worker@sha256:${'a'.repeat(64)}`,
        requiredFiles: ['cordis-worker.mjs'],
      }),
    ).rejects.toThrow(/placeholder digest/)
    await expect(
      provider.ensureGuestBundle(created, {
        hostDist: '/nowhere',
        guestPath: '/opt/cordis-worker',
        revision: 'not-a-digest',
        requiredFiles: ['cordis-worker.mjs'],
      }),
    ).rejects.toThrow(/not a sha256-pinned/)
    await expect(
      provider.ensureGuestBundle(created, {
        hostDist: '/nowhere',
        guestPath: '/opt/cordis-worker',
        revision: `sha256:${'ab'.repeat(32)}`,
        requiredFiles: [],
      }),
    ).rejects.toThrow(/marker-only skip probe/)
    expect(sprite.execs).toEqual([])
    expect(sprite.spawns).toEqual([])
    expect(assertRealBundleRevision(` sha256:${'ab'.repeat(32)} `)).toBe(`sha256:${'ab'.repeat(32)}`)
  })

  it('ensureGuestBundle skips only when marker AND tree verify; reinstalls over a broken tree', async () => {
    const revision = `localhost/waypoint/cordis-worker@sha256:${'ab'.repeat(32)}`
    const hostDist = await mkdtemp(join(tmpdir(), 'fly-l2-dist-'))
    await writeFile(join(hostDist, 'cordis-worker.mjs'), '// bundle', 'utf8')

    // Marker + tree both verify → skip: the probe is the ONLY exec.
    const verified = spriteDouble({ name: 'project-prj-sprites-a', execExit: () => 0 })
    const skipProvider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(verified),
      egressAllow: ['api.openai.com'],
    })
    const skipBinding = await skipProvider.create(createInput())
    await expect(
      skipProvider.ensureGuestBundle(skipBinding, {
        hostDist,
        guestPath: '/opt/cordis-worker',
        revision,
        requiredFiles: ['cordis-worker-launch.mjs', 'cordis-worker.mjs'],
      }),
    ).resolves.toBe('verified')
    expect(verified.execs).toHaveLength(1)
    const probeShell = verified.execs[0]!.join(' ')
    expect(probeShell).toContain(GUEST_REVISION_MARKER)
    expect(probeShell).toContain('/opt/cordis-worker/cordis-worker-launch.mjs')
    expect(probeShell).toContain('/opt/cordis-worker/cordis-worker.mjs')
    expect(verified.spawns).toEqual([])

    // Probe misses (stale marker OR missing tree file — e.g. the marker
    // matches but the launcher is gone): wipe → extract → stamp marker LAST.
    const broken = spriteDouble({
      name: 'project-prj-sprites-a',
      execExit: (joined) => (joined.includes('$(cat ') ? 1 : 0),
    })
    const reinstallProvider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(broken),
      egressAllow: ['api.openai.com'],
    })
    const reinstallBinding = await reinstallProvider.create(createInput())
    await expect(
      reinstallProvider.ensureGuestBundle(reinstallBinding, {
        hostDist,
        guestPath: '/opt/cordis-worker',
        revision,
        requiredFiles: ['cordis-worker.mjs'],
      }),
    ).resolves.toBe('installed')
    expect(broken.execs.map((argv) => argv.slice(0, 2).join(' '))).toEqual([
      '/bin/sh -c', // tree+marker probe
      '/bin/rm -rf', // wipe-before-sync
      '/bin/mkdir -p',
      '/bin/sh -c', // marker stamp, after the extract
    ])
    expect(broken.execs.at(-1)!.join(' ')).toContain(GUEST_REVISION_MARKER)
    expect(broken.spawns).toEqual([['/bin/tar', '-xf', '-', '-C', '/opt/cordis-worker']])
  })

  it('delete-after-pull removes the slug dir once results are home, and a delete failure never fails the attempt', async () => {
    const hostRoot = await mkdtemp(join(tmpdir(), 'fly-l2-pull-'))
    // Pull exits 8 (no claim, no rw delta) — the attempt is still OVER, so the
    // workspace leaves the shared sprite.
    const sprite = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => commandDouble('', 8),
    })
    const provider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(sprite),
      egressAllow: ['api.openai.com'],
    })
    const created = await provider.create(createInput())
    await pullManagedResultsAfterEnter(provider, created, hostRoot, '/work/prj-sprites-a', ['claim.json'])
    expect(sprite.execs).toEqual([['/bin/rm', '-rf', '--', '/work/prj-sprites-a']])

    // rm failing is LOUD but non-fatal: results (none here) are already home.
    const stuck = spriteDouble({
      name: 'project-prj-sprites-a',
      spawn: () => commandDouble('', 8),
      execExit: () => 1,
    })
    const stuckProvider = new FlySpritesProjectSandboxProvider({
      client: clientDouble(stuck),
      egressAllow: ['api.openai.com'],
    })
    const stuckBinding = await stuckProvider.create(createInput())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        pullManagedResultsAfterEnter(stuckProvider, stuckBinding, hostRoot, '/work/prj-sprites-a', ['claim.json']),
      ).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('delete-after-pull failed'))
    } finally {
      errorSpy.mockRestore()
    }
  })
})
