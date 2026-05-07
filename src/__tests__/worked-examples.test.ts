import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  loadQuestsFromDirectory,
  loadRecipesFromDirectory,
  resolveQuestRecipes,
} from '../index.js'

// This test loads the real `quests/` and `recipes/` directories at the repo
// root and verifies the worked examples round-trip through the loaders and
// cross-resolve cleanly. It's intentionally end-to-end.

const here = dirname(fileURLToPath(import.meta.url))
// here = /.../waypoint/src/__tests__ → go up 2 levels to repo root
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

describe('worked examples at repo root', () => {
  it('loads quests/example.yaml and resolves its recipe references', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error('quest load failed')
    expect(quests.registry.has('example')).toBe(true)
    expect(quests.registry.has('gsd')).toBe(true)

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))
    expect(recipes.registry.has('doc-writer')).toBe(true)
    expect(recipes.registry.has('reviewer')).toBe(true)
    // Recursive loader also picks up ported GSD recipes under recipes/gsd/.
    // Full GSD agent library port (33 agents).
    const gsdSlugs = recipes.registry
      .list()
      .map((r) => r.slug)
      .filter((s) => s.startsWith('gsd-'))
    expect(gsdSlugs.length).toBe(33)
    // Spot-check a representative sample across categories.
    expect(recipes.registry.has('gsd-doc-writer')).toBe(true)
    expect(recipes.registry.has('gsd-assumptions-analyzer')).toBe(true)
    expect(recipes.registry.has('gsd-advisor-researcher')).toBe(true)
    expect(recipes.registry.has('gsd-debugger')).toBe(true)
    expect(recipes.registry.has('gsd-executor')).toBe(true)
    expect(recipes.registry.has('gsd-planner')).toBe(true)
    expect(recipes.registry.has('gsd-verifier')).toBe(true)
    expect(recipes.registry.has('gsd-security-auditor')).toBe(true)

    const example = quests.registry.get('example')
    expect(example).toBeDefined()
    if (!example) return

    const resolved = resolveQuestRecipes(example, recipes.registry)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error))
    expect(resolved.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'reviewer'])

    const gsd = quests.registry.get('gsd')
    expect(gsd).toBeDefined()
    if (!gsd) return
    expect(gsd.workflow).toBe('workflows/gsd.yaml')
    expect(gsd.recipes).toEqual([
      'gsd-doc-writer',
      'gsd-project-researcher',
      'gsd-roadmapper',
      'gsd-assumptions-analyzer',
      'gsd-codebase-mapper',
      'gsd-phase-researcher',
      'gsd-planner',
      'gsd-plan-checker',
      'gsd-executor',
      'gsd-verifier',
      'gsd-doc-synthesizer',
      'gsd-code-reviewer',
    ])
    expect(
      gsd.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases?.map((phase) => phase.phase_slug),
    ).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])
    expect(
      (gsd.metadata?.gsd_port as { phase_entrypoints?: unknown[] } | undefined)?.phase_entrypoints,
    ).toHaveLength(6)
    const gsdResolved = resolveQuestRecipes(gsd, recipes.registry)
    expect(gsdResolved.ok).toBe(true)
    if (!gsdResolved.ok) throw new Error(JSON.stringify(gsdResolved.error))
    expect(gsdResolved.resolved.map((r) => r.slug)).toEqual(gsd.recipes)
  })
})
