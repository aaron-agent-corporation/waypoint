import { realpathSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getWaypointPostgres, quoteIdent } from '../postgres/client.ts'

/**
 * Run dossier (rsc-9y6, docs/designs/run-dossier.md): one reviewable record
 * per run, written into the case folder — the engine-side run record (route,
 * tasks, dispatches with reports, events, config snapshot) joined with the
 * Console operator sessions that drove it. The postgres schema stays the
 * truth; this is a review artifact assembled FROM it, so quests and the
 * platform can be optimized from what actually happened, including operator
 * and orchestrator interventions that otherwise live only in chat.
 */

export interface WaypointRunDossierOptions {
  readonly routeId: string
  /** Console base URL; default WAYPOINT_CONSOLE_URL or 127.0.0.1:6767. */
  readonly consoleUrl?: string
  /** Explicit session ids to include beyond the auto-linked ones. */
  readonly sessionIds?: readonly string[]
  /** Free-text notes recorded in the dossier (operator/orchestrator seam). */
  readonly notes?: readonly string[]
  readonly now?: Date
}

export interface WaypointRunDossierResult {
  readonly markdownPath: string
  readonly jsonPath: string
  readonly sessionsLinked: number
  /** True when the Console could not be reached — run record still written. */
  readonly sessionsUnavailable: boolean
}

interface ConsoleSession {
  readonly id: string
  readonly title?: string
  readonly agent_name?: string
  readonly workspace?: string
  readonly created_at?: number
  readonly updated_at?: number
  items?: readonly Record<string, unknown>[]
}

const MARKDOWN_CALL_EXCERPT = 400
const MARKDOWN_OUTPUT_EXCERPT = 1200
const MARKDOWN_TEXT_EXCERPT = 4000

export function defaultConsoleUrl(): string {
  const fromEnv = process.env.WAYPOINT_CONSOLE_URL?.trim()
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : 'http://127.0.0.1:6767'
}

export async function writeWaypointRunDossier(
  projectRoot: string,
  options: WaypointRunDossierOptions,
): Promise<WaypointRunDossierResult> {
  const { pool, schema } = await getWaypointPostgres(projectRoot)
  const s = quoteIdent(schema)

  const routeResult = await pool.query(`SELECT * FROM ${s}.routes WHERE id = $1`, [options.routeId])
  const route = routeResult.rows[0] as Record<string, unknown> | undefined
  if (!route) throw new Error(`Route not found: ${options.routeId}`)

  const tasks = (
    await pool.query(`SELECT * FROM ${s}.tasks WHERE route_id = $1 ORDER BY id`, [options.routeId])
  ).rows as Record<string, unknown>[]
  const dispatches = (
    await pool.query(`SELECT * FROM ${s}.dispatches WHERE route_id = $1 ORDER BY id`, [options.routeId])
  ).rows as Record<string, unknown>[]
  const events = (
    await pool.query(`SELECT * FROM ${s}.route_events WHERE route_id = $1 ORDER BY id`, [options.routeId])
  ).rows as Record<string, unknown>[]

  let configSnapshot: string | null = null
  try {
    configSnapshot = await readFile(join(projectRoot, '.waypoint', 'config.yaml'), 'utf8')
  } catch {
    // Snapshot is best-effort — a missing config never blocks the record.
  }

  const consoleUrl = options.consoleUrl ?? defaultConsoleUrl()
  const { sessions, unavailable } = await collectSessions(projectRoot, consoleUrl, route, options.sessionIds ?? [])

  const generatedAt = (options.now ?? new Date()).toISOString()
  const dossier = {
    generated_at: generatedAt,
    project_root: projectRoot,
    schema,
    route_id: options.routeId,
    quest: route.quest ?? null,
    route,
    config_yaml: configSnapshot,
    tasks,
    dispatches,
    events,
    notes: options.notes ?? [],
    console_url: consoleUrl,
    sessions_unavailable: unavailable,
    sessions,
  }

  const reportDir = join(projectRoot, '.waypoint', 'reports', options.routeId)
  await mkdir(reportDir, { recursive: true })
  const jsonPath = join(reportDir, 'dossier.json')
  const markdownPath = join(reportDir, 'dossier.md')
  await writeFile(jsonPath, `${JSON.stringify(dossier, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderMarkdown(dossier), 'utf8')

  return { markdownPath, jsonPath, sessionsLinked: sessions.length, sessionsUnavailable: unavailable }
}

/**
 * The session `waypoint start` stamped into route metadata (rsc-9y6). This is
 * KNOWLEDGE, not inference: the Console exports WAYPOINT_SESSION_ID into
 * the terminal, and start recorded whatever launched the run. When present it
 * is treated exactly like an explicitly-passed `--session` id — always fetched,
 * never subject to the workspace/recency filter, because we are not guessing.
 */
function stampedSessionId(route: Record<string, unknown>): string | undefined {
  const metadata = route.metadata
  if (typeof metadata !== 'object' || metadata === null) return undefined
  const runner = (metadata as Record<string, unknown>).runner
  if (typeof runner !== 'object' || runner === null) return undefined
  const id = (runner as Record<string, unknown>).console_session_id
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : undefined
}

/**
 * Auto-link Console sessions. The stamped session id is authoritative when the
 * run recorded one. The workspace heuristic REMAINS for everything that did not
 * — every route started before the stamp existed, and every run launched
 * outside a Console terminal — so it is a fallback, not dead code: workspace
 * equals the project root or its DIRECT parent (the orchestrator often works
 * from the folder above the case — anything broader over-matches
 * home-directory sessions), and last active at/after route start (one hour of
 * slack for pre-start planning). Explicit ids are always fetched. Any Console
 * failure degrades to an unavailable marker; the run record must never depend
 * on the Console.
 */
async function collectSessions(
  projectRoot: string,
  consoleUrl: string,
  route: Record<string, unknown>,
  requestedIds: readonly string[],
): Promise<{ sessions: ConsoleSession[]; unavailable: boolean }> {
  const stamped = stampedSessionId(route)
  const explicitIds = stamped === undefined ? requestedIds : [...new Set([...requestedIds, stamped])]
  let roots: string[]
  try {
    const real = realpathSync(projectRoot)
    roots = [...new Set([projectRoot, real, dirname(projectRoot), dirname(real)])]
  } catch {
    roots = [projectRoot, dirname(projectRoot)]
  }
  const routeStartedMs = Date.parse(String(route.created_at ?? '')) || 0

  try {
    const listed = (await fetchJson(`${consoleUrl}/v1/sessions`)) as { data?: ConsoleSession[] }
    const all = listed.data ?? []
    const picked = new Map<string, ConsoleSession>()
    for (const session of all) {
      const workspace = session.workspace?.replace(/\/$/, '')
      const activeMs = (session.updated_at ?? session.created_at ?? 0) * 1000
      const linked = workspace !== undefined && roots.includes(workspace) && activeMs >= routeStartedMs - 3_600_000
      if (linked || explicitIds.includes(session.id)) picked.set(session.id, { ...session })
    }
    for (const id of explicitIds) {
      if (!picked.has(id)) picked.set(id, { id })
    }
    for (const session of picked.values()) {
      try {
        const items = (await fetchJson(`${consoleUrl}/v1/sessions/${encodeURIComponent(session.id)}/items`)) as {
          data?: Record<string, unknown>[]
        }
        session.items = items.data ?? []
      } catch {
        session.items = undefined
      }
    }
    return { sessions: [...picked.values()], unavailable: false }
  } catch {
    return { sessions: [], unavailable: true }
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.json()
}

function renderMarkdown(dossier: Record<string, unknown>): string {
  const lines: string[] = []
  const route = dossier.route as Record<string, unknown>
  lines.push(`# Run dossier — ${String(dossier.route_id)} (${String(dossier.quest ?? 'unknown quest')})`)
  lines.push('')
  lines.push(`- generated: ${String(dossier.generated_at)}`)
  lines.push(`- project: ${String(dossier.project_root)}`)
  lines.push(`- schema: ${String(dossier.schema)}`)
  lines.push(`- status: ${String(route.status)} (current node: ${String(route.current_node ?? '-')})`)
  lines.push(`- started: ${String(route.created_at)}  last update: ${String(route.updated_at)}`)

  const notes = dossier.notes as readonly string[]
  if (notes.length > 0) {
    lines.push('', '## Notes')
    for (const note of notes) lines.push(`- ${note}`)
  }

  lines.push('', '## Tasks')
  lines.push('| plan | kind | status |', '| --- | --- | --- |')
  for (const task of dossier.tasks as Record<string, unknown>[]) {
    lines.push(`| ${String(task.plan_ref)} | ${String(task.kind)} | ${String(task.status)} |`)
  }

  lines.push('', '## Dispatches (agent attempts)')
  const dispatches = dossier.dispatches as Record<string, unknown>[]
  if (dispatches.length === 0) lines.push('_none recorded_')
  for (const dispatch of dispatches) {
    lines.push(
      `- #${String(dispatch.id)} ${String(dispatch.task_ref)} (${String(dispatch.recipe)}) — ` +
        `${String(dispatch.status)}${dispatch.close_reason ? ` / ${String(dispatch.close_reason)}` : ''}`,
    )
    lines.push(`  - created ${String(dispatch.created_at)}, claimed ${String(dispatch.claimed_at ?? '-')}, closed ${String(dispatch.closed_at ?? '-')}`)
    if (dispatch.report !== null && dispatch.report !== undefined) {
      lines.push(`  - report: ${excerpt(JSON.stringify(dispatch.report), MARKDOWN_OUTPUT_EXCERPT)}`)
    }
  }

  lines.push('', '## Events')
  for (const event of dossier.events as Record<string, unknown>[]) {
    const payload = event.payload === null || event.payload === undefined ? '' : ` ${excerpt(JSON.stringify(event.payload), MARKDOWN_CALL_EXCERPT)}`
    lines.push(`- ${String(event.created_at)} ${String(event.kind)}${payload}`)
  }

  if (dossier.config_yaml !== null) {
    lines.push('', '## Project config snapshot (as of generation)', '', '```yaml', String(dossier.config_yaml).trimEnd(), '```')
  }

  lines.push('', '## Operator sessions')
  if (dossier.sessions_unavailable === true) {
    lines.push('_Console unavailable at generation time — session transcripts not captured (run record above is complete)._')
  }
  const sessions = dossier.sessions as ConsoleSession[]
  if (sessions.length === 0 && dossier.sessions_unavailable !== true) lines.push('_no linked sessions found_')
  for (const session of sessions) {
    lines.push('', `### ${session.id}${session.title ? ` — ${session.title}` : ''}`)
    lines.push(`- agent: ${session.agent_name ?? '-'}  workspace: ${session.workspace ?? '-'}`)
    if (!session.items) {
      lines.push('- _transcript unavailable_')
      continue
    }
    for (const item of session.items) {
      const type = String(item.type ?? '')
      if (type === 'message') {
        const role = String(item.role ?? 'unknown')
        const content = Array.isArray(item.content)
          ? item.content
              .map((part) => (typeof part === 'object' && part !== null ? String((part as Record<string, unknown>).text ?? '') : ''))
              .join('')
          : String(item.content ?? '')
        lines.push('', `**${role}:** ${excerpt(content, MARKDOWN_TEXT_EXCERPT)}`)
      } else if (type === 'function_call') {
        lines.push('', `→ \`${String(item.name ?? 'tool')}\` ${excerpt(String(item.arguments ?? ''), MARKDOWN_CALL_EXCERPT)}`)
      } else if (type === 'function_call_output') {
        lines.push(`  ↳ ${excerpt(String(item.output ?? ''), MARKDOWN_OUTPUT_EXCERPT)}`)
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}… [truncated; full text in dossier.json]`
}
