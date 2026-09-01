/**
 * Which worker lanes cannot currently authenticate (item 54, 2026-08-29).
 *
 * The first multi-dispatch run on the lane substrate spent all 21 attempts on
 * lanes whose sign-in had lapsed: the picker offers candidates in sorted
 * order, so the dead lane at the head absorbed retry after retry while healthy
 * lanes sat idle. A credential refusal is an ACCOUNT-level fact — the same
 * class as the quota refusals `pgdurable/lane-health.ts` already handles — so
 * it is recorded here and the lane is held out of the pool until it re-auths.
 *
 * Deliberately narrow: only a credential REFUSAL (the provider rejected the
 * lane's sign-in) marks a lane. A transport failure, a model error, or a task
 * failure never does — those are the work failing, not the account.
 *
 * The record is advisory and fails OPEN: an unreadable file offers every lane,
 * and the broker's own refusal is the authoritative, loud check at dispatch.
 * Holding a lane out on a corrupt file would silently shrink the pool, which
 * is the failure this file exists to prevent.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { subsRoot } from '../pgdurable/brain-reserve.ts'

export const LANE_CREDENTIAL_HEALTH_FILE = 'lane-credential-health.json'

export interface LaneCredentialRefusal {
  readonly lane_id: string
  readonly message: string
  readonly recorded_at: string
  /**
   * Fingerprint of the credential that was refused. A re-auth writes new
   * tokens, so a lane whose home no longer matches this is offered again
   * WITHOUT waiting for a dispatch to clear it — otherwise the start gate
   * would refuse the very dispatch that would prove the lane healthy, and a
   * re-authed lane would stay quarantined forever.
   */
  readonly credential_fingerprint: string
  /**
   * For TIME-BOUNDED refusals (a quota window, not a dead credential): the
   * hold expires on its own at this ISO time — the account heals by waiting,
   * no re-auth involved. Absent = the hold stands until the credential
   * changes.
   */
  readonly held_until?: string
}

/**
 * A stable, non-reversible fingerprint of a lane home's current credential.
 * Hashes token material — never stores or logs it. Empty string when the home
 * cannot be read, which never matches a recorded fingerprint (so an
 * unreadable home is treated as changed, and the lane is offered and fails
 * loudly at the broker rather than being silently held out).
 */
function laneHomeKeyFileFingerprint(homePath: string): string {
  let key: string
  try {
    key = readFileSync(join(homePath, 'key'), 'utf8').trim()
  } catch {
    return ''
  }
  if (!key) return ''
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export function laneHomeCredentialFingerprint(homePath: string): string {
  let raw: string
  try {
    raw = readFileSync(join(homePath, 'auth.json'), 'utf8')
  } catch {
    // API-key lane homes (openrouter) have no auth.json — their credential is
    // the `key` file, so its hash is the fingerprint and a re-key self-clears
    // a hold exactly like a re-auth does for OAuth lanes.
    return laneHomeKeyFileFingerprint(homePath)
  }
  let tokens: unknown
  try {
    tokens = (JSON.parse(raw) as { tokens?: unknown }).tokens
  } catch {
    return ''
  }
  if (tokens === null || typeof tokens !== 'object') return ''
  const t = tokens as Record<string, unknown>
  const material = [t.access_token, t.refresh_token].filter((v) => typeof v === 'string').join('\u0000')
  if (!material) return ''
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

export interface LaneCredentialHealth {
  /** Lane id → the refusal that took it out of the pool. */
  readonly refused: ReadonlyMap<string, LaneCredentialRefusal>
}

const EMPTY: LaneCredentialHealth = { refused: new Map() }

function healthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(subsRoot(env), LANE_CREDENTIAL_HEALTH_FILE)
}

export function readLaneCredentialHealth(env: NodeJS.ProcessEnv = process.env): LaneCredentialHealth {
  const path = healthPath(env)
  if (!existsSync(path)) return EMPTY
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return EMPTY
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
  const lanes = (parsed as { refused?: unknown }).refused
  if (lanes === null || typeof lanes !== 'object' || Array.isArray(lanes)) return EMPTY
  const refused = new Map<string, LaneCredentialRefusal>()
  for (const [laneId, entry] of Object.entries(lanes as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    refused.set(laneId, {
      lane_id: laneId,
      message: typeof e.message === 'string' ? e.message : 'credential refused',
      recorded_at: typeof e.recorded_at === 'string' ? e.recorded_at : '',
      credential_fingerprint:
        typeof e.credential_fingerprint === 'string' ? e.credential_fingerprint : '',
      ...(typeof e.held_until === 'string' && e.held_until ? { held_until: e.held_until } : {}),
    })
  }
  return { refused }
}

function writeHealth(health: LaneCredentialHealth, env: NodeJS.ProcessEnv): void {
  const root = subsRoot(env)
  const path = join(root, LANE_CREDENTIAL_HEALTH_FILE)
  const body = {
    schema_version: 1,
    refused: Object.fromEntries(
      [...health.refused.entries()].map(([laneId, entry]) => [
        laneId,
        {
          message: entry.message,
          recorded_at: entry.recorded_at,
          credential_fingerprint: entry.credential_fingerprint,
          ...(entry.held_until ? { held_until: entry.held_until } : {}),
        },
      ]),
    ),
  }
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, path)
  } catch {
    // Advisory only: a health record we cannot persist must never fail the
    // dispatch that observed it. The refusal itself is already on the record.
  }
}

/** Mark a lane unusable until its credential CHANGES (a re-auth). Idempotent. */
export function recordLaneCredentialRefusal(
  laneId: string,
  message: string,
  opts: {
    readonly env?: NodeJS.ProcessEnv
    readonly now?: () => Date
    /** The lane home whose credential was refused — fingerprinted, never stored. */
    readonly homePath?: string
    readonly fingerprint?: string
    /** Time-bounded hold (quota window): expires on its own at this time. */
    readonly heldUntil?: Date
  } = {},
): void {
  const env = opts.env ?? process.env
  const health = readLaneCredentialHealth(env)
  const refused = new Map(health.refused)
  refused.set(laneId, {
    lane_id: laneId,
    message,
    recorded_at: (opts.now?.() ?? new Date()).toISOString(),
    credential_fingerprint:
      opts.fingerprint ?? (opts.homePath ? laneHomeCredentialFingerprint(opts.homePath) : ''),
    ...(opts.heldUntil ? { held_until: opts.heldUntil.toISOString() } : {}),
  })
  writeHealth({ refused }, env)
}

/** A lane that just authenticated is healthy again — re-auth clears itself. */
export function clearLaneCredentialRefusal(
  laneId: string,
  opts: { readonly env?: NodeJS.ProcessEnv } = {},
): void {
  const env = opts.env ?? process.env
  const health = readLaneCredentialHealth(env)
  if (!health.refused.has(laneId)) return
  const refused = new Map(health.refused)
  refused.delete(laneId)
  writeHealth({ refused }, env)
}

/**
 * The credential refusal a JAILED worker's close reason carries, or null.
 *
 * The broker's refusal is typed (`laneUnusable`), but a token the provider
 * killed SERVER-SIDE passes the broker untouched — its exp claim still reads
 * days out, so no refresh runs — and the refusal only surfaces inside the
 * guest run. Route-006 (2026-08-30) fed six straight dispatches to such a
 * lane: the dead lane failed fastest, so it absorbed the route while the
 * healthy lane ground through real work. There is no typed channel out of the
 * guest yet (that is a worker-outcome field for the next bundle admission),
 * so this matches the shapes an ACCOUNT-level refusal is known to wear —
 * credential refusals first:
 *
 *  - "Provided authentication token is expired" — the codex backend's own
 *    refusal body, observed verbatim host-side against the dead token.
 *  - "OAuth refresh failed for <provider>" — pi-ai's ModelsError, reached only
 *    when a credential reads locally expired. A brokered blob leaves the host
 *    with ≥24h of life and no refresh token, and no jailed run lives 24h, so
 *    inside a jailed worker this string always means the provider refused the
 *    access token and the runtime's salvage refresh had nothing to run on.
 *
 * Deliberately narrow, like the rest of this file: transport deaths, model
 * errors, and task failures never match.
 */
export function laneCredentialRefusalFromCloseReason(closeReason: string): string | null {
  if (/provided authentication token is expired/i.test(closeReason)) {
    return 'the provider refused the lane token in-guest: provided authentication token is expired'
  }
  if (/oauth refresh failed for /i.test(closeReason)) {
    return (
      'the provider refused the lane token in-guest (surfaced as an in-guest refresh attempt, ' +
      'which a brokered access-only blob can never satisfy)'
    )
  }
  // Route-007 (2026-08-30, one hour after route-006): a fresh, VALID sign-in
  // whose account is on the free ChatGPT plan — the backend accepts the token
  // and refuses every worker model with this exact detail. Account-level and
  // stable until the plan changes, and a plan change only reaches the token
  // through a new sign-in/refresh, so the fingerprint-bound clear fits. The
  // free lane failed fastest and absorbed 11 of 15 dispatches; a paid sibling
  // (plan 'prolite') served the identical model all day.
  if (/model is not supported when using codex with a chatgpt account/i.test(closeReason)) {
    return (
      "the account's ChatGPT plan does not serve codex worker models (the provider accepted the " +
      'sign-in and refused the model) — put the account on a paid Codex plan or dedicate a ' +
      'different paid account, then re-auth the lane'
    )
  }
  // OpenRouter API-key lanes (2026-08-30): a refused key is account-level and
  // stable until the key changes; the fingerprint (the key file's hash)
  // self-clears the hold when a new key is installed. Rate limits (429) are
  // transient and deliberately NOT matched — the adapter retries those.
  if (/invalid api key|no auth credentials|user not found/i.test(closeReason)) {
    return (
      'the provider refused the lane API key in-guest — install a valid key at the lane home ' +
      "('key' file, 0600) to bring the lane back"
    )
  }
  return null
}

/** Fallback quota hold when the provider names no retry time. */
export const LANE_QUOTA_HOLD_FALLBACK_MS = 35 * 60 * 1000
/** Margin past the provider's own "try again in ~N min" — it is an estimate. */
export const LANE_QUOTA_HOLD_MARGIN_MS = 5 * 60 * 1000

/**
 * The QUOTA refusal a jailed worker's close reason carries, or null — the
 * fourth costume of the absorb pattern (route-008, 2026-08-30): the lane's
 * sign-in and plan were fine, the account had simply spent its usage window,
 * and every subsequent dispatch fast-failed on the same lane while the other
 * lane sat idle. Unlike a credential refusal this heals by WAITING, so the
 * hold carries `held_until` parsed from the provider's own "try again in
 * ~N min" (plus margin), and expires on its own. A credential change also
 * clears it (a different account is fresh capacity).
 */
/** OpenRouter credits heal by a top-up, not a stated window — re-check on a
 *  fixed cadence so the lane returns shortly after Aaron adds credits. */
export const LANE_CREDITS_HOLD_MS = 30 * 60 * 1000

export function laneQuotaHoldFromCloseReason(
  closeReason: string,
  now: () => Date = () => new Date(),
): { readonly message: string; readonly heldUntil: Date } | null {
  if (/insufficient credits/i.test(closeReason)) {
    const heldUntil = new Date(now().getTime() + LANE_CREDITS_HOLD_MS)
    return {
      message:
        `the OpenRouter account is out of credits — top up at openrouter.ai/credits; ` +
        `the lane re-checks at ${heldUntil.toISOString()}`,
      heldUntil,
    }
  }
  if (!/hit your chatgpt usage limit/i.test(closeReason)) return null
  const stated = /try again in ~?(\d+)\s*min/i.exec(closeReason)
  const waitMs = stated
    ? Number(stated[1]) * 60_000 + LANE_QUOTA_HOLD_MARGIN_MS
    : LANE_QUOTA_HOLD_FALLBACK_MS
  const heldUntil = new Date(now().getTime() + waitMs)
  return {
    message:
      `the account hit its ChatGPT usage limit — quota heals by waiting, so the lane is held ` +
      `until ${heldUntil.toISOString()}` +
      (stated ? ` (the provider said try again in ~${stated[1]} min)` : ''),
    heldUntil,
  }
}

/**
 * Why this lane cannot take work right now, or null when it may.
 *
 * `homePath` makes the hold self-clearing: when the home's credential no
 * longer matches the one that was refused, the lane has been re-authed and is
 * offered again immediately. Callers without a home path get the plain record.
 */
export function laneCredentialHold(
  laneId: string,
  health: LaneCredentialHealth,
  homePath?: string,
  now: () => Date = () => new Date(),
): string | null {
  const entry = health.refused.get(laneId)
  if (!entry) return null
  // A time-bounded hold (quota window) expires on its own — the account
  // healed by waiting, and no credential change is coming to clear it.
  if (entry.held_until) {
    const until = Date.parse(entry.held_until)
    if (Number.isFinite(until) && now().getTime() >= until) return null
  }
  if (homePath !== undefined && entry.credential_fingerprint) {
    const current = laneHomeCredentialFingerprint(homePath)
    // Re-authed since the refusal — the record is stale, not the lane.
    if (current && current !== entry.credential_fingerprint) return null
  }
  const when = entry.recorded_at ? ` (observed ${entry.recorded_at})` : ''
  // Surface the RECORDED refusal, not a fixed 'sign-in lapsed': a plan-gated
  // account (route-007) has a perfectly valid sign-in, and telling the
  // operator to re-auth it would loop them straight back here.
  const why = entry.message || 'sign-in lapsed'
  return `${why}${when} — a new credential (re-auth under Settings → Subscriptions) clears this hold`
}
