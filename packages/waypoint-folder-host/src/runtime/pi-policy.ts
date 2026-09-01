import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'

import type { WaypointProjectPiPolicyRule } from '../project/config.ts'

/**
 * The pi worker policy engine (rsc-bhc part 3). Compiles a project's
 * `runtime.pi_policy` DENY rules into the `beforeToolCall` seam function the pi
 * loop consults after a granted tool's args validate and before it runs. This is
 * the in-process ALLOW/DENY enforcement point the pivot promised (own the tool
 * surface without an opaque subprocess) — bound to config so a project, not a
 * code change, sets it.
 *
 * WHERE IT SITS in the worker's defense-in-depth:
 *  - LEAST PRIVILEGE (layer 1, upstream): only granted tools are registered, so
 *    an ungranted tool is unreachable — this engine never sees it.
 *  - ACCESS-MAP fs jail (layer 2): confines read/write to the plan's rw/ro roots
 *    at the PATH level.
 *  - THIS engine: DENY on the granted tools by ARG CONTENT — its unique reach.
 *    The access map cannot say "deny a `write_file` whose `content` looks like a
 *    secret"; a rule can. ALLOW is the default; there is no ASK (a headless jailed
 *    worker has no interactive approver, and the pi contract has no ask verdict —
 *    human-decision is a gate, not a tool-call prompt).
 *
 * The SAME rules run on both A′ tiers: in-process for tool-less recipes (bound by
 * pi-runtime-for.ts) and inside the jailed child for fs-tool recipes (forwarded
 * through the work order and rebuilt in pi-worker-entry.ts) — the fs-tool workers,
 * which actually touch files, are exactly the ones an arg-content deny protects.
 */

interface CompiledRule {
  readonly tool: string
  readonly arg?: string
  readonly matches?: RegExp
  readonly reason?: string
}

export type PiPolicy = (ctx: BeforeToolCallContext) => BeforeToolCallResult | undefined

/**
 * Build the policy function from validated rules, or `undefined` when there are
 * none (the seam then defaults to allow). Regexes are compiled once, up front:
 * `parsePiPolicyConfig` already validated them, so this is the fail-closed
 * backstop — an uncompilable regex throws here rather than silently not matching.
 */
export function buildPiPolicy(rules: readonly WaypointProjectPiPolicyRule[] | undefined): PiPolicy | undefined {
  if (rules === undefined || rules.length === 0) return undefined
  const compiled: CompiledRule[] = rules.map((rule) => ({
    tool: rule.tool,
    ...(rule.arg !== undefined ? { arg: rule.arg } : {}),
    ...(rule.matches !== undefined ? { matches: new RegExp(rule.matches, rule.flags) } : {}),
    ...(rule.reason !== undefined ? { reason: rule.reason } : {}),
  }))

  return (ctx: BeforeToolCallContext): BeforeToolCallResult | undefined => {
    const name = ctx.toolCall?.name
    if (name === undefined) return undefined
    for (const rule of compiled) {
      if (rule.tool !== '*' && rule.tool !== name) continue
      // No pattern → the rule denies this tool outright.
      if (rule.matches === undefined) return block(rule, name, false)
      // Pattern → deny only when the subject matches. An absent arg field is not
      // a match (a deny-list has nothing to deny when the content is not there).
      const subject = subjectOf(ctx.args, rule.arg)
      if (subject !== undefined && rule.matches.test(subject)) return block(rule, name, true)
    }
    return undefined
  }
}

/** The text a rule tests: a named arg field, or the whole serialized args. */
function subjectOf(args: unknown, arg: string | undefined): string | undefined {
  if (arg === undefined) return safeStringify(args)
  if (typeof args !== 'object' || args === null) return undefined
  const value = (args as Record<string, unknown>)[arg]
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : safeStringify(value)
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function block(rule: CompiledRule, name: string, matched: boolean): BeforeToolCallResult {
  const why = rule.reason ?? `blocked by runtime.pi_policy${matched ? ' (arg matched a deny rule)' : ''}`
  return { block: true, reason: `policy denied '${name}': ${why}` }
}
