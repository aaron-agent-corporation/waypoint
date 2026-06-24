import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

const RECIPE_YAML = `schema_version: 1
slug: authored-recipe
name: Authored Recipe
prompt: Do the work.
`

const QUEST_YAML = `schema_version: 1
slug: authored-quest
name: Authored Quest
workflow: workflows/authored-quest.md
recipes:
  - authored-recipe
`

describe('workspace catalog resolution (engine-host)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>

  beforeEach(async () => {
    dir = await makeTempDir('wp-eh-wscat-')
    host = createEngineHost()
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  })

  afterEach(async () => {
    await cleanup(dir)
  })

  it('approves authored quest+recipe, then run.start + catalog.* see them', async () => {
    // Promote + approve a recipe first (quest references it)
    const recipeDraft = { kind: 'recipe', path: 'recipes/authored-recipe.yaml', yaml: RECIPE_YAML }
    const promotedRecipe = (await host.dispatch('author.promote', { draft: recipeDraft })) as unknown as {
      ok: boolean
      proposalId: string
    }
    expect(promotedRecipe.ok).toBe(true)
    await host.dispatch('author.approveProposal', { id: promotedRecipe.proposalId })

    // Promote + approve a quest
    const questDraft = { kind: 'quest', path: 'quests/authored-quest.yaml', yaml: QUEST_YAML }
    const promotedQuest = (await host.dispatch('author.promote', { draft: questDraft })) as unknown as {
      ok: boolean
      proposalId: string
    }
    expect(promotedQuest.ok).toBe(true)
    await host.dispatch('author.approveProposal', { id: promotedQuest.proposalId })

    // catalog.quests must include the authored quest
    const quests = (await host.dispatch('catalog.quests', {})) as unknown as {
      ok: boolean
      quests: { slug: string }[]
    }
    expect(quests.quests.map((q) => q.slug)).toContain('authored-quest')

    // catalog.recipes {quest} must resolve the authored recipe
    const recipes = (await host.dispatch('catalog.recipes', { quest: 'authored-quest' })) as unknown as {
      ok: boolean
      recipes: { slug: string }[]
    }
    expect(recipes.recipes.map((r) => r.slug)).toEqual(['authored-recipe'])

    // run.start must succeed for the authored quest
    const started = (await host.dispatch('run.start', { quest: 'authored-quest' })) as unknown as {
      ok: boolean
      route: { quest: string }
    }
    expect(started.ok).toBe(true)
    expect(started.route.quest).toBe('authored-quest')
  })

  // N1: a single malformed authored manifest must not blank the listing nor abort
  // the start of an unrelated valid quest. Discovery surfaces skip-and-warn.
  it('skips and warns on a malformed authored manifest without breaking unrelated work', async () => {
    // Approve a valid recipe + quest.
    const recipeDraft = { kind: 'recipe', path: 'recipes/authored-recipe.yaml', yaml: RECIPE_YAML }
    const promotedRecipe = (await host.dispatch('author.promote', { draft: recipeDraft })) as unknown as { proposalId: string }
    await host.dispatch('author.approveProposal', { id: promotedRecipe.proposalId })
    const questDraft = { kind: 'quest', path: 'quests/authored-quest.yaml', yaml: QUEST_YAML }
    const promotedQuest = (await host.dispatch('author.promote', { draft: questDraft })) as unknown as { proposalId: string }
    await host.dispatch('author.approveProposal', { id: promotedQuest.proposalId })

    // Drop a half-written, unrelated recipe straight into the workspace catalog dir.
    await mkdir(join(dir, '.waypoint', 'recipes'), { recursive: true })
    await writeFile(join(dir, '.waypoint', 'recipes', 'half-written.yaml'), 'schema_version: 1\nslug:', 'utf8')

    // catalog.recipes (listing) renders valid entries and surfaces the bad one as a warning.
    const recipes = (await host.dispatch('catalog.recipes', {})) as unknown as {
      recipes: { slug: string }[]
      warnings: string[]
    }
    expect(recipes.recipes.map((r) => r.slug)).toContain('authored-recipe')
    expect(recipes.warnings.some((w) => w.includes('half-written.yaml'))).toBe(true)

    // catalog.quests still lists the authored quest (one bad recipe file is irrelevant to it).
    const quests = (await host.dispatch('catalog.quests', {})) as unknown as { quests: { slug: string }[] }
    expect(quests.quests.map((q) => q.slug)).toContain('authored-quest')

    // run.start of the unrelated valid quest still succeeds.
    const started = (await host.dispatch('run.start', { quest: 'authored-quest' })) as unknown as {
      ok: boolean
      route: { quest: string }
    }
    expect(started.ok).toBe(true)
    expect(started.route.quest).toBe('authored-quest')
  })
})
