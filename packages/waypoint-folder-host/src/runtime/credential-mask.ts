import {
  JWT_PATTERN,
  PLACEHOLDER_CHARS,
  PLACEHOLDER_PATTERN,
  SIMPLE_PATTERNS,
  URL_SCHEME,
  VALUED_PATTERNS,
  type CredentialPattern,
} from './credential-patterns.generated.ts'

/**
 * Redact credentials from worker output before it becomes durable (rsc-xam).
 *
 * THE SINKS, traced rather than assumed. A worker's stdout does not stop at the
 * terminal:
 *
 *   worker stdout
 *     -> WorkerRecipeRuntimeOutput.stdout      (worker-runtime.ts)
 *     -> bridge payload = { ...output }        (pgdurable/bridge.ts)
 *     -> finished     -> signalDurableInstance -> pg_durable instance history
 *     -> not finished -> metadata.runner.evidence on the task row
 *     -> ON RETRY, that evidence is read back and injected into the NEXT
 *        attempt's work order as `output_tail` (priorAttemptFromTask)
 *
 * So an agent that prints its environment does two things: it writes a secret to
 * Postgres, and it hands that secret to ANOTHER AGENT as prompt text. The second
 * is the one that makes this urgent — a leak that propagates to a fresh worker,
 * which may print it again.
 *
 * ABOVE THE CONFINEMENT LAYER, deliberately. The bridge records evidence on every
 * path, so neither the seatbelt nor microsandbox touches this. The sandboxed
 * brokered path removes the CREDENTIAL from the guest, but not client content:
 * an agent summarising a medical record into stdout puts case content in an
 * evidence row either way — that half is out of scope here (see the note on
 * masking-vs-evidence below).
 *
 * NOT the pre-commit guard's job: that one sees commits (tools/safe-evidence,
 * rsc-889). It cannot see a Postgres row or a prompt. Same shapes, different
 * seam, different verb — that guard DETECTS and refuses, this REDACTS and lets
 * the run continue.
 *
 * WHY REDACT AND NOT REFUSE. Evidence is what an operator reads to believe an
 * outcome (the 2026-05-06 fabrication rule: verified outcomes only, never agent
 * say-so). Failing a dispatch because its output contained a token would destroy
 * the evidence trail to protect it. So the row is written, minus the secret, and
 * the surrounding diagnostic text survives intact.
 *
 * SCOPE, kept narrow on purpose. Structured credential shapes ONLY — the same
 * vendor-defined prefixes the guard uses, from the same JSON. No free-text
 * masking and no client-name masking here: the masking policy is authoritative
 * (client names, SSNs, emails, phones, client addresses — provider/doctor/staff
 * names NEVER), it belongs to a different seam, and a mask that eats real
 * diagnostic output makes runs unreadable, which is how a safety feature gets
 * turned off.
 */

/** What a redacted secret leaves behind. Names the category so evidence stays legible. */
export function redactionFor(category: string): string {
  return `<REDACTED:${category}>`
}

function compile(pattern: CredentialPattern, extraFlags = ''): RegExp {
  return new RegExp(pattern.regex, `${pattern.flags}${extraFlags}g`)
}

const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERN.regex, PLACEHOLDER_PATTERN.flags)

function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER_RE.test(value)) return true
  // A template interpolation anywhere in the value: `Bearer ${TOKEN}`,
  // `Bearer {{ .Token }}`. A shape, not a secret — redacting it would just make
  // documentation-shaped output unreadable for nothing.
  return [...PLACEHOLDER_CHARS].some((ch) => value.includes(ch))
}

/**
 * Is the match at `start` inside a URL?
 *
 * The rule the evidence forced (see tools/safe-evidence/credentials.py `_in_url`
 * for the full account): sweeping the detector over the repo returned 155 hits,
 * every one a JWT in a vendor invoice link quoted inside client email. Those are
 * capability URLs that ARE the evidence, not our credential escaping. Redacting
 * them would corrupt the record it is meant to preserve.
 */
function inUrl(text: string, start: number): boolean {
  let left = start
  while (left > 0 && !/\s/.test(text[left - 1]!) && !'"\'`<>(),'.includes(text[left - 1]!)) left -= 1
  return text.slice(left, start).includes(URL_SCHEME)
}

interface Replacement {
  readonly start: number
  readonly end: number
  readonly category: string
}

/**
 * Replace every credential in `text` with `<REDACTED:category>`.
 *
 * Returns the text unchanged when there is nothing to redact, so the common case
 * costs nothing and evidence is byte-identical to what the agent produced.
 */
export function maskCredentials(text: string): string {
  if (text === '') return text
  const hits: Replacement[] = []

  for (const pattern of SIMPLE_PATTERNS) {
    for (const m of text.matchAll(compile(pattern))) {
      hits.push({ start: m.index!, end: m.index! + m[0].length, category: pattern.category })
    }
  }

  for (const m of text.matchAll(compile(JWT_PATTERN))) {
    if (!inUrl(text, m.index!)) {
      hits.push({ start: m.index!, end: m.index! + m[0].length, category: JWT_PATTERN.category })
    }
  }

  for (const pattern of VALUED_PATTERNS) {
    for (const m of text.matchAll(compile(pattern))) {
      const value = m[1]
      if (value === undefined || isPlaceholder(value)) continue
      // Redact GROUP 1 only. The anchor — `"accessToken": "` or `Bearer ` — is
      // structure, and keeping it is what makes the redacted evidence readable:
      // an operator can still see that an auth header was present and where.
      const start = m.index! + m[0].indexOf(value)
      hits.push({ start, end: start + value.length, category: pattern.category })
    }
  }

  if (hits.length === 0) return text

  // Rightmost first, so each splice leaves earlier offsets valid. Overlaps are
  // dropped rather than nested (an OpenAI pattern brushing a bearer token, say):
  // the first, longest claim on a span wins and the rest are already covered.
  hits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  let lastStart = text.length
  for (const hit of hits) {
    if (hit.end > lastStart) continue // overlaps a redaction we already made
    out = out.slice(0, hit.start) + redactionFor(hit.category) + out.slice(hit.end)
    lastStart = hit.start
  }
  return out
}

/**
 * Mask the string fields of an evidence payload, in place of the caller having to
 * remember which ones carry agent output.
 *
 * Only `stdout`/`stderr`/`error`/`close_reason` — the fields an agent's own words
 * reach. Everything else in the payload is ours (status, exit codes, timings, the
 * apply record) and rewriting it would be the mask corrupting the engine's data
 * to protect it from a secret that cannot be there.
 */
const AGENT_TEXT_FIELDS = ['stdout', 'stderr', 'error', 'close_reason'] as const

export function maskEvidencePayload(payload: Record<string, unknown>): Record<string, unknown> {
  let masked: Record<string, unknown> | null = null
  for (const field of AGENT_TEXT_FIELDS) {
    const value = payload[field]
    if (typeof value !== 'string') continue
    const cleaned = maskCredentials(value)
    if (cleaned === value) continue
    masked ??= { ...payload }
    masked[field] = cleaned
  }
  return masked ?? payload
}
