import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWaypointProjectConfig, type WaypointProjectConfig, type WaypointProjectSandboxConfig } from '../project/config.ts'
import { sandboxMountHashForConfig } from '../runtime/managed-cloud-sandbox.ts'
import { SANDBOX_ENV } from '../sandbox/gate.ts'
import { policyHashForEgress } from '../sandbox/provider.ts'
import { DEFAULT_MOUNT_PATH } from '../sandbox/runtime.ts'
import type { SubscriptionHome } from '../sandbox/oauth-lane-resolve.ts'
import type { ScaffoldPlan } from '../tasks/store.ts'
import { assertRuntimeExecutesRecipePlans, sandboxRouteBindingForStart } from './start.ts'

/** Delta 5(a) seam: tests never read the repo's real deploy admission record. */
const passAdmission = () => ({ selected_provider: 'fly-sprites' })

const RECIPE_PLAN: ScaffoldPlan = {
  phase: 'build',
  plan_ref: 'p1',
  title: 'Build the report',
  wave: 1,
  metadata: { runner: { recipe: { slug: 'report-build' } } },
}

const GATE_PLAN: ScaffoldPlan = {
  phase: 'review',
  plan_ref: 'p2',
  title: 'Reviewer approval',
  wave: 2,
  metadata: { runner: { gate: { required: true } } },
}

const sandbox = (overrides: Partial<WaypointProjectSandboxConfig> = {}): WaypointProjectSandboxConfig => ({
  backend: 'fly-sprites',
  // Host-qualified: an unqualified name means Docker Hub, which admission now
  // refuses (rsc-zai). Left as `alpine`, every test below would pass on the
  // image refusal and prove nothing about the egress rule it names.
  image: 'localhost/waypoint/cordis-worker:slim',
  // Worker-lane fixtures model a NON-Anthropic lane — Anthropic is out of the
  // worker lanes entirely (Aaron 2026-08-27, docs/designs/sprite-worker-isolation.md).
  egress: { default: 'deny', allow: ['api.openai.com'] },
  credential: { broker: [{ env_var: 'OPENAI_API_KEY', hosts: ['api.openai.com'] }] },
  ...overrides,
})

const configWith = (sandboxConfig?: WaypointProjectSandboxConfig): WaypointProjectConfig =>
  createWaypointProjectConfig({
    quest: 'runner',
    runtime: {
      recipe: 'worker',
      worker: { command: './bin/fake-agent', args: ['-p'] },
      ...(sandboxConfig ? { sandbox: sandboxConfig } : {}),
    },
  })

describe('sandbox admission at route start (rsc-wxk)', () => {
  it('admits a coherent sandbox policy', () => {
    expect(() => assertRuntimeExecutesRecipePlans(configWith(sandbox()), [RECIPE_PLAN], 'runner')).not.toThrow()
  })

  it('admits a project with no sandbox — nothing changes when off', () => {
    expect(() => assertRuntimeExecutesRecipePlans(configWith(), [RECIPE_PLAN], 'runner')).not.toThrow()
  })

  it('refuses at START, before any route rows exist — not at the first dispatch', () => {
    const config = configWith(sandbox({ egress: { default: 'allow', allow: ['api.openai.com'] } }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(
      /cannot start under the configured worker sandbox: .*sandbox in name only/,
    )
  })

  it('refuses a brokered secret aimed at a host the firewall drops', () => {
    const config = configWith(sandbox({ egress: { default: 'deny', allow: ['registry.npmjs.org'] } }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(/does not permit/)
  })

  it('refuses a CIDR in the allowlist at START — the raw-IP exfil reopening never reaches a dispatch', () => {
    const config = configWith(sandbox({ egress: { default: 'deny', allow: ['api.openai.com', '10.0.0.0/8'] }, credential: undefined }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(/non-domain target/)
  })

  it('refuses a Docker-Hub-resolvable image at START — a squatter never gets a dispatch (rsc-zai)', () => {
    // The rule's real seam. `msb run` auto-pulls on a cache miss, so this
    // reference would have fetched and RUN whatever `docker.io/waypoint/worker`
    // serves — a namespace measured unclaimed — with the case tree mounted rw.
    const config = configWith(sandbox({ image: 'waypoint/worker:slim' }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(
      /cannot start under the configured worker sandbox: .*names no registry host/,
    )
  })

  it('refuses a remote image pinned only by tag at START', () => {
    const config = configWith(sandbox({ image: 'ghcr.io/aaron-agent-corporation/waypoint-worker:slim' }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(/pins no digest/)
  })

  it('admits a digest-pinned remote image — the published path a fresh machine uses', () => {
    const config = configWith(sandbox({ image: `ghcr.io/aaron-agent-corporation/waypoint-worker@sha256:${'b'.repeat(64)}` }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).not.toThrow()
  })

  it('ignores the sandbox for quests with no recipe plans — nothing spawns, nothing to jail', () => {
    const config = configWith(sandbox({ egress: { default: 'allow', allow: ['api.openai.com'] } }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [GATE_PLAN], 'runner')).not.toThrow()
  })

  it('does not refuse a broken policy the env kill switch has already turned off', () => {
    const previous = process.env[SANDBOX_ENV]
    process.env[SANDBOX_ENV] = 'off'
    try {
      const config = configWith(sandbox({ egress: { default: 'allow', allow: ['api.openai.com'] } }))
      expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env[SANDBOX_ENV]
      else process.env[SANDBOX_ENV] = previous
    }
  })

  it('refuses the retired microsandbox backend at START (S1: fly-sprites is the VM tier)', () => {
    const config = configWith(sandbox({ backend: 'microsandbox' }))
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(
      /backend 'microsandbox' is retired/,
    )
  })

  it('still refuses an unexecutable recipe runtime — the existing Q1 guard is unchanged', () => {
    const config = createWaypointProjectConfig({ quest: 'runner', runtime: { recipe: 'worker' } })
    expect(() => assertRuntimeExecutesRecipePlans(config, [RECIPE_PLAN], 'runner')).toThrow(
      /runtime\.worker\.command is missing/,
    )
  })
})

/**
 * S2 (item 52): the admitted binding rides the DURABLE ROUTE ROW. Start reads
 * the per-project provisioning record and stamps it; a production sandbox with
 * no record refuses before any route rows exist.
 */
describe('sandbox binding at route start (item 52)', () => {
  let projectRoot: string

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  })

  async function writeProvisioningRecord(root: string): Promise<void> {
    await mkdir(path.join(root, '.waypoint', 'sandbox'), { recursive: true })
    await writeFile(
      path.join(root, '.waypoint', 'sandbox', 'binding.json'),
      JSON.stringify({
        project_id: 'prj_stamp',
        provider: 'fly-sprites',
        sandbox_instance_id: 'spr_123',
        image_digest: `localhost/waypoint/cordis-worker@sha256:${'a'.repeat(64)}`,
        policy_hash: 'b'.repeat(64),
        mount_hash: 'c'.repeat(64),
        generation: 1,
        workspace_id: 'ws-stamp',
      }),
      'utf8',
    )
  }

  it('stamps ADMISSION CONTEXT — live-config hashes, never sprite identity (L5)', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await writeProvisioningRecord(projectRoot)
    const config = configWith(sandbox())
    const binding = await sandboxRouteBindingForStart(projectRoot, config, [RECIPE_PLAN], 'runner', [], {
      loadAdmission: passAdmission,
      // No installed bundle in this home — the record digest is the fallback.
      env: { WAYPOINT_HOME: path.join(projectRoot, 'no-such-home') },
    })
    expect(binding).toEqual({
      project_id: 'prj_stamp',
      sandbox_provider: 'fly-sprites',
      sandbox_image: `localhost/waypoint/cordis-worker@sha256:${'a'.repeat(64)}`,
      // Recomputed from the LIVE config — the same hashes dispatch enforces —
      // not copied from the record ('b'/'c' placeholders above).
      sandbox_policy: policyHashForEgress(['api.openai.com']),
      sandbox_mount: sandboxMountHashForConfig(DEFAULT_MOUNT_PATH, config.roots),
      sandbox_workspace: 'ws-stamp',
    })
    // The retired per-project sprite identity never rides the stamp.
    expect(binding).not.toHaveProperty('sandbox_instance_id')
    expect(binding).not.toHaveProperty('sandbox_generation')
  })

  it('a CONTEXT-ONLY record (no sprite fields) is fully sufficient (L5)', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await mkdir(path.join(projectRoot, '.waypoint', 'sandbox'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.waypoint', 'sandbox', 'binding.json'),
      JSON.stringify({
        project_id: 'prj_ctx',
        provider: 'fly-sprites',
        image_digest: `localhost/waypoint/cordis-worker@sha256:${'d'.repeat(64)}`,
        policy_hash: policyHashForEgress(['api.openai.com']),
        mount_hash: 'c'.repeat(64),
        workspace_id: 'ws-ctx',
      }),
      'utf8',
    )
    const binding = await sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner', [], {
      loadAdmission: passAdmission,
      env: { WAYPOINT_HOME: path.join(projectRoot, 'no-such-home') },
    })
    expect(binding).toMatchObject({ project_id: 'prj_ctx', sandbox_workspace: 'ws-ctx' })
  })

  it('stamps the INSTALLED bundle digest over a stale provisioning record — one resolver on both legs (route-013)', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await writeProvisioningRecord(projectRoot) // record pins the 'a'.repeat(64) digest
    const home = path.join(projectRoot, 'waypoint-home')
    const installed = `localhost/waypoint/cordis-worker@sha256:${'e'.repeat(64)}`
    await mkdir(path.join(home, 'cordis-guest'), { recursive: true })
    await writeFile(path.join(home, 'cordis-guest', 'digest.txt'), `${installed}\n`, 'utf8')
    const binding = await sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner', [], {
      loadAdmission: passAdmission,
      env: { WAYPOINT_HOME: home },
    })
    // Dispatch installs the resolved bundle and refuses stamp drift — so the
    // stamp must come from the same resolution, not the stale record.
    expect(binding?.sandbox_image).toBe(installed)
  })

  it('refuses when the provider admission record does not verify (delta 5a)', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await writeProvisioningRecord(projectRoot)
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner', [], {
        loadAdmission: () => {
          throw new Error('evidence digest mismatch')
        },
      }),
    ).rejects.toThrow(/admission record does not verify.*evidence digest mismatch/)
  })

  it('refuses when the admission record selects a different provider than the backend', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await writeProvisioningRecord(projectRoot)
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner', [], {
        loadAdmission: () => ({ selected_provider: 'other-cloud' }),
      }),
    ).rejects.toThrow(/admission record selects 'other-cloud'/)
  })

  it('refuses an empty egress allowlist at start — never stamps a hash of nothing', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await writeProvisioningRecord(projectRoot)
    await expect(
      sandboxRouteBindingForStart(
        projectRoot,
        configWith(sandbox({ egress: { default: 'deny', allow: [] } })),
        [RECIPE_PLAN],
        'runner',
        [],
        { loadAdmission: passAdmission },
      ),
    ).rejects.toThrow(/egress\.allow is empty/)
  })
  it('refuses a production sandbox with NO provisioning record — before any route rows exist', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner', [], {
        loadAdmission: passAdmission,
      }),
    ).rejects.toThrow(/no provisioning record/)
  })

  it('returns nothing for a project with no sandbox — nothing changes when off', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(), [RECIPE_PLAN], 'runner'),
    ).resolves.toBeUndefined()
  })

  it('returns nothing for a recordless FAKE backend — the unit-test seam needs no provisioning', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox({ backend: 'fake' })), [RECIPE_PLAN], 'runner'),
    ).resolves.toBeUndefined()
  })

  it('returns nothing for a quest with no recipe plans — nothing will spawn a worker', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [GATE_PLAN], 'runner'),
    ).resolves.toBeUndefined()
  })

  it('the env kill switch starts without a record — the operator explicitly chose unjailed', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    const previous = process.env[SANDBOX_ENV]
    process.env[SANDBOX_ENV] = 'off'
    try {
      await expect(
        sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner'),
      ).resolves.toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env[SANDBOX_ENV]
      else process.env[SANDBOX_ENV] = previous
    }
  })

  it('a corrupt provisioning record refuses loudly — never read as "no sandbox here"', async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'start-binding-'))
    await mkdir(path.join(projectRoot, '.waypoint', 'sandbox'), { recursive: true })
    await writeFile(path.join(projectRoot, '.waypoint', 'sandbox', 'binding.json'), '{not json', 'utf8')
    await expect(
      sandboxRouteBindingForStart(projectRoot, configWith(sandbox()), [RECIPE_PLAN], 'runner'),
    ).rejects.toThrow(/binding record corrupt/)
  })
})

/**
 * L5 delta 5(b): the start gate is CAPABILITY, not identity — every model
 * class the quest's cordis recipes use must map to ≥1 signed-in non-brain
 * worker lane, refused at start rather than after N burned dispatches.
 */
describe('worker-lane capability at route start (L5)', () => {
  let projectRoot: string

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true })
  })

  const laneConfig = (): WaypointProjectConfig =>
    createWaypointProjectConfig({
      quest: 'runner',
      runtime: {
        recipe: 'worker',
        worker: { command: './bin/fake-agent', args: ['-p'] },
        sandbox: sandbox(),
        model_targets: { high: { provider: 'openai-codex', model: 'gpt-5.3-codex-spark' } },
      } as never,
    })

  const home = (over: Partial<SubscriptionHome> = {}): SubscriptionHome => ({
    id: 'codex-worker-example-com',
    provider: 'codex',
    homePath: '/tmp/subs/codex-worker-example-com',
    signedIn: true,
    email: 'worker@example.com',
    ...over,
  })

  const CORDIS_RECIPE = [{ slug: 'report-build', kind: 'cordis', modelClass: 'high' }]

  async function withRecord(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'start-lanes-'))
    await mkdir(path.join(root, '.waypoint', 'sandbox'), { recursive: true })
    await writeFile(
      path.join(root, '.waypoint', 'sandbox', 'binding.json'),
      JSON.stringify({
        project_id: 'prj_lanes',
        provider: 'fly-sprites',
        image_digest: `localhost/waypoint/cordis-worker@sha256:${'d'.repeat(64)}`,
        policy_hash: 'x',
        mount_hash: 'y',
        workspace_id: 'ws-lanes',
      }),
      'utf8',
    )
    return root
  }

  it('starts when the class maps to a signed-in non-brain lane', async () => {
    projectRoot = await withRecord()
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', CORDIS_RECIPE, {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home()],
        reserve: { emails: new Set() },
      }),
    ).resolves.toMatchObject({ project_id: 'prj_lanes' })
  })

  it('refuses when NO signed-in lane serves the class — before any rows exist', async () => {
    projectRoot = await withRecord()
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', CORDIS_RECIPE, {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home({ signedIn: false })],
        reserve: { emails: new Set() },
      }),
    ).rejects.toThrow(/no usable codex worker lane for model class 'high'.*Subscriptions/)
  })

  it('refuses a lane whose account another tool on this machine also holds', async () => {
    projectRoot = await withRecord()
    const subs = await mkdtemp(path.join(tmpdir(), 'start-contested-'))
    const homePath = path.join(subs, 'codex-worker-example-com')
    await mkdir(homePath, { recursive: true })
    const claims = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-contested' } }
    await writeFile(
      path.join(homePath, 'auth.json'),
      JSON.stringify({
        tokens: { access_token: `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y` },
      }),
      'utf8',
    )
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', CORDIS_RECIPE, {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home({ homePath })],
        reserve: { emails: new Set() },
        foreignAccounts: new Map([['acct-contested', '/Users/x/.codex/auth.json']]),
      }),
    ).rejects.toThrow(
      /held out: codex-worker-example-com — this account is also signed in at \/Users\/x\/\.codex\/auth\.json/,
    )
  })

  it('a lane held for the brain does not count — exclusivity is structural', async () => {
    projectRoot = await withRecord()
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', CORDIS_RECIPE, {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home()],
        reserve: { emails: new Set(['worker@example.com']) },
      }),
    ).rejects.toThrow(/held out: codex-worker-example-com — its account .* is serving Waypoint's brain/)
  })

  it('refuses when the only lane is signed-in on disk but its credential was REFUSED (item 54)', async () => {
    projectRoot = await withRecord()
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', CORDIS_RECIPE, {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home()],
        reserve: { emails: new Set() },
        credentialHealth: {
          refused: new Map([
            [
              'sub:codex-worker-example-com',
              {
                lane_id: 'sub:codex-worker-example-com',
                message: 'sign-in has lapsed',
                recorded_at: '2026-08-29T00:00:00.000Z',
                credential_fingerprint: 'fp-codex-worker-example-com',
              },
            ],
          ]),
        },
      }),
    ).rejects.toThrow(/no usable codex worker lane.*sign-in has lapsed.*Subscriptions/s)
  })

  it('refuses an unresolvable model class, naming the recipe', async () => {
    projectRoot = await withRecord()
    await expect(
      sandboxRouteBindingForStart(projectRoot, laneConfig(), [RECIPE_PLAN], 'runner', [
        { slug: 'report-build', kind: 'cordis', modelClass: 'low' },
      ], {
        loadAdmission: passAdmission,
        registry: { 'openai-codex': { auth: 'subscription' } },
        homes: [home()],
        reserve: { emails: new Set() },
      }),
    ).rejects.toThrow(/model class 'low'.*does not resolve/)
  })
})


