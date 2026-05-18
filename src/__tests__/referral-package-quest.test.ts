import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { loadQuestsFromDirectory, loadRecipesFromDirectory } from '../index.js'

const repoRoot = resolve(__dirname, '../..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

const referralRecipeSlugs = [
  'referral-package-document-reviewer',
  'referral-package-packet-segmenter',
  'referral-package-filename-placement-reviewer',
  'referral-package-start-here-builder',
  'referral-package-package-qc',
]

describe('Referral Package Quest', () => {
  it('loads the referral-package Quest and resolves its source-attributed Recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const quest = quests.registry.get('referral-package')
    expect(quest).toBeDefined()
    expect(quest?.name).toBe('Referral Package')
    expect(quest?.description).toContain('attorney referral handoff package')
    expect(quest?.recipes).toEqual(referralRecipeSlugs)
    expect(quest?.metadata).toMatchObject({
      waypoint: {
        quest_family: 'primary_starter',
        selection_summary: 'attorney referral handoff package assembly with safe document review and QC',
      },
      source: {
        project: 'llm-lawyer',
        path: 'docs/referrals/referral-package-and-document-naming-sop.md',
      },
    })

    const phases = quest?.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases ?? []
    expect(phases.map((phase) => phase.phase_slug)).toEqual([
      'intake-review',
      'document-organization',
      'package-drafting',
      'quality-control',
      'handoff',
    ])
    expect(phases.flatMap((phase) => phase.plans ?? []).map((plan) => plan.plan_ref)).toContain(
      'attorney-handoff-gate',
    )

    for (const slug of referralRecipeSlugs) {
      const recipe = recipes.registry.get(slug)
      expect(recipe).toBeDefined()
      expect(recipe?.metadata).toMatchObject({
        source: {
          project: 'llm-lawyer',
        },
        safety: {
          external_side_effects: 'forbidden',
        },
      })
      expect(recipe?.prompt).toContain('No external side effects')
    }
  })

  it('templates the attorney-facing START_HERE dashboard structure for agents', async () => {
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const startHereBuilder = recipes.registry.get('referral-package-start-here-builder')
    expect(startHereBuilder).toBeDefined()

    for (const phrase of [
      'real attorney-facing case dashboard',
      'Do not copy nonfunctional UI chrome',
      'fake top bars',
      'Summary of facts',
      'Current status',
      'Summary of medicals',
      'left-side category navigation',
      'Case Summary, Insurance, Medical, Liens, Expenses, Litigation, Timeline, Documents',
      'Activity Log',
      'descriptive attorney-facing names',
      'HTML medical chronology',
      'medical-chronology.html',
      'accordion',
    ]) {
      expect(startHereBuilder?.prompt).toContain(phrase)
    }
  })

  it('documents how to inspect and start the referral-package Quest', () => {
    const guide = readFileSync(resolve(repoRoot, 'docs/quests/referral-package.md'), 'utf8')

    for (const phrase of [
      'Referral Package',
      'waypoint init --quest referral-package',
      'waypoint start --quest referral-package',
      'waypoint recipes --quest referral-package',
      'source folders remain read-only',
      'does not satisfy FirmVault legal facts',
      'No external side effects',
      'attorney-handoff-gate',
    ]) {
      expect(guide).toContain(phrase)
    }
  })
})
