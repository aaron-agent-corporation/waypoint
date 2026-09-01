import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Control the project-root discovery and make BOTH catalog loaders throw a
// controllable error, so we can exercise the bundled path (no project) and the
// workspace path (project found), plus expected vs unexpected error classification.
const state = vi.hoisted(() => ({ projectRoot: null as string | null, thrown: null as Error | null }))

vi.mock('@waypoint-engine/folder-host', async (orig) => {
  const actual = await orig<typeof import('@waypoint-engine/folder-host')>()
  const fail = async () => {
    throw state.thrown ?? new Error('unexpected')
  }
  return {
    ...actual,
    findWaypointProjectRoot: async () => state.projectRoot,
    loadBundledWaypointCatalog: fail,
    loadWorkspaceWaypointCatalog: fail,
  }
})

import { CatalogLoadError } from '@waypoint-engine/folder-host'

import { runWaypointCli } from '../bin.ts'
import { runQuestsCommand } from './quests.ts'
import { runRecipesCommand } from './recipes.ts'

const STACK_FRAME = /\n\s+at / // an actual stack-trace frame line, not the word "at"

describe('CLI surfaces a clean error when the catalog fails to load', () => {
  const createdDirs: string[] = []

  beforeEach(() => {
    // Default: no project root (bundled path) + an EXPECTED corrupt-catalog failure.
    state.projectRoot = null
    state.thrown = new CatalogLoadError('Recipe', 'recipes/broken.yaml', 'invalid Recipe manifest')
  })

  afterEach(async () => {
    state.projectRoot = null
    state.thrown = null
    while (createdDirs.length > 0) {
      await rm(createdDirs.pop()!, { recursive: true, force: true })
    }
  })

  async function noProjectCwd(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'wp-noproj-'))
    createdDirs.push(dir)
    return dir
  }

  it('quests: clean message, no stack, exit 1 for an expected catalog failure (bundled path)', async () => {
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the quest catalog: invalid Recipe manifest/)
    expect(err.join('\n')).not.toMatch(STACK_FRAME)
  })

  it('recipes: clean message, no stack, exit 1 for an expected catalog failure (bundled path)', async () => {
    const err: string[] = []
    const code = await runRecipesCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the quest catalog/)
    expect(err.join('\n')).not.toMatch(STACK_FRAME) // NB-7: mirror the quests no-stack assertion
  })

  it('classifies an expected failure on the WORKSPACE path as clean too (NB-3)', async () => {
    state.projectRoot = await noProjectCwd() // a project root is found → workspace loader path
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: state.projectRoot })

    expect(code).toBe(1)
    expect(err.join('\n')).toMatch(/Failed to load the quest catalog: invalid Recipe manifest/)
    expect(err.join('\n')).not.toMatch(STACK_FRAME)
  })

  it('preserves the stack for an UNEXPECTED internal error so a real bug is not masked', async () => {
    state.thrown = new Error('overlay merge blew up')
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: () => {}, stderr: (l) => err.push(l), cwd: await noProjectCwd() })

    expect(code).toBe(1)
    const out = err.join('\n')
    expect(out).toMatch(/Failed to load the quest catalog: overlay merge blew up/)
    expect(out).toMatch(STACK_FRAME)
  })

  it('handoffs list --quest exits 1 with a clean error when the catalog fails to load (NB-1)', async () => {
    const stderr: string[] = []
    const code = await runWaypointCli(['handoffs', 'list', '--quest', 'runner'], {
      stdout: () => {},
      stderr: (l) => stderr.push(l),
      cwd: await noProjectCwd(),
    })

    expect(code).toBe(1)
    expect(stderr.join('\n')).toMatch(/Failed to load the quest catalog/)
  })
})
