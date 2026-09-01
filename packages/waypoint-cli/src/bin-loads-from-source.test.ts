import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

/**
 * The shipped `runner` binary runs from SOURCE under
 * `node --experimental-strip-types`, which erases types without emitting
 * code. Any syntax that needs codegen — a constructor parameter property
 * (`constructor(readonly code: X)`), an enum, a namespace, a decorator —
 * refuses to load with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 *
 * Neither of the checks that normally protect this catches it: tsc compiles
 * the shorthand happily, and vitest transforms the module before running it.
 * So a dead binary once shipped while the build and the whole
 * package suite stayed green — every `waypoint` invocation threw at import.
 *
 * This loads the real entry point the same way the binary does, so the next
 * such syntax fails here instead of in the operator's terminal.
 */
describe('waypoint CLI entry point', () => {
  it('imports under --experimental-strip-types, the way the shipped binary runs it', async () => {
    const bin = fileURLToPath(new URL('./bin.ts', import.meta.url))

    // Import only. Running a command would need a project and postgres; the
    // failure this guards happens at module evaluation, before any argv is read.
    await expect(execFileAsync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '--eval',
        `import(${JSON.stringify(bin)}).then(() => process.exit(0))`,
      ],
      { timeout: 60_000 },
    )).resolves.toBeDefined()
  }, 70_000)
})
