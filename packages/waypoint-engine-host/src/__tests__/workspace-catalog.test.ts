import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

const RECIPE_YAML = `schema_version: 1
slug: authored-recipe
name: Authored Recipe
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
})
