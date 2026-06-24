import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { startQuestRoute } from './start.ts'

async function initFolderProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-start-ws-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  await writeFile(join(root, '.waypoint', 'config.yaml'), 'schema_version: 1\nquest: authored-quest\nbackend:\n  route: folder\n', 'utf8')
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
  it('starts a folder route for a workspace-authored quest not in the bundle', async () => {
    const root = await initFolderProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')

    const route = await startQuestRoute(root, { quest: 'authored-quest' })

    expect(route.backend).toBe('folder')
    expect(route.quest).toBe('authored-quest')
  })

  // N1: a single malformed, unrelated authored manifest must not abort the start
  // of a valid quest that never references it.
  it('starts a valid quest even when an unrelated authored recipe is malformed', async () => {
    const root = await initFolderProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')
    // A half-written recipe the quest does not reference.
    await writeFile(join(root, '.waypoint', 'recipes', 'half-written.yaml'), 'schema_version: 1\nslug:', 'utf8')

    const route = await startQuestRoute(root, { quest: 'authored-quest' })

    expect(route.backend).toBe('folder')
    expect(route.quest).toBe('authored-quest')
  })

  it('throws when a quest references a prompt-less recipe (start-time validation)', async () => {
    const root = await initFolderProject()
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
