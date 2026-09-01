import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { WAYPOINT_ALLOW_RETIRED_MICROSANDBOX } from '../project/config.ts'
import { WorkerRecipeRuntime } from '../runtime/worker-runtime.ts'
import { resolveMsbCommand } from './runtime.ts'

const execFileAsync = promisify(execFile)

const previousAllow = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
beforeAll(() => {
  process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
})
afterAll(() => {
  if (previousAllow === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
  else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = previousAllow
})

/**
 * The LIVE proof (rsc-wxk): a REAL microVM, running OUR argv, through OUR
 * runtime — not a fake msb, not a mocked client.
 *
 * microsandbox is RETIRED from production dependencies. This file remains for
 * legacy boundary proof when an operator still has `msb` available
 * (`WAYPOINT_MSB_COMMAND` or a leftover local install). Otherwise every test skips
 * with a clear retired reason — the BOUNDARY IS UNPROVEN, and we say so.
 */

// Fail soft at load time: microsandbox package is retired — no binary is the
// expected default. Tests skip with a clear retired reason rather than crashing
// the suite on import.
let MSB: string
let msbResolveError: string | undefined
try {
  MSB = resolveMsbCommand(undefined, process.env)
} catch (error) {
  MSB = 'msb'
  msbResolveError = error instanceof Error ? error.message : String(error)
}
const IMAGE = process.env.WAYPOINT_MSB_TEST_IMAGE ?? 'alpine'

/**
 * Is `msb` available? Decided ONCE per file, with a retry.
 *
 * Memoized deliberately. Checked per-test, a transient failure silently skips
 * ONE test and leaves the rest green — observed 2026-07-16, when the end-to-end
 * case vanished from a run that otherwise looked clean. A boundary proof that can
 * quietly delete a random subset of itself is worse than one that is honestly
 * absent: silence reads exactly like success. All-or-nothing, and the retry keeps
 * a blip from erasing the whole file.
 */
let msbAvailability: Promise<boolean> | undefined
function msbAvailable(): Promise<boolean> {
  msbAvailability ??= (async () => {
    if (msbResolveError !== undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        `\n⚠ microsandbox live enforcement SKIPPED — retired/missing: ${msbResolveError}\n  The BOUNDARY IS UNPROVEN in this run (use fly-sprites/exe-dev for production).\n`,
      )
      return false
    }
    let last = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await execFileAsync(MSB, ['--version'], { timeout: 30_000 })
        return true
      } catch (error) {
        last = error instanceof Error ? error.message : String(error)
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1_000))
      }
    }
    // ANNOUNCE the skip. A silent one is how this file spent a whole session
    // proving nothing: `import.meta.resolve` is absent under vitest's SSR
    // transform, so resolution fell back to a PATH `msb` that did not exist, and
    // six boundary tests skipped while the run looked clean. If these are going to
    // be absent, they say so and they say why.
    // eslint-disable-next-line no-console
    console.warn(`\n⚠ microsandbox live enforcement SKIPPED — '${MSB}' did not run: ${last}\n  The BOUNDARY IS UNPROVEN in this run.\n`)
    return false
  })()
  return msbAvailability
}

/**
 * A generic project fixture: a rw tree with a ro source and a git repo.
 *
 * `git init` for real, NOT a hand-made `.git/hooks`. The earlier fixture created
 * that directory by hand and nothing else, which no real repo resembles — `git
 * init` always writes `.git/config`, a FILE. That gap hid a total functional
 * break: the mount compiler emitted `--mount-dir` for every hole, so a real vault
 * refused every dispatch ("mount-dir source is not a directory"). The fixture was
 * the reason the suite stayed green over it. Build the real thing.
 */
async function tempCase(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'msb-live-')))
  await mkdir(path.join(root, 'documents', 'inbox'), { recursive: true })
  await writeFile(path.join(root, 'documents', 'inbox', 'record.txt'), 'client record\n', 'utf8')
  await mkdir(path.join(root, 'secret-unnamed'), { recursive: true })
  await writeFile(path.join(root, 'secret-unnamed', 'other-case.txt'), 'A DIFFERENT CLIENT\n', 'utf8')

  await execFileAsync('git', ['init', '--quiet'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'worker@waypoint.local'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Waypoint Worker'], { cwd: root })
  await writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), 'ORIGINAL-HOOK\n', 'utf8')
  return root
}

const sandboxConfig = (overrides: Partial<WaypointProjectSandboxConfig> = {}): WaypointProjectSandboxConfig => ({
  backend: 'microsandbox',
  image: IMAGE,
  egress: { default: 'deny', allow: ['example.com'] },
  ...overrides,
})

/** Run a stub agent script inside a REAL microVM through the real runtime. */
function runtimeFor(
  sandbox: WaypointProjectSandboxConfig,
  script: string,
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 120_000,
) {
  return new WorkerRecipeRuntime({
    command: '/bin/sh',
    args: ['-c', script],
    roots: {
      case_work: { path: '.', access: 'rw' },
      raw_source: { path: 'documents/inbox', access: 'ro' },
    },
    sandbox,
    msbCommand: MSB,
    // The REAL host env plus the canary. msb resolves `--secret ENV@HOST`
    // against its own process env, so this is both what we validate and what we
    // spawn with — a divergence between the two is the bug this file caught.
    env: { ...process.env, ...extraEnv },
    timeoutMs,
  })
}

/**
 * Sandboxes microsandbox currently considers RUNNING.
 *
 * Tolerates a non-zero exit: `msb ls` v0.6.6 has been observed printing a correct
 * table and THEN dying with SIGSEGV. We want its stdout, not its verdict.
 */
async function runningSandboxes(): Promise<string[]> {
  let stdout = ''
  try {
    stdout = (await execFileAsync(MSB, ['ls'], { timeout: 20_000 })).stdout
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? ''
  }
  return stdout
    .split('\n')
    .filter((line) => / running\s*$| running\s/.test(line))
    .map((line) => line.split(/\s+/)[0]!)
}

const input = (projectRoot: string, extra: Record<string, unknown> = {}) => ({
  routeId: 'route-001',
  taskId: 'task-1',
  recipe: 'report-build',
  prompt: 'Build the report.',
  projectRoot,
  access: { case_work: 'rw', raw_source: 'ro' },
  ...extra,
})

/** Shell that writes a finished claim where the report contract asks for it. */
const CLAIM = `mkdir -p /work/.waypoint/claims/route-001 && printf '%s' '{"task_id":"task-1","status":"finished","summary":"REPORTED-FROM-INSIDE-THE-VM"}' > /work/.waypoint/claims/route-001/task-1.json`

describe('microsandbox live enforcement (real microVM, real argv, real runtime)', () => {
  it('runs a dispatch end-to-end and derives finished from the claim that came back through the mount', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()
    const projectRoot = await tempCase()

    // The agent proves it saw the work order, then reports.
    const output = await runtimeFor(
      sandboxConfig(),
      `grep -q "Build the report" /dev/stdin && echo SAW-THE-ORDER; ${CLAIM}`,
    ).runRecipe(input(projectRoot))

    expect(output.status, output.close_reason ?? '').toBe('finished')
    expect(output.sandboxed).toBe(true)
    expect(output.jailed).toBe(true)
    expect(output.report).toMatchObject({ status: 'finished', summary: 'REPORTED-FROM-INSIDE-THE-VM' })
    // The claim file is on the host because the mount put it there.
    expect(await readFile(path.join(projectRoot, '.waypoint', 'claims', 'route-001', 'task-1.json'), 'utf8')).toContain('REPORTED-FROM-INSIDE-THE-VM')
  }, 180_000)

  /**
   * rsc-dqj against a real kernel on the new backend. The worker plants; the
   * OPERATOR detonates — a hook written here would run on the host, unjailed,
   * next time anyone types `git commit` in the vault. Asserted against HOST
   * truth, not the guest's exit code.
   */
  it('REFUSES a .git/hooks write the access map never named, while ordinary case writes land', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()
    const projectRoot = await tempCase()

    const output = await runtimeFor(
      sandboxConfig(),
      [
        // POSITIVE CONTROL: the rw case tree must be writable, or "refused" below proves nothing.
        'if echo PROJECT-WRITE > /work/report.md 2>/dev/null; then echo CONTROL=WROTE; else echo CONTROL=FAILED; fi',
        // THE PROBE: the mandatory ro hole must refuse.
        'if echo PAYLOAD > /work/.git/hooks/pre-commit 2>/dev/null; then echo HOOK=PLANTED; else echo HOOK=REFUSED; fi',
        // And the ro source: reading is fine, writing is not.
        'if echo TAMPER > /work/documents/inbox/record.txt 2>/dev/null; then echo SOURCE=TAMPERED; else echo SOURCE=REFUSED; fi',
        CLAIM,
      ].join('; '),
    ).runRecipe(input(projectRoot))

    expect(output.stdout).toContain('CONTROL=WROTE')
    expect(output.stdout).toContain('HOOK=REFUSED')
    expect(output.stdout).toContain('SOURCE=REFUSED')

    // HOST TRUTH — the only assertion that actually matters here.
    expect(await readFile(path.join(projectRoot, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe('ORIGINAL-HOOK\n')
    expect(await readFile(path.join(projectRoot, 'documents', 'inbox', 'record.txt'), 'utf8')).toBe('client record\n')
    expect(await readFile(path.join(projectRoot, 'report.md'), 'utf8')).toContain('PROJECT-WRITE')
  }, 180_000)

  it('makes a path the access map never named INVISIBLE, not merely unwritable', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()
    const projectRoot = await tempCase()

    const output = await runtimeFor(
      sandboxConfig(),
      `if cat /work/secret-unnamed/other-case.txt 2>/dev/null; then echo OTHER_CASE=READABLE; else echo OTHER_CASE=ABSENT; fi; ${CLAIM}`,
    ).runRecipe(input(projectRoot, { access: { raw_source: 'ro' } }))

    // The seatbelt cannot do this: it leaves reads wide open. Only the mount set can.
    expect(output.stdout).toContain('OTHER_CASE=ABSENT')
    expect(output.stdout).not.toContain('A DIFFERENT CLIENT')
  }, 180_000)

  /**
   * The property the whole backend was chosen for. `nc` honors no proxy env, so
   * this is the probe srt could not survive — and it is a DATA-layer probe,
   * because a connection-level one lies in the other direction.
   */
  it('BLOCKS exfil under default-deny — by domain AND by raw IP — while the allowed host reaches', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()

    // Resolve on the HOST: the guest must not need to resolve it for the probe.
    const { stdout: dig } = await execFileAsync('dig', ['+short', 'www.google.com'])
    const exfilIp = dig.split('\n').find((line) => /^\d+\.\d+\.\d+\.\d+$/.test(line.trim()))!.trim()

    /**
     * THE TIMEOUTS ARE SYMMETRIC ON PURPOSE — do not "fix" a slow run by raising
     * one of them (rsc-u26).
     *
     * Every probe here waits the SAME budget. That is what makes the control
     * guard the assertions: if the network is ever slow enough to time out the
     * exfil probes — reporting BLOCKED for latency rather than for policy, the
     * exact false-BLOCKED trap srt fails on — then the control, given no more
     * time, fails too and the test refuses instead of passing for the wrong
     * reason. Raise the control alone and it stops guarding anything; the suite
     * goes green while proving nothing.
     *
     * (The raw-IP probe used to get 8s against the control's 10s, so a 8-10s
     * latency could false-NO_BYTES with the control none the wiser. Now equal.)
     */
    const BUDGET_S = 10
    const probe = [
      // POSITIVE CONTROL: the ALLOWED domain must reach, or every BLOCK below is meaningless.
      `if wget -q -T${BUDGET_S} -O /dev/null https://example.com 2>/dev/null; then echo ALLOWED=REACHED; else echo ALLOWED=BLOCKED; fi`,
      // Exfil by domain.
      `if wget -q -T${BUDGET_S} -O /dev/null https://www.google.com 2>/dev/null; then echo EXFIL_DOMAIN=REACHED; else echo EXFIL_DOMAIN=BLOCKED; fi`,
      // Exfil by RAW IP at the DATA layer: real bytes, or none. `nc -z` would lie here.
      `R=$(printf 'GET / HTTP/1.1\\r\\nHost: www.google.com\\r\\nConnection: close\\r\\n\\r\\n' | nc -w ${BUDGET_S} ${exfilIp} 80 2>/dev/null | head -c 40)`,
      'if [ -n "$R" ]; then echo EXFIL_RAWIP=BYTES_MOVED; else echo EXFIL_RAWIP=NO_BYTES; fi',
      CLAIM,
    ].join('; ')

    /**
     * RETRY THE MEASUREMENT, NEVER THE VERDICT (rsc-u26).
     *
     * Under full-suite load — several microVMs booting at once — the control
     * genuinely could not reach its allowed host inside the budget, and the test
     * failed. That failure was CORRECT: it refused to claim a boundary it had not
     * exercised. But a boundary test that cries wolf gets re-run on reflex and
     * then ignored, which ends in the same place as never running it.
     *
     * So: re-run the WHOLE probe until the measurement is valid, i.e. until the
     * control reaches. Each attempt is internally symmetric, and the assertions
     * below read the attempt whose control passed — a real measurement taken
     * under conditions we verified, not a stitched-together one.
     *
     * What this must never become: retrying until a probe reports BLOCKED. That
     * would manufacture the pass this whole file exists to prevent. The loop exits
     * on the CONTROL only; the exfil results are whatever that attempt found, and
     * a REACHED exfil on a valid attempt fails the test as loudly as ever.
     */
    let output!: Awaited<ReturnType<ReturnType<typeof runtimeFor>['runRecipe']>>
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      output = await runtimeFor(sandboxConfig(), probe).runRecipe(input(await tempCase()))
      if (output.stdout.includes('ALLOWED=REACHED')) break
      // eslint-disable-next-line no-console
      console.warn(`⚠ egress probe attempt ${attempt}: the ALLOWED host did not reach in ${BUDGET_S}s — remeasuring (rsc-u26)`)
    }

    expect(output.status, output.close_reason ?? '').toBe('finished')
    // The control first: without it, the two BLOCKs below could just mean "no network".
    expect(
      output.stdout,
      `the allowed host did NOT reach in ${BUDGET_S}s across 3 attempts — the probe or the network is broken, not the policy. ` +
        'Nothing below this line was measured; do not read the result as a pass.',
    ).toContain('ALLOWED=REACHED')
    expect(output.stdout).toContain('EXFIL_DOMAIN=BLOCKED')
    expect(output.stdout).toContain('EXFIL_RAWIP=NO_BYTES')
  }, 240_000)

  /**
   * Budget expiry must not leak a running microVM.
   *
   * The worry was concrete: on expiry we SIGTERM the process group and escalate
   * to SIGKILL after a grace period, and SIGKILL cannot be handled — so a VM
   * whose supervisor is killed outright could survive as orphaned compute. The
   * spike DID observe a leaked sandbox, which is what made this worth testing
   * rather than assuming.
   *
   * Measured answer (2026-07-16): it does NOT leak, and the reason is structural
   * rather than lucky. We spawn `detached: true` and kill the whole PROCESS GROUP
   * (`process.kill(-pid)`), and the microVM is msb's child inside that group — so
   * the VM dies with its supervisor whether or not msb handles the signal. Both
   * paths were probed directly:
   * - SIGTERM (what this path actually does first): msb reaps cleanly and leaves
   *   NOTHING — no running VM, no row, no `msb`/`krun` process.
   * - SIGKILL with no SIGTERM (the 2s escalation, only reachable if msb ever
   *   ignores SIGTERM — it does not): also no running VM and no orphaned process,
   *   but it does leave a `crashed` bookkeeping row (~1MB). Operational residue,
   *   not leaked compute.
   *
   * Asserted as an absence of RUNNING VMs rather than an absence of rows: rows
   * are cheap and the escalation path is not the normal one, and writing the
   * stricter assertion would make this test a claim about bookkeeping instead of
   * about the leak it exists to catch.
   *
   * The spike's leaked sandbox was a THIRD mode, and it still stands: a parent
   * that dies WITHOUT killing its group orphans msb and its VM. Our runtime never
   * does that — but a SIGKILLed bridge would, since these children are detached
   * by design. Not this test's scope; worth knowing.
   */
  it('does NOT leak a running microVM when the budget expires', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()
    const projectRoot = await tempCase()
    const before = new Set(await runningSandboxes())

    // A budget shorter than the work: boot (~275ms) then hang.
    const pending = runtimeFor(sandboxConfig(), 'sleep 300', {}, 6_000).runRecipe(input(projectRoot))

    // POSITIVE CONTROL: catch the VM actually RUNNING mid-attempt. Without this,
    // "no running VMs afterwards" is satisfied by a VM that never booted.
    let sawItRunning = false
    for (let i = 0; i < 40 && !sawItRunning; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      sawItRunning = (await runningSandboxes()).some((name) => !before.has(name))
    }

    const output = await pending
    expect(sawItRunning, 'never caught a running microVM — the probe is vacuous, not the reaping').toBe(true)
    expect(output.status).toBe('exhausted')
    expect(output.close_reason).toMatch(/exhausted: process group killed after the 6000ms budget/)

    // The assertion that matters: nothing of ours is still RUNNING.
    for (let i = 0; i < 20; i += 1) {
      if (!(await runningSandboxes()).some((name) => !before.has(name))) break
      await new Promise((r) => setTimeout(r, 500))
    }
    const leaked = (await runningSandboxes()).filter((name) => !before.has(name))
    expect(leaked, `budget expiry leaked running microVM(s): ${leaked.join(', ')}`).toEqual([])
  }, 240_000)

  /**
   * Brokering: the guest holds a placeholder, never the value. Uses a FABRICATED
   * canary — no real credential is handled here, ever.
   */
  it('keeps a brokered secret OUT of the guest entirely — placeholder only', async (ctx) => {
    if (!(await msbAvailable())) return ctx.skip()
    const projectRoot = await tempCase()

    const output = await runtimeFor(
      sandboxConfig({
        egress: { default: 'deny', allow: ['example.com'] },
        credential: { broker: [{ env_var: 'WAYPOINT_LIVE_CANARY', hosts: ['example.com'] }] },
      }),
      [
        'echo "GUEST_SEES=[$WAYPOINT_LIVE_CANARY]"',
        // Rebuild the needle at runtime: a literal here would land in this very
        // shell's /proc/self/cmdline and the probe would find its own argument.
        'N="can""ary-live-""4b7e21"',
        'if env | grep -qF "$N"; then echo ENV=LEAKED; else echo ENV=CLEAN; fi',
        // Positive control: the sweep CAN find a real value when one is present.
        'export CTRL="$N"; if env | grep -qF "$N"; then echo SWEEP=WORKS; else echo SWEEP=BROKEN; fi',
        CLAIM,
      ].join('; '),
      { WAYPOINT_LIVE_CANARY: 'canary-live-4b7e21' },
    ).runRecipe(input(projectRoot))

    expect(output.status, output.close_reason ?? '').toBe('finished')
    expect(output.stdout).toContain('GUEST_SEES=[$MSB_WAYPOINT_LIVE_CANARY]')
    expect(output.stdout).toContain('ENV=CLEAN')
    expect(output.stdout).toContain('SWEEP=WORKS')
    expect(output.stdout).not.toContain('canary-live-4b7e21')
  }, 180_000)
})
