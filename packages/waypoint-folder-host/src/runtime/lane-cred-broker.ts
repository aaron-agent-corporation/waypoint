/**
 * Per-lane credential brokering for cloud cordis workers (L4 of the lane
 * conversion, docs/designs/sprite-lane-conversion.md; refresh residency
 * corrected during item 54 — see the 2026-08-29 ledger entry).
 *
 * Workers broker the PICKED lane's credential — never the shared pi store
 * (`~/.pi/agent/auth.json`), which is the brain's account. That makes
 * brain/worker account exclusivity structural: the worker path has no code
 * that can read the brain's store, so a worker can never rotate the brain's
 * refresh token out from under it (the 2026-07-28 six-run incident class).
 *
 * REFRESH IS HOST-SIDE, AND THE REFRESH TOKEN NEVER LEAVES THE HOST. The
 * original L4 shape shipped `{access, refresh}` into the guest; the guest
 * refreshed when the access token had expired, received the ROTATED refresh
 * token, and threw it away with the rest of its in-memory store at exit — so
 * the lane home kept presenting the used token, and the first multi-dispatch
 * run burned every codex lane (rotation loss → refresh refused). Now the
 * broker refreshes here, WHILE THE LANE LOCK IS HELD (one writer per lane,
 * across products), persists the rotated tokens atomically into the lane
 * home before anything uses them, and hands the guest a short-lived
 * ACCESS-ONLY blob. Codex access tokens live ~10 days; a refresh window of
 * 24h means no task can outlive its brokered access token.
 *
 * Codex and openrouter are implemented; kimi/grok fail closed with an honest
 * message until their shapes are spiked. A husk (home without token material)
 * fails closed: auth failures re-auth via the Console (Settings →
 * Subscriptions), never roll over to another store.
 *
 * OPENROUTER LANES ARE API-KEY LANES (Aaron, 2026-08-30: "wire up
 * OpenRouter"): the home holds one static key at `<home>/key` (0600), the
 * blob is pi's native ApiKeyCredential `{type:'api_key', key}` — the
 * ADMITTED guest bundle resolves it through the same brokered store with no
 * guest change (pi-ai's bundled catalog carries the openrouter provider and
 * its models). No refresh, no rotation, no single-active-session: an API-key
 * lane cannot be killed by another sign-in, which removes three of the four
 * lane-absorb costumes by construction. The key never rides argv/exec-env —
 * same staged-file residency as OAuth blobs.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Mirrors pi-ai's openai-codex OAuth flow (public PKCE client — not a secret). */
export const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
/** Refresh when the access token has less life than this left. */
export const LANE_ACCESS_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000
/** Where codex access tokens carry their account binding (pi reads the same). */
export const CODEX_JWT_AUTH_CLAIM = 'https://api.openai.com/auth'

/** Decode a JWT's payload without verification — informational reads only
 *  (lane attribution, token expiry), never an auth decision. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.')
  if (segments.length < 2) return null
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(segments[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    )
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The account this access token is bound to, read from its OWN claim — the
 * same derivation pi uses (`getAccountId`). Never trust a stale `account_id`
 * on disk over the token in hand: a refresh can move the binding, and a
 * mismatched account id is rejected by the backend at request time, which
 * surfaces as a transport error rather than an auth one.
 */
export function codexAccountIdFromAccessToken(access: string): string | null {
  const claim = decodeJwtPayload(access)?.[CODEX_JWT_AUTH_CLAIM]
  if (claim === null || typeof claim !== 'object') return null
  const accountId = (claim as Record<string, unknown>).chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null
}

export interface WorkerLaneCredentialInput {
  /** The RESOLVED pi provider id the recipe routes to (e.g. 'openai-codex'). */
  readonly piProvider: string
  /** The picked lane (L3 picker shape): Console provider + home path. */
  readonly consoleProvider: string
  readonly homePath: string
}

export type WorkerLaneCredentialResult =
  | { readonly ok: true; readonly blob: string }
  | {
      readonly ok: false
      readonly problem: string
      /**
       * True when the ACCOUNT is what refused — the provider rejected this
       * lane's sign-in, or the home holds no usable token material. Only these
       * take a lane out of the pool (sandbox/lane-credential-health.ts); a
       * network blip or a failed persist is the host failing, not the account,
       * and must never quarantine a lane. Typed rather than pattern-matched:
       * lane-health's regexes missed a wording change once and burned a whole
       * batch of dispatches on an exhausted account.
       */
      readonly laneUnusable?: boolean
    }

export interface ResolveLaneCredentialOptions {
  /** Test seam for the refresh POST. Default: global fetch. */
  readonly fetchImpl?: typeof fetch
  readonly now?: () => Date
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** The guest blob: pi-format credential, ACCESS ONLY — `refresh` is
 *  deliberately empty so the value can never ride the tar leg. */
function accessOnlyBlob(
  piProvider: string,
  access: string,
  expiresMs: number,
  accountId: string | undefined,
): string {
  const credential: Record<string, unknown> = {
    type: 'oauth',
    access,
    refresh: '',
    expires: expiresMs,
    ...(accountId ? { accountId } : {}),
  }
  return JSON.stringify({ provider: piProvider, credential })
}

function accessExpiryMs(access: string): number | null {
  const exp = decodeJwtPayload(access)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/**
 * Refresh the codex lane's tokens against auth.openai.com and PERSIST the
 * rotation into the lane home before returning. Persist-before-use: a rotated
 * refresh token that is not on disk is a lane-killing loss, so a persist
 * failure fails the attempt rather than handing out the new access token.
 */
async function refreshCodexLaneHome(
  homePath: string,
  auth: Record<string, unknown>,
  tokens: Record<string, unknown>,
  refresh: string,
  opts: ResolveLaneCredentialOptions,
): Promise<
  | { ok: true; access: string; expiresMs: number }
  | { ok: false; problem: string; laneUnusable?: boolean }
> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }),
    })
  } catch (error) {
    return {
      ok: false,
      problem:
        `openai-codex token refresh could not reach ${CODEX_OAUTH_TOKEN_URL}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!response.ok) {
    let code = ''
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') code = ` ${body.error}`
    } catch {
      // status alone is the evidence
    }
    return {
      ok: false,
      laneUnusable: true,
      problem:
        `openai-codex token refresh refused (HTTP ${response.status}${code}) — the lane's sign-in has ` +
        `lapsed; re-auth it under Settings → Subscriptions (auth failures re-auth, never roll over)`,
    }
  }
  let payload: Record<string, unknown>
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch (error) {
    return {
      ok: false,
      problem: `openai-codex token refresh returned an unreadable body: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const access = typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!access) return { ok: false, problem: 'openai-codex token refresh returned no access_token' }

  // Persist the rotation ATOMICALLY before anything uses the new tokens —
  // preserve unknown fields, keep codex-CLI shape so the Console and CLI
  // still read the home.
  const nextTokens: Record<string, unknown> = { ...tokens, access_token: access }
  if (typeof payload.refresh_token === 'string' && payload.refresh_token) {
    nextTokens.refresh_token = payload.refresh_token
  }
  if (typeof payload.id_token === 'string' && payload.id_token) {
    nextTokens.id_token = payload.id_token
  }
  const next: Record<string, unknown> = {
    ...auth,
    tokens: nextTokens,
    last_refresh: (opts.now?.() ?? new Date()).toISOString(),
  }
  const target = join(homePath, 'auth.json')
  const tmp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, target)
  } catch (error) {
    return {
      ok: false,
      problem:
        `refreshed openai-codex tokens could not be persisted to the lane home (${target}): ` +
        `${error instanceof Error ? error.message : String(error)} — refusing to use an unpersisted rotation`,
    }
  }
  const expiresMs = accessExpiryMs(access)
  return { ok: true, access, expiresMs: expiresMs ?? 0 }
}

/** Account id for the blob: the token's own claim wins; the lane home's
 *  recorded value is the fallback for opaque (non-JWT) access tokens. */
function accountIdFor(access: string, tokens: Record<string, unknown>): string | undefined {
  const fromToken = codexAccountIdFromAccessToken(access)
  if (fromToken) return fromToken
  return typeof tokens.account_id === 'string' && tokens.account_id ? tokens.account_id : undefined
}

async function resolveCodexLaneCredential(
  input: WorkerLaneCredentialInput,
  opts: ResolveLaneCredentialOptions,
): Promise<WorkerLaneCredentialResult> {
  const auth = readJsonObject(join(input.homePath, 'auth.json'))
  const tokens = auth?.tokens
  if (!auth || !tokens || typeof tokens !== 'object') {
    return {
      ok: false,
      laneUnusable: true,
      problem:
        `lane '${input.homePath}' has no token material in auth.json — the lane is signed out; ` +
        `re-auth it under Settings → Subscriptions (never rolled over to another store)`,
    }
  }
  const t = tokens as Record<string, unknown>
  const access = typeof t.access_token === 'string' ? t.access_token : ''
  const refresh = typeof t.refresh_token === 'string' ? t.refresh_token : ''
  if (!access || !refresh) {
    return {
      ok: false,
      laneUnusable: true,
      problem:
        `lane '${input.homePath}' auth.json tokens are incomplete (need access_token and refresh_token) — ` +
        `re-auth the lane under Settings → Subscriptions`,
    }
  }
  const now = (opts.now?.() ?? new Date()).getTime()
  const expiresMs = accessExpiryMs(access)
  if (expiresMs !== null && expiresMs - now > LANE_ACCESS_REFRESH_WINDOW_MS) {
    return {
      ok: true,
      blob: accessOnlyBlob(input.piProvider, access, expiresMs, accountIdFor(access, t)),
    }
  }
  const refreshed = await refreshCodexLaneHome(input.homePath, auth, t, refresh, opts)
  if (!refreshed.ok) return refreshed
  return {
    ok: true,
    blob: accessOnlyBlob(
      input.piProvider,
      refreshed.access,
      refreshed.expiresMs,
      // Derived from the token just issued — never the pre-refresh disk value.
      accountIdFor(refreshed.access, t),
    ),
  }
}

/**
 * Resolve the brokered-credential blob (`{provider, credential}` JSON, the
 * WAYPOINT_PI_BROKERED_CRED payload shape) from the picked lane's home,
 * refreshing host-side when the access token is inside its refresh window.
 *
 * CALL THIS WHILE THE LANE LOCK IS HELD: the persist makes this the lane
 * home's writer, and the pg session lock is what serializes writers across
 * bridge processes and products.
 */
/**
 * Console providers whose lane-home credential Waypoint can actually derive.
 * Codex (OAuth) and openrouter (API key) are implemented; kimi and grok are
 * recognised worker-lane providers with no derivation yet.
 */
export const LANE_BROKER_IMPLEMENTED_PROVIDERS = ['codex', 'openrouter'] as const

/** The one file an openrouter lane home holds: the API key, 0600. */
export const OPENROUTER_LANE_KEY_FILE = 'key'

/**
 * An openrouter lane's credential is a static API key — no refresh, no
 * rotation, no account session to collide with. Read it from the lane home
 * and hand the guest pi's native ApiKeyCredential shape. A missing or empty
 * key file is the account-shaped refusal (laneUnusable): the lane is held
 * until a key is installed, and the health fingerprint (the key file's hash)
 * self-clears the hold when the key changes.
 */
function resolveOpenrouterLaneCredential(input: WorkerLaneCredentialInput): WorkerLaneCredentialResult {
  const keyPath = join(input.homePath, OPENROUTER_LANE_KEY_FILE)
  let key = ''
  try {
    key = readFileSync(keyPath, 'utf8').trim()
  } catch {
    key = ''
  }
  if (!key) {
    return {
      ok: false,
      laneUnusable: true,
      problem:
        `openrouter lane '${input.homePath}' has no API key — install one at ${keyPath} ` +
        `(0600, the key alone on one line) to bring the lane into the pool`,
    }
  }
  const credential = { type: 'api_key', key }
  return { ok: true, blob: JSON.stringify({ provider: input.piProvider, credential }) }
}

/**
 * Why a lane of this provider cannot take work, or null when it can.
 *
 * The start gate and the picker both ask this BEFORE offering a lane. Without
 * it "signed in" is a file-shape test all over again: a grok or kimi home has
 * token material, passes every identity check, is handed a dispatch, and dies
 * at the broker — after the route started and the lock was taken.
 */
export function laneBrokerSupportHold(consoleProvider: string): string | null {
  const slug = consoleProvider.trim().toLowerCase()
  if ((LANE_BROKER_IMPLEMENTED_PROVIDERS as readonly string[]).includes(slug)) return null
  if (slug === 'kimi' || slug === 'grok') {
    return (
      `Waypoint cannot broker a '${slug}' lane credential yet — worker-lane derivation is ` +
      'implemented for codex and openrouter only, so this subscription cannot run workers however it is signed in'
    )
  }
  return `'${slug}' is not a worker-lane Console provider (codex, openrouter, kimi, grok)`
}

export async function resolveLaneBrokeredCredential(
  input: WorkerLaneCredentialInput,
  opts: ResolveLaneCredentialOptions = {},
): Promise<WorkerLaneCredentialResult> {
  const consoleProvider = input.consoleProvider.trim().toLowerCase()
  if (consoleProvider === 'codex') return resolveCodexLaneCredential(input, opts)
  if (consoleProvider === 'openrouter') return resolveOpenrouterLaneCredential(input)
  // One vocabulary: the same helper the picker and the start gate ask, so a
  // lane can never be offered upstream and refused here for different reasons.
  return { ok: false, problem: laneBrokerSupportHold(consoleProvider) ?? 'unsupported lane provider' }
}
