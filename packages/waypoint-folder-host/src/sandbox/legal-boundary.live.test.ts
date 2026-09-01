// RETIRED BACKEND (S1, 2026-08-27, supersedes the D12 shelf): microsandbox is
// retired — the live VM tier is the fly-sprites backend now
// (docs/designs/sprite-worker-isolation.md). This env-gated suite stays as the
// historical legal-boundary record for the retired path; running it requires
// WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1 plus WAYPOINT_MSB_COMMAND, and a skip here
// is a retired claim, not a passing one.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { WorkerRecipeRuntime } from '../runtime/worker-runtime.ts'
import { resolveMsbCommand } from './runtime.ts'

const execFileAsync = promisify(execFile)
let MSB: string
try {
  MSB = resolveMsbCommand(undefined, process.env)
} catch {
  // Package retired and no override — the env-gated suite below never runs
  // without WAYPOINT_MSB_COMMAND anyway; a placeholder keeps collection alive.
  MSB = 'msb'
}
const IMAGE = process.env.WAYPOINT_MSB_TEST_IMAGE ?? 'alpine'

const CLAIM = `mkdir -p /work/.waypoint/claims/route-legal-live-001 && printf '%s' '{"task_id":"task-legal-live-001","status":"finished","summary":"LEGAL-LIVE-PROFILE-COMPLETE"}' > /work/.waypoint/claims/route-legal-live-001/task-legal-live-001.json`

describe('Phase 1 legal boundary (real microsandbox, non-skipping once armed)', () => {
  it('V_SAFE_LIVE_RED requires the real runtime, positive control, and every named denial probe', async (ctx) => {
    // Retired backend (S1): this boundary proof only runs when the operator
    // explicitly re-arms the legacy path. Once armed it keeps its original
    // non-skipping contract — a missing runtime is a RED failure, not a skip.
    if (process.env.WAYPOINT_ALLOW_RETIRED_MICROSANDBOX !== '1') return ctx.skip()
    let version
    try {
      version = (await execFileAsync(MSB, ['--version'], { timeout: 30_000 })).stdout.trim()
    } catch (error) {
      throw new Error(`V_SAFE_LIVE_RED: required product-resolved microsandbox runtime did not execute: ${error instanceof Error ? error.message : String(error)}`)
    }
    expect(version).toMatch(/(?:msb|microsandbox).*0\.6\.6/i)

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'phase-one-legal-live-'))
    const outputRoot = path.join(projectRoot, 'assignment-output')
    const publicRoot = path.join(projectRoot, 'public-law')
    const matterRoot = path.join(projectRoot, 'matter-a')
    const otherMatterRoot = path.join(projectRoot, 'matter-b')
    const unapprovedTools = path.join(projectRoot, 'unapproved-tools')
    await Promise.all([
      mkdir(outputRoot, { recursive: true }),
      mkdir(publicRoot, { recursive: true }),
      mkdir(matterRoot, { recursive: true }),
      mkdir(otherMatterRoot, { recursive: true }),
      mkdir(unapprovedTools, { recursive: true }),
    ])
    await writeFile(path.join(publicRoot, 'authorized.bin'), 'phase-one-authorized-public-law\n', 'utf8')
    await writeFile(path.join(matterRoot, 'record.txt'), 'synthetic matter A record\n', 'utf8')
    await writeFile(path.join(otherMatterRoot, 'record.txt'), 'synthetic matter B canary\n', 'utf8')
    await writeFile(path.join(unapprovedTools, 'courtlistener'), 'unapproved tool canary\n', 'utf8')
    await writeFile(path.join(unapprovedTools, 'shell'), 'unapproved shell canary\n', 'utf8')
    await symlink(otherMatterRoot, path.join(projectRoot, 'matter-a-link'))

    const probe = [
      "if [ \"$(cat /work/public-law/authorized.bin 2>/dev/null)\" = 'phase-one-authorized-public-law' ]; then echo POSITIVE=EXACT; else echo POSITIVE=FAILED; fi",
      "if cat /work/matter-b/record.txt >/dev/null 2>&1; then echo CROSS_MATTER=READABLE; else echo CROSS_MATTER=DENIED; fi",
      "if printf TAMPER > /work/public-law/authorized.bin 2>/dev/null; then echo WRITE=LANDED; else echo WRITE=DENIED; fi",
      "if cat /work/unapproved-tools/courtlistener >/dev/null 2>&1; then echo TOOL=AVAILABLE; else echo TOOL=DENIED; fi",
      "if cat /work/unapproved-tools/shell >/dev/null 2>&1; then echo SHELL_TOOL=AVAILABLE; else echo SHELL_TOOL=DENIED; fi",
      "if env | grep -q 'PHASE_ONE_CREDENTIAL_CANARY'; then echo CREDENTIAL=VISIBLE; else echo CREDENTIAL=DENIED; fi",
      "if wget -q -T3 -O /tmp/egress.out https://example.com 2>/dev/null && [ -s /tmp/egress.out ]; then echo EGRESS=BYTES; else echo EGRESS=DENIED; fi",
      "if cat /work/public-law/../matter-b/record.txt >/dev/null 2>&1; then echo TRAVERSAL=READABLE; else echo TRAVERSAL=DENIED; fi",
      `if cat ${JSON.stringify(path.join(otherMatterRoot, 'record.txt'))} >/dev/null 2>&1; then echo ABSOLUTE=READABLE; else echo ABSOLUTE=DENIED; fi`,
      "if cat /work/matter-a-link/record.txt >/dev/null 2>&1; then echo SYMLINK=READABLE; else echo SYMLINK=DENIED; fi",
      "if cat /work/matter-record-999/record.txt >/dev/null 2>&1; then echo MOUNT_ALIAS=READABLE; else echo MOUNT_ALIAS=DENIED; fi",
      'printf WORKER-SIDE-EFFECT > /work/assignment-output/permitted.txt',
      CLAIM,
    ].join('; ')

    const runtime = new WorkerRecipeRuntime({
      command: '/bin/sh',
      args: ['-c', probe],
      roots: {
        assignment_output: { path: 'assignment-output', access: 'rw' },
        public_law: { path: 'public-law', access: 'ro' },
        matter_record: { path: 'matter-a', access: 'ro' },
      },
      sandbox: {
        backend: 'microsandbox',
        image: IMAGE,
        egress: { default: 'deny', allow: [] },
      },
      msbCommand: MSB,
      env: { ...process.env, PHASE_ONE_CREDENTIAL_CANARY: 'synthetic-secret-never-serialized' },
      timeoutMs: 120_000,
    })
    const result = await runtime.runRecipe({
      routeId: 'route-legal-live-001',
      taskId: 'task-legal-live-001',
      recipe: 'phase-one-legal-live-profile',
      prompt: 'Execute the fixed synthetic Phase 1 boundary profile.',
      projectRoot,
      access: {
        assignment_output: 'rw',
        public_law: 'ro',
        matter_record: 'ro',
      },
    })

    expect(result.status, result.close_reason ?? '').toBe('finished')
    expect(result.sandboxed).toBe(true)
    expect(result.jailed).toBe(true)
    expect(result.report).toMatchObject({ status: 'finished', summary: 'LEGAL-LIVE-PROFILE-COMPLETE' })
    expect(result.stdout).toContain('POSITIVE=EXACT')
    for (const marker of [
      'CROSS_MATTER=DENIED',
      'WRITE=DENIED',
      'TOOL=DENIED',
      'SHELL_TOOL=DENIED',
      'CREDENTIAL=DENIED',
      'EGRESS=DENIED',
      'TRAVERSAL=DENIED',
      'ABSOLUTE=DENIED',
      'SYMLINK=DENIED',
      'MOUNT_ALIAS=DENIED',
    ]) {
      expect(result.stdout, `missing non-skipping live probe marker ${marker}`).toContain(marker)
    }
    expect(result.stdout).not.toContain('synthetic-secret-never-serialized')
    expect(await readFile(path.join(publicRoot, 'authorized.bin'), 'utf8')).toBe('phase-one-authorized-public-law\n')
    expect(await readFile(path.join(otherMatterRoot, 'record.txt'), 'utf8')).toBe('synthetic matter B canary\n')
    expect(await readFile(path.join(outputRoot, 'permitted.txt'), 'utf8')).toBe('WORKER-SIDE-EFFECT')
  }, 180_000)
})
