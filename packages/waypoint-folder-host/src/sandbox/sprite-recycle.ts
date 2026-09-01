/**
 * Sprite recycling on transport-death exhaustion.
 *
 * Fly's own infra log documents per-host-pair WireGuard tunnel failures
 * between a worker host and its egress gateway (2026-08-10 entry; 2026-04-14
 * one-way wg0 pairs), and the 2026-08-30 discriminating experiment proved the
 * item-54 wall is that class: a fresh sprite ran the same workload clean
 * through 280KB request bodies while BOTH incumbent sprites stalled at
 * 86–91KB across two accounts in the same hour. A sprite is a stateless
 * cache (bundle + workspace re-sync per dispatch), so the fix for a sick
 * placement is a redraw: destroy the sprite and let the next dispatch
 * create a fresh one.
 *
 * Aaron amended D-B (2026-08-30, "you can make the recycle automatic"):
 * transport-death exhaustion is the ONE condition under which the product
 * destroys a sprite on its own. Everything else remains operator-only.
 *
 * The trigger is deliberately the adapter's own exhaustion suffix — a turn
 * whose EVERY attempt died in transport (each attempt is a fresh flow under
 * the pinned sse transport). Five consecutive dead flows never happened on a
 * healthy placement (probe8: 0 stalls in 33 flows to 280KB) and were routine
 * on sick ones (91KB died 5/5); a spurious recycle costs only the next
 * dispatch's re-sync, so one exhausted turn is enough. Credential and quota
 * refusals never carry the suffix — those hold the LANE, not the sprite.
 */

const TRANSPORT_EXHAUSTION = /\(stream died on all \d+ attempts\)/i

/**
 * When a dispatch close reason shows a turn whose every transport attempt
 * died, return the recycle reason; null for every other failure.
 */
export function spriteTransportDeathFromCloseReason(
  closeReason: string | null | undefined,
): string | null {
  const text = (closeReason ?? '').trim()
  if (!text) return null
  if (!TRANSPORT_EXHAUSTION.test(text)) return null
  return (
    'every transport attempt of a turn died on this sprite — the per-host-pair ' +
    'egress pathology (see docs/designs/sprites-egress-loss-report.md); recycling ' +
    'so the next dispatch draws a fresh placement'
  )
}
