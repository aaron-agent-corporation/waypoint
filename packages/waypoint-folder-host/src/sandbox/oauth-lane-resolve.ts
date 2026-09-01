/**
 * Dispatch-time OAuth / Console subscription lane resolution for Cordis
 * workers (L3 of the lane conversion, docs/designs/sprite-lane-conversion.md;
 * ported from the Waypoint guide with Waypoint's deltas).
 *
 * model_class → resolveModelTarget → pi provider → matching signed-in Console
 * subscription homes → pick a free lane (pg session advisory lock) → the lane
 * sprite. The picker returns the HELD lock handle — the runtime adopts it and
 * releases on every exit path; it is never re-acquired (self-deadlock trap).
 *
 * Waypoint deltas over the guide:
 *  1. Anthropic never rides a worker lane. The provider map has no claude
 *     entry, `claude-*` homes are not listed, and 'anthropic'/'claude' pi
 *     providers refuse via the item-53 ruling (`runtime/cordis-only.ts`).
 *  2. Brain-lane exclusivity: a lane whose account email is in the Console's
 *     brain-in-use registry is HELD OUT of the pool (pgdurable/brain-reserve).
 *     Held is not quarantined — the moment the registry changes it serves.
 *  2b. A lane whose credential was REFUSED is held out too, until it re-auths
 *     (sandbox/lane-credential-health.ts, item 54): the picker offers
 *     candidates in sorted order, so without this a lapsed lane at the head
 *     absorbs every retry while healthy lanes sit idle.
 *  4. Lane ids are `sub:<home-dir-name>` and lock keys share Waypoint's
 *     keyspace: both Consoles slug homes as `<provider>-<email-slug>`, so the
 *     same account yields the same lane id, the same lock, and the same
 *     sprite name across products — one account, one sprite, one lock,
 *     globally.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  brainFamilyAmbiguityHold,
  laneBrainHold,
  readBrainReserve,
  subsRoot,
  type BrainReserve,
} from '../pgdurable/brain-reserve.ts'
import {
  laneCredentialHold,
  readLaneCredentialHealth,
  type LaneCredentialHealth,
} from './lane-credential-health.ts'
import { contestedAccountHold, foreignAccountHomes } from './lane-credential-duplicates.ts'
import { laneBrokerSupportHold } from '../runtime/lane-cred-broker.ts'
import { workerLaneProviderProblem } from '../runtime/cordis-only.ts'
import { decodeJwtPayload } from '../runtime/lane-cred-broker.ts'
import { stableOauthSandboxName } from './provider.ts'
import type { CordisLanePicker } from '../runtime/cordis-jailed-runtime.ts'
import { LANE_LOCK_NOTICE_MS, LANE_LOCK_WAIT_MS } from './oauth-lane-lock.ts'
import type { OauthLaneLockHandle, OauthLaneLocks } from './oauth-lane-lock.ts'

export { stableOauthSandboxName }

/**
 * Console subscription providers a WORKER lane may ride (folder prefix under
 * the subs root). No 'claude' — delta 1; the brain's Anthropic-by-API-key
 * option never rides a worker lane.
 */
export const WORKER_LANE_CONSOLE_PROVIDERS = ['codex', 'openrouter', 'kimi', 'grok'] as const
export type WorkerLaneConsoleProvider = (typeof WORKER_LANE_CONSOLE_PROVIDERS)[number]

export interface SubscriptionHome {
  readonly id: string
  readonly provider: WorkerLaneConsoleProvider
  readonly homePath: string
  readonly signedIn: boolean
  /** Account email when the credential names one (codex id_token); else null. */
  readonly email: string | null
}

export interface PickedOauthLane {
  readonly oauth_lane_id: string
  readonly oauth_provider_slug: string
  readonly homePath: string
  readonly subscriptionId: string
  readonly consoleProvider: WorkerLaneConsoleProvider
  readonly email: string | null
  readonly envInject: Readonly<Record<string, string>>
  readonly queue_wait_ms: number
  /** HELD — adopt it; never re-acquire; release on every exit path. */
  readonly lock: OauthLaneLockHandle
  /** Lane sprite name (hash slug — never an email). */
  readonly sandbox_name: string
}

/** Host-side lane home env names — no CLAUDE_CONFIG_DIR by design (delta 1).
 *  Informational: the guest gets only the brokered blob (lane-cred-broker),
 *  never a home dir. */
const CRED_HOME_ENV: Record<WorkerLaneConsoleProvider, string> = {
  codex: 'CODEX_HOME',
  openrouter: 'OPENROUTER_HOME',
  kimi: 'KIMI_CODE_HOME',
  grok: 'GROK_HOME',
}

/**
 * Map a pi provider id (model_targets / registry) to a worker-lane Console
 * provider. Anthropic deliberately has no mapping — callers get the item-53
 * refusal before this is consulted.
 */
export function workerLaneConsoleProviderForPiProvider(
  piProvider: string,
): WorkerLaneConsoleProvider | null {
  const id = piProvider.trim().toLowerCase()
  if (id === 'openai-codex' || id === 'codex' || id === 'openai') return 'codex'
  if (id === 'openrouter') return 'openrouter'
  if (id === 'kimi' || id === 'moonshot') return 'kimi'
  if (id === 'xai' || id === 'grok') return 'grok'
  return null
}

/** The item-53 lane ruling, with 'claude' normalized onto it. */
export function anthropicWorkerLaneRefusal(piProvider: string): string | undefined {
  const id = piProvider.trim().toLowerCase()
  return workerLaneProviderProblem(id === 'claude' ? 'anthropic' : id)
}

/** Opaque lane id for locks + sprite naming input — never an email. */
export function oauthLaneIdForSubscription(subscriptionId: string): string {
  const id = subscriptionId.trim()
  if (!id) throw new Error('oauth lane id refused: empty subscription id')
  if (id.startsWith('sub:')) return id
  return `sub:${id}`
}

export function envInjectForSubscriptionHome(
  provider: WorkerLaneConsoleProvider,
  homePath: string,
): Readonly<Record<string, string>> {
  return { [CRED_HOME_ENV[provider]]: homePath }
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

/**
 * Email claim from a JWT payload, without verification — informational lane
 * attribution for the brain hold, never an auth decision. Returns null on any
 * shape surprise (fail open, per brain-reserve doctrine).
 */
function emailFromJwt(idToken: string): string | null {
  const email = decodeJwtPayload(idToken)?.email
  return typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : null
}

/** Signed-in = the credential file carries token material. Husks read signed-out. */
function inspectHome(
  provider: WorkerLaneConsoleProvider,
  homePath: string,
): { signedIn: boolean; email: string | null } {
  if (provider === 'codex') {
    const auth = readJsonObject(join(homePath, 'auth.json'))
    const tokens = auth?.tokens
    if (!tokens || typeof tokens !== 'object') return { signedIn: false, email: null }
    const idToken = (tokens as Record<string, unknown>).id_token
    if (typeof idToken !== 'string' || idToken.length === 0) return { signedIn: false, email: null }
    return { signedIn: true, email: emailFromJwt(idToken) }
  }
  if (provider === 'openrouter') {
    // API-key lane: "signed in" = a non-empty key file (lane-cred-broker's
    // OPENROUTER_LANE_KEY_FILE). No account email — keys have no session.
    try {
      const key = readFileSync(join(homePath, 'key'), 'utf8').trim()
      return { signedIn: key.length > 0, email: null }
    } catch {
      return { signedIn: false, email: null }
    }
  }
  if (provider === 'kimi') {
    const credentials = readJsonObject(join(homePath, 'credentials', 'kimi-code.json'))
    const signedIn = typeof credentials?.refresh_token === 'string' && credentials.refresh_token.length > 0
    return { signedIn, email: null }
  }
  // grok
  const auth = readJsonObject(join(homePath, 'auth.json'))
  if (!auth) return { signedIn: false, email: null }
  for (const entry of Object.values(auth)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (e.refresh_token || e.key) return { signedIn: true, email: null }
  }
  return { signedIn: false, email: null }
}

/** List worker-eligible Console subscription homes under the subs root. */
export function listSubscriptionHomes(opts?: {
  readonly root?: string
  readonly env?: NodeJS.ProcessEnv
}): SubscriptionHome[] {
  const root = opts?.root ?? subsRoot(opts?.env ?? process.env)
  if (!existsSync(root)) return []
  const found: SubscriptionHome[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const name of entries.sort()) {
    const homePath = join(root, name)
    const provider = WORKER_LANE_CONSOLE_PROVIDERS.find((p) => name.startsWith(`${p}-`))
    if (!provider) continue
    try {
      if (!statSync(homePath).isDirectory()) continue
    } catch {
      continue
    }
    const inspected = inspectHome(provider, homePath)
    found.push({ id: name, provider, homePath, ...inspected })
  }
  return found
}

export type OauthLanePickResult =
  | { readonly ok: true; readonly lane: PickedOauthLane }
  | { readonly ok: false; readonly reason: string }

/**
 * Prefer a lane whose advisory lock is free; if all are busy, wait for
 * WHICHEVER candidate frees first (fleet concurrency = candidate count).
 * Every refusal names what is missing — a zero-lane pool is loud.
 *
 * Wait-ANY, not wait-one: the original all-busy path blocked on the FIRST
 * candidate's lock, which serialized the fleet behind one lane — route-008
 * (2026-08-30) queued four dispatches on the head lane for 9+ minutes while
 * the second lane sat idle after its first task (1 of 10 lane dispatches).
 * The wait is visible (a notice per minute) and bounded (the lane-lock
 * limit), same discipline as the lock module's own acquire.
 */
export async function pickFreeOauthLane(input: {
  readonly piProvider: string
  readonly tryAcquire: (laneId: string) => Promise<OauthLaneLockHandle | null>
  readonly homes?: readonly SubscriptionHome[]
  readonly reserve?: BrainReserve
  readonly credentialHealth?: LaneCredentialHealth
  /** Accounts held by non-Waypoint stores → where; defaults to a fresh disk scan. */
  readonly foreignAccounts?: ReadonlyMap<string, string>
  readonly env?: NodeJS.ProcessEnv
  readonly subsRoot?: string
  /** Ceiling on the all-busy wait; defaults to the lane-lock limit. */
  readonly waitMs?: number
  readonly noticeMs?: number
  readonly onNotice?: (message: string) => void
  readonly sleep?: (ms: number) => Promise<void>
}): Promise<OauthLanePickResult> {
  const laneProblem = anthropicWorkerLaneRefusal(input.piProvider)
  if (laneProblem) return { ok: false, reason: laneProblem }

  const consoleProvider = workerLaneConsoleProviderForPiProvider(input.piProvider)
  if (!consoleProvider) {
    return {
      ok: false,
      reason:
        `provider '${input.piProvider}' has no worker-lane subscription mapping ` +
        `(known: openai-codex→codex, openrouter, kimi, xai→grok). ` +
        `Add a subscription under Settings → Subscriptions or route the class to a mapped provider.`,
    }
  }

  // Capability and brain-ambiguity are properties of the PROVIDER, not of any
  // home: refuse before the home list is even consulted, so the reason is the
  // true one whether or not a lane happens to be signed in.
  const brokerHold = laneBrokerSupportHold(consoleProvider)
  if (brokerHold) {
    return { ok: false, reason: `no usable '${consoleProvider}' worker lane: ${brokerHold}.` }
  }

  const homes =
    input.homes ??
    listSubscriptionHomes({
      ...(input.subsRoot ? { root: input.subsRoot } : {}),
      ...(input.env ? { env: input.env } : {}),
    })
  const signedIn = homes.filter((h) => h.provider === consoleProvider && h.signedIn)
  const reserve = input.reserve ?? { emails: new Set<string>() }
  const health = input.credentialHealth ?? readLaneCredentialHealth(input.env ?? process.env)
  // Scanned once per pick, and only when there is something to hold out.
  const foreign =
    input.foreignAccounts ?? (signedIn.length > 0 ? foreignAccountHomes() : new Map<string, string>())
  /**
   * Why this lane is unavailable right now. Capability first (a provider we
   * cannot broker is never a lane, however it is signed in), then brain
   * exclusivity, then the dedicated-accounts policy, then observed failures.
   */
  const ambiguityHold = brainFamilyAmbiguityHold(input.piProvider, reserve)
  const holdFor = (home: SubscriptionHome): string | null =>
    laneBrainHold(home.email ?? undefined, reserve) ??
    ambiguityHold ??
    contestedAccountHold(home.homePath, foreign) ??
    laneCredentialHold(oauthLaneIdForSubscription(home.id), health, home.homePath)
  const heldOut = signedIn.filter((h) => holdFor(h) !== null)
  const candidates = signedIn.filter((h) => holdFor(h) === null)

  if (candidates.length === 0) {
    const heldNote =
      heldOut.length > 0
        ? ` ${heldOut.length} signed-in lane(s) are held out: ${heldOut
            .map((h) => `${h.id} (${holdFor(h)})`)
            .join('; ')}.`
        : ''
    return {
      ok: false,
      reason:
        `no available '${consoleProvider}' worker lane for provider '${input.piProvider}'.` +
        heldNote +
        ` Sign in a worker subscription under Settings → Subscriptions` +
        ` (homes under the subs root as ${consoleProvider}-*).`,
    }
  }

  const pickedLane = (home: SubscriptionHome, lock: OauthLaneLockHandle): PickedOauthLane => {
    const laneId = oauthLaneIdForSubscription(home.id)
    return {
      oauth_lane_id: laneId,
      oauth_provider_slug: consoleProvider,
      homePath: home.homePath,
      subscriptionId: home.id,
      consoleProvider,
      email: home.email,
      envInject: envInjectForSubscriptionHome(consoleProvider, home.homePath),
      queue_wait_ms: lock.queue_wait_ms,
      lock,
      sandbox_name: stableOauthSandboxName(laneId, consoleProvider),
    }
  }

  // One loop covers both cases: the first sweep is the free-lane preference
  // (queue_wait ≈ 0), and every later sweep is the all-busy wait-ANY — the
  // pick goes to whichever lane frees first, never to a fixed head.
  const started = Date.now()
  const waitMs = input.waitMs ?? LANE_LOCK_WAIT_MS
  const noticeMs = input.noticeMs ?? LANE_LOCK_NOTICE_MS
  const notice = input.onNotice ?? ((message: string) => console.error(message))
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let nextNotice = noticeMs
  for (;;) {
    for (const home of candidates) {
      const lock = await input.tryAcquire(oauthLaneIdForSubscription(home.id))
      if (lock) {
        return { ok: true, lane: pickedLane(home, { ...lock, queue_wait_ms: Date.now() - started }) }
      }
    }
    const waited = Date.now() - started
    if (waited >= waitMs) {
      return {
        ok: false,
        reason:
          `all ${candidates.length} '${consoleProvider}' lane(s) stayed lock-held for ` +
          `${Math.round(waited / 1000)}s (limit ${Math.round(waitMs / 1000)}s) — a queue deeper than ` +
          'the pool is expected to wait, but not past the exec deadline. Check pg_locks for granted ' +
          'advisory locks whose session is idle (a leaked lock reads exactly like a busy fleet).',
      }
    }
    if (waited >= nextNotice) {
      notice(
        `[lane-pick] all ${candidates.length} '${consoleProvider}' lane(s) busy for ` +
          `${Math.round(waited / 1000)}s — waiting for the first to free`,
      )
      nextNotice += noticeMs
    }
    await sleep(Math.min(2000, 250 + waited / 10))
  }
}

/**
 * The production `CordisLanePicker` (L5): homes and the brain reserve are read
 * FRESH on every pick — sign-ins and brain-in-use change between dispatches —
 * and the locks are the pg session pair, so exclusion holds across bridge
 * processes and across products. The returned lane carries the HELD lock's
 * release; the jailed runtime adopts it and releases on every exit path.
 */
export function createCordisLanePicker(opts: {
  readonly locks: OauthLaneLocks
  readonly env?: NodeJS.ProcessEnv
  readonly subsRoot?: string
}): CordisLanePicker {
  return async (target) => {
    const env = opts.env ?? process.env
    const reserve = await readBrainReserve(env)
    const picked = await pickFreeOauthLane({
      piProvider: target.provider,
      tryAcquire: opts.locks.tryAcquire,
      reserve,
      // Fresh per pick: a lane re-authed a minute ago serves the next dispatch.
      credentialHealth: readLaneCredentialHealth(env),
      env,
      ...(opts.subsRoot ? { subsRoot: opts.subsRoot } : {}),
    })
    if (!picked.ok) return picked
    const lane = picked.lane
    return {
      ok: true,
      lane: {
        oauth_lane_id: lane.oauth_lane_id,
        oauth_provider_slug: lane.oauth_provider_slug,
        consoleProvider: lane.consoleProvider,
        homePath: lane.homePath,
        queue_wait_ms: lane.queue_wait_ms,
        release: () => lane.lock.release(),
      },
    }
  }
}
