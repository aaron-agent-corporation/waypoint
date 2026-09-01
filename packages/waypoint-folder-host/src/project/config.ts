import { readFile } from 'node:fs/promises'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { type ModelTargets, parseModelTargets } from '../runtime/model-routing.ts'
import { retiredWorkerHarnessProblem } from '../runtime/cordis-only.ts'

/**
 * Q1 (docs/designs/q-quest-proving.md): the explicit string `'null'` and an
 * unset `recipe` are DIFFERENT states. `'null'` is a deliberate opt-in to
 * simulated recipe execution (outcomes recorded `simulated`); unset means
 * the project cannot execute recipe plans — starting a recipe-bearing quest
 * refuses, and a bridge never claims recipe dispatches for it.
 */
export type WaypointRecipeRuntimeMode = 'null' | 'local' | 'worker'
/**
 * Postgres is the only route backend (P5, docs/designs/p5-folder-retirement.md).
 * Retired values in existing configs ('folder', 'beads') fail closed at parse
 * time with `waypoint migrate` guidance — never silently pointed at an empty
 * schema.
 */
export type WaypointRouteBackendMode = 'postgres'

/**
 * Postgres route backend (P1 of the pg_durable substrate track,
 * docs/spikes/pg-durable-substrate/DESIGN.md): run state persists to
 * Postgres tables instead of `.waypoint/` YAML/JSONL. Same execution
 * semantics as the folder backend — only the persistence layer moves.
 * `url`/`schema` can be overridden by WAYPOINT_POSTGRES_URL / WAYPOINT_POSTGRES_SCHEMA.
 */
export interface WaypointPostgresBackendConfig {
  readonly url?: string
  readonly schema?: string
  /**
   * P2 (docs/designs/p2-waypoint-on-pgdurable.md, B2): route execution is driven
   * by the pg_durable engine — `waypoint start` compiles the quest scaffold to a
   * df graph and calls `df.start`. P1 tables without the engine remain valid
   * (durable absent/false) — that is the fallback and the migration path.
   */
  readonly durable?: boolean
}

export interface WaypointProjectBackendConfig {
  readonly route: WaypointRouteBackendMode
  readonly postgres?: WaypointPostgresBackendConfig
}

export interface WaypointProjectRuntimeConfig {
  readonly recipe: WaypointRecipeRuntimeMode | null
  readonly command?: string
  readonly args?: readonly string[]
  readonly worker?: WaypointProjectWorkerRuntimeConfig
  /**
   * Provider-agnostic model routing (rsc-bpg phase 2): capability class ->
   * {provider, model}, resolved against the user's provider registry
   * (~/.waypoint/config.yaml). Supersedes the Claude-only
   * `worker.model_args` as the runtime pivots to multi-provider (runtime/
   * model-routing.ts). Absent = fall back to `model_args`.
   */
  readonly model_targets?: ModelTargets
  /** microsandbox egress + credential layer (rsc-wxk). Opt-in per project. */
  readonly sandbox?: WaypointProjectSandboxConfig
  /**
   * Defense-in-depth DENY rules for a `runtime.kind: pi` worker's granted tools
   * (rsc-bhc part 3). The pi loop's `beforeToolCall` seam consults these AFTER a
   * granted tool's args validate and BEFORE it runs; a matching rule blocks the
   * call. This governs the tools a recipe already holds — least privilege (only
   * granted tools are registered) is upstream of it, and the access-map fs jail
   * confines paths beneath it. Its unique reach is ARG CONTENT: it can deny a
   * granted `write_file` whose `content` matches a secret pattern, which the
   * path-level access map cannot express.
   *
   * DENY-list only, ALLOW by default. There is no ASK: a headless jailed worker
   * has no interactive approver at the tool loop (the pi contract has no ask
   * verdict either), and human-decision points in this system are GATES, not
   * per-tool-call prompts. A policy that needs a human belongs in a gate.
   */
  readonly pi_policy?: readonly WaypointProjectPiPolicyRule[]
}

/**
 * One DENY rule for a pi worker's granted tools (rsc-bhc part 3). A tool call is
 * blocked when a rule's `tool` matches (by name, or `*` for any granted tool) AND
 * its condition matches: with no `matches`, the tool is denied outright; with
 * `matches`, the unanchored JS regex is tested against the `arg` field (or, when
 * `arg` is omitted, the whole serialized args). First matching rule wins.
 */
export interface WaypointProjectPiPolicyRule {
  /** Granted tool name this rule governs, or `*` for any granted tool. */
  readonly tool: string
  /** Arg field to test (e.g. `path`, `content`). Omitted → test the whole args. */
  readonly arg?: string
  /** Unanchored JS regex; omitted → the rule denies the tool unconditionally.
   *  JS syntax — no inline `(?i)`; use `flags` for case-insensitivity. */
  readonly matches?: string
  /** JS regex flags for `matches` (e.g. `i`). Case-insensitivity matters for
   *  secret matching, and JS has no inline-flag syntax. */
  readonly flags?: string
  /** Message surfaced in the block reason (and, downstream, the close reason). */
  readonly reason?: string
}

/**
 * Worker-host runtime (P3/W3-W4, docs/designs/p3-worker-host.md):
 * `runtime.recipe: worker` makes the bridge spawn the agent command directly
 * as a subprocess per dispatch. Model classes map to CLI args
 * (`model_args`); the Seatbelt jail (WAYPOINT_SEATBELT)
 * assembles from the top-level `roots:` plus each plan's `access:` map.
 */
/**
 * One worker LANE: a subscription with a seat at the table (Aaron 2026-07-28).
 *
 * Concurrency is not limited by the machine, it is limited by the plan every
 * worker shares — N concurrent `claude -p` processes are N inference streams
 * against one Max account, and the fleet rate-limits together. A lane binds a
 * dispatch to ONE subscription: its own command, its own credential home, and
 * its own class→model mapping, because "large" is a different model on every
 * provider. The pool runs one dispatch per lane, so adding a subscription adds
 * a worker instead of adding contention.
 */
export interface WaypointProjectWorkerLaneConfig {
  /** Operator-facing name, e.g. `claude-max-a`. Unique within the pool. */
  readonly name: string
  /**
   * The account this lane runs on, as an email address.
   *
   * Subscriptions are interchangeable until one of them breaks; then the only
   * question that matters is WHICH — which plan hit its limit, which login
   * expired, which invoice to look at (Aaron 2026-07-28). The lane name is
   * ours; the email is the thing the provider knows it by.
   */
  readonly email?: string
  /** The agent binary. Defaults to `runtime.worker.command`. */
  readonly command?: string
  /** Base args. Defaults to `runtime.worker.args`. */
  readonly args?: readonly string[]
  /**
   * Environment this lane's worker is spawned with — VALUES, not just names,
   * and the seam that binds a lane to one account: `CLAUDE_CONFIG_DIR` for a
   * second Claude subscription, `CODEX_HOME` for a second OpenAI one, and so
   * on. Merged over the allowlisted env, so a lane can only ADD what it names.
   */
  readonly env?: Readonly<Record<string, string>>
  /**
   * How the work order reaches this agent: `stdin` (default) or `arg`.
   * kimi refuses an empty prompt and never reads the pipe, so its order has to
   * ride as the final argument.
   */
  readonly work_order?: 'stdin' | 'arg'
  /** Class → CLI args for THIS provider. Defaults to `runtime.worker.model_args`. */
  readonly model_args?: {
    readonly high?: readonly string[]
    readonly medium?: readonly string[]
    readonly low?: readonly string[]
  }
}

export interface WaypointProjectWorkerRuntimeConfig {
  /** The agent binary, e.g. `claude`. */
  readonly command: string
  /** Base args, e.g. `['-p']`. The work order arrives on stdin. */
  readonly args?: readonly string[]
  /** Model-class routing: class -> extra CLI args (e.g. high: ['--model','opus']). */
  readonly model_args?: {
    readonly high?: readonly string[]
    readonly medium?: readonly string[]
    readonly low?: readonly string[]
  }
  /** Attempt budget; past it the process group is killed and the attempt is `exhausted`. */
  readonly task_timeout_minutes?: number
  /**
   * How many times a failed task may be re-dispatched automatically before it
   * parks for a human (rsc-m23.6). Counts the first attempt, so 3 means one
   * run plus two retries; 1 disables auto retry. Default 3.
   */
  readonly max_attempts?: number
  /** Verify-then-apply admission (rsc-nrm). */
  readonly verify_then_apply?: boolean
  /** How many worker attempts the bridge runs at once (default 1). */
  readonly concurrency?: number
  /**
   * EXTRA env var names the worker may inherit, on top of the built-in
   * allowlist (rsc-m8x, runtime/worker-env.ts).
   *
   * The worker is spawned with an allowlisted env, not the Console's whole
   * environment. This is the escape hatch when a setup needs a name we do not
   * ship — and it is deliberately the ONLY one: there is no switch that restores
   * full inheritance, because that switch would be reached for the first time a
   * dispatch broke and would silently reinstate the hole for good. Naming what
   * you need is a change a reviewer can see.
   *
   * Add names, not secrets: this is a list of variable NAMES.
   */
  readonly env_allow?: readonly string[]
  /**
   * The worker pool: one lane per subscription. Present = the pool's size is
   * the lane count and `concurrency` is ignored (a lane IS a slot). Absent =
   * today's behavior, `concurrency` copies of this one worker.
   */
  readonly lanes?: readonly WaypointProjectWorkerLaneConfig[]
}

/**
 * Worker sandbox backend (egress allowlist + credential brokering) — the layer
 * the Seatbelt structurally cannot provide: a default-deny egress allowlist
 * (nowhere to exfiltrate *to*) and credential brokering (the worker never
 * holds the real model key).
 *
 * **Production (sprite workers, S1):** only `fly-sprites` (Firecracker
 * microvm reached over the Sprites control plane). See
 * `isProductionSandboxBackend`.
 *
 * **`fake`:** deterministic harness/unit tests only. Never production
 * admission.
 *
 * **`microsandbox`:** RETIRED local microVM path (historical rsc-wxk /
 * docs/spikes/microsandbox.md). Kept on the type for legacy unit tests of the
 * argv builder; parse/admission refuse it unless
 * `WAYPOINT_ALLOW_RETIRED_MICROSANDBOX=1` or `{ allowRetired: true }`.
 *
 * Opt-in per project — absent means off, and off is exactly today's behavior.
 */
export type WaypointSandboxBackend = 'fly-sprites' | 'fake' | 'microsandbox'

/** Env that re-enables retired microsandbox parse/runtime for legacy tests only. */
export const WAYPOINT_ALLOW_RETIRED_MICROSANDBOX = 'WAYPOINT_ALLOW_RETIRED_MICROSANDBOX'

/** Clear refusal when a config still names the retired local microVM backend. */
export const RETIRED_MICROSANDBOX_MESSAGE =
  "backend 'microsandbox' is retired — use 'fly-sprites' (or 'fake' for tests)"

export type SandboxParseOptions = {
  /** Re-admit retired `microsandbox` (legacy argv-builder tests only). */
  readonly allowRetired?: boolean
}

/** True when retired microsandbox may be parsed / admitted (tests only). */
export function allowRetiredMicrosandbox(
  options?: SandboxParseOptions,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return options?.allowRetired === true || env[WAYPOINT_ALLOW_RETIRED_MICROSANDBOX] === '1'
}

/** True only for cloud-qualified production backends (not microsandbox/fake). */
export function isProductionSandboxBackend(backend: WaypointSandboxBackend): boolean {
  return backend === 'fly-sprites'
}

export interface WaypointProjectSandboxEgressConfig {
  /** Baseline verdict for targets not named in `allow`. microsandbox itself
   *  defaults to ALLOW; we require `deny` and admission refuses otherwise. */
  readonly default: 'deny' | 'allow'
  /**
   * DOMAINS the worker may reach, e.g. `api.openai.com`. Domains only —
   * admission refuses IPs, CIDRs and target groups (`public`, `private`).
   *
   * Why domains only: microsandbox matches domain rules by intercepting DNS and
   * validating TLS SNI. A connection to a hard-coded IP resolves through nothing
   * and matches no domain rule, so under `default: deny` it fails closed — which
   * the spike proved by moving zero bytes to a raw IP. A CIDR or group entry in
   * this list is precisely what would reopen that path.
   */
  readonly allow?: readonly string[]
}

/**
 * Credential brokering — the real secret NEVER enters the sandbox. The guest
 * gets a placeholder (`$MSB_<env_var>`); the host substitutes the real value at
 * the network boundary, and only for the hosts named here, validated against
 * observed DNS and TLS identity. Proven in the spike: the value appeared in no
 * guest env var and in no guest process's environ or cmdline.
 *
 * The config records the NAME of a host env var — never a value. (microsandbox's
 * own CLI enforces the same discipline: it accepts `ENV@HOST` and rejects the
 * inline `ENV=VALUE@HOST` form.)
 *
 * Unlike the OpenSandbox vault this replaces, brokering needs no header or path
 * globs: substitution is by placeholder, not by header injection, so it is not
 * limited to API-key-shaped providers.
 */
export interface WaypointProjectSandboxBrokerConfig {
  /** Host env var holding the real secret (e.g. `ANTHROPIC_API_KEY`). Name only. */
  readonly env_var: string
  /** The only hosts this secret may ever be substituted into. Must be a subset
   *  of `egress.allow` — brokering into a host the firewall drops is dead config. */
  readonly hosts: readonly string[]
}

/** A host credential file/dir mounted into the sandbox (e.g. an OAuth token
 *  store: `~/.claude/.credentials.json`, `~/.codex/auth.json`). */
export interface WaypointProjectSandboxCredentialFile {
  /** Absolute host path; a leading `~` expands to the operator's home. */
  readonly host_path: string
  /** Where the agent expects it inside the sandbox. */
  readonly mount_path: string
  /** Default `ro`. `rw` only when the CLI must persist a token refresh. */
  readonly access?: WaypointRootAccess
}

/**
 * Passthrough — the credential actually enters the sandbox. Necessary for
 * subscription/OAuth agents, which is most of them (Claude Code, Codex, Grok):
 * their CLI holds its own credential store and cannot take a placeholder.
 *
 * The wall this leans on is the EGRESS ALLOWLIST, not brokering: a worker
 * holding a token it can only send to the one allowed provider has nowhere to
 * leak it. What passthrough gives up is protection against the credential being
 * copied into something DURABLE — a file, a log line, a commit, a dossier. That
 * path is covered by keeping the mount narrow (name the one credential file,
 * never all of `~/.claude`) and by the safe-evidence guard's credential
 * patterns.
 *
 * Prefer `broker` where the provider allows it: brokering keeps the value out of
 * the guest entirely, so there is nothing inside to copy anywhere.
 */
export interface WaypointProjectSandboxPassthroughConfig {
  /** Host env var NAMES copied into the sandbox. Names only — values are read
   *  at dispatch and never logged, echoed, or persisted. */
  readonly env?: readonly string[]
  readonly files?: readonly WaypointProjectSandboxCredentialFile[]
}

/**
 * How the worker authenticates to its model provider. Provider-neutral by
 * design: Claude, Codex, Grok and others differ in credential shape and host, so
 * nothing here names a vendor — the project config does.
 *
 * Both mechanisms may be combined (e.g. a brokered API key plus an OAuth token
 * file for a second provider).
 */
export interface WaypointProjectSandboxCredentialConfig {
  readonly broker?: readonly WaypointProjectSandboxBrokerConfig[]
  readonly passthrough?: WaypointProjectSandboxPassthroughConfig
}

export interface WaypointProjectSandboxConfig {
  readonly backend: WaypointSandboxBackend
  readonly image: string
  readonly egress: WaypointProjectSandboxEgressConfig
  readonly credential?: WaypointProjectSandboxCredentialConfig
  /** Where the case folder is mounted inside the sandbox (default `/work`). */
  readonly mount_path?: string
}

export type WaypointRootAccess = 'ro' | 'rw'

/**
 * A named write/read boundary (rsc-8ip). Binds a symbolic name (referenced by
 * a quest plan's `metadata.runner.access` map) to a concrete path relative
 * to the case folder, plus the root's base capability (`ro` = read-only,
 * `rw` = read-write). Declarative here; a later Seatbelt profile compiler
 * (rsc-urj) consumes these + per-plan access to emit a fail-closed SBPL jail.
 */
export interface WaypointProjectRootConfig {
  readonly path: string
  readonly access: WaypointRootAccess
}

export interface WaypointProjectConfig {
  readonly schema_version: 1
  readonly enabled: boolean
  readonly quest: string
  readonly backend: WaypointProjectBackendConfig
  readonly runtime: WaypointProjectRuntimeConfig
  /** Named read/write roots for this case (rsc-8ip). Optional. */
  readonly roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  readonly created_at: string
  readonly updated_at: string
}

export function createWaypointProjectConfig(input: {
  quest: string
  backend?: WaypointRouteBackendMode
  postgres?: WaypointPostgresBackendConfig
  runtime?: WaypointProjectRuntimeConfig
  /** Named seatbelt roots to record (rsc-w0z). Materialized by `waypoint init`
   *  from the quest's `metadata.runner.roots`; omitted when the quest declares none. */
  roots?: Readonly<Record<string, WaypointProjectRootConfig>>
  now?: Date
}): WaypointProjectConfig {
  const now = (input.now ?? new Date()).toISOString()

  return {
    schema_version: 1,
    enabled: true,
    quest: input.quest,
    backend: {
      route: input.backend ?? 'postgres',
      ...(input.postgres ? { postgres: input.postgres } : {}),
    },
    runtime: input.runtime ?? {
      recipe: null,
    },
    ...(input.roots && Object.keys(input.roots).length > 0 ? { roots: input.roots } : {}),
    created_at: now,
    updated_at: now,
  }
}

/**
 * Read a quest manifest's declared seatbelt roots (rsc-w0z): the quest-level
 * `metadata.runner.roots` map (binding -> {path, access}) that `## Access roots`
 * in prose compiles to. `waypoint init` materializes these into the project config
 * so a jailed dispatch resolves every plan `Access:` binding instead of failing
 * closed at "config declares no such root". Lenient by design — a quest with no
 * roots declared yields `{}`; malformed entries are skipped, mirroring
 * parseRootsConfig.
 */
export function extractQuestRoots(metadata: unknown): Record<string, WaypointProjectRootConfig> {
  const runner = isRecord(metadata) && isRecord(metadata.runner) ? metadata.runner : undefined
  const rawRoots = runner && isRecord(runner.roots) ? runner.roots : undefined
  return parseRootsConfig(rawRoots) ?? {}
}

/**
 * Q1 admission (docs/designs/q-quest-proving.md): can this project's runtime
 * honestly take a recipe dispatch to an outcome? Executable modes must carry
 * their command NOW — a missing worker.command failing at the first dispatch
 * is the same silent hang this guard exists to prevent. The explicit 'null'
 * mode passes: it is a deliberate opt-in to simulated outcomes.
 */
export function recipeRuntimeProblem(runtime: WaypointProjectRuntimeConfig): string | undefined {
  if (runtime.recipe === null) {
    return [
      'runtime.recipe is not configured in .waypoint/config.yaml — recipe plans would never execute',
      '(dispatches sit unclaimed forever; the hollis-vantry referral-package hang, rsc-e1b).',
      "Configure `runtime.recipe: worker` with `runtime.worker.command` (an agent executes the work),",
      "or `runtime.recipe: local` with `runtime.command`, or explicitly opt into simulation with `runtime.recipe: 'null'`",
      '(waypoint init --simulated) — simulated outcomes are recorded as simulated, never as executed.',
    ].join(' ')
  }
  if (runtime.recipe === 'worker' && !runtime.worker?.command) {
    return 'runtime.recipe is worker but runtime.worker.command is missing in .waypoint/config.yaml'
  }
  if (runtime.recipe === 'worker' && runtime.worker?.command) {
    // Item 53 (cordis-only): programmatic configs bypass the YAML parse, so the
    // Q1 admission re-checks the retired-harness rule here.
    const retired = retiredWorkerHarnessProblem(runtime.worker.command)
    if (retired) return retired
  }
  if (runtime.recipe === 'local' && !runtime.command) {
    return 'runtime.recipe is local but runtime.command is missing in .waypoint/config.yaml'
  }
  return undefined
}

export function serializeWaypointProjectConfig(config: WaypointProjectConfig): string {
  return yamlStringify(config)
}

export async function readWaypointProjectConfig(configPath: string): Promise<WaypointProjectConfig> {
  return parseWaypointProjectConfig(await readFile(configPath, 'utf8'))
}

export function parseWaypointProjectConfig(
  text: string,
  options: { readonly healDuplicateKeys?: boolean } = {},
): WaypointProjectConfig {
  let parsed: Partial<WaypointProjectConfig> | null
  try {
    parsed = yamlParse(text) as Partial<WaypointProjectConfig> | null
  } catch (error) {
    // A hand edit racing the root-merge writer produced duplicate map keys in
    // vivo (2026-08-25) and every subsequent CLI invocation died on this
    // parse. Strict everywhere by default; the merge WRITER opts into a
    // last-value-wins reread so its next write heals the file instead of the
    // whole surface staying dead.
    if (!options.healDuplicateKeys || !/unique/i.test(String(error))) throw error
    parsed = yamlParse(text, { uniqueKeys: false }) as Partial<WaypointProjectConfig> | null
  }

  if (!parsed || parsed.schema_version !== 1 || typeof parsed.quest !== 'string') {
    throw new Error('Invalid Waypoint project config')
  }

  const roots = parseRootsConfig(parsed.roots)

  return {
    schema_version: 1,
    enabled: parsed.enabled === true,
    quest: parsed.quest,
    backend: parseBackendConfig(parsed.backend),
    runtime: parseRuntimeConfig(parsed.runtime),
    ...(roots ? { roots } : {}),
    created_at: String(parsed.created_at ?? ''),
    updated_at: String(parsed.updated_at ?? ''),
  }
}

function parseRootsConfig(value: unknown): Record<string, WaypointProjectRootConfig> | undefined {
  if (!isRecord(value)) return undefined
  const roots: Record<string, WaypointProjectRootConfig> = {}
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    if (typeof raw.path !== 'string' || raw.path.length === 0) continue
    const access: WaypointRootAccess = raw.access === 'rw' ? 'rw' : 'ro'
    roots[name] = { path: raw.path, access }
  }
  return Object.keys(roots).length > 0 ? roots : undefined
}

function parseBackendConfig(value: unknown): WaypointProjectBackendConfig {
  const backend = isRecord(value) ? value : {}
  if (backend.route !== undefined && backend.route !== 'postgres') {
    throw new Error(
      `The '${String(backend.route)}' route backend is retired — run 'waypoint migrate' in this project to move its run state to the postgres backend (P5, docs/designs/p5-folder-retirement.md).`,
    )
  }
  const postgres = parsePostgresBackendConfig(backend.postgres)
  return {
    route: 'postgres',
    ...(postgres ? { postgres } : {}),
  }
}

function parsePostgresBackendConfig(value: unknown): WaypointPostgresBackendConfig | undefined {
  if (!isRecord(value)) return undefined
  const url = typeof value.url === 'string' && value.url.trim() !== '' ? value.url : undefined
  const schema = typeof value.schema === 'string' && value.schema.trim() !== '' ? value.schema : undefined
  const durable = value.durable === true
  if (!url && !schema && !durable) return undefined
  return {
    ...(url ? { url } : {}),
    ...(schema ? { schema } : {}),
    ...(durable ? { durable: true } : {}),
  }
}

function parseRuntimeConfig(value: unknown): WaypointProjectRuntimeConfig {
  const runtime = isRecord(value) ? value : {}
  const recipe =
    runtime.recipe === 'local' || runtime.recipe === 'null' || runtime.recipe === 'worker'
      ? runtime.recipe
      : null
  const command = typeof runtime.command === 'string' ? runtime.command : undefined
  const args = Array.isArray(runtime.args) ? runtime.args.filter((arg): arg is string => typeof arg === 'string') : undefined
  const worker = parseWorkerRuntimeConfig(runtime.worker)
  const modelTargets = parseModelTargets(runtime.model_targets)
  const sandbox = parseSandboxConfig(runtime.sandbox)
  const piPolicy = parsePiPolicyConfig(runtime.pi_policy)
  return {
    recipe,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(worker ? { worker } : {}),
    ...(modelTargets ? { model_targets: modelTargets } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(piPolicy ? { pi_policy: piPolicy } : {}),
  }
}

/**
 * Parse `runtime.pi_policy` — STRICT, for the same reason `parseSandboxConfig` is
 * (rsc-bhc part 3). A pi policy is a DENY boundary; a rule silently dropped for a
 * typo is fail-OPEN — a deny that does not deny, believed active. So a
 * present-but-invalid block refuses loudly (bad tool, bad field type, or a regex
 * that will not compile). Absent is the only way to have no policy.
 */
function parsePiPolicyConfig(value: unknown): readonly WaypointProjectPiPolicyRule[] | undefined {
  if (value === undefined || value === null) return undefined
  const bad = (why: string): never => {
    throw new Error(`Invalid runtime.pi_policy in .waypoint/config.yaml: ${why}`)
  }
  if (!Array.isArray(value)) return bad('expected a list of deny rules')
  const rules: WaypointProjectPiPolicyRule[] = []
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return bad(`rule ${index} is not a mapping`)
    const tool = nonEmptyString(raw.tool) ?? bad(`rule ${index}: 'tool' is required (a granted tool name, or '*')`)
    if (raw.arg !== undefined && typeof raw.arg !== 'string') return bad(`rule ${index}: 'arg' must be a string`)
    if (raw.reason !== undefined && typeof raw.reason !== 'string') return bad(`rule ${index}: 'reason' must be a string`)
    if (raw.flags !== undefined && typeof raw.flags !== 'string') return bad(`rule ${index}: 'flags' must be a string`)
    if (raw.matches !== undefined) {
      if (typeof raw.matches !== 'string') return bad(`rule ${index}: 'matches' must be a regex string`)
      try {
        new RegExp(raw.matches, typeof raw.flags === 'string' ? raw.flags : undefined)
      } catch (error) {
        return bad(`rule ${index}: 'matches' is not a valid regex — ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    rules.push({
      tool,
      ...(typeof raw.arg === 'string' ? { arg: raw.arg } : {}),
      ...(typeof raw.matches === 'string' ? { matches: raw.matches } : {}),
      ...(typeof raw.flags === 'string' ? { flags: raw.flags } : {}),
      ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
    })
  }
  return rules
}

/**
 * Parse `runtime.sandbox` — STRICT, unlike the lenient worker/roots parsers
 * above. Those skip malformed entries because the cost is a missing
 * convenience. Here the cost is a missing *boundary*: an operator who wrote a
 * sandbox block asked for egress control, and silently degrading a typo into
 * "no sandbox" is fail-OPEN — an unjailed worker with the real key and the open
 * internet, believed sandboxed. Present-but-invalid therefore refuses loudly.
 * Absent is the only way to be off.
 */
function parseSandboxConfig(value: unknown, options?: SandboxParseOptions): WaypointProjectSandboxConfig | undefined {
  if (value === undefined || value === null) return undefined
  const bad = (why: string): never => {
    throw new Error(`Invalid runtime.sandbox in .waypoint/config.yaml: ${why}`)
  }
  if (!isRecord(value)) return bad('expected a mapping')

  const allowedBackends: readonly WaypointSandboxBackend[] = ['fly-sprites', 'fake', 'microsandbox']
  if (typeof value.backend !== 'string' || !allowedBackends.includes(value.backend as WaypointSandboxBackend)) {
    // 'opensandbox' was the backend until rsc-20z (2026-07-16). It is not a
    // silent no-op: a config naming it asked for a boundary that no longer
    // exists here, so it refuses rather than running unsandboxed.
    const hint =
      value.backend === 'opensandbox'
        ? " — the OpenSandbox backend was removed; rewrite the block: drop `server` and `egress.mode`, and replace `credential.vault` with `credential.broker`. The production backend is 'fly-sprites'"
        : ''
    return bad(
      `unknown backend '${String(value.backend)}' — supported backends are 'fly-sprites' and 'fake' (microsandbox is retired)${hint}`,
    )
  }
  const backend = value.backend as WaypointSandboxBackend
  if (backend === 'microsandbox' && !allowRetiredMicrosandbox(options)) {
    return bad(RETIRED_MICROSANDBOX_MESSAGE)
  }
  const image = nonEmptyString(value.image) ?? bad('image is required')

  if (!isRecord(value.egress)) return bad('egress is required — a sandbox without an egress policy buys us nothing')
  const egressDefault = value.egress.default
  if (egressDefault !== 'deny' && egressDefault !== 'allow') {
    return bad(`egress.default must be 'deny' or 'allow', got '${String(egressDefault)}'`)
  }
  if (value.egress.allow !== undefined && !Array.isArray(value.egress.allow)) {
    return bad('egress.allow must be a list of domains')
  }
  const allow = Array.isArray(value.egress.allow)
    ? value.egress.allow.filter((host): host is string => typeof host === 'string' && host.trim() !== '').map((h) => h.trim())
    : undefined

  let credential: WaypointProjectSandboxCredentialConfig | undefined
  if (value.credential !== undefined) {
    if (!isRecord(value.credential)) return bad('credential must be a mapping')
    const broker = parseBrokerConfig(value.credential.broker, bad)
    const passthrough = parsePassthroughConfig(value.credential.passthrough, bad)
    if (broker === undefined && passthrough === undefined) {
      return bad('credential declares neither `broker` nor `passthrough` — it grants the worker no way to authenticate')
    }
    credential = { ...(broker ? { broker } : {}), ...(passthrough ? { passthrough } : {}) }
  }

  const mountPath = nonEmptyString(value.mount_path)
  if (value.mount_path !== undefined && mountPath === undefined) return bad('mount_path must be a non-empty string')
  if (mountPath !== undefined && !mountPath.startsWith('/')) return bad(`mount_path must be absolute, got '${mountPath}'`)

  return {
    backend,
    image,
    egress: {
      default: egressDefault,
      ...(allow && allow.length > 0 ? { allow } : {}),
    },
    ...(credential ? { credential } : {}),
    ...(mountPath ? { mount_path: mountPath } : {}),
  }
}

type Bad = (why: string) => never

function parseBrokerConfig(value: unknown, bad: Bad): readonly WaypointProjectSandboxBrokerConfig[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return bad('credential.broker must be a list of {env_var, hosts} mappings')
  const parsed: WaypointProjectSandboxBrokerConfig[] = []
  for (const raw of value) {
    if (!isRecord(raw)) return bad('credential.broker entries must be mappings')
    const envVar =
      nonEmptyString(raw.env_var) ?? bad('credential.broker[].env_var is required (the NAME of the host env var holding the real secret)')
    // Same rule as passthrough.env, for the same reason: config files get
    // committed, and a value here would be a secret in git.
    if (envVar.includes('=')) {
      return bad(`credential.broker[].env_var ${JSON.stringify(envVar)} looks like a NAME=value pair — name the env var only, never the value`)
    }
    if (!Array.isArray(raw.hosts)) return bad(`credential.broker[env_var=${envVar}].hosts is required — a list of hosts the secret may be sent to`)
    const hosts = raw.hosts.filter((h): h is string => typeof h === 'string' && h.trim() !== '').map((h) => h.trim())
    if (hosts.length === 0) {
      return bad(`credential.broker[env_var=${envVar}].hosts is empty — a brokered secret with no allowed host can never be substituted`)
    }
    parsed.push({ env_var: envVar, hosts })
  }
  if (parsed.length === 0) return bad('credential.broker is an empty list')
  const seen = new Set<string>()
  for (const entry of parsed) {
    if (seen.has(entry.env_var)) return bad(`credential.broker names '${entry.env_var}' twice — one env var, one host set`)
    seen.add(entry.env_var)
  }
  return parsed
}

function parsePassthroughConfig(value: unknown, bad: Bad): WaypointProjectSandboxPassthroughConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return bad('credential.passthrough must be a mapping')

  let env: readonly string[] | undefined
  if (value.env !== undefined) {
    if (!Array.isArray(value.env)) return bad('credential.passthrough.env must be a list of env var NAMES')
    const names = value.env.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
    // A value here would be a secret written into a config file that gets
    // committed. Names only — refuse anything that looks like a NAME=value pair.
    for (const name of names) {
      if (name.includes('=')) return bad(`credential.passthrough.env entry ${JSON.stringify(name)} looks like a NAME=value pair — list NAMES only, never values`)
    }
    if (names.length > 0) env = names
  }

  let files: readonly WaypointProjectSandboxCredentialFile[] | undefined
  if (value.files !== undefined) {
    if (!Array.isArray(value.files)) return bad('credential.passthrough.files must be a list')
    const parsed: WaypointProjectSandboxCredentialFile[] = []
    for (const raw of value.files) {
      if (!isRecord(raw)) return bad('credential.passthrough.files entries must be mappings')
      const hostPath = nonEmptyString(raw.host_path) ?? bad('credential.passthrough.files[].host_path is required')
      const mountPath = nonEmptyString(raw.mount_path) ?? bad('credential.passthrough.files[].mount_path is required')
      if (!mountPath.startsWith('/')) return bad(`credential.passthrough.files[].mount_path must be absolute, got '${mountPath}'`)
      if (raw.access !== undefined && raw.access !== 'ro' && raw.access !== 'rw') {
        return bad(`credential.passthrough.files[].access must be 'ro' or 'rw', got '${String(raw.access)}'`)
      }
      parsed.push({ host_path: hostPath, mount_path: mountPath, ...(raw.access === 'rw' ? { access: 'rw' as const } : { access: 'ro' as const }) })
    }
    if (parsed.length > 0) files = parsed
  }

  if (env === undefined && files === undefined) return bad('credential.passthrough declares neither env nor files')
  return { ...(env ? { env } : {}), ...(files ? { files } : {}) }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function parseWorkerRuntimeConfig(value: unknown): WaypointProjectWorkerRuntimeConfig | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.command !== 'string' || value.command.trim() === '') return undefined
  // Item 53 (cordis-only): a retired third-party harness command fails at
  // parse, the beads-exit pattern — never a warning, never a substitution.
  const retired = retiredWorkerHarnessProblem(value.command)
  if (retired) throw new Error(`Invalid runtime.worker.command in .waypoint/config.yaml: ${retired}`)
  const stringList = (raw: unknown): readonly string[] | undefined =>
    Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : undefined
  const lanes = parseWorkerLanes(value.lanes)
  const modelArgs = isRecord(value.model_args)
    ? {
        ...(stringList(value.model_args.high) ? { high: stringList(value.model_args.high)! } : {}),
        ...(stringList(value.model_args.medium) ? { medium: stringList(value.model_args.medium)! } : {}),
        ...(stringList(value.model_args.low) ? { low: stringList(value.model_args.low)! } : {}),
      }
    : undefined
  return {
    command: value.command,
    ...(stringList(value.args) ? { args: stringList(value.args)! } : {}),
    ...(modelArgs && Object.keys(modelArgs).length > 0 ? { model_args: modelArgs } : {}),
    ...(isPositiveNumber(value.task_timeout_minutes) ? { task_timeout_minutes: value.task_timeout_minutes } : {}),
    ...(isPositiveNumber(value.max_attempts) ? { max_attempts: value.max_attempts } : {}),
    ...(value.verify_then_apply === true ? { verify_then_apply: true } : {}),
    ...(isPositiveNumber(value.concurrency) && Number.isInteger(value.concurrency) ? { concurrency: value.concurrency } : {}),
    ...(stringList(value.env_allow) ? { env_allow: stringList(value.env_allow)! } : {}),
    ...(lanes ? { lanes } : {}),
  }
}

/**
 * Parse `runtime.worker.lanes` — STRICT, like the pi policy and the sandbox.
 * A lane silently dropped for a typo is a subscription that stops being used
 * while the operator believes it is, and worse, one whose credential env never
 * reaches the worker — so the lane would run on the DEFAULT account. Absent is
 * the only way to have no pool.
 */
function parseWorkerLanes(value: unknown): readonly WaypointProjectWorkerLaneConfig[] | undefined {
  if (value === undefined || value === null) return undefined
  const bad = (why: string): never => {
    throw new Error(`Invalid runtime.worker.lanes in .waypoint/config.yaml: ${why}`)
  }
  if (!Array.isArray(value)) return bad('expected a list of worker lanes')
  if (value.length === 0) return bad('a pool with no lanes has no workers — remove the key instead')
  const stringList = (raw: unknown): readonly string[] | undefined =>
    Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : undefined
  const lanes: WaypointProjectWorkerLaneConfig[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) return bad(`lane ${index} is not a mapping`)
    const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : undefined
    if (!name) return bad(`lane ${index}: 'name' is required (how the lane is named in logs)`)
    if (seen.has(name)) return bad(`lane ${index}: duplicate name ${name}`)
    seen.add(name)
    if (raw.command !== undefined && (typeof raw.command !== 'string' || raw.command.trim() === '')) {
      return bad(`lane ${name}: 'command' must be a non-empty string when set`)
    }
    if (raw.email !== undefined && (typeof raw.email !== 'string' || !raw.email.includes('@'))) {
      return bad(`lane ${name}: 'email' must be the account's email address`)
    }
    if (raw.work_order !== undefined && raw.work_order !== 'stdin' && raw.work_order !== 'arg') {
      return bad(`lane ${name}: 'work_order' must be 'stdin' or 'arg'`)
    }
    let env: Record<string, string> | undefined
    if (raw.env !== undefined) {
      if (!isRecord(raw.env)) return bad(`lane ${name}: 'env' must be a mapping of NAME: value`)
      env = {}
      for (const [key, item] of Object.entries(raw.env)) {
        if (typeof item !== 'string') return bad(`lane ${name}: env ${key} must be a string`)
        env[key] = item
      }
    }
    const modelArgs = isRecord(raw.model_args)
      ? {
          ...(stringList(raw.model_args.high) ? { high: stringList(raw.model_args.high)! } : {}),
          ...(stringList(raw.model_args.medium) ? { medium: stringList(raw.model_args.medium)! } : {}),
          ...(stringList(raw.model_args.low) ? { low: stringList(raw.model_args.low)! } : {}),
        }
      : undefined
    lanes.push({
      name,
      ...(typeof raw.email === 'string' ? { email: raw.email.trim() } : {}),
      ...(typeof raw.command === 'string' ? { command: raw.command } : {}),
      ...(raw.work_order === 'arg' || raw.work_order === 'stdin' ? { work_order: raw.work_order } : {}),
      ...(stringList(raw.args) ? { args: stringList(raw.args)! } : {}),
      ...(env ? { env } : {}),
      ...(modelArgs && Object.keys(modelArgs).length > 0 ? { model_args: modelArgs } : {}),
    })
  }
  return lanes
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
