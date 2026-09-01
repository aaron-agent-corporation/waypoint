import { describe, expect, it } from 'vitest'

import { buildWorkerEnv, DEFAULT_WORKER_ENV_ALLOW, droppedEnvNames } from './worker-env.ts'

/**
 * rsc-m8x. The worker used to inherit the Console's whole process.env — every
 * cloud key, GitHub token and unrelated project secret — while the seatbelt left
 * network wide open and case documents (untrusted input) went into its prompt.
 *
 * The tests that matter here are the NEGATIVE ones: they assert things are
 * ABSENT. A regression that reinstates inheritance would leave every positive
 * assertion passing, because inheritance is a superset of the allowlist.
 */

/** A host env shaped like a real supervisor's: a few essentials, a lot of loot. */
const hostEnv = (): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin',
  HOME: '/Users/operator',
  LANG: 'en_US.UTF-8',
  ANTHROPIC_API_KEY: 'sk-ant-fake-not-a-real-key',
  WAYPOINT_POSTGRES_URL: 'postgres://waypoint@localhost:5433/postgres',
  // The loot. None of this is the agent's business.
  AWS_ACCESS_KEY_ID: 'AKIAFAKE',
  AWS_SECRET_ACCESS_KEY: 'fake-aws-secret',
  GITHUB_TOKEN: 'ghp_fake',
  GH_TOKEN: 'gho_fake',
  DATABASE_URL: 'postgres://admin:hunter2@prod/db',
  STRIPE_SECRET_KEY: 'sk_live_fake',
  NODE_OPTIONS: '--require /tmp/evil.js',
  HARNESS_CLAUDE_SDK_PERMISSION_MODE: 'bypassPermissions',
})

describe('buildWorkerEnv — the allowlist (rsc-m8x)', () => {
  it('DROPS every secret the agent has no business holding', () => {
    const env = buildWorkerEnv(hostEnv())
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'DATABASE_URL', 'STRIPE_SECRET_KEY']) {
      expect(env[name], `${name} reached the worker — inheritance is back`).toBeUndefined()
    }
  })

  it('drops NODE_OPTIONS — inherited, it is arbitrary code execution in the agent', () => {
    // `NODE_OPTIONS=--require /path/x.js` preloads a module into any node process
    // the agent starts. Passing it through was handing over an injection seam for
    // free; it is not a secret, so a denylist built by scanning for key-ish names
    // would never have caught it.
    expect(buildWorkerEnv(hostEnv()).NODE_OPTIONS).toBeUndefined()
  })

  it('drops unrelated host-harness config rather than leaking our own settings', () => {
    expect(buildWorkerEnv(hostEnv()).HARNESS_CLAUDE_SDK_PERMISSION_MODE).toBeUndefined()
  })

  it('is an ALLOWLIST: an unknown name is dropped without anyone having predicted it', () => {
    const env = buildWorkerEnv({ ...hostEnv(), SOME_FUTURE_VENDOR_TOKEN: 'nobody-predicted-this' })
    expect(env.SOME_FUTURE_VENDOR_TOKEN).toBeUndefined()
  })

  it('keeps the model credential — the one secret the worker is meant to hold', () => {
    const env = buildWorkerEnv(hostEnv())
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-fake-not-a-real-key')
  })

  it('keeps process essentials, or the agent cannot run at all', () => {
    const env = buildWorkerEnv(hostEnv())
    // The provisioned runner shim dir rides in front (recipes run `runner ...`,
    // and launchd's PATH never carries the CLI); the host PATH survives after it.
    expect(env.PATH).toMatch(/\.waypoint\/bin:\/usr\/bin:\/bin$/)
    expect(env.HOME).toBe('/Users/operator')
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('does NOT leak the substrate URL into the worker — the report is a file claim (rsc-452)', () => {
    // The report seam is the file claim on every path now, so the worker has no
    // reason to reach Postgres and must not carry a write path back into gates,
    // dispatch rows, or other cases' schemas. Even with WAYPOINT_POSTGRES_URL /
    // _SCHEMA set on the host, they are withheld from the worker env.
    const env = buildWorkerEnv(hostEnv())
    expect(env.WAYPOINT_POSTGRES_URL).toBeUndefined()
    expect(env.WAYPOINT_POSTGRES_SCHEMA).toBeUndefined()
  })

  it('returns a FRESH object, never a reference into the host env', () => {
    const host = hostEnv()
    const env = buildWorkerEnv(host)
    env.PATH = '/tampered'
    expect(host.PATH, 'the worker env aliases process.env — a mutation would leak upward').toBe('/usr/bin:/bin')
  })

  it('leaves an allowlisted-but-unset name unset rather than defining it empty', () => {
    // Some tools read a defined-but-empty var as a deliberate "off" and an
    // absent one as "use your default". Copying `undefined` through would
    // silently differ from the inheritance it replaces.
    const env = buildWorkerEnv({ PATH: '/bin' })
    expect('HTTPS_PROXY' in env).toBe(false)
  })
})

describe('buildWorkerEnv — env_allow, the only escape hatch (rsc-m8x)', () => {
  it('lets a project name an extra var it genuinely needs', () => {
    const env = buildWorkerEnv({ ...hostEnv(), CORP_INTERNAL_CA: '/etc/corp.pem' }, ['CORP_INTERNAL_CA'])
    expect(env.CORP_INTERNAL_CA).toBe('/etc/corp.pem')
  })

  it('extends and never replaces the built-in list', () => {
    const env = buildWorkerEnv(hostEnv(), ['CORP_INTERNAL_CA'])
    expect(env.PATH).toMatch(/\.waypoint\/bin:\/usr\/bin:\/bin$/)
    expect(env.ANTHROPIC_API_KEY).toBeDefined()
  })

  it('grants ONLY what it names — an extra entry is not a door for its neighbours', () => {
    const env = buildWorkerEnv(hostEnv(), ['STRIPE_SECRET_KEY'])
    expect(env.STRIPE_SECRET_KEY, 'named, so granted — the operator asked for this').toBe('sk_live_fake')
    expect(env.AWS_SECRET_ACCESS_KEY, 'not named, so still dropped').toBeUndefined()
  })

  it('ignores blank entries rather than letting one widen the list', () => {
    const env = buildWorkerEnv(hostEnv(), ['', '   '])
    expect(env['']).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })
})

describe('droppedEnvNames — diagnostics, names only (rsc-m8x)', () => {
  it('reports what was withheld, so a broken dispatch can be explained', () => {
    const dropped = droppedEnvNames(hostEnv())
    expect(dropped).toContain('AWS_SECRET_ACCESS_KEY')
    expect(dropped).toContain('NODE_OPTIONS')
    expect(dropped).not.toContain('PATH')
    expect(dropped).not.toContain('ANTHROPIC_API_KEY')
  })

  it('returns NAMES ONLY — no value may ride along', () => {
    // This output is destined for evidence rows, which are durable AND get
    // re-injected into a later attempt's prompt (rsc-xam). A value here would
    // travel further than the env we just scrubbed.
    const host = hostEnv()
    const serialized = droppedEnvNames(host).join('\n')
    for (const secret of ['fake-aws-secret', 'ghp_fake', 'hunter2', 'sk_live_fake', 'sk-ant-fake-not-a-real-key']) {
      expect(serialized, `a secret VALUE leaked into diagnostics: ${secret}`).not.toContain(secret)
    }
  })
})

describe('DEFAULT_WORKER_ENV_ALLOW — the list itself', () => {
  it('is frozen: no caller may widen the allowlist at runtime', () => {
    expect(Object.isFrozen(DEFAULT_WORKER_ENV_ALLOW)).toBe(true)
  })

  it('carries no wildcard — an allowlist that can match a prefix is a denylist wearing a disguise', () => {
    for (const name of DEFAULT_WORKER_ENV_ALLOW) {
      expect(name, `'${name}' looks like a pattern`).not.toMatch(/[*?]/)
    }
  })

  it('names no credential beyond the model key', () => {
    // A guard on the list's INTENT. If someone adds e.g. GITHUB_TOKEN here
    // because one recipe wanted it, that is a decision to make in review with a
    // reason — env_allow exists for exactly that, per project, not for everyone.
    const credentialish = DEFAULT_WORKER_ENV_ALLOW.filter((name) => /token|secret|password|_key$/i.test(name))
    expect(credentialish).toEqual(['ANTHROPIC_API_KEY'])
  })
})

describe("PATH carries the agent binary's own directory", () => {
  // Seventeen attempts across two vendors died `env: node: No such file or
  // directory` (exit 127) before reading their work order: the agent CLIs are
  // shebang scripts, and under launchd the Console's PATH — faithfully copied
  // by the allowlist — has no /opt/homebrew/bin to resolve the interpreter with.
  it('appends it, so a shebang interpreter beside the binary resolves', () => {
    const env = buildWorkerEnv({ PATH: '/usr/bin:/bin' }, [], '/opt/homebrew/bin/pi')
    expect(env.PATH?.split(':')).toContain('/opt/homebrew/bin')
  })

  it('appends, never prepends: the host PATH still wins a name collision', () => {
    const env = buildWorkerEnv({ PATH: '/usr/bin:/bin' }, [], '/opt/homebrew/bin/pi')
    const parts = env.PATH?.split(':') ?? []
    expect(parts.indexOf('/opt/homebrew/bin')).toBeGreaterThan(parts.indexOf('/usr/bin'))
  })

  it('adds nothing for a bare command name — there is no directory to add', () => {
    expect(buildWorkerEnv({ PATH: '/usr/bin' }, [], 'claude').PATH?.endsWith('/usr/bin')).toBe(true)
  })

  it('does not duplicate a directory the PATH already names', () => {
    const env = buildWorkerEnv({ PATH: '/usr/bin:/opt/homebrew/bin' }, [], '/opt/homebrew/bin/pi')
    expect(env.PATH?.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
  })
})
