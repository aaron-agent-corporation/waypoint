import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
 * THE IN-VIVO RUN (rsc-wxk): a REAL agent, in a REAL microVM, through OUR
 * runtime, doing REAL work, with its credential NEVER inside the guest.
 *
 * microsandbox is RETIRED — this file is legacy opt-in proof only. Set
 * WAYPOINT_MSB_INVIVO=1 and WAYPOINT_MSB_COMMAND (or a leftover msb install).
 */

let MSB: string
try {
  MSB = resolveMsbCommand(undefined, process.env)
} catch {
  MSB = 'msb'
}
// Host-qualified (rsc-zai): unqualified, this named docker.io/waypoint/worker
// — an unclaimed namespace msb would auto-pull from on a cache miss.
const IMAGE = process.env.WAYPOINT_MSB_INVIVO_IMAGE ?? 'localhost/waypoint/worker:slim'
const ENABLED = process.env.WAYPOINT_MSB_INVIVO === '1'
// Existence only. This test NEVER reads the value — that is the whole point.
const HAS_KEY = (process.env.ANTHROPIC_API_KEY ?? '').trim() !== ''

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

/** A tiny case vault with a seeded bug, a git repo, and a committed baseline. */
async function seededCase(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'msb-invivo-')))
  await mkdir(path.join(root, 'documents', 'inbox'), { recursive: true })
  await writeFile(path.join(root, 'documents', 'inbox', 'note.txt'), 'source material, read-only\n', 'utf8')

  // The seeded bug: an off-by-one a real agent can find and fix.
  await writeFile(
    path.join(root, 'total.js'),
    ['function total(items) {', '  let sum = 0', '  for (let i = 0; i < items.length - 1; i += 1) sum += items[i]', '  return sum', '}', 'module.exports = { total }', ''].join('\n'),
    'utf8',
  )

  await git(root, 'init', '--quiet')
  // Identity must be seeded HOST-side: .git/config is a mandatory ro hole
  // (rsc-dqj), so the agent cannot set it from inside — which is the point.
  await git(root, 'config', 'user.email', 'worker@waypoint.local')
  await git(root, 'config', 'user.name', 'Waypoint Worker')
  await git(root, 'add', '-A')
  await git(root, 'commit', '--quiet', '-m', 'baseline')
  return root
}

describe('IN VIVO: a real agent in a real microVM (rsc-wxk)', () => {
  it('authenticates through a brokered key it never holds, does real work, commits, and reports — with egress shut', async (ctx) => {
    if (!ENABLED) return ctx.skip()
    if (!HAS_KEY) return ctx.skip()

    const projectRoot = await seededCase()
    const baselineCommit = (await git(projectRoot, 'rev-parse', 'HEAD')).trim()

    const runtime = new WorkerRecipeRuntime({
      command: 'claude',
      args: ['-p', '--dangerously-skip-permissions'],
      roots: {
        case_work: { path: '.', access: 'rw' },
        raw_source: { path: 'documents/inbox', access: 'ro' },
      },
      sandbox: {
        backend: 'microsandbox',
        image: IMAGE,
        // The real policy: the provider and nothing else.
        egress: { default: 'deny', allow: ['api.anthropic.com', 'statsig.anthropic.com'] },
        // The key is read from the host env BY REFERENCE and substituted at the
        // network boundary. The guest gets `$MSB_ANTHROPIC_API_KEY`.
        credential: { broker: [{ env_var: 'ANTHROPIC_API_KEY', hosts: ['api.anthropic.com'] }] },
      },
      msbCommand: MSB,
      env: process.env,
      timeoutMs: 10 * 60 * 1000,
    })

    const output = await runtime.runRecipe({
      routeId: 'route-001',
      taskId: 'task-1',
      recipe: 'bug-fix',
      prompt: [
        'The function in total.js has an off-by-one bug: it skips the last item.',
        'Fix it, then commit the fix with `git commit`.',
        'Do not change anything else.',
      ].join(' '),
      projectRoot,
      access: { case_work: 'rw', raw_source: 'ro' },
    })

    // 1. The agent ran and reported. If auth had failed, this is where it shows.
    expect(output.status, `close_reason: ${output.close_reason}\nstderr: ${output.stderr.slice(0, 2000)}`).toBe('finished')
    expect(output.sandboxed).toBe(true)
    expect(output.jailed).toBe(true)
    expect(output.report).toMatchObject({ status: 'finished' })

    // 2. REAL WORK, verified by git — not by the agent's say-so (2026-05-06).
    const head = (await git(projectRoot, 'rev-parse', 'HEAD')).trim()
    expect(head, 'no new commit — the agent claimed a fix it did not commit').not.toBe(baselineCommit)
    const fixed = await readFile(path.join(projectRoot, 'total.js'), 'utf8')
    expect(fixed).not.toContain('items.length - 1')

    // 3. The credential never entered the guest. The agent authenticated with a
    //    placeholder it could not read — proven by the fact that it worked at all,
    //    and that the real value appears in nothing the run produced.
    const real = process.env.ANTHROPIC_API_KEY!
    expect(output.stdout).not.toContain(real)
    expect(output.stderr).not.toContain(real)
    expect(await readFile(path.join(projectRoot, '.waypoint', 'claims', 'route-001', 'task-1.json'), 'utf8')).not.toContain(real)

    // 4. Ownership across virtiofs: the agent runs as uid 1000 in the guest, but
    //    the case file must land on the host owned by the OPERATOR. A file owned
    //    by a stray uid would be a real defect — the operator could not edit their
    //    own case.
    const owner = (await stat(path.join(projectRoot, 'total.js'))).uid
    expect(owner, 'the agent write landed on the host owned by a foreign uid').toBe(process.getuid!())

    // 5. The mandatory ro hole held against a REAL agent with a real shell.
    expect(await readFile(path.join(projectRoot, 'documents', 'inbox', 'note.txt'), 'utf8')).toBe('source material, read-only\n')

    // WITNESS. "The test went green" is not evidence; the run's artifacts are.
    // The W5 precedent is an operator-witnessed run, so print what an operator
    // would need to see to believe it — the commit the agent actually made, its
    // diff, and the claim it filed — rather than asking anyone to trust a tick.
    const log = [
      '',
      '─── IN-VIVO EVIDENCE ───────────────────────────────────',
      `vault:        ${projectRoot}`,
      `baseline:     ${baselineCommit.slice(0, 12)}`,
      `agent commit: ${(await git(projectRoot, 'log', '-1', '--format=%h %an <%ae> — %s')).trim()}`,
      `file owner:   uid ${owner} (operator uid ${process.getuid!()})`,
      '',
      (await git(projectRoot, 'show', '--stat', '--format=', 'HEAD')).trim(),
      '',
      (await git(projectRoot, 'diff', `${baselineCommit}..HEAD`, '--', 'total.js')).trim(),
      '',
      `claim: ${(await readFile(path.join(projectRoot, '.waypoint', 'claims', 'route-001', 'task-1.json'), 'utf8')).trim()}`,
      '────────────────────────────────────────────────────────',
    ].join('\n')
    // eslint-disable-next-line no-console
    console.log(log)
  }, 15 * 60 * 1000)
})
