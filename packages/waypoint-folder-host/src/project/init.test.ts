import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { deriveProjectSchemaName } from './backend'
import { extractQuestRoots } from './config'
import { initWaypointProject } from './init'
import { assembleSeatbeltJailRoots } from '../seatbelt/jail'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'runner-init-'))
}

describe('initWaypointProject', () => {
  it('creates .waypoint config and the authored-content directories (run state lives in postgres, P5)', async () => {
    const projectRoot = await tempProject()

    const result = await initWaypointProject(projectRoot, { quest: 'runner' })

    expect(result.projectRoot).toBe(projectRoot)
    expect(result.runnerDir).toBe(join(projectRoot, '.waypoint'))
    expect(result.config.quest).toBe('runner')
    expect(result.config.enabled).toBe(true)

    const configText = await readFile(join(projectRoot, '.waypoint/config.yaml'), 'utf8')
    const config = yamlParse(configText) as Record<string, unknown>

    expect(config).toMatchObject({
      schema_version: 1,
      enabled: true,
      quest: 'runner',
      backend: {
        route: 'postgres',
        // Schema-per-project (endstate Q1) + durable-by-default (endstate Q3).
        postgres: { schema: deriveProjectSchemaName(projectRoot), durable: true },
      },
      runtime: { recipe: null },
    })
    expect(typeof config.created_at).toBe('string')
    expect(typeof config.updated_at).toBe('string')

    for (const relativePath of ['.waypoint/quests', '.waypoint/recipes', '.waypoint/lifecycle', '.waypoint/tasks']) {
      const entry = await stat(join(projectRoot, relativePath))
      expect(entry.isDirectory()).toBe(true)
    }

    // Route/event run state moved to postgres — the folder scaffold is gone.
    for (const retiredPath of ['.waypoint/routes', '.waypoint/events']) {
      await expect(stat(join(projectRoot, retiredPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('records an explicit durable opt-out (postgres: { durable: false })', async () => {
    const projectRoot = await tempProject()

    const result = await initWaypointProject(projectRoot, { quest: 'runner', postgres: { durable: false } })

    expect(result.config.backend.route).toBe('postgres')
    expect(result.config.backend.postgres).toEqual({
      schema: deriveProjectSchemaName(projectRoot),
      durable: false,
    })
  })

  // rsc-w0z: the safety-floor keystone — a fresh init of a root-binding quest
  // must record its seatbelt roots and create the rw write targets, so a jailed
  // dispatch resolves every plan `Access:` binding instead of failing closed.
  it('materializes quest-declared seatbelt roots into config and creates the rw dirs', async () => {
    const projectRoot = await tempProject()
    const roots = {
      case_source: { path: '.', access: 'ro' as const },
      build: { path: 'release-bundle-build', access: 'rw' as const },
      rollup_out: { path: 'reports/rollup-output', access: 'rw' as const },
    }

    const result = await initWaypointProject(projectRoot, { quest: 'release-bundle', roots })

    expect(result.config.roots).toEqual(roots)
    const config = yamlParse(await readFile(join(projectRoot, '.waypoint/config.yaml'), 'utf8')) as Record<string, unknown>
    expect(config.roots).toEqual(roots)

    // rw roots get their directories created; the ro source root is not created.
    for (const rel of ['release-bundle-build', 'reports/rollup-output']) {
      expect((await stat(join(projectRoot, rel))).isDirectory()).toBe(true)
    }

    // The recorded roots feed the jail without failing closed — the exact plan
    // access map the referral quest binds now resolves against config.roots.
    expect(() =>
      assembleSeatbeltJailRoots({
        projectRoot,
        roots: result.config.roots,
        access: { case_source: 'ro', build: 'rw' },
        scratchDir: join(projectRoot, '.scratch'),
        tmpDir: join(projectRoot, '.tmp'),
      }),
    ).not.toThrow()
  })

  it('drops a quest root whose path escapes the project (defense in depth)', async () => {
    const projectRoot = await tempProject()

    const result = await initWaypointProject(projectRoot, {
      quest: 'x',
      roots: {
        build: { path: 'release-bundle-build', access: 'rw' as const },
        escape: { path: '../../etc', access: 'rw' as const },
      },
    })

    expect(result.config.roots).toEqual({ build: { path: 'release-bundle-build', access: 'rw' } })
  })

  it('extractQuestRoots reads metadata.runner.roots and ignores quests without it', () => {
    expect(
      extractQuestRoots({ runner: { roots: { layer: { path: 'knowledge-layer', access: 'rw' } } } }),
    ).toEqual({ layer: { path: 'knowledge-layer', access: 'rw' } })
    expect(extractQuestRoots({ runner: { quest_set: 'legal' } })).toEqual({})
    expect(extractQuestRoots(undefined)).toEqual({})
  })
})

/**
 * Re-init preserves what the operator did not ask to change (rsc-g1al).
 *
 * init built its config from the passed options alone and overwrote
 * config.yaml unconditionally, so `waypoint init --quest <slug>` on a configured
 * case swapped its worker command for the global default and reset the quest
 * to the starter. A live case began dispatching against the wrong agent
 * binary, with no warning and no diff — while the catalog install path beside
 * it was already careful to preserve operator-edited recipe files.
 */
describe('initWaypointProject on an already-initialized project (rsc-g1al)', () => {
  // Item 53: the historical fixture command was `/opt/homebrew/bin/pi` — now a
  // retired harness (cordis-only), so a benign binary carries the rsc-g1al
  // preservation semantics instead.
  const WORKER = { recipe: 'worker' as const, worker: { command: '/opt/homebrew/bin/fake-agent', args: ['--no-tools'] } }

  async function initialized(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'reinit-'))
    await initWaypointProject(root, { quest: 'knowledge-layer', runtime: WORKER })
    return root
  }

  it('keeps the configured worker when a re-init names only a quest', async () => {
    const root = await initialized()
    const result = await initWaypointProject(root, { quest: 'acme' })
    expect(result.config.runtime).toEqual(WORKER)
    expect(result.config.quest).toBe('acme')
  })

  it('keeps the quest when a re-init names none', async () => {
    const root = await initialized()
    const result = await initWaypointProject(root, {})
    expect(result.config.quest).toBe('knowledge-layer')
    expect(result.changes).toEqual([])
    expect(result.existed).toBe(true)
  })

  it('reports every change it makes, old -> new', async () => {
    const root = await initialized()
    const result = await initWaypointProject(root, { quest: 'acme' })
    expect(result.changes).toContain('quest: "knowledge-layer" -> "acme"')
  })

  it('never re-derives the postgres schema — that would orphan every existing route', async () => {
    const root = await initialized()
    const before = (await initWaypointProject(root, {})).config.backend.postgres?.schema
    const after = (await initWaypointProject(root, { postgres: { url: 'postgresql://elsewhere/db' } })).config
    expect(after.backend.postgres?.schema).toBe(before)
    expect(after.backend.postgres?.url).toBe('postgresql://elsewhere/db')
  })

  it('an explicit option still wins over the existing value', async () => {
    const root = await initialized()
    const other = { recipe: 'worker' as const, worker: { command: '/usr/bin/fake-agent', args: [] } }
    const result = await initWaypointProject(root, { runtime: other })
    expect(result.config.runtime).toEqual(other)
  })

  it('merges roots rather than revoking one an in-flight route needs', async () => {
    const root = await initialized()
    await initWaypointProject(root, { roots: { layer: { path: 'knowledge-layer', access: 'rw' } } })
    const result = await initWaypointProject(root, { roots: { build: { path: 'build', access: 'rw' } } })
    expect(Object.keys(result.config.roots ?? {}).sort()).toEqual(['build', 'layer'])
  })

  it('--force rebuilds from the given options alone', async () => {
    const root = await initialized()
    const result = await initWaypointProject(root, { quest: 'acme', force: true })
    expect(result.config.runtime).not.toEqual(WORKER)
    expect(result.existed).toBe(false)
    expect(result.changes).toEqual([])
  })

  it('a fresh project is unaffected — no existing config, no preservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reinit-fresh-'))
    const result = await initWaypointProject(root, { quest: 'acme' })
    expect(result.existed).toBe(false)
    expect(result.config.quest).toBe('acme')
  })

  it('a corrupt config does not block init — it is replaced, not obeyed', async () => {
    const root = await initialized()
    await writeFile(join(root, '.waypoint', 'config.yaml'), 'this: is: not: valid: yaml:\n', 'utf8')
    const result = await initWaypointProject(root, { quest: 'acme' })
    expect(result.config.quest).toBe('acme')
  })
})
