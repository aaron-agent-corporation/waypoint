import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Credential } from '@earendil-works/pi-ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { WAYPOINT_ALLOW_RETIRED_MICROSANDBOX, type WaypointProjectSandboxConfig } from '../project/config.ts'
import { BROKER_ENV } from './pi-cred-broker.ts'
import { preparePiJailedSpawn, preparePiSandboxedSpawn, type PiJailedConfig, type PiJailedTarget } from './pi-jailed-runtime.ts'
import type { PiRecipeRuntimeInput } from './pi-runtime.ts'
import type { PiWorkOrder } from './pi-worker-entry.ts'

const OAUTH: Credential = { type: 'oauth', refresh: 'r', access: 'a', expires: 9_999_999_999 }
const TARGET: PiJailedTarget = { provider: 'openai-codex', model: 'gpt-5.4', modelClass: 'high' }
const ROOTS = { work: { path: 'work', access: 'rw' as const } }

async function authFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-jail-auth-'))
  const authPath = join(dir, 'auth.json')
  await writeFile(authPath, JSON.stringify({ 'openai-codex': OAUTH }), 'utf8')
  return authPath
}

async function projectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-jail-'))
}

function input(root: string, extra: Partial<PiRecipeRuntimeInput> = {}): PiRecipeRuntimeInput {
  return { routeId: 'route-1', taskId: 'task-1', recipe: 'demo', prompt: 'go', projectRoot: root, tools: ['write_file'], access: { work: 'rw' }, ...extra }
}

// A clean base env: no WAYPOINT_SEATBELT (roots presence arms the jail), no WAYPOINT_SANDBOX.
const baseEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME }

describe('preparePiJailedSpawn — happy path (rsc-0fx, seatbelt)', () => {
  it('assembles a jailed spawn: entry argv, PiWorkOrder stdin, brokered cred in env', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { roots: ROOTS, env: baseEnv, authPath, piPolicy: [{ tool: 'bash' }] }
    const plan = await preparePiJailedSpawn(input(root), TARGET, config)

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // argv runs the child under the jail wrapper
    const cmdline = plan.argv.join(' ')
    expect(cmdline).toContain('pi-worker-entry')
    expect(cmdline).toContain('--experimental-strip-types')
    // stdin is the structured work order carrying the parent-resolved model
    const order = JSON.parse(plan.stdin) as PiWorkOrder
    expect(order).toMatchObject({ routeId: 'route-1', taskId: 'task-1', provider: 'openai-codex', model: 'gpt-5.4', tools: ['write_file'], access: { work: 'rw' } })
    expect(order.roots).toEqual(ROOTS)
    // the DENY policy is forwarded so the jailed child enforces it (rsc-bhc part 3)
    expect(order.piPolicy).toEqual([{ tool: 'bash' }])
    // the credential is brokered into the child env, and TMPDIR is redirected into the jail
    expect(plan.env[BROKER_ENV]).toBeDefined()
    expect(JSON.parse(plan.env[BROKER_ENV]!)).toMatchObject({ provider: 'openai-codex' })
    expect(plan.env.TMPDIR).toContain(join('.waypoint', 'tmp'))
    // the allowlist held: no arbitrary host var leaked through
    expect(plan.env.WAYPOINT_POSTGRES_URL).toBeUndefined()
  })
})

describe('preparePiJailedSpawn — fail closed, never an unjailed run (rsc-0fx)', () => {
  it('the seatbelt prep refuses a configured microsandbox (that is preparePiSandboxedSpawn)', async () => {
    // Defensive: runPiJailed routes a sandbox to the sandbox prep before here.
    // A sandbox config reaching the SEATBELT prep is a caller error, and running
    // the seatbelt path (a weaker jail than asked) or unjailed would be fail-open.
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { roots: ROOTS, env: baseEnv, authPath, sandbox: { image: 'localhost/x:slim' } as WaypointProjectSandboxConfig }
    const plan = await preparePiJailedSpawn(input(root), TARGET, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('microsandbox')
  })

  it('refuses when no write jail is available (no roots, WAYPOINT_SEATBELT off)', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { env: baseEnv, authPath } // no roots
    const plan = await preparePiJailedSpawn(input(root), TARGET, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('require the write jail')
  })

  it('refuses when the provider has no stored credential to broker', async () => {
    const root = await projectRoot()
    const authPath = await authFixture() // has openai-codex, not anthropic
    const config: PiJailedConfig = { roots: ROOTS, env: baseEnv, authPath }
    const plan = await preparePiJailedSpawn(input(root), { ...TARGET, provider: 'anthropic' }, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('no stored credential to broker')
  })

  it('refuses when the jail will not compile (fs tool granted but no access map)', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { roots: ROOTS, env: baseEnv, authPath }
    const plan = await preparePiJailedSpawn(input(root, { access: undefined }), TARGET, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('seatbelt jail refused')
  })
})

// A simple rw root for the argv-shape assertions below. (The claim dir is mounted
// rw EXPLICITLY now — rsc-clm — so it no longer depends on a root covering it.)
const SANDBOX_ROOTS = { case_work: { path: '.', access: 'rw' as const } }
const SANDBOX: WaypointProjectSandboxConfig = {
  backend: 'microsandbox',
  image: 'localhost/waypoint/pi-worker:slim',
  egress: { default: 'deny', allow: ['chatgpt.com'] },
  mount_path: '/work',
}

function sandboxInput(root: string, extra: Partial<PiRecipeRuntimeInput> = {}): PiRecipeRuntimeInput {
  return { routeId: 'route-1', taskId: 'task-1', recipe: 'demo', prompt: 'go', projectRoot: root, tools: ['write_file'], access: { case_work: 'rw' }, ...extra }
}

describe('preparePiSandboxedSpawn — microsandbox tier (rsc-0fx 2b)', () => {
  // RETIRED BACKEND (S1, 2026-08-27): the VM tier is fly-sprites now
  // (docs/designs/sprite-worker-isolation.md). These unit contracts of the
  // retired argv builder still run under the legacy arm — fake msb only.
  let priorRetiredArm: string | undefined
  beforeAll(() => {
    priorRetiredArm = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
  })
  afterAll(() => {
    if (priorRetiredArm === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = priorRetiredArm
  })

  it('compiles one `msb run` argv: egress deny + provider allow, brokered blob by ref, guest-coord order', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { roots: SANDBOX_ROOTS, env: baseEnv, authPath, sandbox: SANDBOX, msbCommand: '/fake/msb', piPolicy: [{ tool: 'bash' }] }
    const plan = await preparePiSandboxedSpawn(sandboxInput(root), TARGET, config)

    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // the DENY policy is forwarded into the guest work order (rsc-bhc part 3)
    expect(plan.order.piPolicy).toEqual([{ tool: 'bash' }])
    const cmdline = plan.argv.join(' ')
    // the sandbox binary is the resolved one, run non-interactively
    expect(plan.argv[0]).toBe('/fake/msb')
    expect(cmdline).toContain('run --no-tty')
    // egress: default-deny + exactly the provider host allowed
    expect(cmdline).toContain('--net-default deny')
    expect(cmdline).toContain('--net-rule allow@chatgpt.com')
    // the brokered blob is delivered BY REFERENCE (bare `--env NAME`, no value in argv)
    expect(cmdline).toContain(`--env ${BROKER_ENV}`)
    expect(cmdline).not.toContain(`${BROKER_ENV}=`)
    // the image and the guest command (order staged into the mount, redirected in).
    // buildSandboxArgv shell-quotes each argv element, so the pieces are quoted.
    expect(cmdline).toContain(SANDBOX.image)
    expect(cmdline).toContain("'node' '/opt/pi-worker/pi-worker.mjs'")
    expect(cmdline).toContain("< '/work/.waypoint/scratch/route-1/task-1/work-order.md'")
    // the order speaks GUEST coordinates: projectRoot is the mount path
    expect(plan.order.projectRoot).toBe('/work')
    expect(plan.order).toMatchObject({ provider: 'openai-codex', model: 'gpt-5.4', tools: ['write_file'], access: { case_work: 'rw' } })
    // the brokered credential rides the spawn env, never the argv
    expect(plan.spawnEnv[BROKER_ENV]).toBeDefined()
    expect(JSON.parse(plan.spawnEnv[BROKER_ENV]!)).toMatchObject({ provider: 'openai-codex' })
  })

  it('honors a custom guest entry seam', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    const config: PiJailedConfig = { roots: SANDBOX_ROOTS, env: baseEnv, authPath, sandbox: SANDBOX, msbCommand: '/fake/msb', guestEntry: '/custom/pi.mjs' }
    const plan = await preparePiSandboxedSpawn(sandboxInput(root), TARGET, config)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.argv.join(' ')).toContain("'node' '/custom/pi.mjs'")
  })

  it('refuses when the provider has no stored credential to broker', async () => {
    const root = await projectRoot()
    const authPath = await authFixture() // openai-codex only
    const config: PiJailedConfig = { roots: SANDBOX_ROOTS, env: baseEnv, authPath, sandbox: SANDBOX, msbCommand: '/fake/msb' }
    const plan = await preparePiSandboxedSpawn(sandboxInput(root), { ...TARGET, provider: 'anthropic' }, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('no stored credential to broker')
  })

  it('refuses when a root escapes the mounted case tree (unmappable to a guest mount)', async () => {
    const root = await projectRoot()
    const authPath = await authFixture()
    // an absolute root outside projectRoot has no container path — assembleSandboxMounts throws
    const config: PiJailedConfig = {
      roots: { escape: { path: '/etc', access: 'rw' } },
      env: baseEnv,
      authPath,
      sandbox: SANDBOX,
      msbCommand: '/fake/msb',
    }
    const plan = await preparePiSandboxedSpawn(sandboxInput(root, { access: { escape: 'rw' } }), TARGET, config)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('sandbox refused the pi attempt')
  })
})
