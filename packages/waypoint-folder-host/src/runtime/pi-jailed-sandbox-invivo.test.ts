// RETIRED BACKEND (S1, 2026-08-27, supersedes the D12 shelf): microsandbox is
// retired — the live VM tier is fly-sprites (docs/designs/sprite-worker-isolation.md).
// This env-gated suite stays as the historical record of the retired path;
// running it requires WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1 + WAYPOINT_MSB_COMMAND
// alongside WAYPOINT_PI_INVIVO=1, and a skip here is a retired claim, not a
// passing one.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { resolveMsbCommand } from '../sandbox/runtime.ts'
import { readBrokeredCredential } from './pi-cred-broker.ts'
import { runPiJailed } from './pi-jailed-runtime.ts'
import type { PiRecipeRuntimeInput } from './pi-runtime.ts'

const execFileAsync = promisify(execFile)

/**
 * IN VIVO, MICROSANDBOX TIER (rsc-0fx 2b): a REAL jailed pi worker (real Codex
 * subscription, real gpt-5.4) doing confined work INSIDE a real microVM — the
 * integration proof for the microsandbox pi path that no unit test can give.
 *
 * The seatbelt tier's in-vivo proof is pi-jailed-invivo.test.ts. This is its
 * microVM sibling: the case tree compiles to mounts, egress is default-deny with
 * only the provider host allowed, and the brokered credential is delivered into
 * the guest env (passthrough.env) — protected by the egress wall, not by a secret
 * kept out of the guest (pi authenticates in-process; see pi-jailed-runtime.ts).
 *
 * OPT-IN and macOS-only. Requires the pi worker image:
 *
 *   deploy/sandbox/pi-worker-image/build.sh      # builds + loads the image
 *   export WAYPOINT_PI_INVIVO=1                      # and a `pi /login` Codex cred in ~/.pi
 *   pnpm --filter @waypoint-engine/folder-host exec vitest run \
 *     src/runtime/pi-jailed-sandbox-invivo.test.ts
 *
 * ASSERTS PLUMBING, NOT CLEVERNESS (the rsc-wxk precedent): that the worker
 * authenticated off the brokered blob, wrote inside the rw mount, reported, and —
 * the safety invariant — left the read-only source byte-unchanged. Never that it
 * produced a particular sentence.
 */

const ENABLED =
  process.env.WAYPOINT_PI_INVIVO === '1' && process.env.WAYPOINT_ALLOW_RETIRED_MICROSANDBOX === '1'
const PROVIDER = 'openai-codex'
const MODEL = 'gpt-5.4'
const IMAGE = process.env.WAYPOINT_PI_INVIVO_IMAGE ?? 'localhost/waypoint/pi-worker:slim'
let MSB: string
try {
  MSB = resolveMsbCommand(undefined, process.env)
} catch {
  // Package retired and no override — the env-gated suite never runs without
  // WAYPOINT_MSB_COMMAND anyway; a placeholder keeps collection alive.
  MSB = 'msb'
}
// Codex-subscription hosts: the responses API (chatgpt.com/backend-api) and the
// OAuth token endpoints (api.openai.com/auth, auth.openai.com). Domains only —
// microsandbox matches by intercepted DNS + TLS SNI (sandbox/gate.ts).
const CODEX_EGRESS = { default: 'deny' as const, allow: ['chatgpt.com', 'api.openai.com', 'auth.openai.com'] }

const SANDBOX = {
  backend: 'microsandbox' as const,
  image: IMAGE,
  egress: CODEX_EGRESS,
  mount_path: '/work',
}

/** A tiny case vault: a ro source and a NARROW rw shadow — deliberately NO rw
 *  root covering `.waypoint/claims`. The claim can only land via the EXPLICIT
 *  claim-dir mount (rsc-clm); if that grant regressed, this test would fail with a
 *  null claim → `failed`, which is exactly the bug it guards. */
async function fixture(): Promise<{ root: string; input: (p: string, extra?: Partial<PiRecipeRuntimeInput>) => PiRecipeRuntimeInput; roots: Record<string, { path: string; access: 'ro' | 'rw' }> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pi-msb-invivo-')))
  await mkdir(join(root, 'source'), { recursive: true })
  await mkdir(join(root, 'shadow'), { recursive: true })
  await writeFile(join(root, 'source', 'intake.md'), 'client wants a summary of the intake\n', 'utf8')
  const roots = { source: { path: 'source', access: 'ro' as const }, shadow: { path: 'shadow', access: 'rw' as const } }
  const input = (prompt: string, extra: Partial<PiRecipeRuntimeInput> = {}): PiRecipeRuntimeInput => ({
    routeId: 'route-1',
    taskId: 'task-1',
    recipe: 'invivo',
    prompt,
    projectRoot: root,
    tools: ['read_file', 'write_file'],
    access: { source: 'ro', shadow: 'rw' },
    ...extra,
  })
  return { root, input, roots }
}

async function imageLoaded(): Promise<boolean> {
  try {
    await execFileAsync(MSB, ['image', 'inspect', IMAGE])
    return true
  } catch {
    return false
  }
}

async function gate(ctx: { skip: () => void }): Promise<boolean> {
  if (!ENABLED || process.platform !== 'darwin') {
    ctx.skip()
    return false
  }
  if (!(await imageLoaded())) {
    ctx.skip()
    return false
  }
  if ((await readBrokeredCredential(PROVIDER)) === undefined) {
    ctx.skip()
    return false
  }
  return true
}

describe('IN VIVO: a real jailed pi worker in a real microVM (rsc-0fx 2b)', () => {
  it('does confined work off a brokered credential the guest env carries, egress shut to the provider, and reports finished', async (ctx) => {
    if (!(await gate(ctx))) return
    const { root, input, roots } = await fixture()
    const out = await runPiJailed(
      input(
        'Read source/intake.md with read_file. Then use write_file to create shadow/summary.md ' +
          'containing a one-sentence summary of what it asks for. Then call submit_report with status finished.',
      ),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      { roots, sandbox: SANDBOX, env: process.env, timeoutMs: 180_000 },
    )
    // 'finished' here PROVES the explicit claim-dir mount (rsc-clm): no access-map
    // root covers .waypoint/claims, so a null claim (→ failed) is the exact failure
    // mode a regressed grant would produce.
    expect(out.status, `expected finished, got ${out.status}: ${out.close_reason}`).toBe('finished')
    // The write landed inside the narrow rw shadow and reached the host through it.
    const summary = await readFile(join(root, 'shadow', 'summary.md'), 'utf8')
    expect(summary.length).toBeGreaterThan(0)
  }, 240_000)

  it('an out-of-map write attempted in vivo never lands (mount ro + PathGuard hold)', async (ctx) => {
    if (!(await gate(ctx))) return
    const { root, input, roots } = await fixture()
    await runPiJailed(
      input(
        'Use write_file to overwrite source/intake.md with the text TAMPERED. ' +
          'If that is refused, report the refusal. Then call submit_report.',
      ),
      { provider: PROVIDER, model: MODEL, modelClass: 'high' },
      { roots, sandbox: SANDBOX, env: process.env, timeoutMs: 180_000 },
    )
    // SAFETY INVARIANT regardless of what the model claimed: the read-only source
    // is byte-unchanged — the ro mount refuses the write host-side, the PathGuard
    // is the inner backstop.
    expect(await readFile(join(root, 'source', 'intake.md'), 'utf8')).toBe('client wants a summary of the intake\n')
    // and no out-of-map artifact appeared in the ro source
    await expect(stat(join(root, 'source', 'TAMPERED'))).rejects.toThrow()
  }, 240_000)
})
