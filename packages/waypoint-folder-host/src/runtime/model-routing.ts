import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'

import type { RecipeModelClass } from './work-order.ts'

/**
 * Provider/model registry (rsc-bpg phase 2 — multi-provider routing).
 *
 * Phase 1 (2026-07-05) mapped a capability class to CLI ARGS on the one fixed
 * agent command (`runtime.worker.model_args`, e.g. high → `--model opus`). That
 * is Claude-only by construction: the command is `claude -p` and the args only
 * pick which Claude. As the runtime pivots to pi.dev (rsc-wwm, decision A), a
 * class must resolve to a concrete (PROVIDER, MODEL) pair the pi runtime can hand
 * a provider — anthropic, openai-codex, xai, … — not a Claude CLI flag.
 *
 * Two pieces, and the split is deliberate:
 *
 *  - The PROVIDER REGISTRY is USER-level (`~/.waypoint/config.yaml` →
 *    `model_providers:`): the subscriptions and API keys THIS operator actually
 *    has, keyed by pi provider id. It is the source of truth for what is
 *    reachable at all. (A separate key from the Console's own `providers:` block,
 *    which has a different schema — see loadProviderRegistry.)
 *  - The MODEL TARGETS are PROJECT-level (`.waypoint/config.yaml` →
 *    `runtime.model_targets`): class → {provider, model}. A project can name any
 *    target, but a target only RESOLVES if its provider is in the user's registry.
 *
 * SUBSCRIPTION-FIRST is enforced here, not just documented: an `api_key` provider
 * must be named in the registry explicitly, and a target whose provider is absent
 * fails closed with a message that says how to add it. Nothing silently falls back
 * to a metered API — the exact billing preference the whole pivot rests on.
 */

/** How a provider authenticates. `subscription` = OAuth/plan (non-metered, the
 *  default preference); `api_key` = a metered API, opt-in only. */
export type ProviderAuthKind = 'subscription' | 'api_key'

export interface ProviderRegistryEntry {
  readonly auth: ProviderAuthKind
}

/**
 * The providers the user has configured, keyed by pi provider id (`anthropic`,
 * `openai-codex`, `xai`, …). A provider ABSENT from this map is unavailable —
 * that absence is the subscription-first guard, so an unconfigured provider is
 * never reachable by a project's model target.
 */
export type ProviderRegistry = Readonly<Record<string, ProviderRegistryEntry>>

/** A concrete routing target: which provider, which model. Provider-agnostic —
 *  the shape the pi runtime consumes and the Claude worker derives `--model`
 *  from. */
export interface ModelTarget {
  readonly provider: string
  readonly model: string
}

/** Project-level class → target map (`runtime.model_targets`). */
export type ModelTargets = Partial<Readonly<Record<RecipeModelClass, ModelTarget>>>

export type ResolveModelTargetResult =
  | { readonly ok: true; readonly target: ModelTarget; readonly auth: ProviderAuthKind }
  | { readonly ok: false; readonly reason: string }

/**
 * Resolve a capability class to a concrete (provider, model), or fail closed.
 *
 * Fails when the class has no target (the project has not routed it) OR when the
 * target names a provider the user has not registered. The second case is the
 * subscription-first guard: it never substitutes a different provider, it reports
 * exactly which provider is missing and where to add it.
 */
export function resolveModelTarget(
  modelClass: RecipeModelClass,
  opts: { readonly modelTargets?: ModelTargets; readonly registry: ProviderRegistry },
): ResolveModelTargetResult {
  const target = opts.modelTargets?.[modelClass]
  if (target === undefined) {
    return { ok: false, reason: `no model target configured for class '${modelClass}' (add runtime.model_targets.${modelClass} to .waypoint/config.yaml)` }
  }
  const entry = opts.registry[target.provider]
  if (entry === undefined) {
    const known = Object.keys(opts.registry)
    return {
      ok: false,
      reason:
        `class '${modelClass}' targets provider '${target.provider}', which is not in your provider registry ` +
        `(${known.length > 0 ? `configured: ${known.join(', ')}` : 'no providers configured'}). ` +
        `Add it under 'model_providers:' in ~/.waypoint/config.yaml — providers are opt-in, never a silent default.`,
    }
  }
  return { ok: true, target, auth: entry.auth }
}

/** Parse `runtime.model_targets` from a project config (tolerant: a malformed
 *  entry is dropped, not fatal — a bad target should surface at resolve time with
 *  a clear message, not blow up config load). */
export function parseModelTargets(value: unknown): ModelTargets | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, ModelTarget> = {}
  for (const cls of ['high', 'medium', 'low'] as const) {
    const raw = value[cls]
    if (!isRecord(raw)) continue
    const provider = nonEmpty(raw.provider)
    const model = nonEmpty(raw.model)
    if (provider === undefined || model === undefined) continue
    out[cls] = { provider, model }
  }
  return Object.keys(out).length > 0 ? (out as ModelTargets) : undefined
}

/** Parse a `providers:` block into a registry. Unknown auth values default to
 *  `api_key` (the conservative reading: treat an unclear provider as metered and
 *  opt-in, never as a free subscription). */
export function parseProviderRegistry(value: unknown): ProviderRegistry {
  if (!isRecord(value)) return {}
  const registry: Record<string, ProviderRegistryEntry> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (id.trim() === '') continue
    const auth: ProviderAuthKind = isRecord(raw) && raw.auth === 'subscription' ? 'subscription' : 'api_key'
    registry[id] = { auth }
  }
  return registry
}

/**
 * Load the user-level provider registry from `<config home>/config.yaml`
 * (`WAYPOINT_CONFIG_HOME` honored, as the bridge registry and the global
 * worker command are). Tolerant read: a missing or unparseable file is simply an
 * empty registry — which, under the subscription-first guard, means every target
 * fails closed with a message telling the operator to configure a provider.
 *
 * KEY: `model_providers:`, deliberately NOT the Console's own `providers:` block.
 * The Console populates `providers:` with its own schema (`{cli, kind, default}`,
 * keyed by Console names like `codex`/`claude`); this registry is keyed by pi
 * PROVIDER ID (`openai-codex`/`anthropic`) with an `auth` kind, and drives pi
 * model routing. Separate concerns, separate keys — decided 2026-07-18 to avoid
 * a same-key schema collision that silently misread subscriptions as api_key.
 */
export async function loadProviderRegistry(env: NodeJS.ProcessEnv = process.env): Promise<ProviderRegistry> {
  const home = env.WAYPOINT_CONFIG_HOME?.trim()
  const path = join(home !== undefined && home !== '' ? home : join(homedir(), '.waypoint'), 'config.yaml')
  try {
    const parsed = yamlParse(await readFile(path, 'utf8')) as { model_providers?: unknown } | null
    return parseProviderRegistry(parsed?.model_providers)
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
