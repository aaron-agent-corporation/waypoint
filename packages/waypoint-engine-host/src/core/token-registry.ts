import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Result of resolving a bearer token (MAR Contract Lock 2). The discriminated
 * union is deliberate: `unknown` is distinct from a scoped token with an empty
 * allow-set, so the transport never confuses "invalid" (→ 401) with
 * "unrestricted" (`global`) or "scoped".
 */
export type TokenScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'scoped'; readonly sessionId: string; readonly allow: ReadonlySet<string> }
  | { readonly kind: 'unknown' }

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Per-session scoped tokens enforced at the command bus. The global host token
 * is unrestricted; agent sessions get a scoped token bound to their `sessionId`
 * whose allow-set the CommandBus checks on every dispatch.
 */
export class TokenRegistry {
  private globalToken: string | null = null
  private readonly scoped = new Map<string, { sessionId: string; allow: ReadonlySet<string> }>()

  registerGlobal(token: string): void {
    this.globalToken = token
  }

  /** Mint a token bound to a session (Lock 2: identity is set at mint time). */
  mintScoped(sessionId: string, allow: ReadonlySet<string>): string {
    const token = randomBytes(24).toString('hex')
    this.scoped.set(token, { sessionId, allow })
    return token
  }

  resolve(token: string): TokenScope {
    if (this.globalToken !== null && safeEqual(token, this.globalToken)) return { kind: 'global' }
    const scoped = this.scoped.get(token)
    if (scoped) return { kind: 'scoped', sessionId: scoped.sessionId, allow: scoped.allow }
    return { kind: 'unknown' }
  }

  revoke(token: string): void {
    this.scoped.delete(token)
  }
}
