import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { realpath } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { claimHostPath } from '../sandbox/claim.ts'
import { SANDBOX_ENV } from '../sandbox/gate.ts'
import { orderHostPath } from '../sandbox/runtime.ts'
import { WAYPOINT_ALLOW_RETIRED_MICROSANDBOX } from '../project/config.ts'
import { WorkerRecipeRuntime } from './worker-runtime.ts'

// RETIRED BACKEND (S1, 2026-08-27): microsandbox left the product for
// fly-sprites (docs/designs/sprite-worker-isolation.md). These UNIT contracts
// of the retired tier (claim discipline, argv policy, fail-closed spawns) still
// run — against a fake msb, never the real one — under the legacy arm.
let priorRetiredArm: string | undefined
beforeAll(() => {
  priorRetiredArm = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
  process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
})
afterAll(() => {
  if (priorRetiredArm === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
  else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = priorRetiredArm
})

const SANDBOX: WaypointProjectSandboxConfig = {
  backend: 'microsandbox',
  image: 'alpine',
  egress: { default: 'deny', allow: ['api.anthropic.com'] },
  credential: { broker: [{ env_var: 'AGENT_KEY', hosts: ['api.anthropic.com'] }] },
}

async function tempProject(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'worker-sandbox-')))
  await mkdir(path.join(root, 'documents', 'inbox'), { recursive: true })
  return root
}

const scratchRelFor = (routeId = 'route-001', taskId = 'task-1') => path.join('.waypoint', 'scratch', routeId, taskId)

/**
 * A fake `msb`: a real executable the real spawn path really runs. It does what
 * a sandboxed agent would — record the argv it was handed, optionally write a
 * claim and artifacts into the mounted tree (which, being a bind mount, is just
 * the host project dir) — and exits.
 *
 * This is a better seam than the mocked SDK client it replaces: the argv under
 * test is the argv `buildSandboxArgv` actually produced, and the spawn under
 * test is the same `runWorkerCommand` the unsandboxed path uses. Nothing about
 * the boundary is simulated except the VM itself.
 */
async function fakeMsb(behavior: {
  projectRoot: string
  exitCode?: number
  claim?: unknown
  writeArtifacts?: Array<{ rel: string; body: string }>
  scratchRel?: string
  routeId?: string
  taskId?: string
  failToSpawn?: boolean
}): Promise<{ command: string; readArgv: () => Promise<string[]> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fake-msb-'))
  const argvLog = path.join(dir, 'argv.txt')
  if (behavior.failToSpawn) return { command: path.join(dir, 'does-not-exist'), readArgv: async () => [] }

  const lines = ['#!/bin/sh', `printf '%s\\n' "$@" > ${JSON.stringify(argvLog)}`]
  if (behavior.claim !== undefined) {
    const file = claimHostPath(behavior.projectRoot, behavior.routeId ?? 'route-001', behavior.taskId ?? 'task-1')
    const body = typeof behavior.claim === 'string' ? behavior.claim : JSON.stringify(behavior.claim)
    lines.push(`mkdir -p ${JSON.stringify(path.dirname(file))}`, `cat > ${JSON.stringify(file)} <<'CLAIM_EOF'\n${body}\nCLAIM_EOF`)
  }
  for (const artifact of behavior.writeArtifacts ?? []) {
    const target = path.join(behavior.projectRoot, behavior.scratchRel ?? '', artifact.rel)
    lines.push(`mkdir -p ${JSON.stringify(path.dirname(target))}`, `cat > ${JSON.stringify(target)} <<'ART_EOF'\n${artifact.body}\nART_EOF`)
  }
  lines.push('echo "stub stdout"', `exit ${behavior.exitCode ?? 0}`)

  const command = path.join(dir, 'msb')
  await writeFile(command, `${lines.join('\n')}\n`, 'utf8')
  await chmod(command, 0o755)
  return { command, readArgv: async () => (await readFile(argvLog, 'utf8')).split('\n').filter((l) => l !== '') }
}

const runtimeFor = (command: string, extra: Record<string, unknown> = {}) =>
  new WorkerRecipeRuntime({
    command: './bin/fake-agent',
    args: ['-p'],
    roots: { case_work: { path: '.', access: 'rw' }, raw_source: { path: 'documents/inbox', access: 'ro' } },
    sandbox: SANDBOX,
    msbCommand: command,
    // The full host env, not a bare {AGENT_KEY}: config.env is the host
    // environment as this runtime SEES it, and it is now also the env msb is
    // spawned with — so it must be able to find PATH, not just the secret.
    env: { ...process.env, AGENT_KEY: 'REAL-SECRET' },
    ...extra,
  })

const input = (projectRoot: string, extra: Record<string, unknown> = {}) => ({
  routeId: 'route-001',
  taskId: 'task-1',
  recipe: 'chronology-build',
  prompt: 'Build the chronology.',
  projectRoot,
  access: { case_work: 'rw', raw_source: 'ro' },
  ...extra,
})

describe('WorkerRecipeRuntime — the sandboxed path (rsc-wxk)', () => {
  it('derives finished from exit 0 x a finished CLAIM (no dispatch row involved)', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { task_id: 'task-1', status: 'finished', summary: 'built it' } })
    const output = await runtimeFor(command).runRecipe(input(projectRoot))

    expect(output.status).toBe('finished')
    expect(output.sandboxed).toBe(true)
    // The mount set IS the write jail here — reporting jailed:false would
    // understate the boundary that actually held.
    expect(output.jailed).toBe(true)
    expect(output.report).toEqual({ task_id: 'task-1', status: 'finished', summary: 'built it' })
    expect(output.close_reason).toBe('built it')
  })

  it('fails the attempt when the agent exits 0 but writes no claim — the report contract is still mandatory', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot })
    const output = await runtimeFor(command).runRecipe(input(projectRoot))

    expect(output.status).toBe('failed')
    expect(output.report).toBeNull()
    expect(output.close_reason).toMatch(/no report/)
  })

  it("lets exit status win over a 'finished' claim — never agent say-so (2026-05-06)", async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, exitCode: 1, claim: { status: 'finished', summary: 'all good honest' } })
    const output = await runtimeFor(command).runRecipe(input(projectRoot))

    expect(output.status).toBe('failed')
    expect(output.close_reason).toMatch(/process exited 1.*agent reported 'finished' — exit status wins/)
  })

  it("fails on a claimed 'failed' status", async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { status: 'failed', summary: 'source docs unreadable' } })
    const output = await runtimeFor(command).runRecipe(input(projectRoot))

    expect(output.status).toBe('failed')
    expect(output.close_reason).toBe("agent reported 'failed': source docs unreadable")
  })

  it('runs verify-then-apply over the mounted scratch, exactly as the host path does', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({
      projectRoot,
      claim: { status: 'finished', summary: 'chronology built' },
      writeArtifacts: [{ rel: 'chronology.md', body: '# chronology' }],
      scratchRel: scratchRelFor(),
    })
    const output = await runtimeFor(command, { verifyThenApply: true }).runRecipe(
      input(projectRoot, { outputArtifacts: ['chronology.md'] }),
    )

    expect(output.status).toBe('finished')
    expect(output.apply.mode).toBe('verify_then_apply')
    expect(output.apply.applied).toEqual(['chronology.md'])
    // .trim(): the fake's heredoc adds a trailing newline. The claim under test
    // is that the staged artifact's content reached the case tree, not the fake's
    // whitespace.
    expect((await readFile(path.join(projectRoot, 'chronology.md'), 'utf8')).trim()).toBe('# chronology')
  })

  it('rejects a finished claim whose declared artifacts are missing — nothing reaches the case tree', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'lying about the artifact' } })
    const output = await runtimeFor(command, { verifyThenApply: true }).runRecipe(
      input(projectRoot, { outputArtifacts: ['chronology.md'] }),
    )

    expect(output.status).toBe('failed')
    expect(output.close_reason).toMatch(/verify-then-apply rejected/)
    expect(output.apply.applied).toEqual([])
  })

  it('speaks SANDBOX paths in the work order, not host paths the VM has never heard of', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'ok' } })
    await runtimeFor(command).runRecipe(input(projectRoot))

    const order = await readFile(orderHostPath(path.join(projectRoot, scratchRelFor())), 'utf8')
    expect(order).toContain('Project root (all inputs and outputs): /work')
    expect(order).toContain('/work/.waypoint/claims/route-001/task-1.json')
    expect(order).toMatch(/Do NOT use `waypoint tasks report`/)
    // The host path must not leak into instructions the agent would follow.
    expect(order).not.toContain(projectRoot)
  })

  it('hands msb the real policy: default-deny, the allowlist, the mounts, and the secret by reference', async () => {
    const projectRoot = await tempProject()
    const { command, readArgv } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'ok' } })
    await runtimeFor(command).runRecipe(input(projectRoot))

    const argv = await readArgv()
    expect(argv[argv.indexOf('--net-default') + 1]).toBe('deny')
    expect(argv).toContain('allow@api.anthropic.com')
    expect(argv).toContain('AGENT_KEY@api.anthropic.com')
    expect(argv).toContain(`${projectRoot}:/work`)
    expect(argv).toContain(`${path.join(projectRoot, 'documents', 'inbox')}:/work/documents/inbox:ro`)
    // The whole point: the value stays on the host.
    expect(argv.join(' ')).not.toContain('REAL-SECRET')
  })

  it('FAILS CLOSED with no spawn when the sandbox command is missing (never an un-sandboxed fallback)', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, failToSpawn: true })
    const output = await runtimeFor(command).runRecipe(input(projectRoot))

    expect(output.status).toBe('failed')
    expect(output.sandboxed).toBe(true)
    expect(output.jailed).toBe(false)
    expect(output.close_reason).toMatch(/sandbox refused the attempt \(no spawn\): the sandbox command .* was not found/)
  })

  it('fails closed on an unjailable plan rather than sandboxing it wide open', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'ok' } })
    const output = await runtimeFor(command).runRecipe(input(projectRoot, { access: undefined }))

    expect(output.status).toBe('failed')
    expect(output.close_reason).toMatch(/sandbox refused the attempt \(no spawn\).*declares no access map/)
  })

  it('fails closed when a brokered credential is absent from the host env — never a fake key at a real API', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'ok' } })
    const output = await runtimeFor(command, { env: {} }).runRecipe(input(projectRoot))

    expect(output.status).toBe('failed')
    expect(output.close_reason).toMatch(/sandbox refused the attempt \(no spawn\).*is not set in the host environment/)
  })

  it('does NOT wrap the argv in sandbox-exec — SBPL is macOS and the VM interior is Linux', async () => {
    const projectRoot = await tempProject()
    const { command, readArgv } = await fakeMsb({ projectRoot, claim: { status: 'finished', summary: 'ok' } })
    await runtimeFor(command).runRecipe(input(projectRoot))

    const argv = await readArgv()
    expect(argv.join(' ')).not.toContain('sandbox-exec')
    expect(argv.at(-1)).toContain("'./bin/fake-agent' '-p'")
  })

  it('takes the ordinary host path when the env kill switch disables a configured sandbox', async () => {
    const projectRoot = await tempProject()
    const { command } = await fakeMsb({ projectRoot, failToSpawn: true })
    const runtime = new WorkerRecipeRuntime({
      command: 'true',
      roots: { case_work: { path: '.', access: 'rw' } },
      sandbox: SANDBOX,
      msbCommand: command, // would fail to spawn if the sandbox were used at all
      env: { ...process.env, AGENT_KEY: 'REAL-SECRET', [SANDBOX_ENV]: 'off', WAYPOINT_SEATBELT: '' },
      readReport: async () => ({ status: 'finished', summary: 'ran on the host' }),
    })
    const output = await runtime.runRecipe(input(projectRoot, { access: { case_work: 'rw' } }))

    expect(output.sandboxed).toBe(false)
    // Roots are present, so the seatbelt (the host jail) applies instead.
    expect(output.jailed).toBe(true)
    expect(output.status).toBe('finished')
  })
})
