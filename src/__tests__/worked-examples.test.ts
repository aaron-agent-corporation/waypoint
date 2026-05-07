import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
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
const commandMapPath = resolve(repoRoot, 'docs', 'quests', 'waypoint-command-map.yaml')

type GsdCommandMap = {
  readonly schema_version: number
  readonly mappings?: readonly {
    readonly source_command?: string
    readonly command?: string
    readonly category?: string
    readonly target?: string
    readonly status?: string
  }[]
}

describe('worked examples at repo root', () => {
  it('loads quests/example.yaml and resolves its recipe references', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error('quest load failed')
    expect(quests.registry.has('example')).toBe(true)
    expect(quests.registry.has('waypoint')).toBe(true)
    const p3SubQuestSlugs = [
      'debug',
      'spike',
      'ui-phase',
      'spec-phase',
      'secure-phase',
      'ai-integration-phase',
      'ultraplan-phase',
      'validate-phase',
    ]
    const p4CatalogQuestSlugs = [
      'audit-fix',
      'audit-milestone',
      'audit-uat',
      'code-review',
      'eval-review',
      'ui-review',
      'review',
      'review-backlog',
      'plan-review-convergence',
      'forensics',
      'health',
      'explore',
      'map-codebase',
      'stats',
      'graphify',
      'extract-learnings',
      'profile-user',
      'sketch',
      'fast',
      'quick',
      'cleanup',
      'complete-milestone',
      'milestone-summary',
      'docs-update',
      'ingest-docs',
      'add-tests',
      'pr-branch',
    ]
    const gsdSubQuestSlugs = [...p3SubQuestSlugs, ...p4CatalogQuestSlugs]
    for (const slug of gsdSubQuestSlugs) {
      expect(quests.registry.has(slug)).toBe(true)
    }

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))
    expect(recipes.registry.has('doc-writer')).toBe(true)
    expect(recipes.registry.has('reviewer')).toBe(true)
    // Recursive loader also picks up ported GSD recipes under recipes/waypoint/.
    // Full GSD agent library port (33 agents).
    const gsdSlugs = recipes.registry
      .list()
      .map((r) => r.slug)
      .filter((s) => s.startsWith('waypoint-'))
    expect(gsdSlugs.length).toBe(33)
    // Spot-check a representative sample across categories.
    expect(recipes.registry.has('waypoint-doc-writer')).toBe(true)
    expect(recipes.registry.has('waypoint-assumptions-analyzer')).toBe(true)
    expect(recipes.registry.has('waypoint-advisor-researcher')).toBe(true)
    expect(recipes.registry.has('waypoint-debugger')).toBe(true)
    expect(recipes.registry.has('waypoint-executor')).toBe(true)
    expect(recipes.registry.has('waypoint-planner')).toBe(true)
    expect(recipes.registry.has('waypoint-verifier')).toBe(true)
    expect(recipes.registry.has('waypoint-security-auditor')).toBe(true)

    for (const slug of gsdSubQuestSlugs) {
      const subQuest = quests.registry.get(slug)
      expect(subQuest).toBeDefined()
      if (!subQuest) throw new Error(`missing sub-Quest ${slug}`)
      expect((subQuest.metadata?.source_port as { scope?: unknown }).scope).toBe('command_informed_sub_quest')
      expect((subQuest.metadata?.source_port as { source_command?: unknown }).source_command).toBe(
        `commands/gsd/${slug}.md`,
      )
      const resolved = resolveQuestRecipes(subQuest, recipes.registry)
      expect(resolved.ok).toBe(true)
      if (!resolved.ok) throw new Error(JSON.stringify(resolved.error))
      expect(resolved.resolved.length).toBe(subQuest.recipes?.length ?? 0)
      const phases = subQuest.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases
      expect(phases).toHaveLength(1)
      expect(phases?.[0]?.plans?.length).toBeGreaterThan(0)
    }

    const example = quests.registry.get('example')
    expect(example).toBeDefined()
    if (!example) return

    const resolved = resolveQuestRecipes(example, recipes.registry)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.error))
    expect(resolved.resolved.map((r) => r.slug)).toEqual(['doc-writer', 'reviewer'])

    const gsd = quests.registry.get('waypoint')
    expect(gsd).toBeDefined()
    if (!gsd) return
    expect(gsd.workflow).toBe('workflows/waypoint.yaml')
    expect(gsd.recipes).toEqual([
      'waypoint-doc-writer',
      'waypoint-project-researcher',
      'waypoint-roadmapper',
      'waypoint-assumptions-analyzer',
      'waypoint-codebase-mapper',
      'waypoint-phase-researcher',
      'waypoint-planner',
      'waypoint-plan-checker',
      'waypoint-executor',
      'waypoint-verifier',
      'waypoint-doc-synthesizer',
      'waypoint-code-reviewer',
    ])
    expect(
      gsd.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases?.map((phase) => phase.phase_slug),
    ).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])
    expect(
      (gsd.metadata?.source_port as { phase_entrypoints?: unknown[] } | undefined)?.phase_entrypoints,
    ).toHaveLength(6)
    const gsdResolved = resolveQuestRecipes(gsd, recipes.registry)
    expect(gsdResolved.ok).toBe(true)
    if (!gsdResolved.ok) throw new Error(JSON.stringify(gsdResolved.error))
    expect(gsdResolved.resolved.map((r) => r.slug)).toEqual(gsd.recipes)

    const commandMap = parseYaml(await readFile(commandMapPath, 'utf8')) as GsdCommandMap
    expect(commandMap.schema_version).toBe(1)
    expect(commandMap.mappings?.length).toBe(65)
    const mappings = commandMap.mappings ?? []
    const mappingTargetsByCommand = new Map(mappings.map((entry) => [entry.source_command, entry]))
    expect(mappingTargetsByCommand.get('commands/gsd/pause-work.md')).toMatchObject({
      category: 'operator_action',
      target: '/waypoint pause',
      status: 'documented',
    })
    expect(mappingTargetsByCommand.get('commands/gsd/resume-work.md')).toMatchObject({
      category: 'operator_action',
      target: '/waypoint resume',
      status: 'documented',
    })
    expect(mappingTargetsByCommand.get('commands/gsd/autonomous.md')).toMatchObject({
      category: 'operator_action',
      target: '/waypoint auto',
      status: 'documented',
    })
    expect(mappingTargetsByCommand.get('commands/gsd/ns-project.md')).toMatchObject({
      category: 'deferred_optional',
      status: 'deferred',
    })
    for (const slug of p4CatalogQuestSlugs) {
      expect(mappingTargetsByCommand.get(`commands/gsd/${slug}.md`)).toMatchObject({
        target: `quests/${slug}.yaml`,
        status: 'ported',
      })
    }
  })
})
