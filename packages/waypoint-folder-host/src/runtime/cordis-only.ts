/**
 * Worker-harness enforcement. Every worker command must be a first-class
 * runtime in this repository (cordis, pi, worker, deterministic) — no
 * third-party agent harness binary (Claude Code, Codex CLI, …) executes work.
 * Models stay reachable through the runtimes' ADAPTERS (this bans the loop,
 * not the model). Anthropic is removed as a worker-lane option: it remains
 * available via an explicitly named `api_key` provider only.
 *
 * Enforcement is the fail-closed pattern: a retired value FAILS CLOSED with a
 * message naming the ruling — never a warning, never a substitution. This is a
 * policy boundary, not a security boundary (the jail is the security boundary):
 * it refuses the KNOWN third-party harness commands and retired providers so a
 * config cannot quietly reintroduce them.
 *
 * Every predicate for the ruling lives in THIS module and nowhere else (the
 * one-place-per-predicate discipline). Consumers:
 *   - `project/config.ts` — parse-time refusal of retired worker commands
 *   - `runtime/worker-runtime.ts` — constructor backstop for programmatic configs
 *   - `runtime/cordis-runtime.ts` — worker-lane provider refusal after routing
 */

/**
 * Third-party agent-harness binaries retired as `runtime.worker.command`.
 * Exact basename matches (after stripping a path and a runner prefix such as
 * `npx`). `pi` here is the pi coding-agent CLI — the in-process pi-ai model
 * ADAPTERS that Cordis mounts are unaffected.
 */
export const RETIRED_WORKER_HARNESS_COMMANDS: ReadonlySet<string> = new Set([
  'claude',
  'claude-code',
  'codex',
  'gemini',
  'cursor',
  'cursor-agent',
  'aider',
  'goose',
  'opencode',
  'amp',
  'copilot',
  'droid',
  'pi',
])

/** Package-runner prefixes that execute their next argument. */
const RUNNER_PREFIXES: ReadonlySet<string> = new Set(['npx', 'bunx', 'uvx', 'pnpm', 'npm', 'yarn', 'bun'])

/** Runner subcommands that still mean "execute the next token" (`pnpm dlx foo`). */
const RUNNER_SUBCOMMANDS: ReadonlySet<string> = new Set(['dlx', 'exec', 'x', 'run'])

const RULING =
  'every worker command must resolve to a first-class runtime in this repository; ' +
  'models remain reachable through its adapters. This value fails closed; there is no override.'

function basenameOf(token: string): string {
  const slash = token.lastIndexOf('/')
  return (slash === -1 ? token : token.slice(slash + 1)).toLowerCase()
}

/**
 * Returns the refusal message when a worker command resolves to a retired
 * third-party harness, else undefined. Checks the first token's basename, and
 * when that token is a package runner (`npx`, `pnpm dlx`, …), the first
 * non-flag token after it.
 */
export function retiredWorkerHarnessProblem(command: string): string | undefined {
  const tokens = command.trim().split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return undefined
  const first = basenameOf(tokens[0]!)
  if (RETIRED_WORKER_HARNESS_COMMANDS.has(first)) {
    return `runtime.worker.command resolves to '${first}' — a third-party agent harness, ${RULING}`
  }
  if (RUNNER_PREFIXES.has(first)) {
    for (const token of tokens.slice(1)) {
      if (token.startsWith('-')) continue
      if (RUNNER_SUBCOMMANDS.has(token.toLowerCase())) continue
      const target = basenameOf(token)
      if (RETIRED_WORKER_HARNESS_COMMANDS.has(target)) {
        return `runtime.worker.command runs '${target}' via ${first} — a third-party agent harness, ${RULING}`
      }
      break
    }
  }
  return undefined
}

/** Providers retired as WORKER lanes. Brain use via explicit `api_key` provider is out of scope here. */
export const WORKER_LANE_RETIRED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])

/**
 * Returns the refusal message when a resolved worker target names a retired
 * worker-lane provider, else undefined. Applies to WORKER model resolution
 * only — other provider registries are a different code path and keep
 * Anthropic as an explicitly named api_key option.
 */
export function workerLaneProviderProblem(provider: string): string | undefined {
  if (!WORKER_LANE_RETIRED_PROVIDERS.has(provider.toLowerCase())) return undefined
  return (
    `provider '${provider}' is retired as a worker lane — Anthropic never rides a ` +
    `worker lane; it remains available via an explicitly named api_key provider. ` +
    `Point this model class at a non-Anthropic provider in runtime.model_targets.`
  )
}
