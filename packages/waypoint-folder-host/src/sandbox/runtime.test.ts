import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { RETIRED_MICROSANDBOX_MESSAGE, WAYPOINT_ALLOW_RETIRED_MICROSANDBOX } from '../project/config.ts'
import type { SandboxMount } from './mounts.ts'
import { buildSandboxArgv, orderHostPath, prepareSandboxedRun, resolveCredentialFiles, resolveMsbCommand, SANDBOX_COMMAND_ENV } from './runtime.ts'

const SANDBOX: WaypointProjectSandboxConfig = {
  backend: 'microsandbox',
  image: 'alpine',
  egress: { default: 'deny', allow: ['api.anthropic.com'] },
  credential: { broker: [{ env_var: 'ANTHROPIC_API_KEY', hosts: ['api.anthropic.com'] }] },
}

const previousAllow = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
beforeAll(() => {
  process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
})
afterAll(() => {
  if (previousAllow === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
  else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = previousAllow
})

const MOUNTS: SandboxMount[] = [
  { hostPath: '/cases/dl', mountPath: '/work', readOnly: false, isDirectory: true },
  { hostPath: '/cases/dl/documents/inbox', mountPath: '/work/documents/inbox', readOnly: true, isDirectory: true },
]

const build = (overrides: Partial<Parameters<typeof buildSandboxArgv>[0]> = {}) =>
  buildSandboxArgv({
    sandbox: SANDBOX,
    argv: ['claude', '-p', '--dangerously-skip-permissions'],
    mounts: MOUNTS,
    mountPath: '/work',
    orderSandboxPath: '/work/.waypoint/scratch/r/t/work-order.md',
    env: { ANTHROPIC_API_KEY: 'real-value-never-in-argv' },
    msbCommand: 'msb',
    ...overrides,
  })

describe('buildSandboxArgv (rsc-wxk) — the policy compiled to msb argv', () => {
  it('emits default-deny plus the domain allowlist', () => {
    const argv = build()
    expect(argv.slice(0, 3)).toEqual(['msb', 'run', '--no-tty'])
    expect(argv[argv.indexOf('--net-default') + 1]).toBe('deny')
    expect(argv[argv.indexOf('--net-rule') + 1]).toBe('allow@api.anthropic.com')
  })

  it('ALWAYS emits --net-default explicitly, never relying on the tool default', () => {
    // microsandbox's own default is ALLOW. An omitted flag would silently be the
    // exact opposite of the boundary the config asked for.
    expect(build()).toContain('--net-default')
  })

  it('emits one --net-rule per allowed domain', () => {
    const argv = build({ sandbox: { ...SANDBOX, egress: { default: 'deny', allow: ['api.anthropic.com', 'api.x.ai'] } } })
    const rules = argv.filter((_, i) => argv[i - 1] === '--net-rule')
    expect(rules).toEqual(['allow@api.anthropic.com', 'allow@api.x.ai'])
  })

  it('brokers the secret BY REFERENCE — the real value never enters argv', () => {
    const argv = build()
    expect(argv[argv.indexOf('--secret') + 1]).toBe('ANTHROPIC_API_KEY@api.anthropic.com')
    // The property the backend was chosen for. argv is world-readable via `ps`;
    // a value here would be CVE-2026-61670 rebuilt by hand.
    expect(argv.join(' ')).not.toContain('real-value-never-in-argv')
  })

  it('emits one --secret per bound host', () => {
    const argv = build({
      sandbox: {
        ...SANDBOX,
        egress: { default: 'deny', allow: ['a.example.com', 'b.example.com'] },
        credential: { broker: [{ env_var: 'ANTHROPIC_API_KEY', hosts: ['a.example.com', 'b.example.com'] }] },
      },
    })
    const secrets = argv.filter((_, i) => argv[i - 1] === '--secret')
    expect(secrets).toEqual(['ANTHROPIC_API_KEY@a.example.com', 'ANTHROPIC_API_KEY@b.example.com'])
  })

  it('pins the secret-violation action to block-and-terminate, never passthrough', () => {
    // msb also accepts `passthrough`, which sends the secret anyway. No config
    // may select it — an option whose only effect is to defeat brokering.
    expect(build()[build().indexOf('--on-secret-violation') + 1]).toBe('block-and-terminate')
  })

  it('omits --on-secret-violation when nothing is brokered', () => {
    expect(build({ sandbox: { ...SANDBOX, credential: undefined } })).not.toContain('--on-secret-violation')
  })

  it('FAILS CLOSED when a brokered env var is unset on the host', () => {
    expect(() => build({ env: {} })).toThrow(/is not set in the host environment/)
  })

  it('passes passthrough env BY REFERENCE (bare --env NAME), never NAME=value', () => {
    const argv = build({
      sandbox: { ...SANDBOX, credential: { passthrough: { env: ['XAI_API_KEY'] } } },
      env: { XAI_API_KEY: 'secret-value-77' },
    })
    expect(argv[argv.indexOf('--env') + 1]).toBe('XAI_API_KEY')
    // --env NAME=value would put the secret in msb's own command line, readable
    // by any `ps` on the host.
    expect(argv.join(' ')).not.toContain('secret-value-77')
  })

  it('FAILS CLOSED when a passthrough env var is unset on the host', () => {
    expect(() => build({ sandbox: { ...SANDBOX, credential: { passthrough: { env: ['XAI_API_KEY'] } } }, env: {} })).toThrow(
      /is not set in the host environment/,
    )
  })

  it('renders the mounts, ro included', () => {
    const argv = build()
    expect(argv).toContain('/cases/dl:/work')
    expect(argv).toContain('/cases/dl/documents/inbox:/work/documents/inbox:ro')
  })

  it('mounts credential files AFTER the case tree so a case mount cannot shadow them', () => {
    const argv = build({
      credentialFiles: [
        { hostPath: '/Users/x/.claude/.credentials.json', mountPath: '/home/node/.claude/.credentials.json', readOnly: true, isDirectory: false },
      ],
    })
    const caseMount = argv.indexOf('/cases/dl:/work')
    const credential = argv.indexOf('/Users/x/.claude/.credentials.json:/home/node/.claude/.credentials.json:ro')
    expect(credential).toBeGreaterThan(caseMount)
    expect(argv[credential - 1]).toBe('--mount-file')
  })

  it('uses --mount-dir for a credential DIRECTORY and --mount-file for a file', () => {
    const argv = build({
      credentialFiles: [{ hostPath: '/Users/x/.codex', mountPath: '/home/node/.codex', readOnly: false, isDirectory: true }],
    })
    expect(argv[argv.indexOf('/Users/x/.codex:/home/node/.codex') - 1]).toBe('--mount-dir')
  })

  it('redirects the staged order onto the agent stdin, quoted', () => {
    const argv = build()
    expect(argv.at(-3)).toBe('/bin/sh')
    expect(argv.at(-2)).toBe('-lc')
    expect(argv.at(-1)).toBe("'claude' '-p' '--dangerously-skip-permissions' < '/work/.waypoint/scratch/r/t/work-order.md'")
  })

  it('quotes an agent argv containing a single quote rather than breaking out of the shell string', () => {
    expect(build({ argv: ["ag'ent", '-p'] }).at(-1)).toContain(`'ag'\\''ent'`)
  })

  it('sets the workdir to the mount path and names the image before the command', () => {
    const argv = build()
    expect(argv[argv.indexOf('--workdir') + 1]).toBe('/work')
    expect(argv[argv.indexOf('alpine') + 1]).toBe('--')
  })

  it('takes the msb command from the env seam when not passed explicitly', () => {
    const argv = buildSandboxArgv({
      sandbox: { ...SANDBOX, credential: undefined },
      argv: ['claude'],
      mounts: MOUNTS,
      mountPath: '/work',
      orderSandboxPath: '/work/order.md',
      env: { [SANDBOX_COMMAND_ENV]: '/opt/msb' },
    })
    expect(argv[0]).toBe('/opt/msb')
  })
})

/**
 * Legacy msb resolution. The microsandbox package is retired from production
 * dependencies — without an explicit / env override, resolve fails closed.
 */
describe('resolveMsbCommand — retired package', () => {
  it('fails closed with a clear retired/missing error when the package is gone', () => {
    expect(() => resolveMsbCommand(undefined, {})).toThrow(/retired|not installed/i)
  })

  it('lets the operator override (bring-up, or a different build)', () => {
    expect(resolveMsbCommand(undefined, { [SANDBOX_COMMAND_ENV]: '/opt/msb' })).toBe('/opt/msb')
  })

  it('lets an explicit argument beat the env — the test seam wins', () => {
    expect(resolveMsbCommand('/x/msb', { [SANDBOX_COMMAND_ENV]: '/opt/msb' })).toBe('/x/msb')
  })

  it('refuses microsandbox argv without the retired allow env', () => {
    const previous = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    try {
      expect(() =>
        buildSandboxArgv({
          sandbox: SANDBOX,
          argv: ['claude'],
          mounts: MOUNTS,
          mountPath: '/work',
          orderSandboxPath: '/work/order.md',
          env: { ANTHROPIC_API_KEY: 'x' },
          msbCommand: 'msb',
        }),
      ).toThrow(RETIRED_MICROSANDBOX_MESSAGE)
    } finally {
      if (previous === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
      else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = previous
    }
  })
})

describe('resolveCredentialFiles', () => {
  it('FAILS CLOSED on a host path that does not exist', async () => {
    await expect(
      resolveCredentialFiles({ ...SANDBOX, credential: { passthrough: { files: [{ host_path: '/nope/missing.json', mount_path: '/m' }] } } }),
    ).rejects.toThrow(/does not exist/)
  })

  it('FAILS CLOSED on a relative host path', async () => {
    await expect(
      resolveCredentialFiles({ ...SANDBOX, credential: { passthrough: { files: [{ host_path: 'relative.json', mount_path: '/m' }] } } }),
    ).rejects.toThrow(/is not absolute/)
  })

  it('marks a directory so the caller mounts it with --mount-dir, read-only by default', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cred-'))
    const resolved = await resolveCredentialFiles({
      ...SANDBOX,
      credential: { passthrough: { files: [{ host_path: dir, mount_path: '/home/node/.codex' }] } },
    })
    expect(resolved[0]).toMatchObject({ isDirectory: true, readOnly: true })
  })

  it('honors an explicit rw (a CLI that must persist a token refresh)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cred-'))
    const file = path.join(dir, 'auth.json')
    await writeFile(file, '{}', 'utf8')
    const resolved = await resolveCredentialFiles({
      ...SANDBOX,
      credential: { passthrough: { files: [{ host_path: file, mount_path: '/m/auth.json', access: 'rw' }] } },
    })
    expect(resolved[0]).toMatchObject({ isDirectory: false, readOnly: false })
  })
})

describe('prepareSandboxedRun — staging', () => {
  it('stages the work order on the host inside the scratch dir and points the guest at it', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'msb-prep-'))
    const scratchDir = path.join(projectRoot, '.waypoint', 'scratch', 'r', 't')

    const prepared = await prepareSandboxedRun({
      sandbox: { ...SANDBOX, credential: undefined },
      argv: ['claude', '-p'],
      workOrder: 'THE WORK ORDER BODY',
      projectRoot,
      roots: { case_work: { path: '.', access: 'rw' } },
      access: { case_work: 'rw' },
      scratchDir,
      claimDir: path.join(projectRoot, '.waypoint', 'claims', 'r'),
      env: {},
      msbCommand: 'msb',
    })

    // Written on the HOST — the mount is what makes it visible inside, so there
    // is no second code path for getting bytes into the guest.
    expect(await readFile(orderHostPath(scratchDir), 'utf8')).toBe('THE WORK ORDER BODY')
    expect(prepared.argv.at(-1)).toContain("< '/work/.waypoint/scratch/r/t/work-order.md'")
  })

  it('refuses BEFORE staging anything when the access map is unjailable', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'msb-prep-'))
    const scratchDir = path.join(projectRoot, 'scratch')
    await expect(
      prepareSandboxedRun({
        sandbox: { ...SANDBOX, credential: undefined },
        argv: ['claude'],
        workOrder: 'x',
        projectRoot,
        roots: { case_work: { path: '.', access: 'ro' } },
        access: { case_work: 'rw' }, // escalation
        scratchDir,
        claimDir: path.join(projectRoot, '.waypoint', 'claims', 'r'),
        env: {},
      }),
    ).rejects.toThrow(/escalation refused/)
    // An unjailable attempt costs nothing: no order file was written.
    await expect(readFile(orderHostPath(scratchDir), 'utf8')).rejects.toThrow()
  })
})
