import {
  getWaypointProjectPaths,
  readWaypointProjectConfig,
  type WaypointProjectWorkerLaneConfig,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

const CLASSES = ['high', 'medium', 'low'] as const

/**
 * `waypoint workers [--json]` — who is available to pick up work.
 *
 * A worker pool is one lane per SUBSCRIPTION, and lanes are interchangeable
 * right up until one of them breaks; then the only question is which account
 * it was (Aaron 2026-07-28). This prints the seat chart: the lane, the email
 * the provider knows it by, the binary it runs, the credential home that binds
 * it to that account, and what each capability class means there.
 */
export async function runWorkersCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const cwd = io.cwd ?? process.cwd()
  // Outside a project this degrades to a clear one-liner, the way
  // `waypoint providers` does — not six lines of ENOENT internals.
  let config
  try {
    config = await readWaypointProjectConfig(getWaypointProjectPaths(cwd).configPath)
  } catch {
    if (json) {
      io.stdout(JSON.stringify({ error: 'not a Waypoint project (no .waypoint/config.yaml)', cwd }, null, 2))
    } else {
      io.stdout(`Not a Waypoint project: no .waypoint/config.yaml under ${cwd}.`)
      io.stdout('Worker lanes are per-project config — cd to a project (or run `waypoint init`) first.')
    }
    return 1
  }
  const worker = config.runtime.worker
  const lanes = worker?.lanes ?? []

  if (json) {
    io.stdout(
      JSON.stringify(
        {
          pool: lanes.length > 0 ? 'lanes' : 'single',
          workers: lanes.length > 0 ? lanes.length : (worker?.concurrency ?? 1),
          lanes: lanes.map((lane) => describe(lane, worker)),
        },
        null,
        2,
      ),
    )
    return 0
  }

  if (lanes.length === 0) {
    const workers = worker?.concurrency ?? 1
    io.stdout(`workers: ${workers} (no lanes configured — ${workers} copies of one worker)`)
    io.stdout('A lane per subscription spreads the load across plans: runtime.worker.lanes in .waypoint/config.yaml')
    return 0
  }

  io.stdout(`workers: ${lanes.length} (one per lane)`)
  for (const lane of lanes) {
    const shown = describe(lane, worker)
    io.stdout('')
    io.stdout(`  ${shown.name}${shown.email ? `  <${shown.email}>` : '  <no email — set lane.email>'}`)
    io.stdout(`    command: ${shown.command ?? '(inherits runtime.worker.command)'} ${(shown.args ?? []).join(' ')}`)
    for (const [key, value] of Object.entries(shown.env ?? {})) io.stdout(`    ${key}=${value}`)
    for (const cls of CLASSES) {
      const model = shown.model_args?.[cls]
      if (model) io.stdout(`    ${cls}: ${model.join(' ')}`)
    }
  }
  return 0
}

function describe(
  lane: WaypointProjectWorkerLaneConfig,
  worker: { readonly command?: string; readonly args?: readonly string[]; readonly model_args?: unknown } | undefined,
): {
  name: string
  email?: string
  command?: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  model_args?: Partial<Record<(typeof CLASSES)[number], readonly string[]>>
} {
  return {
    name: lane.name,
    ...(lane.email ? { email: lane.email } : {}),
    ...(lane.command ?? worker?.command ? { command: lane.command ?? worker?.command } : {}),
    ...(lane.args ?? worker?.args ? { args: lane.args ?? worker?.args } : {}),
    ...(lane.env ? { env: lane.env } : {}),
    ...(lane.model_args ?? worker?.model_args
      ? { model_args: (lane.model_args ?? worker?.model_args) as Partial<Record<(typeof CLASSES)[number], readonly string[]>> }
      : {}),
  }
}
