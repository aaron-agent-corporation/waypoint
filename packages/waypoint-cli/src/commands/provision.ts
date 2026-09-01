// `waypoint provision` — the host owns its agents' environments: everything a
// run needs is provisioned HERE, at install/deploy time, so nothing installs
// during a run and agents never install anything themselves.

import { existsSync, realpathSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WaypointCliIo } from '../bin.ts'

/** The CLI shim directory root: $WAYPOINT_HOME or ~/.waypoint. */
function waypointHome(): string {
  const override = process.env.WAYPOINT_HOME?.trim()
  return override && override !== '' ? override : join(homedir(), '.waypoint')
}

export interface RunProvisionCommandOptions {
  readonly homePath?: string
}

/**
 * A node path that survives the next `brew upgrade`.
 *
 * `process.execPath` is version-pinned — on this machine it resolves to
 * `/opt/homebrew/Cellar/node/24.7.0/bin/node`. Homebrew removes the old Cellar
 * directory on upgrade, so a shim written with that path stops working at some
 * arbitrary later moment, and the workers that reach `waypoint` through it
 * improvise around a command that has silently vanished. The stable symlink
 * beside it does not move.
 *
 * A candidate is only accepted when it resolves to the SAME real binary that is
 * running now: a `/usr/bin/node` from an unrelated install would be a different
 * node with different flag support, which is a worse failure than the pinned
 * path. No candidate matching → keep `execPath`, and let the shim's own
 * existence check produce the actionable error.
 */
export function stableNodePath(
  execPath: string = process.execPath,
  candidates: readonly string[] = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'],
  realpath: (path: string) => string = realpathSync,
): string {
  let actual: string
  try {
    actual = realpath(execPath)
  } catch {
    return execPath
  }
  for (const candidate of candidates) {
    try {
      if (realpath(candidate) === actual) return candidate
    } catch {
      // Not installed at that location; try the next.
    }
  }
  return execPath
}

/**
 * The shim body.
 *
 * It checks both of its own dependencies before exec'ing, because every way
 * this shim breaks breaks it for a WORKER — a jailed agent mid-quest, whose
 * only report of the failure is whatever the shell printed. `exec: no such
 * file` names a Cellar path and tells that agent nothing about what to do, so
 * on 2026-08-15 a shim pointing at a nonexistent `dist/bin.ts` had every worker
 * `waypoint` call die silently. Exit 127 is the shell's own "command not found".
 */
export function renderWaypointShim(nodePath: string, binPath: string): string {
  const node = JSON.stringify(nodePath)
  const bin = JSON.stringify(binPath)
  return [
    '#!/bin/sh',
    '# Written by `waypoint provision` — do not edit.',
    `NODE=${node}`,
    `BIN=${bin}`,
    'if [ ! -x "$NODE" ]; then',
    '  echo "waypoint: no node at $NODE" >&2',
    '  echo "waypoint: this shim is stale (a node upgrade moves the interpreter). Re-run \\`waypoint provision\\` from the Waypoint checkout to rewrite it." >&2',
    '  exit 127',
    'fi',
    'if [ ! -f "$BIN" ]; then',
    '  echo "waypoint: no Waypoint CLI at $BIN" >&2',
    '  echo "waypoint: the checkout moved, or provision ran from a build that no longer exists. Re-run \\`waypoint provision\\` from the Waypoint checkout to rewrite it." >&2',
    '  exit 127',
    'fi',
    'exec "$NODE" --experimental-strip-types --disable-warning=ExperimentalWarning "$BIN" "$@"',
    '',
  ].join('\n')
}

export async function runProvisionCommand(
  args: readonly string[],
  io: WaypointCliIo,
  options: RunProvisionCommandOptions = {},
): Promise<number> {
  const json = args.includes('--json')
  try {
    // The `waypoint` shim workers reach (worker-env.ts prepends the waypoint
    // home's bin dir to every worker PATH): without a provisioned shim a
    // worker improvises with whatever stale checkout it can find. Points at
    // THIS checkout's bin, always — bin.ts when provision runs from source,
    // bin.js when it runs from dist (the 2026-08-15 shim pointed at a
    // nonexistent dist/bin.ts and every worker `waypoint` call died silently).
    const binTs = fileURLToPath(new URL('../bin.ts', import.meta.url))
    const binResolved = existsSync(binTs) ? binTs : fileURLToPath(new URL('../bin.js', import.meta.url))
    const shimDir = join(options.homePath ?? waypointHome(), 'bin')
    const shimPath = join(shimDir, 'waypoint')
    await mkdir(shimDir, { recursive: true })
    await writeFile(shimPath, renderWaypointShim(stableNodePath(), binResolved), 'utf8')
    await chmod(shimPath, 0o755)
    if (json) {
      io.stdout(JSON.stringify({
        provisioned: [
          { name: 'waypoint-shim', path: shimPath },
        ],
      }, null, 1))
    } else {
      io.stdout(`waypoint shim ready: ${shimPath}`)
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (json) {
      io.stdout(JSON.stringify({ error: message }, null, 1))
    } else {
      io.stderr(`provision failed: ${message}`)
    }
    return 1
  }
}
