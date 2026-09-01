/**
 * Stale-duplicate detection for worker lane credentials (item 54, 2026-08-29).
 *
 * A rotating OAuth credential has exactly one live copy: when any tool
 * refreshes an account, the provider rotates the refresh token and every OTHER
 * copy of that account on the machine dies. So two credential homes for one
 * account is not redundancy — it is a machine that breaks itself on a timer.
 *
 * That is what took all four Waypoint worker lanes out: three of the four
 * accounts had a live credential on this machine the whole time (two under the
 * other product's subs root, one in the codex CLI's own store) while Waypoint
 * held month-old copies that answered HTTP 401. Re-authing Waypoint's copy
 * "fixes" it until the other tool signs in again.
 *
 * This module only READS account identity and issue time — never token
 * material, never another store's secrets — so a 401 can say what is actually
 * wrong: *this account is live somewhere else; Waypoint's copy is the stale
 * duplicate*. It moves nothing and deletes nothing.
 *
 * POLICY (Aaron, 2026-08-29): Waypoint's worker pool uses only accounts nothing
 * else on this machine signs into. A CONTESTED account — one another store
 * also holds — is held out of the pool from the start, because the alternative
 * is a lane that works until the other tool next refreshes and then fails in
 * the middle of a run. Held out is not deleted: the home stays exactly where
 * the operator put it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { decodeJwtPayload, CODEX_JWT_AUTH_CLAIM } from '../runtime/lane-cred-broker.ts'

/** Credential stores other tools on this machine keep for the same accounts. */
export function defaultForeignCredentialStores(home = homedir()): readonly string[] {
  return [
    join(home, '.codex'), // the codex CLI's own store
    join(home, '.waypoint', 'subs'), // the sibling product's lane homes
    // The pi runtime's DEFAULT store (family-keyed, one file). Any pi process
    // launched without a designated config dir reads and refreshes this file —
    // route-006 (2026-08-30) died because it still held a worker account's
    // old brain-era credential, and a brain session's refresh there rotated
    // the account server-side while this scan couldn't see the copy.
    join(home, '.pi', 'agent'),
  ]
}

export interface CredentialCopy {
  /** Absolute path of the auth.json holding this copy. */
  readonly path: string
  /** Provider account id from the access token's claim; null when opaque. */
  readonly accountId: string | null
  /** Access-token issue time (ms), or null when undecodable. */
  readonly issuedAtMs: number | null
  readonly expiresAtMs: number | null
}

/**
 * A codex access token + the account id recorded beside it, from either store
 * shape this machine actually has: the codex-CLI home (`{tokens:
 * {access_token, account_id}}`, also Waypoint's and Waypoint's lane homes)
 * or the pi runtime's family-keyed default store (`{'openai-codex': {access,
 * accountId}}`). Two shapes, one meaning — a copy of a codex account's
 * rotating credential.
 */
function codexAccessFromStore(
  parsed: Record<string, unknown>,
): { access: string; accountIdOnDisk: string | null } | null {
  const tokens = parsed.tokens
  if (tokens !== null && typeof tokens === 'object') {
    const t = tokens as Record<string, unknown>
    if (typeof t.access_token === 'string' && t.access_token) {
      return {
        access: t.access_token,
        accountIdOnDisk: typeof t.account_id === 'string' && t.account_id ? t.account_id : null,
      }
    }
  }
  const entry = parsed['openai-codex']
  if (entry !== null && typeof entry === 'object') {
    const e = entry as Record<string, unknown>
    if (typeof e.access === 'string' && e.access) {
      return {
        access: e.access,
        accountIdOnDisk: typeof e.accountId === 'string' && e.accountId ? e.accountId : null,
      }
    }
  }
  return null
}

function readCopy(authPath: string): CredentialCopy | null {
  let raw: string
  try {
    raw = readFileSync(authPath, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const found = codexAccessFromStore(parsed as Record<string, unknown>)
  if (!found) return null
  const payload = decodeJwtPayload(found.access)
  const claim = payload?.[CODEX_JWT_AUTH_CLAIM]
  const claimAccountId =
    claim !== null && typeof claim === 'object'
      ? ((claim as Record<string, unknown>).chatgpt_account_id as string | undefined) ?? null
      : null
  const iat = payload?.iat
  const exp = payload?.exp
  return {
    path: authPath,
    // The token's own claim wins; the value recorded beside it covers opaque
    // (non-JWT) tokens — same precedence as the broker's accountIdFor.
    accountId:
      typeof claimAccountId === 'string' && claimAccountId ? claimAccountId : found.accountIdOnDisk,
    issuedAtMs: typeof iat === 'number' ? iat * 1000 : null,
    expiresAtMs: typeof exp === 'number' ? exp * 1000 : null,
  }
}

/** Every codex credential copy under the given roots (one level of homes). */
export function listCredentialCopies(roots: readonly string[]): CredentialCopy[] {
  const found: CredentialCopy[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    // A store may itself be a home (~/.codex/auth.json) …
    const direct = readCopy(join(root, 'auth.json'))
    if (direct) found.push(direct)
    // … or a root of per-account homes (…/subs/<home>/auth.json).
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries.sort()) {
      const dir = join(root, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      const copy = readCopy(join(dir, 'auth.json'))
      if (copy) found.push(copy)
    }
  }
  return found
}

/** The account this lane home holds, or null when it is unreadable/opaque. */
export function laneHomeAccountId(laneHomePath: string): string | null {
  return readCopy(join(laneHomePath, 'auth.json'))?.accountId ?? null
}

/**
 * Accounts held by stores OUTSIDE Waypoint's own subs root, mapped to WHERE the
 * other copy lives. Computed once per pick and shared across candidates — the
 * picker must not re-scan the disk per lane. The path is the point: "another
 * tool" is a mystery, `~/.codex/auth.json` is an action.
 */
export function foreignAccountHomes(stores?: readonly string[]): ReadonlyMap<string, string> {
  const held = new Map<string, string>()
  for (const copy of listCredentialCopies(stores ?? defaultForeignCredentialStores())) {
    if (copy.accountId && !held.has(copy.accountId)) held.set(copy.accountId, copy.path)
  }
  return held
}

/**
 * Why this lane is out of the pool under the dedicated-accounts policy, or
 * null when the account is Waypoint's alone.
 *
 * Fails OPEN on an unreadable home: a lane we cannot identify is offered and
 * fails loudly at the broker rather than being silently held out — silently
 * shrinking the pool is the failure this whole area exists to prevent.
 */
export function contestedAccountHold(
  laneHomePath: string,
  foreign: ReadonlyMap<string, string>,
): string | null {
  const accountId = laneHomeAccountId(laneHomePath)
  if (!accountId) return null
  const elsewhere = foreign.get(accountId)
  if (!elsewhere) return null
  return (
    `this account is also signed in at ${elsewhere}, so a rotation there would kill this ` +
    "lane mid-run — Waypoint's worker pool uses only dedicated accounts. Either give Waypoint its " +
    'own subscription for this lane, or stop using this account elsewhere'
  )
}

/**
 * A one-line, operator-readable note when this lane home's account has a
 * FRESHER copy elsewhere on the machine — or undefined when it does not.
 * Undefined is the honest answer for "nothing else holds this account", which
 * means the lane genuinely needs a re-auth.
 */
export function staleDuplicateNote(
  laneHomePath: string,
  opts: { readonly stores?: readonly string[]; readonly now?: () => Date } = {},
): string | undefined {
  const mine = readCopy(join(laneHomePath, 'auth.json'))
  if (!mine?.accountId) return undefined
  const stores = opts.stores ?? defaultForeignCredentialStores()
  const fresher = listCredentialCopies(stores)
    .filter((copy) => copy.accountId === mine.accountId && copy.path !== mine.path)
    .filter((copy) => (copy.issuedAtMs ?? 0) > (mine.issuedAtMs ?? 0))
    .sort((a, b) => (b.issuedAtMs ?? 0) - (a.issuedAtMs ?? 0))
  const best = fresher[0]
  if (!best) return undefined
  const now = (opts.now?.() ?? new Date()).getTime()
  const live = best.expiresAtMs !== null && best.expiresAtMs > now
  return (
    `this account also has a ${live ? 'LIVE' : 'newer'} credential at ${best.path} — ` +
    `Waypoint's copy is a stale duplicate, not a lapsed account. A rotating credential has one live ` +
    `copy: whichever tool refreshes it invalidates every other copy. Re-authing here works until ` +
    `the other tool signs in again; the durable fix is one home per account (dedicate the account ` +
    `to one tool, or point both at the same home).`
  )
}
