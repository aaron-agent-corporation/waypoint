// When the ACCOUNT fails, not the work (Aaron 2026-08-02).
//
// The medical-layer extraction died on `403 You've reached your usage limit
// for this billing cycle`. Nothing was wrong with the task: one subscription
// out of eight ran out of quota, and the run recorded a failed attempt and
// stopped, as if the work itself had failed.
//
//   "if a particular subscription hit a limit — workers have lots of different
//    subscriptions — wherever that agent left off should just go back into the
//    queue at the checkpoint with another agent to pick it up. Don't just die
//    because one subscription hit a limit when I've got eight subscriptions."
//
// So a lane that answers with a billing, quota or sign-in failure is taken out
// of the pool and its dispatch goes back on the queue for another lane. The
// work-so-far is already on disk (the extractor's 45 encounter pages survived
// three attempts), and the retry carries the prior attempt's evidence.
//
// Deliberately NARROW. A misread of an ordinary failure would re-queue a
// genuinely broken task around every lane in the pool, burning eight
// subscriptions on the same doomed attempt — so these patterns match what a
// provider says when it refuses to serve an ACCOUNT, and nothing else.

const ACCOUNT_REFUSALS: readonly RegExp[] = [
  /usage limit .*(billing cycle|reached)/i,
  /reached your usage limit/i,
  // Claude's subscription window wording changed: "You've hit your session
  // limit · resets 3:10pm". It matched nothing here, so on 2026-08-15 a whole
  // batch of dispatches burned their task attempts on one exhausted
  // subscription and parked — with four other providers' lanes configured
  // and idle (route-007).
  /hit your (?:session|usage|weekly) limit/i,
  /(?:session|usage) limit[^\n]{0,60}resets/i,
  /quota (?:exceeded|exhausted)|insufficient[_ ]quota|out of credits?/i,
  /credit balance is too low/i,
  /billing (?:cycle|hard limit)|purchase extra usage|upgrade your plan/i,
  /rate limit (?:exceeded|reached)|429 too many requests/i,
  /\b(?:401|403)\b[^\n]{0,80}(?:unauthorized|forbidden|expired|invalid[_ ]api[_ ]key|authentication)/i,
  /(?:please )?(?:sign|log) ?in again|session (?:has )?expired|run \/login/i,
  /oauth token (?:has )?expired|refresh token (?:is )?invalid/i,
  // "revoked" is not "expired" (Aaron 2026-08-08). A Claude sub answered
  // `401 OAuth access token has been revoked.` and matched nothing here, so the
  // dispatch was recorded as a FAILED TASK and the route died — for a reason
  // that had nothing to do with the work. Its sibling wording, "OAuth session
  // expired", did match and would have re-queued. One account problem stated
  // two ways, only one of them survivable.
  /token (?:has been |was |is )?(?:revoked|deauthorized)/i,
  /failed to authenticate/i,
  // A CLI that is not signed in may ASK instead of failing: the gemini lane
  // printed "Opening authentication page in your browser. Do you want to
  // continue? [Y/n]:" to a stdin nobody was holding, and one intake dispatch
  // sat there for its whole 180-minute budget (2026-08-20). The spawn seam now
  // kills on the question; this is what makes it the ACCOUNT's problem, so the
  // work goes to another lane instead of being recorded as a failed task.
  /opening authentication page in your browser/i,
  /error authenticating|authentication cancelled/i,
]

/** Every string in an attempt's evidence that a provider could have spoken in. */
function spoken(payload: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of ['stderr', 'stdout', 'error', 'close_reason']) {
    const value = payload[key]
    if (typeof value === 'string') parts.push(value)
  }
  return parts.join('\n')
}

/**
 * Did the ACCOUNT refuse, rather than the work fail?
 *
 * Returns the provider's own sentence, for the operator to read — "kimi-1 is
 * out of quota" is only useful if the next line says how they know.
 */
export function accountRefusal(payload: Record<string, unknown>): string | null {
  const text = spoken(payload)
  if (text.trim() === '') return null
  for (const pattern of ACCOUNT_REFUSALS) {
    const match = pattern.exec(text)
    if (!match) continue
    // The sentence around the match, not the whole log.
    const start = text.lastIndexOf('\n', Math.max(0, match.index - 1)) + 1
    const end = text.indexOf('\n', match.index + match[0].length)
    return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 300)
  }
  return null
}
