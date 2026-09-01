/**
 * Where the built cordis guest bundle lives on the host.
 *
 * The bundle has to be installed into the sprite before a worker can run, and
 * the install was gated on `WAYPOINT_CORDIS_GUEST_DIST` being set:
 *
 *     const guestDist = env[CORDIS_GUEST_DIST_ENV]?.trim()
 *     if (guestDist && ensurer.ensureGuestBundle) { …install… }
 *
 * Unset meant SKIP — silently. The worker then entered a sprite with no bundle
 * and died on `Cannot find module '/opt/cordis-worker/cordis-worker-launch.mjs'`,
 * which names nothing an operator can act on. Every dispatch of item 54's
 * route-003 failed that way, because bridges spawned by launchd have no such
 * variable (the same shape as the SPRITES_TOKEN finding the same day).
 *
 * A missing env var must not mean "assume the bundle is already there" — that
 * is a status fallback defaulting to the reassuring value. So the path gets a
 * real home, and an unresolvable one is a loud refusal rather than a skip.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Env override; still the first place looked. */
export const CORDIS_GUEST_DIST_ENV = 'WAYPOINT_CORDIS_GUEST_DIST'

/** Installed home for the built bundle, beside Waypoint's other machine state. */
export function defaultCordisGuestDist(env: NodeJS.ProcessEnv = process.env): string {
  const waypointHome = env.WAYPOINT_HOME?.trim() || join(homedir(), '.waypoint')
  return join(waypointHome, 'cordis-guest')
}

export interface CordisGuestDistResolution {
  readonly dist: string | null
  readonly source: 'env' | 'installed' | null
  /** Every path considered, in order — a refusal must say where to put it. */
  readonly searched: readonly string[]
}

/**
 * Resolve the host-side bundle directory. A directory only counts when it
 * holds a `digest.txt`: the caller compares that digest against the binding's
 * pinned image, and a dist without one cannot be checked for drift.
 */
export function resolveCordisGuestDist(env: NodeJS.ProcessEnv = process.env): CordisGuestDistResolution {
  const searched: string[] = []
  const named = env[CORDIS_GUEST_DIST_ENV]?.trim()
  if (named) {
    searched.push(named)
    if (existsSync(join(named, 'digest.txt'))) return { dist: named, source: 'env', searched }
  }
  const installed = defaultCordisGuestDist(env)
  searched.push(installed)
  if (existsSync(join(installed, 'digest.txt'))) return { dist: installed, source: 'installed', searched }
  return { dist: null, source: null, searched }
}

/** The refusal text, naming every place the bundle could have been. */
export function cordisGuestDistRefusal(searched: readonly string[]): string {
  return (
    'cordis guest bundle not found on the host, so the sprite cannot be provisioned ' +
    '(fail closed: entering without it dies in-guest on a missing module). ' +
    `Looked for digest.txt in: ${searched.join(', ')}. ` +
    `Build it with deploy/sandbox/cordis-worker-guest/build.sh and install it at ` +
    `${searched[searched.length - 1]}, or set $${CORDIS_GUEST_DIST_ENV}.`
  )
}
