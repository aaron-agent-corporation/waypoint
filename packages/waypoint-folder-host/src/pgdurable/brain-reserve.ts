// Waypoint's brain and the worker pool must never share an account
// (Aaron 2026-08-16): two consumers of one subscription rotate each other's
// refresh tokens until the provider revokes the login — the 2026-07-28
// six-run incident — and a chat turn and a dispatch racing one quota window
// starve each other unpredictably. The Console writes the accounts Waypoint's
// brain currently runs on (the default brain plus every session-picked
// subscription) to `~/.waypoint/subs/brain-in-use.json`; the bridge reads it
// before handing a dispatch to a lane and HOLDS OUT any lane on a reserved
// account. Held is not quarantined: the moment Waypoint switches away and the
// registry changes, the lane serves again — no config edit, no restart.
//
// Fail open: no registry (Console absent, fresh machine) means no reservation
// — the worker pool must not stall because the file is missing.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface BrainReserve {
  /** Lower-cased account emails currently serving Waypoint's brain. */
  readonly emails: ReadonlySet<string>
  /**
   * Provider families the brain IS signed into but whose account the registry
   * could not name (the Console resolves the default brain's email by account
   * id, which only codex records). A family in here means "the brain is on one
   * of these lanes and we cannot tell which" — the lanes are held out.
   */
  readonly unnamedFamilies?: ReadonlySet<string>
}

const EMPTY: BrainReserve = { emails: new Set() }

/** The Console's subscription root — one derivation, shared with the lane picker. */
export function subsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.WAYPOINT_HOME?.trim() || join(homedir(), '.waypoint')
  return env.WAYPOINT_SUBS_ROOT?.trim() || join(home, 'subs')
}

/** The registry the Console maintains; empty when absent or unreadable. */
export async function readBrainReserve(env: NodeJS.ProcessEnv = process.env): Promise<BrainReserve> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(subsRoot(env), 'brain-in-use.json'), 'utf8'))
  } catch {
    return EMPTY
  }
  if (parsed === null || typeof parsed !== 'object') return EMPTY
  const accounts = (parsed as { accounts?: unknown }).accounts
  if (!Array.isArray(accounts)) return EMPTY
  const emails = new Set<string>()
  const unnamedFamilies = new Set<string>()
  for (const account of accounts) {
    const email = (account as { email?: unknown })?.email
    if (typeof email === 'string' && email.includes('@')) {
      emails.add(email.trim().toLowerCase())
      continue
    }
    // The brain is on this family and the registry cannot say which account.
    const family = (account as { family?: unknown })?.family
    if (typeof family === 'string' && family.trim()) unnamedFamilies.add(family.trim().toLowerCase())
  }
  return { emails, unnamedFamilies }
}

/**
 * Why no lane of this provider family may take work: the brain is signed into
 * the family and the registry does not name the account, so we cannot prove a
 * given lane is not the brain's. Fails CLOSED — the alternative is handing
 * Waypoint's own brain account to a worker, which is the collision the reserve
 * exists to prevent (found live 2026-08-29: the xai entry carries a null
 * email, and the one grok home on the machine is almost certainly the brain's).
 */
export function brainFamilyAmbiguityHold(piProvider: string, reserve: BrainReserve): string | null {
  const family = piProvider.trim().toLowerCase()
  if (!reserve.unnamedFamilies?.has(family)) return null
  return (
    `Waypoint's brain is signed into '${family}' and the registry does not name which account, ` +
    'so no lane of this provider can be proven free — re-check after the Console records the ' +
    "brain's account for this family"
  )
}

/**
 * Why this lane must not take work right now, or null when it may.
 * Matching is by the account email the lane declares — the one identity the
 * provider knows it by. A lane with no declared email cannot be reserved.
 */
export function laneBrainHold(laneEmail: string | undefined, reserve: BrainReserve): string | null {
  if (!laneEmail) return null
  return reserve.emails.has(laneEmail.trim().toLowerCase())
    ? `its account (${laneEmail}) is serving Waypoint's brain`
    : null
}
