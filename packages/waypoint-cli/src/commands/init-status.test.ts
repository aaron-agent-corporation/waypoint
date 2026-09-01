import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as yamlParse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { DEFAULT_WORKER_MODEL_ARGS } from './worker-runtime-defaults.ts'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

/** Run `body` with WAYPOINT_CONFIG_HOME pointed at a fresh dir whose
 * config.yaml has the given content (no file when null), restoring after. */
async function withGlobalConfig(content: string | null, body: () => Promise<void>): Promise<void> {
  const saved = process.env.WAYPOINT_CONFIG_HOME
  const home = await mkdtemp(join(tmpdir(), 'waypoint-global-config-'))
  if (content !== null) await writeFile(join(home, 'config.yaml'), content, 'utf8')
  process.env.WAYPOINT_CONFIG_HOME = home
  try {
    await body()
  } finally {
    if (saved === undefined) delete process.env.WAYPOINT_CONFIG_HOME
    else process.env.WAYPOINT_CONFIG_HOME = saved
  }
}

/** The test-owned fixture catalog: the bundled catalog ships only the `runner`
 * lifecycle scaffold (no recipe plans), so the Q1 unconfigured-runtime warning
 * — which exists for recipe-BEARING quests — is exercised against the fixture
 * `code-review` quest instead. */
const FIXTURE_CATALOG = fileURLToPath(new URL('../testing/fixtures/catalog', import.meta.url))

async function withFixtureCatalog(body: () => Promise<void>): Promise<void> {
  const saved = process.env.WAYPOINT_CATALOG_ROOT
  process.env.WAYPOINT_CATALOG_ROOT = FIXTURE_CATALOG
  try {
    await body()
  } finally {
    if (saved === undefined) delete process.env.WAYPOINT_CATALOG_ROOT
    else process.env.WAYPOINT_CATALOG_ROOT = saved
  }
}

const pgProjects = new PostgresTestProjects()

// Every test in this file runs against an empty global config home so the
// machine's real ~/.waypoint (worker_command, lanes, providers) can never
// leak into init's fallback reads; withGlobalConfig still layers per-test
// content on top by swapping the same env var.
let suiteConfigHome: string | undefined

beforeAll(async () => {
  pgProjects.setEnv()
  suiteConfigHome = process.env.WAYPOINT_CONFIG_HOME
  process.env.WAYPOINT_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'waypoint-suite-config-'))
})

afterAll(async () => {
  if (suiteConfigHome === undefined) delete process.env.WAYPOINT_CONFIG_HOME
  else process.env.WAYPOINT_CONFIG_HOME = suiteConfigHome
  await pgProjects.cleanup()
})

describe('waypoint init/status commands', () => {
  it('initializes the current working directory with a selected quest on postgres', async () => {
    await withFixtureCatalog(async () => {
      const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
      const { io, stdout, stderr } = makeIo(cwd)

      // Q1 needs a recipe-BEARING quest: the warning exists because a quest with
      // recipe plans and no runtime parks at its first wave. The bundled catalog
      // ships only the `runner` lifecycle scaffold (no recipe plans), so this
      // uses the fixture catalog's `code-review` quest, which dispatches.
      const exitCode = await runWaypointCli(['init', '--quest', 'code-review'], io)

      expect(exitCode).toBe(0)
      expect(stderr.join('\n')).toContain("'waypoint start' will refuse")
      const output = stdout.join('\n')
      expect(output).toContain('Initialized project')
      expect(output).toContain('run backend: postgres')
      expect(output).toContain('postgres url: postgresql://waypoint@localhost:5433/postgres (managed default)')
      expect(output).toMatch(/postgres schema: waypoint_[a-z0-9_]+_[0-9a-f]{8}/)
      expect(output).toContain('durable engine: true')
      expect(output).toContain('recipe runtime: not configured')

      const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as {
        quest: string
        enabled: boolean
        backend: { route: string; postgres?: { schema?: string; durable?: boolean } }
      }
      expect(config.quest).toBe('code-review')
      expect(config.enabled).toBe(true)
      expect(config.backend.route).toBe('postgres')
      expect(config.backend.postgres?.schema).toMatch(/^waypoint_[a-z0-9_]+_[0-9a-f]{8}$/)
      expect(config.backend.postgres?.durable).toBe(true)
    })
  })

  it('accepts --backend postgres and opts out of durable with --postgres-no-durable', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const { io, stdout, stderr } = makeIo(cwd)

    const exitCode = await runWaypointCli(
      ['init', '--quest', 'runner', '--backend', 'postgres', '--postgres-no-durable', '--simulated'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('run backend: postgres')
    expect(output).toContain('durable engine: false')
    expect(output).toContain('recipe runtime: simulated (explicit opt-in')

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as {
      backend: { route: string; postgres?: { durable?: boolean } }
    }
    expect(config.backend.route).toBe('postgres')
    expect(config.backend.postgres?.durable).toBe(false)
  })

  it('rejects the retired folder and beads route backends', async () => {
    for (const retired of ['folder', 'beads']) {
      const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
      const { io, stderr } = makeIo(cwd)

      const exitCode = await runWaypointCli(['init', '--quest', 'runner', '--backend', retired], io)

      expect(exitCode).toBe(1)
      expect(stderr.join('\n')).toContain('retired')
      expect(stderr.join('\n')).toContain('waypoint migrate')
    }
  })

  it('rejects an unknown route backend', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const { io, stderr } = makeIo(cwd)

    const exitCode = await runWaypointCli(['init', '--quest', 'runner', '--backend', 'bogus'], io)

    expect(exitCode).toBe(1)
    expect(stderr.join('\n')).toContain('Invalid --backend value. Expected postgres.')
  })

  it('prints uninitialized and initialized status for the current working directory', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const before = makeIo(cwd)

    expect(await runWaypointCli(['status'], before.io)).toBe(0)
    expect(before.stdout.join('\n')).toContain('initialized: false')

    await runWaypointCli(['init', '--quest', 'runner'], silentIo(cwd))

    const after = makeIo(cwd)
    expect(await runWaypointCli(['status'], after.io)).toBe(0)

    const statusText = after.stdout.join('\n')
    expect(statusText).toContain('initialized: true')
    expect(statusText).toContain('enabled: true')
    expect(statusText).toContain('quest: runner')
    expect(statusText).toContain('run backend: postgres')
  })

  it('summarizes routes after a Quest starts', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
    await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))

    const { io, stdout } = makeIo(cwd)
    expect(await runWaypointCli(['status'], io)).toBe(0)

    const statusText = stdout.join('\n')
    expect(statusText).toContain('runs: 1')
    expect(statusText).toContain('active runs: 1')
    expect(statusText).toContain('blocked gates: 0')
  })

  it("Q1: --worker-command scaffolds the worker runtime (whitespace-split, first token the binary)", async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const { io, stdout, stderr } = makeIo(cwd)

    const exitCode = await runWaypointCli(
      ['init', '--quest', 'runner', '--worker-command', 'claude -p --dangerously-skip-permissions'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout.join('\n')).toContain('recipe runtime: worker (claude)')

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as {
      runtime: { recipe: string; worker?: { command: string; args?: string[]; model_args?: unknown } }
    }
    expect(config.runtime.recipe).toBe('worker')
    // Init scaffolds the model-class map too, so a class-tagged recipe resolves
    // on a fresh project instead of silently ignoring its class.
    expect(config.runtime.worker).toEqual({
      command: 'claude',
      args: ['-p', '--dangerously-skip-permissions'],
      model_args: DEFAULT_WORKER_MODEL_ARGS,
    })
  })

  it('falls back to the global config runner.worker_command when no runtime flag is passed', async () => {
    await withGlobalConfig('runner:\n  worker_command: claude -p --dangerously-skip-permissions\n', async () => {
      const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
      const { io, stdout, stderr } = makeIo(cwd)

      const exitCode = await runWaypointCli(['init', '--quest', 'runner'], io)

      expect(exitCode).toBe(0)
      expect(stderr).toEqual([])
      expect(stdout.join('\n')).toContain('recipe runtime: worker (claude) — from global config runner.worker_command')

      const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as {
        runtime: { recipe: string; worker?: { command: string; args?: string[]; model_args?: unknown } }
      }
      expect(config.runtime.recipe).toBe('worker')
      expect(config.runtime.worker).toEqual({
        command: 'claude',
        args: ['-p', '--dangerously-skip-permissions'],
        model_args: DEFAULT_WORKER_MODEL_ARGS,
      })
    })
  })

  it('explicit --worker-command and --simulated both beat the global default', async () => {
    await withGlobalConfig('runner:\n  worker_command: global-agent --go\n', async () => {
      const flagCwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
      const flag = makeIo(flagCwd)
      expect(await runWaypointCli(['init', '--quest', 'runner', '--worker-command', 'local-agent'], flag.io)).toBe(0)
      expect(flag.stdout.join('\n')).toContain('recipe runtime: worker (local-agent)')
      expect(flag.stdout.join('\n')).not.toContain('from global config')

      const simCwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
      const sim = makeIo(simCwd)
      expect(await runWaypointCli(['init', '--quest', 'runner', '--simulated'], sim.io)).toBe(0)
      expect(sim.stdout.join('\n')).toContain('recipe runtime: simulated (explicit opt-in')
    })
  })

  it('an absent or malformed global config leaves the Q1 unconfigured-runtime warning intact', async () => {
    await withGlobalConfig('runner: [this is not, a mapping\n', async () => {
      await withFixtureCatalog(async () => {
        const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
        const { io, stderr } = makeIo(cwd)

        expect(await runWaypointCli(['init', '--quest', 'code-review'], io)).toBe(0)
        expect(stderr.join('\n')).toContain("'waypoint start' will refuse")
        expect(stderr.join('\n')).toContain('runner.worker_command')
      })
    })
  })

  it('Q1: --worker-command and --simulated are mutually exclusive', async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const { io, stderr } = makeIo(cwd)

    const exitCode = await runWaypointCli(['init', '--quest', 'runner', '--worker-command', 'claude', '--simulated'], io)

    expect(exitCode).toBe(1)
    expect(stderr.join('\n')).toContain('mutually exclusive')
  })

  it("Q1: --simulated writes the explicit 'null' opt-in and silences the warning", async () => {
    const cwd = await pgProjects.mkProjectRoot('waypoint-cli-init-')
    const { io, stderr } = makeIo(cwd)

    const exitCode = await runWaypointCli(['init', '--quest', 'runner', '--simulated'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])

    const config = yamlParse(await readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')) as {
      runtime: { recipe: string }
    }
    expect(config.runtime.recipe).toBe('null')
  })
})
