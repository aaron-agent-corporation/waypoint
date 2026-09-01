/**
 * The worker's spawn environment (rsc-m8x).
 *
 * Until this existed, `runWorkerCommand` spawned the agent with no explicit env,
 * so the child inherited the Console/bridge `process.env` WHOLESALE: every cloud
 * key, GitHub token, DB URL and unrelated project secret exported into the
 * supervisor, not the one credential the agent needs. The seatbelt is a WRITE
 * jail and leaves network open, and case documents are untrusted input — so a
 * prompt-injected worker could read every secret in the environment and send it
 * anywhere. This narrows what it can reach.
 *
 * ALLOWLIST, never a denylist. A denylist has to predict every secret anyone will
 * ever export; an allowlist is wrong only about things we can name and add. The
 * failure modes are not symmetric: a missing allowlist entry breaks a dispatch
 * loudly and gets fixed, while a missing denylist entry leaks silently forever.
 *
 * ON BY DEFAULT, with no kill switch, and that is deliberate. The sandbox (the
 * other control that would cover this) is opt-in — and measured 2026-07-16, NOT
 * ONE real project configures it, so it protects nobody. An env var that restores
 * full inheritance would be reached for the first time a dispatch broke, and the
 * hole would be back permanently and silently. Projects extend the list instead
 * (`runtime.worker.env_allow`), which is a change you can read in a diff.
 *
 * This does NOT apply to the sandboxed path, which needs no help: microsandbox
 * builds the guest env from explicitly named vars only, so the guest is clean by
 * construction. The env we hand `msb` itself stays whole ON PURPOSE — msb resolves
 * brokered secrets (`--secret ENV@HOST`) from its own process env, and msb is our
 * trusted binary rather than the untrusted agent. Scrubbing it would break
 * brokering to protect nothing.
 */

import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/** The CLI shim directory root: $WAYPOINT_HOME or ~/.waypoint. */
function waypointHome(env: NodeJS.ProcessEnv): string {
  const override = env.WAYPOINT_HOME?.trim()
  return override && override !== '' ? override : join(homedir(), '.waypoint')
}

/**
 * Names the worker gets, and the reason each survives. Everything absent from
 * this list is dropped — that is the point, so additions deserve a reason.
 */
export const DEFAULT_WORKER_ENV_ALLOW: readonly string[] = Object.freeze([
  // Process essentials. Without these the agent cannot find its own binary, its
  // config, or a place to write scratch.
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TERM',
  'TZ',
  // Locale/encoding. Dropping these does not fail — it mangles non-ASCII, which
  // in a case tree means client names and addresses.
  'LANG',
  'LC_ALL',
  'LC_CTYPE',

  // The model credential and its endpoint. This IS the credential the worker is
  // meant to hold; the point of the bead is that it should be the ONLY one.
  // BASE_URL rides along because dropping it would silently redirect the agent
  // to the public default when an operator has pointed it at a gateway.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CONFIG_DIR',

  // TLS + proxy. Paths and URLs, not secrets. Dropping them breaks networking
  // wherever a corporate root or proxy is in play, in ways that look like
  // provider outages rather than a config change.
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
])

/**
 * NO SUBSTRATE URL — the report seam is the file claim on every path (rsc-452).
 *
 * `WAYPOINT_POSTGRES_URL` / `WAYPOINT_POSTGRES_SCHEMA` used to be here, and the reason
 * was uncomfortable: the report contract had the agent run `waypoint tasks report
 * <id>`, which needs a route to Postgres, so the worker carried the substrate
 * URL — and with it a WRITE PATH into gates, dispatch rows, and other cases'
 * schemas, exactly what the sandboxed path rejected on principle.
 *
 * That is closed. The worker now reports by writing a claim FILE (the seam the
 * sandbox always used — worker-runtime.ts, sandbox/claim.ts); the host reads it
 * after exit and records the durable row itself. No `waypoint tasks report`, no
 * `WAYPOINT_POSTGRES_URL`, no substrate access from inside the worker at all,
 * sandboxed or not. The blast radius is finally the "one model key" the design
 * promised. Do not re-add these entries: a worker that needs the run database is
 * a worker with a write path back into it.
 */

/**
 * Build the env for a worker spawn: the allowlisted names that are actually set,
 * and nothing else.
 *
 * Returns a fresh object — never a mutated `process.env` — so a caller cannot
 * accidentally leak through a shared reference.
 */
export function buildWorkerEnv(
  hostEnv: NodeJS.ProcessEnv,
  extraAllow: readonly string[] = [],
  agentCommand?: string,
): NodeJS.ProcessEnv {
  const allowed = new Set<string>([...DEFAULT_WORKER_ENV_ALLOW, ...extraAllow.map((name) => name.trim()).filter((name) => name !== '')])
  const env: NodeJS.ProcessEnv = {}
  for (const name of allowed) {
    const value = hostEnv[name]
    // An allowlisted-but-unset name stays unset. Copying `undefined` in would
    // differ from inheritance: some tools read a defined-empty var as a
    // deliberate "off" rather than as absent.
    if (value !== undefined) env[name] = value
  }
  // Recipes tell workers to run `runner ...` for case-file operations
  // (document-handoff etc.), but under launchd nothing puts the CLI on PATH —
  // a worker that goes hunting finds whatever stale checkout is lying around
  // (executed 2026-07-22: a worker ran a pre-`staged` build out of an old git
  // worktree and failed its contract). `waypoint provision` writes the shim into
  // ~/.waypoint/bin pointing at THIS checkout; prepending it here guarantees
  // version match with the running host.
  const shimDir = join(waypointHome(hostEnv), 'bin')
  env.PATH = env.PATH ? `${shimDir}:${env.PATH}` : shimDir
  // The agent binary's OWN directory, when the project configured an absolute
  // command. Every agent CLI we run is a script with an interpreter shebang,
  // and the interpreter is that binary's neighbour: /opt/homebrew/bin/pi is
  // `#!/usr/bin/env node`, and node lives in /opt/homebrew/bin too. Under
  // launchd the Console's PATH is /usr/bin:/bin:/usr/sbin:/sbin, so the
  // allowlist faithfully copies a PATH that cannot resolve the interpreter and
  // the spawn dies with `env: node: No such file or directory`, exit 127,
  // before reading the work order. Seventeen attempts across two vendors died
  // that way. The host already resolved this path to spawn the command, so
  // adding it grants nothing the worker did not have.
  const commandDir = agentCommand !== undefined && isAbsolute(agentCommand) ? dirname(agentCommand) : null
  if (commandDir !== null && !env.PATH.split(':').includes(commandDir)) env.PATH = `${env.PATH}:${commandDir}`
  return env
}

/**
 * The names dropped from a host env — for diagnostics, never for a decision.
 *
 * When a dispatch breaks because the agent wanted something we withheld, the
 * question is "what did you take away?", and an allowlist cannot answer it from
 * the child's side. NAMES ONLY: the values are the thing we are protecting, and
 * this output is destined for evidence rows that are re-injected into a later
 * attempt's prompt (rsc-xam).
 */
export function droppedEnvNames(hostEnv: NodeJS.ProcessEnv, extraAllow: readonly string[] = []): string[] {
  const kept = new Set(Object.keys(buildWorkerEnv(hostEnv, extraAllow)))
  return Object.keys(hostEnv)
    .filter((name) => !kept.has(name))
    .sort()
}
