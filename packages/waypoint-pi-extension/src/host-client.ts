/**
 * Minimal loopback client the Pi extension uses to call engine-host commands.
 * Every Waypoint tool the agent invokes becomes a `POST /cmd/<name>` carrying
 * the per-session SCOPED bearer token. Auth/scope failures are mapped to
 * actionable errors so the agent (and operator) sees *why* a call was refused,
 * not a bare 401/403 (decision 19 / Task 10).
 */

export type FetchImpl = (input: string, init: FetchInit) => Promise<FetchResponse>

export interface FetchInit {
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string
}

export interface FetchResponse {
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface HostClientConfig {
  readonly url: string
  readonly token: string
  readonly fetchImpl?: FetchImpl
}

export interface HostClient {
  /** Dispatch an engine command; resolves the success envelope or throws {@link HostCommandError}. */
  command(name: string, payload?: unknown): Promise<Record<string, unknown>>
}

export class HostCommandError extends Error {
  readonly code: string
  readonly status: number
  readonly field?: string

  constructor(message: string, details: { code: string; status: number; field?: string }) {
    super(message)
    this.name = 'HostCommandError'
    this.code = details.code
    this.status = details.status
    if (details.field !== undefined) this.field = details.field
  }
}

export function createHostClient(config: HostClientConfig): HostClient {
  if (typeof config.url !== 'string' || config.url.trim() === '') {
    throw new Error('createHostClient requires a non-empty url (set WAYPOINT_HOST_URL)')
  }
  if (typeof config.token !== 'string' || config.token.trim() === '') {
    throw new Error('createHostClient requires a non-empty token (set WAYPOINT_HOST_TOKEN)')
  }
  const base = config.url.replace(/\/+$/, '')

  return {
    async command(name, payload) {
      const doFetch = config.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)
      const response = await doFetch(`${base}/cmd/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(payload ?? {}),
      })

      let body: Record<string, unknown> = {}
      try {
        body = (await response.json()) as Record<string, unknown>
      } catch {
        body = {}
      }
      const details = isRecord(body.details) ? body.details : {}

      if (response.status === 401) {
        throw new HostCommandError(
          'authorization failed: WAYPOINT_HOST_TOKEN is missing or invalid (the engine host rejected the token).',
          { code: 'UNAUTHENTICATED', status: 401 },
        )
      }
      if (response.status === 403) {
        const allowed = Array.isArray(details.issues) ? (details.issues as string[]) : []
        const suffix = allowed.length > 0 ? ` Allowed in this session: [${allowed.join(', ')}].` : ''
        throw new HostCommandError(`tool '${name}' is not in this agent session's grant.${suffix}`, {
          code: 'FORBIDDEN',
          status: 403,
        })
      }
      if (body.ok === false) {
        throw new HostCommandError(typeof body.error === 'string' ? body.error : `Command failed: ${name}`, {
          code: typeof details.code === 'string' ? details.code : 'BACKEND_ERROR',
          status: response.status,
          ...(typeof details.path === 'string' ? { field: details.path } : {}),
        })
      }
      return body
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
