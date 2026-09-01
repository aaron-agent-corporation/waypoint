import { readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

import type { PiModelResolver } from './pi-runtime.ts'

/**
 * OAuth-token brokering for the JAILED pi worker (rsc-0fx, decision 2).
 *
 * A jailed pi worker must authenticate to its model provider WITHOUT the
 * `~/.pi/agent/auth.json` store entering the jail (no mount). So the parent reads
 * the one provider credential host-side and hands it to the child as a single
 * transported value — `--secret WAYPOINT_PI_BROKERED_CRED@HOST` on the microsandbox
 * path (the rsc-wxk brokering seam, so the blob never lands in guest persistent
 * state), or the allowlisted worker env on the seatbelt path (where there is no
 * `--secret` and the child has no read grant on `~/.pi` anyway).
 *
 * Child-side, the credential seeds an in-memory `CredentialStore` handed to
 * `ModelRuntime.create({ credentials })` — pi's own supported injection point —
 * so no auth.json is ever read inside the jail. OAuth refresh happens in-memory
 * off the blob's refresh token; the models catalog is bundled in the pi package,
 * so no `~/.pi` read is needed for it either.
 */

/** The env var carrying the serialized `{ provider, credential }` blob. */
export const BROKER_ENV = 'WAYPOINT_PI_BROKERED_CRED'

/**
 * The env var naming a FILE that carries the blob instead (L4 residency,
 * docs/designs/sprite-lane-conversion.md). On the cloud path the enter argv —
 * including any inlined env exports — rides the Sprites WebSocket URL query
 * string, so the credential VALUE must never be in argv or exec-env there:
 * it is staged as a file on the stdin-streamed workspace tar leg, only its
 * PATH rides argv, and the guest reads-and-unlinks it here before the agent
 * loop starts. The seatbelt path keeps `BROKER_ENV` (process env, no URL).
 */
export const BROKER_FILE_ENV = 'WAYPOINT_PI_BROKERED_CRED_FILE'

interface BrokeredPayload {
  readonly provider: string
  readonly credential: Credential
}

/**
 * HOST-side: read the provider's stored credential from `~/.pi/agent/auth.json`
 * (no store instantiated, no key command executed) and serialize it for
 * transport into a jailed child. Returns undefined when the provider has no
 * stored credential — the caller then fails closed (no spawn), exactly as the
 * in-process path fails when `hasConfiguredAuth` is false.
 */
export async function readBrokeredCredential(providerId: string, authPath?: string): Promise<string | undefined> {
  const { readStoredCredential } = await import('@earendil-works/pi-coding-agent')
  const credential = readStoredCredential(providerId, authPath ?? join(homedir(), '.pi', 'agent', 'auth.json'))
  if (credential === undefined) return undefined
  const payload: BrokeredPayload = { provider: providerId, credential }
  return JSON.stringify(payload)
}

/**
 * A minimal in-memory `CredentialStore` seeded with the brokered credential.
 * `modify` is serialized (one promise chain) so pi's in-`modify` OAuth refresh
 * cannot double-refresh a rotated token — the contract `AuthStorage` documents.
 * Writes stay in memory: a refreshed token lives only for this task's process.
 */
class BrokeredCredentialStore implements CredentialStore {
  private readonly creds = new Map<string, Credential>()
  private chain: Promise<unknown> = Promise.resolve()

  constructor(seed: Readonly<Record<string, Credential>>) {
    for (const [provider, credential] of Object.entries(seed)) this.creds.set(provider, credential)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.creds.get(providerId)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.creds.entries()].map(([providerId, c]) => ({ providerId, type: c.type }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const run = this.chain.then(async () => {
      const next = await fn(this.creds.get(providerId))
      if (next !== undefined) this.creds.set(providerId, next)
      return this.creds.get(providerId)
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  async delete(providerId: string): Promise<void> {
    this.creds.delete(providerId)
  }
}

/**
 * Read the blob from the staged credential file named by `env[BROKER_FILE_ENV]`
 * and UNLINK it immediately — the value must not persist on the guest
 * filesystem past this read (delete-after-pull and wipe-before-sync are the
 * backstops, not the mechanism). Returns undefined when unset or unreadable.
 */
function readBrokeredCredentialFile(env: NodeJS.ProcessEnv): string | undefined {
  const path = env[BROKER_FILE_ENV]?.trim()
  if (!path) return undefined
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
    try {
      unlinkSync(path)
    } catch {
      // Best effort: the workspace is wiped/deleted by the L2 hygiene contract.
    }
  } catch {
    return undefined
  }
  return raw.trim() === '' ? undefined : raw
}

/**
 * CHILD-side: build a {@link PiModelResolver} that authenticates from the
 * BROKERED credential — the staged file named by `env[BROKER_FILE_ENV]`
 * (cloud path; read-and-unlinked) or the `env[BROKER_ENV]` value (seatbelt
 * path) — never reading `~/.pi`. Returns undefined when no brokered
 * credential is present (or it will not parse) — the caller fails the attempt
 * closed. `modelsPath: null` keeps model resolution on the bundled catalog,
 * so the jail needs no `~/.pi` read for models either.
 */
export async function brokeredResolverFactory(env: NodeJS.ProcessEnv = process.env): Promise<PiModelResolver | undefined> {
  const raw = readBrokeredCredentialFile(env) ?? env[BROKER_ENV]
  if (raw === undefined || raw.trim() === '') return undefined
  let payload: BrokeredPayload
  try {
    payload = JSON.parse(raw) as BrokeredPayload
  } catch {
    return undefined
  }
  if (typeof payload?.provider !== 'string' || payload.credential === undefined) return undefined
  const store = new BrokeredCredentialStore({ [payload.provider]: payload.credential })
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null })
  return runtime as unknown as PiModelResolver
}

/** Exposed for testing the store's contract in isolation. */
export const __test = { BrokeredCredentialStore }
