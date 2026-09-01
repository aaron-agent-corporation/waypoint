/**
 * Where Waypoint keeps its Sprites API token.
 *
 * Before this file the token had exactly one home: `process.env.SPRITES_TOKEN`.
 * That is fine for a driver script an operator runs by hand and useless for the
 * way Waypoint actually runs — the Console's `bridge_manager` spawns bridges
 * under launchd, which carries no such variable, so EVERY cordis sprite
 * dispatch a managed bridge claimed failed closed (item 54, 2026-08-29: 15 of
 * 20 failures in route-002). On this machine the token lived in a different
 * product's `.env` file, which is not a home at all.
 *
 * So the token gets a home of Waypoint's own: a file the operator controls,
 * holding nothing else, readable by any process running as them — including a
 * headless launchd bridge, which is the case the environment could not serve.
 *
 * The file, not the keychain: a keychain read from a non-interactive launchd
 * agent either prompts (a hang no one sees) or requires an ACL that trusts
 * every binary, which gives back the security it was supposed to buy. A 0600
 * file in the operator's home is honest about what it protects.
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The env var, still the first place looked and still honoured. */
export const SPRITES_TOKEN_ENV = 'SPRITES_TOKEN'

/** Default token file, overridable by env for tests and odd deployments. */
export const SPRITES_TOKEN_FILE_ENV = 'SPRITES_TOKEN_FILE'

export function defaultSpritesTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  const named = env[SPRITES_TOKEN_FILE_ENV]?.trim()
  if (named) return named
  const waypointHome = env.WAYPOINT_HOME?.trim() || join(homedir(), '.waypoint')
  return join(waypointHome, 'secrets', 'sprites-token')
}

export interface SpritesTokenResolution {
  readonly token: string | null
  /** Where it came from, for the refusal message and for evidence. */
  readonly source: 'env' | 'file' | null
  /** Every place looked, in order — a refusal must say where to put it. */
  readonly searched: readonly string[]
  /** Loud, non-fatal notes (e.g. a token file anyone can read). */
  readonly warnings: readonly string[]
}

/**
 * Resolve the token: env first (unchanged behaviour for every existing
 * caller), then Waypoint's own file. Never throws — the caller decides whether
 * a missing token is fatal, and gets the search list to say so usefully.
 */
export function resolveSpritesToken(env: NodeJS.ProcessEnv = process.env): SpritesTokenResolution {
  const searched: string[] = [`$${SPRITES_TOKEN_ENV}`]
  const warnings: string[] = []

  const fromEnv = env[SPRITES_TOKEN_ENV]?.trim()
  if (fromEnv) return { token: fromEnv, source: 'env', searched, warnings }

  const path = defaultSpritesTokenFile(env)
  searched.push(path)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { token: null, source: null, searched, warnings }
  }
  const token = raw.trim()
  if (!token) {
    warnings.push(`${path} exists but is empty`)
    return { token: null, source: null, searched, warnings }
  }
  try {
    // Warn, never refuse: the operator's file modes are the operator's call,
    // and a token that works must not be rejected over a permission bit. But
    // a secret every process can read should never be silent about it.
    const mode = statSync(path).mode & 0o077
    if (mode !== 0) warnings.push(`${path} is readable beyond its owner — chmod 600 it`)
  } catch {
    /* stat failed after a successful read; not worth failing over */
  }
  return { token, source: 'file', searched, warnings }
}

/** The refusal text, naming every place the token could have been. */
export function spritesTokenRefusal(searched: readonly string[]): string {
  return (
    `fly-sprites provider refused: no Sprites token (fail closed; never invent live evidence). ` +
    `Looked in: ${searched.join(', ')}. ` +
    `Put the token in the file and chmod 600 it — the environment does not reach bridges spawned by launchd.`
  )
}
