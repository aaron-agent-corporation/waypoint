import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createWaypointProjectConfig,
  isProductionSandboxBackend,
  parseWaypointProjectConfig,
  recipeRuntimeProblem,
  RETIRED_MICROSANDBOX_MESSAGE,
  serializeWaypointProjectConfig,
  WAYPOINT_ALLOW_RETIRED_MICROSANDBOX,
} from './config.ts'

describe('Waypoint project config', () => {
  it('defaults configs without a backend section to the postgres route backend (P5)', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.backend).toEqual({ route: 'postgres' })
  })

  it("fails closed on the retired 'folder' and 'beads' route values with migrate guidance (P5)", () => {
    const parseWithRoute = (route: string) => () =>
      parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
backend:
  route: ${route}
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(parseWithRoute('folder')).toThrow("route backend is retired — run 'waypoint migrate'")
    expect(parseWithRoute('beads')).toThrow("route backend is retired — run 'waypoint migrate'")
  })

  it('round-trips the postgres route backend without changing recipe runtime config', () => {
    const config = createWaypointProjectConfig({
      quest: 'runner',
      backend: 'postgres',
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(parseWaypointProjectConfig(serializeWaypointProjectConfig(config))).toMatchObject({
      quest: 'runner',
      backend: { route: 'postgres' },
      runtime: { recipe: null },
    })
  })

  it('ignores an unknown runtime section (a retired crew block stays inert)', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: null
  crew:
    enabled: true
    city: /tmp/somewhere
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.backend).toEqual({ route: 'postgres' })
    expect(config.runtime).toEqual({ recipe: null })
  })

  it('parses named read/write roots (rsc-8ip), defaulting unknown access to ro', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: release-bundle
runtime:
  recipe: null
roots:
  case_source:
    path: .
    access: ro
  build:
    path: release-bundle-build
    access: rw
  rollup_out:
    path: reports/rollup-output
    access: bogus
  no_path:
    access: rw
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.roots).toEqual({
      case_source: { path: '.', access: 'ro' },
      build: { path: 'release-bundle-build', access: 'rw' },
      // unknown access falls back to the safe default (ro)
      rollup_out: { path: 'reports/rollup-output', access: 'ro' },
      // entries without a path are dropped
    })
  })

  it('omits roots entirely when none are declared', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.roots).toBeUndefined()
  })
  it('parses the postgres route backend with connection settings', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
backend:
  route: postgres
  postgres:
    url: postgresql://postgres:secret@localhost:5544/postgres
    schema: waypoint_case
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.backend).toEqual({
      route: 'postgres',
      postgres: { url: 'postgresql://postgres:secret@localhost:5544/postgres', schema: 'waypoint_case' },
    })
  })

  it('parses the durable engine knob only when it is literally true', () => {
    const parse = (durable: string) =>
      parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
backend:
  route: postgres
  postgres:
    durable: ${durable}
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(parse('true').backend.postgres).toEqual({ durable: true })
    expect(parse('false').backend.postgres).toBeUndefined()
    expect(parse("'yes'").backend.postgres).toBeUndefined()
  })

  it('rejects unknown route values as retired (postgres is the only backend, P5)', () => {
    expect(() =>
      parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
backend:
  route: bogus
runtime:
  recipe: null
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`),
    ).toThrow("route backend is retired — run 'waypoint migrate'")
  })

  it('parses the worker-host runtime section (P3/W4)', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
backend:
  route: postgres
  postgres:
    durable: true
runtime:
  recipe: worker
  worker:
    command: ./bin/fake-agent
    args: ['-p']
    model_args:
      high: ['--model', 'opus']
      low: ['--model', 'haiku']
    task_timeout_minutes: 45
    verify_then_apply: true
    concurrency: 4
roots:
  case_source:
    path: case
    access: ro
  shadow:
    path: shadow
    access: rw
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)

    expect(config.runtime.recipe).toBe('worker')
    expect(config.runtime.worker).toEqual({
      command: './bin/fake-agent',
      args: ['-p'],
      model_args: { high: ['--model', 'opus'], low: ['--model', 'haiku'] },
      task_timeout_minutes: 45,
      verify_then_apply: true,
      concurrency: 4,
    })
    expect(config.roots).toEqual({
      case_source: { path: 'case', access: 'ro' },
      shadow: { path: 'shadow', access: 'rw' },
    })
  })

  it('parses worker.env_allow — extra env names the worker may inherit (rsc-m8x)', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: worker
  worker:
    command: ./bin/fake-agent
    env_allow: ['CORP_INTERNAL_CA', 'ACME_REGION']
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)
    expect(config.runtime.worker?.env_allow).toEqual(['CORP_INTERNAL_CA', 'ACME_REGION'])
  })

  it('omits env_allow when absent — the built-in allowlist alone, never inheritance (rsc-m8x)', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: worker
  worker:
    command: ./bin/fake-agent
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)
    // Absent means "no EXTRA names", not "no allowlist". There is deliberately
    // no config that restores full inheritance.
    expect(config.runtime.worker?.env_allow).toBeUndefined()
  })

  it('drops a worker section without a command and non-integer concurrency', () => {
    const config = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: worker
  worker:
    args: ['-p']
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)
    expect(config.runtime.recipe).toBe('worker')
    expect(config.runtime.worker).toBeUndefined()

    const fractional = parseWaypointProjectConfig(`
schema_version: 1
enabled: true
quest: runner
runtime:
  recipe: worker
  worker:
    command: ./bin/fake-agent
    concurrency: 2.5
created_at: '2026-01-01T00:00:00.000Z'
updated_at: '2026-01-01T00:00:00.000Z'
`)
    expect(fractional.runtime.worker).toEqual({ command: './bin/fake-agent' })
  })
})

describe('recipeRuntimeProblem (Q1, docs/designs/q-quest-proving.md)', () => {
  it('flags an unset runtime with configuration guidance', () => {
    expect(recipeRuntimeProblem({ recipe: null })).toMatch(/runtime\.recipe is not configured/)
  })

  it("passes the explicit 'null' simulation opt-in", () => {
    expect(recipeRuntimeProblem({ recipe: 'null' })).toBeUndefined()
  })

  it('requires the command NOW for executable modes — not at the first dispatch', () => {
    expect(recipeRuntimeProblem({ recipe: 'worker' })).toMatch(/runtime\.worker\.command is missing/)
    expect(recipeRuntimeProblem({ recipe: 'local' })).toMatch(/runtime\.command is missing/)
    expect(recipeRuntimeProblem({ recipe: 'worker', worker: { command: './bin/fake-agent' } })).toBeUndefined()
    expect(recipeRuntimeProblem({ recipe: 'local', command: 'run-recipe.sh' })).toBeUndefined()
  })

  it('createWaypointProjectConfig threads an explicit runtime through init', () => {
    const config = createWaypointProjectConfig({
      quest: 'runner',
      runtime: { recipe: 'worker', worker: { command: './bin/fake-agent', args: ['-p'] } },
    })
    expect(config.runtime).toEqual({ recipe: 'worker', worker: { command: './bin/fake-agent', args: ['-p'] } })
    // Round-trips through serialize/parse without loss.
    const parsed = parseWaypointProjectConfig(serializeWaypointProjectConfig(config))
    expect(parsed.runtime).toEqual(config.runtime)
  })

  it('default init runtime stays UNSET — never silently simulated', () => {
    expect(createWaypointProjectConfig({ quest: 'runner' }).runtime).toEqual({ recipe: null })
  })
})

describe('runtime.sandbox config (rsc-wxk)', () => {
  // The fixtures below predate the retirement and exercise the FULL strict
  // parser through the legacy microsandbox backend; re-admit it for the
  // duration of this describe (S1: parse refuses it in production).
  const previousAllow = process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
  beforeAll(() => {
    process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
  })
  afterAll(() => {
    if (previousAllow === undefined) delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    else process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = previousAllow
  })

  it('refuses retired microsandbox for production parse (no allow env)', () => {
    delete process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX]
    try {
      expect(() =>
        parseWaypointProjectConfig(withSandbox(`  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }`)),
      ).toThrow(RETIRED_MICROSANDBOX_MESSAGE)
    } finally {
      process.env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] = '1'
    }
  })

  it('isProductionSandboxBackend admits only fly-sprites', () => {
    expect(isProductionSandboxBackend('fly-sprites')).toBe(true)
    expect(isProductionSandboxBackend('microsandbox')).toBe(false)
    expect(isProductionSandboxBackend('fake')).toBe(false)
  })

  const withSandbox = (sandboxYaml: string): string => `
schema_version: 1
enabled: true
quest: acme
backend:
  route: postgres
runtime:
  recipe: worker
  worker:
    command: ./bin/fake-agent
${sandboxYaml}
created_at: '2026-07-16T00:00:00.000Z'
updated_at: '2026-07-16T00:00:00.000Z'
`

  const VALID = `  sandbox:
    backend: microsandbox
    image: alpine
    egress:
      default: deny
      allow: [api.openai.com]
    credential:
      broker:
        - env_var: OPENAI_API_KEY
          hosts: [api.openai.com]
    mount_path: /work`

  it('parses a full sandbox block and round-trips without loss', () => {
    const config = parseWaypointProjectConfig(withSandbox(VALID))
    expect(config.runtime.sandbox).toEqual({
      backend: 'microsandbox',
      image: 'alpine',
      egress: { default: 'deny', allow: ['api.openai.com'] },
      credential: { broker: [{ env_var: 'OPENAI_API_KEY', hosts: ['api.openai.com'] }] },
      mount_path: '/work',
    })
    expect(parseWaypointProjectConfig(serializeWaypointProjectConfig(config)).runtime.sandbox).toEqual(config.runtime.sandbox)
  })

  // Multi-provider: Claude/Codex/Grok differ in credential shape and host, so
  // nothing in the config may assume one vendor.
  it('parses passthrough credentials (env names + mounted OAuth token files)', () => {
    const config = parseWaypointProjectConfig(
      withSandbox(`  sandbox:
    backend: microsandbox
    image: worker:slim
    egress:
      default: deny
      allow: [api.openai.com, statsig.openai.com]
    credential:
      passthrough:
        env: [ANTHROPIC_BASE_URL]
        files:
          - host_path: ~/.claude/.credentials.json
            mount_path: /home/node/.claude/.credentials.json`),
    )
    expect(config.runtime.sandbox?.credential).toEqual({
      passthrough: {
        env: ['ANTHROPIC_BASE_URL'],
        files: [{ host_path: '~/.claude/.credentials.json', mount_path: '/home/node/.claude/.credentials.json', access: 'ro' }],
      },
    })
  })

  it('parses several brokered secrets — one provider need not be the only one', () => {
    const config = parseWaypointProjectConfig(
      withSandbox(`  sandbox:
    backend: microsandbox
    image: alpine
    egress: { default: deny, allow: [api.openai.com, api.x.ai] }
    credential:
      broker:
        - env_var: OPENAI_API_KEY
          hosts: [api.openai.com]
        - env_var: XAI_API_KEY
          hosts: [api.x.ai]`),
    )
    expect(config.runtime.sandbox?.credential?.broker).toEqual([
      { env_var: 'OPENAI_API_KEY', hosts: ['api.openai.com'] },
      { env_var: 'XAI_API_KEY', hosts: ['api.x.ai'] },
    ])
  })

  it('leaves sandbox undefined when absent — opt-in, no behavior change when off', () => {
    const config = parseWaypointProjectConfig(withSandbox(''))
    expect(config.runtime.sandbox).toBeUndefined()
    expect(config.runtime).toEqual({ recipe: 'worker', worker: { command: './bin/fake-agent' } })
  })

  it('stores only the NAME of the credential env var — never a value', () => {
    const config = parseWaypointProjectConfig(withSandbox(VALID))
    const serialized = serializeWaypointProjectConfig(config)
    expect(config.runtime.sandbox?.credential?.broker?.[0]?.env_var).toBe('OPENAI_API_KEY')
    // The config surface has no field a real secret could be written into.
    expect(serialized).not.toMatch(/sk-/)
  })

  it('refuses an env entry that carries a value — config files get committed', () => {
    expect(() =>
      parseWaypointProjectConfig(
        withSandbox(`  sandbox:
    backend: microsandbox
    image: worker:slim
    egress: { default: deny, allow: [api.openai.com] }
    credential:
      passthrough:
        env: ['OPENAI_API_KEY=sk-ant-not-a-real-key']`),
      ),
    ).toThrow(/looks like a NAME=value pair — list NAMES only, never values/)
  })

  it('refuses a broker env_var that carries a value, for the same reason', () => {
    expect(() =>
      parseWaypointProjectConfig(
        withSandbox(`  sandbox:
    backend: microsandbox
    image: worker:slim
    egress: { default: deny, allow: [api.openai.com] }
    credential:
      broker:
        - env_var: 'OPENAI_API_KEY=sk-ant-not-a-real-key'
          hosts: [api.openai.com]`),
      ),
    ).toThrow(/looks like a NAME=value pair — name the env var only, never the value/)
  })

  // The retired backend does not silently become "no sandbox": a config naming
  // it asked for a boundary this build no longer has.
  it('refuses the retired opensandbox backend loudly, and says how to migrate', () => {
    expect(() =>
      parseWaypointProjectConfig(
        withSandbox(`  sandbox:\n    backend: opensandbox\n    server: http://localhost:8080\n    image: x\n    egress: { mode: dns+nft, default: deny }`),
      ),
    ).toThrow(/the OpenSandbox backend was removed.*replace `credential\.vault` with `credential\.broker`/s)
  })

  // The core of the strict parser: every malformed sandbox REFUSES rather than
  // degrading to "no sandbox", which would run an unjailed worker that the
  // operator believes is sandboxed.
  const refusals: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['unknown backend', `  sandbox:\n    backend: firejail\n    image: x`, /unknown backend 'firejail'/],
    ['missing image', `  sandbox:\n    backend: microsandbox\n    egress: { default: deny }`, /image is required/],
    ['missing egress', `  sandbox:\n    backend: microsandbox\n    image: x`, /egress is required/],
    ['bad egress default', `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: maybe }`, /egress\.default must be/],
    [
      'egress.allow that is not a list',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny, allow: api.openai.com }`,
      /egress\.allow must be a list of domains/,
    ],
    [
      'broker without env_var',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      broker:\n        - hosts: [api.openai.com]`,
      /credential\.broker\[\]\.env_var is required/,
    ],
    [
      'broker without hosts',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      broker:\n        - env_var: OPENAI_API_KEY`,
      /hosts is required/,
    ],
    [
      'broker with an empty hosts list — a secret with nowhere to go',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      broker:\n        - env_var: OPENAI_API_KEY\n          hosts: []`,
      /hosts is empty/,
    ],
    [
      'broker that is not a list',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      broker: { env_var: K, hosts: [h.example.com] }`,
      /credential\.broker must be a list/,
    ],
    [
      'the same env var brokered twice',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      broker:\n        - env_var: K\n          hosts: [a.example.com]\n        - env_var: K\n          hosts: [b.example.com]`,
      /names 'K' twice/,
    ],
    [
      'credential with neither broker nor passthrough',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential: {}`,
      /declares neither `broker` nor `passthrough`/,
    ],
    [
      'passthrough file with a relative mount_path',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    credential:\n      passthrough:\n        files:\n          - { host_path: ~/.claude/.credentials.json, mount_path: rel/path }`,
      /mount_path must be absolute/,
    ],
    [
      'relative mount_path',
      `  sandbox:\n    backend: microsandbox\n    image: x\n    egress: { default: deny }\n    mount_path: work`,
      /mount_path must be absolute/,
    ],
    ['sandbox is not a mapping', `  sandbox: true`, /expected a mapping/],
  ]

  for (const [name, yaml, message] of refusals) {
    it(`refuses loudly rather than silently disabling the sandbox: ${name}`, () => {
      expect(() => parseWaypointProjectConfig(withSandbox(yaml))).toThrow(message)
    })
  }
})

describe('runtime.pi_policy config (rsc-bhc part 3)', () => {
  const withPolicy = (policyYaml: string): string => `
schema_version: 1
enabled: true
quest: acme
backend:
  route: postgres
runtime:
  kind: pi
${policyYaml}
created_at: '2026-07-18T00:00:00.000Z'
updated_at: '2026-07-18T00:00:00.000Z'
`

  it('parses a deny-rule list and round-trips without loss', () => {
    const config = parseWaypointProjectConfig(
      withPolicy(`  pi_policy:
    - tool: bash
      reason: no shell in a agent quest
    - tool: write_file
      arg: content
      matches: 'api[_-]?key'
      flags: i`),
    )
    expect(config.runtime.pi_policy).toEqual([
      { tool: 'bash', reason: 'no shell in a agent quest' },
      { tool: 'write_file', arg: 'content', matches: 'api[_-]?key', flags: 'i' },
    ])
    expect(parseWaypointProjectConfig(serializeWaypointProjectConfig(config)).runtime.pi_policy).toEqual(config.runtime.pi_policy)
  })

  it('is absent when unset (no policy is the default)', () => {
    const config = parseWaypointProjectConfig(withPolicy(''))
    expect(config.runtime.pi_policy).toBeUndefined()
  })

  // A DENY rule silently dropped for a typo is fail-OPEN — a deny that does not
  // deny. So a present-but-invalid block refuses loudly, like runtime.sandbox.
  const refusals: readonly [string, string, RegExp][] = [
    ['not a list', `  pi_policy: true`, /expected a list of deny rules/],
    ['a rule with no tool', `  pi_policy:\n    - reason: oops`, /'tool' is required/],
    ['arg of the wrong type', `  pi_policy:\n    - tool: write_file\n      arg: 3`, /'arg' must be a string/],
    ['an uncompilable regex', `  pi_policy:\n    - tool: write_file\n      matches: '('`, /not a valid regex/],
  ]
  for (const [name, yaml, message] of refusals) {
    it(`refuses loudly rather than silently disabling the policy: ${name}`, () => {
      expect(() => parseWaypointProjectConfig(withPolicy(yaml))).toThrow(message)
    })
  }
})

describe('worker lanes', () => {
  const parse = (lanes: string): ReturnType<typeof parseWaypointProjectConfig> =>
    parseWaypointProjectConfig(
      `schema_version: 1\nquest: acme\nruntime:\n  recipe: worker\n  worker:\n    command: ./bin/fake-agent\n${lanes}`,
    )

  it('reads one lane per subscription, with its own credential env and models', () => {
    const config = parse(
      [
        '    lanes:',
        '      - name: claude-max-a',
        '        email: a@firm.com',
        '        env:',
        '          CLAUDE_CONFIG_DIR: /Users/x/.claude',
        '        model_args:',
        '          high: ["--model", "opus"]',
        '      - name: codex-a',
        '        command: codex',
        '        args: ["exec"]',
        '        env:',
        '          CODEX_HOME: /Users/x/.codex',
        '        model_args:',
        '          high: ["-m", "gpt-5.5"]',
      ].join('\n'),
    )
    expect(config.runtime.worker?.lanes).toEqual([
      {
        name: 'claude-max-a',
        email: 'a@firm.com',
        env: { CLAUDE_CONFIG_DIR: '/Users/x/.claude' },
        model_args: { high: ['--model', 'opus'] },
      },
      {
        name: 'codex-a',
        command: 'codex',
        args: ['exec'],
        env: { CODEX_HOME: '/Users/x/.codex' },
        model_args: { high: ['-m', 'gpt-5.5'] },
      },
    ])
  })

  it('refuses a malformed pool instead of quietly running one worker', () => {
    // A dropped lane is a subscription that stops being used while the
    // operator believes it is — and worse, one whose credential env never
    // reaches the worker, so it would run on the DEFAULT account.
    expect(() => parse('    lanes: []')).toThrow(/no lanes/)
    expect(() => parse('    lanes:\n      - command: ./bin/fake-agent')).toThrow(/'name' is required/)
    expect(() => parse('    lanes:\n      - name: a\n      - name: a')).toThrow(/duplicate name a/)
    expect(() => parse('    lanes:\n      - name: a\n        env: [nope]')).toThrow(/must be a mapping/)
    // An account you cannot name is one you cannot check when it breaks.
    expect(() => parse('    lanes:\n      - name: a\n        email: not-an-address')).toThrow(/email/)
    expect(() => parse('    lanes:\n      - name: a\n        env:\n          N: 5')).toThrow(/must be a string/)
  })

  it('leaves a pool-less project exactly as it was', () => {
    const config = parse('    concurrency: 3')
    expect(config.runtime.worker?.lanes).toBeUndefined()
    expect(config.runtime.worker?.concurrency).toBe(3)
  })
})
