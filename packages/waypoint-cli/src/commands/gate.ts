import {
  approveRouteGate,
  presentGateChangeset,
  rejectRouteGate,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export interface GateCommandDependencies {
  readonly approveRouteGate: typeof approveRouteGate
  readonly rejectRouteGate: typeof rejectRouteGate
  readonly presentGateChangeset: typeof presentGateChangeset
}

const DEFAULT_DEPENDENCIES: GateCommandDependencies = {
  approveRouteGate,
  rejectRouteGate,
  presentGateChangeset,
}

export async function runGateCommand(
  args: readonly string[],
  io: WaypointCliIo,
  overrides: Partial<GateCommandDependencies> = {},
): Promise<number> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides }
  const routeId = readRequiredOption(args, '--route-id')
  if (routeId.ok === false) return fail(io, routeId.error)
  const node = readRequiredOption(args, '--node')
  if (node.ok === false) return fail(io, node.error)

  const show = args.includes('--show')
  const approve = args.includes('--approve')
  const reject = args.includes('--reject')
  if (show) {
    if (approve || reject) {
      return fail(io, '--show does not combine with approval or rejection')
    }
    return showGate(
      io,
      routeId.value,
      node.value,
      args.includes('--json'),
      dependencies,
    )
  }
  if (approve === reject) return fail(io, 'Exactly one of --approve, --reject, or --show is required')

  const note = readOptionalOption(args, '--note')
  const nextNode = readOptionalOption(args, '--next-node')
  const changesetDigest = readOptionalOption(args, '--changeset-digest')
  try {
    const projectRoot = io.cwd ?? process.cwd()
    let updated
    if (approve) {
      updated = await dependencies.approveRouteGate(projectRoot, {
        routeId: routeId.value,
        node: node.value,
        note,
        nextNode,
        changesetDigest,
      })
    } else {
      updated = await dependencies.rejectRouteGate(projectRoot, {
        routeId: routeId.value,
        node: node.value,
        note,
      })
    }

    io.stdout(`${approve ? 'Approved' : 'Rejected'} gate ${node.value} on run ${updated.id}`)
    io.stdout(`status: ${updated.status}`)
    io.stdout(`current node: ${updated.current_node ?? 'none'}`)
    if (note) io.stdout(`note: ${note}`)
    if (approve && changesetDigest) io.stdout(`changeset: ${changesetDigest} (verified against the gated artifacts)`)
    return 0
  } catch (error) {
    return fail(io, error instanceof Error ? error.message : String(error))
  }
}

/**
 * `waypoint gate --show`: what a reviewer of this gate is approving. On a
 * changeset gate, prints the digest + per-file manifest to review against
 * and to pass back via --changeset-digest (read-verify-bind).
 */
async function showGate(
  io: WaypointCliIo,
  routeId: string,
  node: string,
  json: boolean,
  dependencies: GateCommandDependencies,
): Promise<number> {
  try {
    const presentation = await dependencies.presentGateChangeset(
      io.cwd ?? process.cwd(),
      routeId,
      node,
    )
    if (json) {
      io.stdout(JSON.stringify(presentation, null, 2))
      return 0
    }
    io.stdout(`gate ${presentation.node} on run ${presentation.routeId}`)
    io.stdout(`approves: ${presentation.approves}`)
    if (presentation.changeset) {
      io.stdout(`changeset digest: ${presentation.changeset.digest} (${presentation.changeset.algorithm})`)
      io.stdout(`manifest (${presentation.changeset.manifest.length} file(s)):`)
      for (const entry of presentation.changeset.manifest) {
        io.stdout(`  ${entry.path} ${entry.sha256}`)
      }
      io.stdout(`approve with: waypoint gate --route-id ${presentation.routeId} --node ${presentation.node} --approve --changeset-digest ${presentation.changeset.digest}`)
    }
    return 0
  } catch (error) {
    return fail(io, error instanceof Error ? error.message : String(error))
  }
}

function fail(io: WaypointCliIo, message: string): number {
  io.stderr(message)
  return 1
}

function readRequiredOption(args: readonly string[], name: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = readOptionalOption(args, name)
  if (!value) return { ok: false, error: `Missing required option: ${name}` }
  return { ok: true, value }
}

function readOptionalOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  const value = index === -1 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}

function count(args: readonly string[], value: string): number {
  return args.reduce((total, arg) => total + (arg === value ? 1 : 0), 0)
}
