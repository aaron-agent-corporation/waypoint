import { loadRecipeManifest } from '../autopilot/run.ts'
import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'

/**
 * Tier-tuning scorecard (rsc-b5b, docs/MODEL-ROUTING.md): the dispatch-row
 * readout that replaced the city-based tier-report tool deleted with Gas
 * City (P4). One row per recipe seen in the project's durable dispatches:
 * which class it runs at, how attempts ended (the four-outcome vocabulary),
 * how long queue and work took, and the last close reason as an evidence
 * excerpt. Reads only.
 */
export interface WaypointTierReportRow {
  readonly recipe: string
  /** The recipe's declared model class; 'untagged' when the manifest has
   * none, 'unknown' when no manifest resolves for the slug. */
  readonly model_class: string
  readonly dispatches: number
  readonly outcomes: {
    readonly finished: number
    /** Closed with anything other than finished/exhausted/stopped — includes
     * a finished attempt whose engine signal was never consumed. */
    readonly failed: number
    readonly exhausted: number
    readonly stopped: number
    /** Not yet terminal: pending + running (closed_at IS NULL). */
    readonly open: number
  }
  /** Mean seconds from dispatch creation to claim, over claimed rows. */
  readonly avg_queue_seconds: number | null
  /** Mean seconds from claim to close, over closed rows. */
  readonly avg_work_seconds: number | null
  /** The last attempt's report summary — the agent's evidence-bearing claim. */
  readonly last_summary: string | null
}

const SUMMARY_EXCERPT_MAX = 200

export async function spineTierReport(projectRoot: string): Promise<WaypointTierReportRow[]> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)
  // Outcome lives in close_reason (the W4 close writes status
  // 'completed'/'failed' and close_reason = the four-outcome word, or
  // 'signal not consumed (...)' — which counts as failed).
  const result = await pool.query(
    `SELECT recipe,
            count(*)::int AS dispatches,
            count(*) FILTER (WHERE closed_at IS NOT NULL AND close_reason = 'finished')::int AS finished,
            count(*) FILTER (WHERE closed_at IS NOT NULL AND close_reason NOT IN ('finished', 'exhausted', 'stopped'))::int AS failed,
            count(*) FILTER (WHERE closed_at IS NOT NULL AND close_reason = 'exhausted')::int AS exhausted,
            count(*) FILTER (WHERE closed_at IS NOT NULL AND close_reason = 'stopped')::int AS stopped,
            count(*) FILTER (WHERE closed_at IS NULL)::int AS open,
            avg(EXTRACT(EPOCH FROM (claimed_at - created_at))) FILTER (WHERE claimed_at IS NOT NULL) AS avg_queue_seconds,
            avg(EXTRACT(EPOCH FROM (closed_at - claimed_at))) FILTER (WHERE closed_at IS NOT NULL AND claimed_at IS NOT NULL) AS avg_work_seconds,
            (array_agg(report->>'summary' ORDER BY id DESC) FILTER (WHERE report->>'summary' IS NOT NULL))[1] AS last_summary
     FROM ${s}.dispatches
     GROUP BY recipe
     ORDER BY recipe`,
  )

  const rows: WaypointTierReportRow[] = []
  for (const raw of result.rows as ReadonlyArray<Record<string, unknown>>) {
    const recipe = String(raw.recipe)
    rows.push({
      recipe,
      model_class: await modelClassFor(projectRoot, recipe),
      dispatches: Number(raw.dispatches),
      outcomes: {
        finished: Number(raw.finished),
        failed: Number(raw.failed),
        exhausted: Number(raw.exhausted),
        stopped: Number(raw.stopped),
        open: Number(raw.open),
      },
      avg_queue_seconds: raw.avg_queue_seconds === null ? null : round1(Number(raw.avg_queue_seconds)),
      avg_work_seconds: raw.avg_work_seconds === null ? null : round1(Number(raw.avg_work_seconds)),
      last_summary: raw.last_summary === null ? null : String(raw.last_summary).slice(0, SUMMARY_EXCERPT_MAX),
    })
  }
  return rows
}

async function modelClassFor(projectRoot: string, recipeSlug: string): Promise<string> {
  try {
    const manifest = await loadRecipeManifest(projectRoot, recipeSlug)
    return manifest.runtime?.model_class ?? 'untagged'
  } catch {
    // A dispatch can outlive its recipe (renamed, removed) — the report
    // still shows the row; only the class is unresolvable.
    return 'unknown'
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
