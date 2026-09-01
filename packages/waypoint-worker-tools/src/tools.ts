/**
 * The bundled worker tool surface: `report`, the claim seam.
 *
 * WHY THIS EXISTS. A worker on a closed tool surface has no shell and no file
 * access — so the report contract ("write your claim as JSON to this path") is
 * a capability it does not have. The `report` tool IS the contract on that
 * surface: it writes the claim file the host reads after the run, from the
 * path the host injected as WAYPOINT_CLAIM_PATH.
 *
 * The claim is the worker's CLAIM, not the verdict. The host reads the file,
 * verifies the declared artifacts and contracts, and derives the outcome —
 * which is why an attempt with no claim is recorded as failed no matter how
 * much work it did: silence is indistinguishable from a crash.
 *
 * WHAT IS NOT HERE. Domain guards — "a finished report is refused while any
 * input is unaccounted for" — are domain policy and belong to the host's own
 * tool server, which can wrap or replace this one via the runtime's
 * `toolServer` config. This bundle enforces only the universal rules: a claim
 * path must exist, the status must be real, and review verdicts ride in
 * `evidence` under the `review.` prefix the host's admission step reads.
 */
import { mkdir, writeFile } from 'node:fs/promises'

import { fail, ok, type ToolSpec } from './types.ts'

export function buildWorkerTools(): ToolSpec[] {
  return [
    {
      name: 'report',
      description:
        'File your report for this task. This is the ONLY way to report — you have no file access, and an attempt ' +
        'with no report is recorded as failed no matter how much work it did. Call it ONCE at the very end, after ' +
        'your work exists. If you cannot finish, call it with status "failed" and say why: an honest failure is ' +
        'worth far more than silence, which reads as a crash.',
      inputSchema: {
        type: 'object',
        required: ['status', 'summary'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['finished', 'failed'] },
          summary: { type: 'string', description: 'What you did, or what stopped you.' },
          brief: {
            type: 'string',
            description:
              'OPTIONAL note to the reviewer — an exception, not a narrative. Only something true, that they do ' +
              'not already know, and that could change a decision: a conflict in the inputs, a judgement call you ' +
              'had to make, a real obstacle. One or two sentences, in their vocabulary, no file paths or system ' +
              'words.',
          },
          review: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description:
              'REQUIRED when your work order lists review checks: one entry per check, keyed by the check text ' +
              'exactly as the order states it, valued "pass: <one-line reason>" or "fail: <one-line reason>". A ' +
              'check you leave out is not admitted, and the whole attempt is rejected however good the work was — ' +
              'a verdict written in your summary instead of here does not count.',
          },
        },
      },
      async execute(params) {
        const claimPath = process.env.WAYPOINT_CLAIM_PATH
        if (!claimPath) {
          return fail('ERROR: no claim path was provided to this worker (WAYPOINT_CLAIM_PATH unset). Report not filed.')
        }
        const status = String(params.status ?? '')
        if (status !== 'finished' && status !== 'failed') return fail('ERROR: status must be "finished" or "failed".')

        // Review verdicts ride in `evidence` under the `review.` prefix the
        // host's admission step reads. The worker states the check text; the
        // prefix is plumbing and is added here, so a verdict cannot be lost to
        // a missing prefix.
        const review = (params.review ?? {}) as Record<string, string>
        const evidence: Record<string, unknown> = {}
        for (const [check, verdict] of Object.entries(review)) evidence[`review.${check}`] = verdict

        await mkdir(claimPath.slice(0, claimPath.lastIndexOf('/')), { recursive: true })
        await writeFile(
          claimPath,
          `${JSON.stringify(
            {
              task_id: process.env.WAYPOINT_TASK_ID ?? undefined,
              status,
              summary: String(params.summary ?? ''),
              ...(typeof params.brief === 'string' && params.brief.trim() !== '' ? { brief: params.brief } : {}),
              evidence,
            },
            null,
            1,
          )}\n`,
          'utf8',
        )
        return ok(`Report filed: ${status}.`)
      },
    },
  ]
}
