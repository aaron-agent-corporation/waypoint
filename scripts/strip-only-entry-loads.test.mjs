import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, '..')

/**
 * The deployed bridge and the shipped `runner` binary run SOURCE under
 * `node --experimental-strip-types`, which erases types without emitting
 * code. Syntax that needs codegen — a constructor parameter property, an
 * enum, a namespace, a decorator — refuses to load with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, and neither tsc nor vitest catches it
 * (both transform the module before running it). Four legal commands once
 * shipped a dead binary this way while the whole suite stayed green.
 *
 * bin-loads-from-source.test.ts guards the one CLI entry; this widens the
 * guard to EVERY package src entry (docs/PLAN.md item 23).
 */
const ENTRIES = [
  'src/index.ts', // @waypoint-engine/core core
  'packages/waypoint-cli/src/index.ts',
  'packages/waypoint-cli/src/bin.ts',
  'packages/waypoint-folder-host/src/index.ts',
  'packages/waypoint-worker-tools/src/index.ts',
  'packages/waypoint-worker-tools/src/mcp-server.ts',
]

async function stripLoad(absolute) {
  try {
    await execFileAsync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        // Import only: the failure this guards happens at module
        // evaluation. Every entry (including both MCP servers) has a
        // main-module guard, so import never starts a server.
        '--eval',
        `import(${JSON.stringify(absolute)}).then(() => process.exit(0))`,
      ],
      { timeout: 60_000 },
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, stderr: String(error?.stderr ?? error) }
  }
}

describe('every package src entry loads under --experimental-strip-types', () => {
  for (const entry of ENTRIES) {
    it(entry, async () => {
      const absolute = resolve(repoRoot, entry)
      // A moved/deleted entry must fail here, not silently guard nothing.
      expect(existsSync(absolute), `entry point missing: ${entry}`).toBe(true)

      const result = await stripLoad(absolute)
      if (result.ok) return

      expect.fail(`${entry} failed to load under --experimental-strip-types:\n${result.stderr}`)
    }, 70_000)
  }
})
