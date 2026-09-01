import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { RecipeManifest } from '@waypoint-engine/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { claimHostPath } from '../sandbox/claim.ts'
import { orderHostPath } from '../sandbox/runtime.ts'
import { FAKE_VERIFIED_PROBES } from '../sandbox/providers/fake.ts'
import type { ProjectSandboxBinding, ProjectSandboxProvider } from '../sandbox/provider.ts'
import {
  laneHomeCredentialFingerprint,
  readLaneCredentialHealth,
} from '../sandbox/lane-credential-health.ts'
import {
  CORDIS_GUEST_DIST_ENV,
  prepareCordisManagedEnter,
  runCordisJailed,
  type CordisPickedLane,
  type CordisWorkerLane,
} from './cordis-jailed-runtime.ts'
import { cordisScratchDir } from './cordis/compose.ts'
import type { CordisRecipeRuntimeInput } from './cordis-runtime.ts'

const PROVIDER = 'openai-codex'
const MODEL = 'gpt-5.4'
const REFRESH_TOKEN = 'refresh-token-value-never-in-argv'

function fakeJwt(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
}

/** A signed-in codex lane home (codex-CLI auth.json, as the Console writes it). */
async function writeLaneHome(projectRoot: string): Promise<CordisWorkerLane> {
  const homePath = path.join(projectRoot, 'lane-home')
  await mkdir(homePath, { recursive: true })
  await writeFile(
    path.join(homePath, 'auth.json'),
    JSON.stringify({
      tokens: {
        id_token: fakeJwt({ email: 'worker-a@agents.example.com' }),
        access_token: fakeJwt({ exp: 9_999_999_999 }),
        refresh_token: REFRESH_TOKEN,
        account_id: 'acct-1',
      },
    }),
    'utf8',
  )
  return { consoleProvider: 'codex', homePath }
}

const FLY_SPRITES: WaypointProjectSandboxConfig = {
  backend: 'fly-sprites',
  image: `localhost/waypoint/cordis-worker@sha256:${'d'.repeat(64)}`,
  egress: { default: 'deny', allow: ['api.openai.com'] },
}

const MANAGED_BINDING = {
  project_id: 'prj_test',
  sandbox_provider: 'fly-sprites',
  sandbox_instance_id: 'sprite-1',
  sandbox_image: FLY_SPRITES.image,
  sandbox_policy: 'b'.repeat(64),
  sandbox_mount: 'c'.repeat(64),
  sandbox_generation: 1,
  sandbox_workspace: 'ws-a',
}

const RECIPE: RecipeManifest = {
  schema_version: 1,
  slug: 'doc-writer',
  name: 'Doc writer',
  prompt: 'write docs',
  runtime: { kind: 'cordis' },
  tools: ['report'],
} as RecipeManifest

function input(projectRoot: string): CordisRecipeRuntimeInput {
  return {
    routeId: 'route-cordis-001',
    taskId: 'task-1',
    recipe: RECIPE,
    prompt: 'write docs',
    projectRoot,
    access: { case_work: 'rw' },
  }
}

function fakeProvider(
  projectRoot: string,
  opts?: { readonly exitCode?: number; readonly claim?: unknown; readonly stderr?: string },
): ProjectSandboxProvider {
  return {
    create: async () => {
      throw new Error('not used')
    },
    inspect: async () => null,
    verify: async (binding: ProjectSandboxBinding) => ({
      ...binding,
      enterable: true,
      virtualization: 'microvm' as const,
      healthy: true,
      policy_verified: true,
      mount_policy_verified: true,
      observed_at: '2026-08-27T00:00:00.000Z',
      probes: [...FAKE_VERIFIED_PROBES],
    }),
    enter: async () => {
      if (opts?.claim !== undefined) {
        const claimFile = claimHostPath(projectRoot, 'route-cordis-001', 'task-1')
        await mkdir(path.dirname(claimFile), { recursive: true })
        await writeFile(claimFile, JSON.stringify(opts.claim), 'utf8')
      }
      return {
        exit_code: opts?.exitCode ?? 0,
        stdout: '',
        stderr: opts?.stderr ?? '',
        observed_at: '2026-08-27T00:00:00.000Z',
      }
    },
    health: async (binding: ProjectSandboxBinding) => ({
      ...binding,
      status: 'healthy' as const,
      healthy: true,
      virtualization: 'microvm' as const,
      observed_at: '2026-08-27T00:00:00.000Z',
    }),
    stop: async () => {},
    syncProjectWorkspace: async () => {},
  } as unknown as ProjectSandboxProvider
}

describe('prepareCordisManagedEnter — fly-sprites', () => {
  let projectRoot: string

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  })

  it('assembles enter argv with the guest entry, a path-only credential, and a staged manifest order', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const lane = await writeLaneHome(projectRoot)

    const plan = await prepareCordisManagedEnter(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: MANAGED_BINDING,
        lane,
        sandboxProvider: fakeProvider(projectRoot),
      },
    )

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    const argv = plan.argv.join(' ')
    expect(argv).toContain('/opt/cordis-worker/cordis-worker-launch.mjs')
    // L4 residency: argv (which rides the Sprites WebSocket URL) names the
    // staged credential FILE — the credential VALUE never appears in it.
    expect(argv).toContain('WAYPOINT_PI_BROKERED_CRED_FILE')
    expect(argv).toContain('/work/prj-test/.waypoint/scratch/route-cordis-001/task-1/brokered-cred.json')
    expect(argv).not.toContain(REFRESH_TOKEN)
    // L2 hygiene: on a shared sprite the project runs in its own slug dir
    // under the mount base — synced, entered, and wiped strictly inside it.
    expect(plan.order.projectRoot).toBe('/work/prj-test')
    expect(plan.mountPath).toBe('/work/prj-test')
    expect(argv).toContain(`cd '/work/prj-test'`)
    expect(plan.order.provider).toBe(PROVIDER)
    expect(plan.order.toolServer).toBe('/opt/cordis-worker/worker-mcp-server.mjs')
    // The order rides the FULL manifest — the guest never resolves a slug.
    expect(plan.order.recipe.slug).toBe('doc-writer')
    expect(plan.binding.sandbox_name).toBe('project-prj-test')

    // Staged into the workspace before sync, so the tar carries it into the mount.
    const scratch = cordisScratchDir(projectRoot, 'route-cordis-001', 'task-1')
    const staged = await readFile(orderHostPath(scratch), 'utf8')
    expect(JSON.parse(staged).taskId).toBe('task-1')
    // The HOST copy of the credential is gone the moment the sync consumed it.
    await expect(access(path.join(scratch, 'brokered-cred.json'))).rejects.toThrow()
  })

  it('refuses without a provisioning record — never inferred from cwd', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const lane = await writeLaneHome(projectRoot)

    const plan = await prepareCordisManagedEnter(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      { sandbox: FLY_SPRITES, lane, sandboxProvider: fakeProvider(projectRoot) },
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected refusal')
    expect(plan.reason).toContain('missing project_id')
  })

  it('refuses without a worker lane — the shared pi store is never read on this path', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    // A populated shared pi store sits right there — it must not be consulted.
    await writeFile(
      path.join(projectRoot, 'auth.json'),
      JSON.stringify({ 'openai-codex': { type: 'oauth', refresh: 'r', access: 'a', expires: 9 } }),
      'utf8',
    )

    const plan = await prepareCordisManagedEnter(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      { sandbox: FLY_SPRITES, managedBinding: MANAGED_BINDING, sandboxProvider: fakeProvider(projectRoot) },
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected refusal')
    expect(plan.reason).toContain('no worker lane was provided')
    expect(plan.reason).toContain("the shared pi store is the brain's account")
  })

  it('refuses a signed-out (husk) lane — re-auth, never roll over', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const homePath = path.join(projectRoot, 'husk-home')
    await mkdir(homePath, { recursive: true })
    await writeFile(path.join(homePath, 'auth.json'), JSON.stringify({ tokens: {} }), 'utf8')

    const plan = await prepareCordisManagedEnter(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: MANAGED_BINDING,
        lane: { consoleProvider: 'codex', homePath },
        sandboxProvider: fakeProvider(projectRoot),
      },
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) throw new Error('expected refusal')
    expect(plan.reason).toContain('worker lane credential refused')
    expect(plan.reason).toContain('incomplete')
  })
})

describe('runCordisJailed — verdicts', () => {
  let projectRoot: string

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  })

  async function run(provider: ProjectSandboxProvider, env?: NodeJS.ProcessEnv) {
    const lane = await writeLaneHome(projectRoot)
    return runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: MANAGED_BINDING,
        lane,
        sandboxProvider: provider,
        ...(env ? { env } : {}),
      },
    )
  }

  it('finished on exit 0 + finished claim; the digest is honestly unobserved', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const out = await run(fakeProvider(projectRoot, { claim: { status: 'finished', summary: 'wrote the docs' } }))
    expect(out.status).toBe('finished')
    expect(out.close_reason).toBe('wrote the docs')
    expect(out.composition_digest).toBeNull()
    // S2 (item 52): the ADMITTED binding rides the output so the bridge can
    // stamp the dispatch row with where the work physically ran.
    expect(out.sandbox).toMatchObject({
      provider: 'fly-sprites',
      project_id: 'prj_test',
      sandbox_name: 'project-prj-test',
    })
    expect((out.sandbox as Record<string, unknown>).image_digest).toBeTruthy()
    expect((out.sandbox as Record<string, unknown>).policy_hash).toBeTruthy()
  })

  it('failed when exit 0 leaves no claim — silence is never success', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const out = await run(fakeProvider(projectRoot))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('wrote no report claim')
  })

  it('failed on nonzero guest exit', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const out = await run(fakeProvider(projectRoot, { exitCode: 3 }))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('exited 3')
  })

  it('fails closed when the sandbox is disabled by env — no local fallback from here', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const out = await run(fakeProvider(projectRoot), { WAYPOINT_SANDBOX: 'off' })
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('fail closed')
    // Refused before admission: there was no sandbox on the attempt, and the
    // output must not fabricate a provenance claim.
    expect(out.sandbox).toBeNull()
  })
})

describe('runCordisJailed — L5 dispatch-time lane picking', () => {
  let projectRoot: string

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  })

  /** Route stamp under L5: ADMISSION CONTEXT only — no sprite identity. */
  const CONTEXT_BINDING = {
    project_id: 'prj_test',
    sandbox_provider: 'fly-sprites',
    sandbox_image: FLY_SPRITES.image,
    sandbox_policy: 'b'.repeat(64),
    sandbox_mount: 'c'.repeat(64),
    sandbox_workspace: 'ws-a',
  }

  /** Provider double whose create() realizes a LANE sprite from the input. */
  function laneProvider(
    root: string,
    opts?: {
      readonly exitCode?: number
      readonly claim?: unknown
      readonly stderr?: string
      readonly ensured?: string[]
      readonly recycled?: Array<{ name: string; reason: string }>
      readonly recycleError?: string
      readonly admission?: { admitted_image_digest: string }
    },
  ): ProjectSandboxProvider {
    const base = fakeProvider(root, opts) as unknown as Record<string, unknown>
    return {
      ...base,
      ...(opts?.admission ? { admission: opts.admission } : {}),
      create: async (create: Record<string, unknown>) => ({
        ...create,
        provider: 'fly-sprites',
        sandbox_instance_id: 'sprite-lane-0001',
        sandbox_name: `oauth-${String(create.oauth_provider_slug)}-cafe0123`,
        generation: 1,
        lifecycle: 'running',
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      }),
      ...(opts?.ensured
        ? {
            ensureGuestBundle: async (_binding: unknown, input: { revision: string }) => {
              opts.ensured!.push(input.revision)
              return 'verified' as const
            },
          }
        : {}),
      ...(opts?.recycled || opts?.recycleError
        ? {
            recycleSandbox: async (binding: { sandbox_name: string }, reason: string) => {
              if (opts?.recycleError) throw new Error(opts.recycleError)
              opts.recycled!.push({ name: binding.sandbox_name, reason })
            },
          }
        : {}),
    } as unknown as ProjectSandboxProvider
  }

  function picker(released: { count: number }, laneOver: Partial<CordisPickedLane> = {}) {
    return async () => ({
      ok: true as const,
      lane: {
        oauth_lane_id: 'sub:codex-worker-example-com',
        oauth_provider_slug: 'codex',
        consoleProvider: 'codex',
        homePath: '',
        queue_wait_ms: 42,
        release: async () => {
          released.count += 1
        },
        ...laneOver,
      },
    })
  }

  async function runPicked(provider: ProjectSandboxProvider, released: { count: number }) {
    const lane = await writeLaneHome(projectRoot)
    return runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: provider,
      },
    )
  }

  it('picks at dispatch, realizes the LANE binding from context, stamps lane meta, releases the lock', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const released = { count: 0 }
    const out = await runPicked(
      laneProvider(projectRoot, { claim: { status: 'finished', summary: 'done on a lane' } }),
      released,
    )
    expect(out.status).toBe('finished')
    // The dispatch stamp records the realized lane sprite + queue wait —
    // the route stamp carried no sprite identity at all (item 8 retired it).
    expect(out.sandbox).toMatchObject({
      provider: 'fly-sprites',
      project_id: 'prj_test',
      sandbox_name: 'oauth-codex-cafe0123',
      sandbox_instance_id: 'sprite-lane-0001',
      oauth_lane_id: 'sub:codex-worker-example-com',
      oauth_provider_slug: 'codex',
      queue_wait_ms: 42,
    })
    // The HELD lock was adopted and released exactly once.
    expect(released.count).toBe(1)
  })

  it('a picker refusal fails the attempt with the refusal text — nothing entered, nothing to release', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: async () => ({ ok: false, reason: 'no available codex worker lane' }),
        sandboxProvider: laneProvider(projectRoot),
      },
    )
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('no available codex worker lane')
    expect(out.sandbox).toBeNull()
  })

  it('releases the held lock on a FAILED attempt too — every exit path', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const released = { count: 0 }
    const out = await runPicked(laneProvider(projectRoot, { exitCode: 3 }), released)
    expect(out.status).toBe('failed')
    expect(released.count).toBe(1)
  })

  it('holds the lane out when the guest reports a credential refusal — route-006', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr:
            'cordis worker: failed: cordis loop error: model openai-codex/x failed: ' +
            'OAuth refresh failed for openai-codex',
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    // The refusal is on the health record, bound to THIS home's credential so
    // a re-auth self-clears, and the next pick holds the lane out instead of
    // feeding it the rest of the route.
    const entry = readLaneCredentialHealth(env).refused.get('sub:codex-worker-example-com')
    expect(entry).toBeDefined()
    expect(entry!.message).toMatch(/refused the lane token in-guest/)
    expect(entry!.credential_fingerprint).toBe(laneHomeCredentialFingerprint(lane.homePath))
    expect(released.count).toBe(1)
  })

  it('a quota refusal holds the lane with an expiry parsed from the provider — route-008', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr:
            'cordis worker: failed: cordis loop error: model openai-codex/x failed: ' +
            'You have hit your ChatGPT usage limit (prolite plan). Try again in ~32 min.',
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    const entry = readLaneCredentialHealth(env).refused.get('sub:codex-worker-example-com')
    expect(entry).toBeDefined()
    expect(entry!.message).toMatch(/heals by waiting/)
    // Time-bounded: expiry recorded, roughly stated time + margin from now.
    const until = Date.parse(entry!.held_until ?? '')
    expect(Number.isFinite(until)).toBe(true)
    const minutesOut = (until - Date.now()) / 60_000
    expect(minutesOut).toBeGreaterThan(30)
    expect(minutesOut).toBeLessThan(45)
  })

  it('a transport death on a picked lane never marks it — the work failed, not the account', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr: 'model openai-codex/x failed: WebSocket error (stream died on all 3 attempts)',
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
  })

  it('transport-death exhaustion RECYCLES the sprite (placement, not account) — D-B amendment 2026-08-30', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const recycled: Array<{ name: string; reason: string }> = []
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr:
            'cordis loop error: model openai-codex/gpt-5.3-codex-spark stream went quiet for 45000ms between events (stream died on all 5 attempts)',
          recycled,
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    expect(out.close_reason).toMatch(/stream died on all 5 attempts/)
    expect(recycled).toHaveLength(1)
    expect(recycled[0]!.name).toBe('oauth-codex-cafe0123')
    expect(recycled[0]!.reason).toMatch(/fresh placement/)
    // The placement was sick, not the account: the lane is NOT held.
    expect(readLaneCredentialHealth(env).refused.size).toBe(0)
  })

  it('a credential refusal holds the LANE and never recycles the sprite', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const recycled: Array<{ name: string; reason: string }> = []
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr: 'cordis loop error: model openai-codex/x failed: Provided authentication token is expired.',
          recycled,
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    expect(recycled).toHaveLength(0)
    expect(readLaneCredentialHealth(env).refused.size).toBe(1)
  })

  it('a recycle failure is loud but never masks the dispatch close reason', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const healthRoot = await mkdtemp(path.join(tmpdir(), 'lane-health-'))
    const env = { WAYPOINT_SUBS_ROOT: healthRoot } as NodeJS.ProcessEnv
    const lane = await writeLaneHome(projectRoot)
    const released = { count: 0 }
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          exitCode: 1,
          stderr: 'model openai-codex/x failed: WebSocket error (stream died on all 3 attempts)',
          recycleError: 'sprites API is down',
        }),
        env,
      },
    )
    expect(out.status).toBe('failed')
    expect(out.close_reason).toMatch(/stream died on all 3 attempts/)
    expect(out.close_reason).not.toMatch(/sprites API is down/)
  })

  it('ensures the guest bundle at dispatch when the dist env is set — and refuses on digest drift', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const distDir = path.join(projectRoot, 'guest-dist')
    await mkdir(distDir, { recursive: true })
    await writeFile(path.join(distDir, 'digest.txt'), `${FLY_SPRITES.image}\n`, 'utf8')
    const released = { count: 0 }
    const ensured: string[] = []
    const lane = await writeLaneHome(projectRoot)
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, { claim: { status: 'finished', summary: 'ok' }, ensured }),
        env: { ...process.env, [CORDIS_GUEST_DIST_ENV]: distDir },
      },
    )
    expect(out.status).toBe('finished')
    expect(ensured).toEqual([FLY_SPRITES.image])

    // Drift: the built bundle is not the admitted revision — refuse, don't run.
    await writeFile(path.join(distDir, 'digest.txt'), `localhost/waypoint/cordis-worker@sha256:${'e'.repeat(64)}\n`, 'utf8')
    const drifted = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, { ensured }),
        env: { ...process.env, [CORDIS_GUEST_DIST_ENV]: distDir },
      },
    )
    expect(drifted.status).toBe('failed')
    expect(drifted.close_reason).toContain('guest bundle drift')
    // Both locks released regardless.
    expect(released.count).toBe(2)
  })

  it('refuses a bundle the admission does not pin — the human admits WHICH bundle runs (route-013)', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'cordis-jailed-'))
    const distDir = path.join(projectRoot, 'guest-dist')
    await mkdir(distDir, { recursive: true })
    // Stamp and host bundle AGREE — the stale-stamp drift check passes — but
    // the admission pins a different bundle: refuse before any install.
    await writeFile(path.join(distDir, 'digest.txt'), `${FLY_SPRITES.image}\n`, 'utf8')
    const released = { count: 0 }
    const ensured: string[] = []
    const lane = await writeLaneHome(projectRoot)
    const admitted = `localhost/waypoint/cordis-worker@sha256:${'f'.repeat(64)}`
    const out = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, { ensured, admission: { admitted_image_digest: admitted } }),
        env: { ...process.env, [CORDIS_GUEST_DIST_ENV]: distDir },
      },
    )
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('not the admitted one')
    expect(ensured).toEqual([])
    expect(released.count).toBe(1)

    // The admitted bundle itself rides through untouched.
    const ok = await runCordisJailed(
      input(projectRoot),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      {
        sandbox: FLY_SPRITES,
        managedBinding: CONTEXT_BINDING,
        lanePicker: picker(released, { homePath: lane.homePath }),
        sandboxProvider: laneProvider(projectRoot, {
          claim: { status: 'finished', summary: 'ok' },
          ensured,
          admission: { admitted_image_digest: FLY_SPRITES.image },
        }),
        env: { ...process.env, [CORDIS_GUEST_DIST_ENV]: distDir },
      },
    )
    expect(ok.status).toBe('finished')
    expect(ensured).toEqual([FLY_SPRITES.image])
  })
})
