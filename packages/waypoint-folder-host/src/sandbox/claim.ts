import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The file-based claim (rsc-3yf, Phase 2 — decided 2026-07-16).
 *
 * A sandboxed worker cannot file its report row: `waypoint tasks report` needs the
 * CLI and a route to Postgres, and an egress-denied Linux container has neither.
 * So the medium changes, and only the medium: the agent writes its claim into
 * the bind-mounted workspace, and the HOST reads it after exit and records the
 * durable row.
 *
 * This is the existing doctrine, not a weakening of it. The report was always
 * "the agent's CLAIM; the runtime is the judge" (worker-runtime.ts). A file the
 * host controls is no more trustworthy than a CLI write and no less — an agent
 * could always claim `finished` falsely, which is why the host verifies
 * artifacts and contracts before applying anything. What this buys is that
 * Postgres never enters the sandbox: no gate, dispatch row, or other project is
 * reachable from inside.
 *
 * The claim lands under the attempt's own scratch-adjacent path so it is
 * per-attempt, inside the mount, and cannot be confused with a prior attempt's.
 */

/** Path (relative to the project root) the agent writes its claim to. */
export function claimRelPath(routeId: string, taskId: string): string {
  return path.posix.join('.waypoint', 'claims', routeId, `${taskId}.json`)
}

/** Absolute host path of the claim file for an attempt. */
export function claimHostPath(projectRoot: string, routeId: string, taskId: string): string {
  return path.join(projectRoot, ...claimRelPath(routeId, taskId).split('/'))
}

/** Path the agent sees, inside the sandbox. */
export function claimSandboxPath(mountPath: string, routeId: string, taskId: string): string {
  return path.posix.join(mountPath, claimRelPath(routeId, taskId))
}

/**
 * The file-claim report contract — what replaces `waypoint tasks report` in the
 * work order on EVERY execution path (rsc-452). Same doctrine, different medium:
 * report exactly once, the report is a claim and not the verdict, and the host
 * still judges. The seatbelt path adopted this from the sandboxed one so the
 * worker never needs a route to the run database — no `WAYPOINT_POSTGRES_URL`, no
 * write path into gates, dispatch rows, or other projects' schemas.
 */
/**
 * The report contract for a worker on a CLOSED TOOL SURFACE — one with no
 * shell and no file access, whose tools include `report`.
 *
 * Same doctrine, third medium. The file-claim text above tells the worker to
 * write JSON to a path, which a tools-only worker cannot do: it was handed
 * "FIRST, before any other work: write <path> containing …" and had no
 * file-writing tool to obey it with. An extractor ran 20 minutes, wrote 28
 * output pages, exited 0 and filed nothing, so the attempt was recorded as
 * having done nothing at all. A contract phrased for a capability the worker
 * lacks is not a contract, it is a trap — the same mistake the review contract
 * made by printing a CLI command no worker can run.
 */
export function toolClaimReportContract(gateFacing = false): string[] {
  return [
    'Report by calling the `report` tool. You have no file access, so this is your ONLY way to report, and an ' +
      'attempt that ends without one is recorded as having done nothing — every page it wrote is treated as untrusted.',
    '- Call it ONCE at the start with status "failed" and summary "attempt started; not yet reported". It costs a ' +
      'single call and it is what stands if you are killed, run out of room, or lose the thread.',
    '- Call it again as your LAST act with the real result: status "finished" when the work is done and verified, or ' +
      '"failed" with what stopped you. An honest failure is worth far more than silence, which reads as a crash.',
    '- If your work order lists review checks, pass a verdict for EVERY one in the tool\'s `review` argument. A ' +
      'verdict written in your summary instead does not count and the whole attempt is rejected.',
    gateFacing
      ? '- The "brief" argument is REQUIRED: finishing this task puts the work in front of a human reviewer for ' +
        'approval, and your brief is what they read first. One to three plain sentences: what you did and what ' +
        'they are being asked to approve. No file paths, no system vocabulary. A finished report without a ' +
        'brief is rejected.'
      : '- The "brief" argument is OPTIONAL and is an exception note to the reviewer, not a narrative: something true, ' +
        'that they do not already know, and that could change a decision. Omit it when you have nothing to add.',
  ]
}

export function fileClaimReportContract(taskId: string, claimPath: string, gateFacing = false): string[] {
  return [
    `Report by writing your claim as JSON to this exact path: ${claimPath}`,
    '- The claim file IS the report. Do NOT use `waypoint tasks report` — this worker has no route to the run database, by design.',
    `- Write the stub FIRST, before starting the task: {"task_id": "${taskId}", "status": "failed", "summary": "attempt started; not yet reported"}. It costs one write and it is what stands if you are killed, run out of budget, or lose the thread — an attempt that finishes the work but never writes this file is recorded as having done nothing, and every hour of it is thrown away.`,
    `- When complete and verified, write: {"task_id": "${taskId}", "status": "finished", "summary": "<what you did>", "brief": "<your note to the reviewer>", "evidence": {"<key>": "<value>"}} (cite the files or checks that prove the work)`,
    gateFacing
      ? '- The "brief" is REQUIRED: finishing this task puts the work in front of a human reviewer for approval, and your brief is what they read first. One to three plain sentences: what you did and what they are being asked to approve. A finished report without a brief is rejected.'
      : '- The "brief" is OPTIONAL and is an exception note, not a narrative. The approval already tells the reviewer what will happen, why it is due, and the proof — all derived from the project. Omit "brief" entirely (most of the time) when you have nothing to add to that.',
    '- Write one only for something that is true, that the reviewer does not already know, and that could change their decision: a conflict in the inputs, a judgment call you had to make, a real obstacle. One or two sentences. NEVER recount how a fact came to be known, restate what the project already records, describe a default as if it were a problem, or raise something you resolved yourself — a reviewer reading a paragraph of things that do not matter stops reading the ones that do.',
    '- When you do write one, speak as a careful colleague to a busy reviewer. No file paths, no schema versions, no underscore_names, no system vocabulary. Call an input what the reviewer calls it, NEVER a machine copy or an internal path; the reviewer has never seen those and never will.',
    `- If you cannot complete the task, write: {"task_id": "${taskId}", "status": "failed", "summary": "<what failed and why>"}`,
    '- Write it exactly once, as valid JSON. The claim is your claim, not the verdict — the host reads this file after you exit, verifies the declared artifacts, and derives the outcome.',
  ]
}

/**
 * Translate a host path into the path the agent sees inside the sandbox. The
 * work order must speak the sandbox's coordinates: a host path like
 * /Users/…/case/.waypoint/scratch does not exist inside the container, and telling
 * an agent to write there sends it somewhere real but wrong.
 */
export function toSandboxPath(projectRoot: string, hostPath: string, mountPath: string): string {
  const rel = path.relative(path.resolve(projectRoot), path.resolve(hostPath))
  if (rel === '') return mountPath
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`sandbox: ${hostPath} is outside the project root ${projectRoot} — it has no path inside the sandbox (fail closed)`)
  }
  return path.posix.join(mountPath, ...rel.split(path.sep))
}

/**
 * Read a sandboxed attempt's claim as a report row, or null when the agent
 * never wrote one (which the runtime treats exactly as a missing report row:
 * a failed attempt — the report contract is mandatory either way).
 *
 * Malformed JSON is null, not a throw: a garbled claim is an agent that did not
 * report, and the host's verdict for that is already 'failed'. Throwing here
 * would turn a bad claim into a runtime crash.
 */
export async function readSandboxClaim(
  projectRoot: string,
  routeId: string,
  taskId: string,
): Promise<Record<string, unknown> | null> {
  let text: string
  try {
    text = await readFile(claimHostPath(projectRoot, routeId, taskId), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
