import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PostgresTestProjects } from '../testing/postgres.ts'
import { startQuestRoute } from './start.ts'

// Single tracked tmpdir factory: every root this file creates MUST be obtained via
// initWorkspaceProject so afterEach can reclaim it. Do not call mkdtemp directly in a
// test — route it through here to keep cleanup correct by construction (runner-7ok N2).
const pgProjects = new PostgresTestProjects()
const createdRoots: string[] = []

async function initWorkspaceProject(): Promise<string> {
  const root = await pgProjects.mkProjectRoot('wp-start-ws-')
  createdRoots.push(root)
  await mkdir(join(root, '.waypoint'), { recursive: true })
  // Plain postgres (durable off): startQuestRoute must run the non-durable path.
  await writeFile(join(root, '.waypoint', 'config.yaml'), 'schema_version: 1\nquest: authored-quest\nbackend:\n  route: postgres\n', 'utf8')
  return root
}

async function writeAuthored(root: string, questSlug: string, recipeSlug: string): Promise<void> {
  const qDir = join(root, '.waypoint', 'quests')
  const rDir = join(root, '.waypoint', 'recipes')
  await mkdir(qDir, { recursive: true })
  await mkdir(rDir, { recursive: true })
  await writeFile(
    join(qDir, `${questSlug}.yaml`),
    `schema_version: 1\nslug: ${questSlug}\nname: ${questSlug}\nworkflow: workflows/${questSlug}.md\nrecipes:\n  - ${recipeSlug}\n`,
    'utf8',
  )
  await writeFile(join(rDir, `${recipeSlug}.yaml`), `schema_version: 1\nslug: ${recipeSlug}\nname: ${recipeSlug}\nprompt: Do the work.\n`, 'utf8')
}

describe('startQuestRoute with an authored quest', () => {
  beforeAll(() => pgProjects.setEnv())
  afterAll(async () => {
    await pgProjects.cleanup()
  })
  afterEach(async () => {
    while (createdRoots.length > 0) {
      await rm(createdRoots.pop()!, { recursive: true, force: true })
    }
  })

  it('starts a route for a workspace-authored quest not in the bundle', async () => {
    const root = await initWorkspaceProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')

    const route = await startQuestRoute(root, { quest: 'authored-quest' })

    expect(route.backend).toBe('postgres')
    expect(route.quest).toBe('authored-quest')
    // A real route was materialized (id assigned) with its scaffold summary.
    expect(route.id).toBeTruthy()
    expect(route.scaffold).toBeDefined()
  })

  // N1: a single malformed, unrelated authored manifest must not abort the start
  // of a valid quest that never references it.
  it('starts a valid quest even when an unrelated authored recipe is malformed', async () => {
    const root = await initWorkspaceProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')
    // A half-written recipe the quest does not reference.
    await writeFile(join(root, '.waypoint', 'recipes', 'half-written.yaml'), 'schema_version: 1\nslug:', 'utf8')

    const route = await startQuestRoute(root, { quest: 'authored-quest' })

    expect(route.backend).toBe('postgres')
    expect(route.quest).toBe('authored-quest')
  })

  // X4: only the durable engine has a loop primitive — a plain-postgres start
  // would silently drop the repeat, the exact semantic loss the df-operator
  // track closes. Fail closed.
  it('refuses to start a repeating quest without the durable engine', async () => {
    const root = await initWorkspaceProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')
    const questPath = join(root, '.waypoint', 'quests', 'authored-quest.yaml')
    const manifest = await readFile(questPath, 'utf8')
    await writeFile(questPath, `${manifest}repeat:\n  every_days: 3\n`, 'utf8')

    await expect(startQuestRoute(root, { quest: 'authored-quest' })).rejects.toThrow(
      /repeating quests require the durable postgres backend/,
    )
  })

  it('throws when a quest references a prompt-less recipe (start-time validation)', async () => {
    const root = await initWorkspaceProject()
    const qDir = join(root, '.waypoint', 'quests')
    const rDir = join(root, '.waypoint', 'recipes')
    await mkdir(qDir, { recursive: true })
    await mkdir(rDir, { recursive: true })
    // Quest with a prompt-less recipe reference
    const questSlug = 'promptless-quest'
    const recipeSlug = 'promptless-recipe'
    await writeFile(
      join(qDir, `${questSlug}.yaml`),
      `schema_version: 1\nslug: ${questSlug}\nname: ${questSlug}\nworkflow: workflows/${questSlug}.md\nrecipes:\n  - ${recipeSlug}\n`,
      'utf8',
    )
    await writeFile(
      join(rDir, `${recipeSlug}.yaml`),
      `schema_version: 1\nslug: ${recipeSlug}\nname: ${recipeSlug}\n`,
      'utf8',
    )

    await expect(startQuestRoute(root, { quest: questSlug })).rejects.toThrow(
      /references a recipe that is not runtime-valid/,
    )
  })
})
