import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  loadQuestsFromDirectory,
  loadRecipesFromDirectory,
  resolveQuestRecipes,
  type QuestManifest,
} from '../index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')
const commandMapPath = resolve(repoRoot, 'docs', 'quests', 'runner-command-map.yaml')

type CommandMap = {
  readonly schema_version: number
  readonly mappings?: readonly {
    readonly source_command?: string
    readonly category?: string
    readonly target?: string
    readonly status?: string
  }[]
}

type ScaffoldPhase = {
  readonly phase_slug?: string
  readonly plans?: readonly {
    readonly plan_ref?: string
    readonly title?: string
    readonly wave?: number
    readonly metadata?: {
      readonly runner?: {
        readonly discussion?: {
          readonly enabled?: boolean
          readonly agent?: string
        }
        readonly gate?: {
          readonly required?: boolean
          readonly kind?: string
        }
      }
    }
  }[]
}

function flattenPhases(quest: QuestManifest): readonly ScaffoldPhase[] {
  const workstreams = quest.scaffolds?.workstreams ?? []
  return workstreams.flatMap((workstream) =>
    (workstream.milestones ?? []).flatMap((milestone) => milestone.phases ?? []),
  ) as readonly ScaffoldPhase[]
}

describe('Waypoint Quest/Recipe port structural smoke coverage', () => {
  it('loads the full Waypoint source port corpus with unique slugs and resolved recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const questSlugs = quests.registry.list().map((quest) => quest.slug)
    const recipeSlugs = recipes.registry.list().map((recipe) => recipe.slug)
    expect(new Set(questSlugs).size).toBe(questSlugs.length)
    expect(new Set(recipeSlugs).size).toBe(recipeSlugs.length)

    // D6 (2026-08-24): the coding suite is gone. `recipes/runner/` held 33
    // get-shit-done-cc agent ports — planner, executor, debugger, code-reviewer,
    // security-auditor and the rest — retired when Waypoint became a generic
    // workflow runtime. No recipe carries the prefix any more, and the assertion that used
    // to enumerate all 33 is now the assertion that none survive.
    expect(recipeSlugs.filter((slug) => slug.startsWith('runner-'))).toEqual([])

    for (const quest of quests.registry.list()) {
      const resolved = resolveQuestRecipes(quest, recipes.registry)
      expect(resolved.ok, `${quest.slug} has unresolved recipe references`).toBe(true)
    }
  })

  it('keeps the main Waypoint Quest scaffold explicit about discussion and human gates', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const runner = quests.registry.get('runner')
    expect(runner).toBeDefined()
    if (!runner) throw new Error('missing runner Quest')

    const phases = flattenPhases(runner)
    const phasesBySlug = new Map(phases.map((phase) => [phase.phase_slug, phase]))
    expect([...phasesBySlug.keys()]).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])

    for (const phase of phases) {
      expect(phase.plans?.length, `${phase.phase_slug} should expose structural plan checkpoints`).toBeGreaterThan(0)
    }

    // The discussion step survived the coding suite (D6) on a neutral agent —
    // and it is the only discussion plan in the whole catalog, so this is the
    // one place that machinery is exercised.
    expect(phasesBySlug.get('discuss')?.plans?.some((plan) => plan.metadata?.runner?.discussion?.enabled)).toBe(true)
    expect(phasesBySlug.get('discuss')?.plans?.some((plan) => plan.metadata?.runner?.discussion?.agent === 'scaffold-discussion')).toBe(true)

    for (const gatedPhase of ['plan', 'verify', 'ship']) {
      expect(
        phasesBySlug
          .get(gatedPhase)
          ?.plans?.some((plan) => plan.metadata?.runner?.gate?.required === true),
        `${gatedPhase} should preserve human/operator gate intent`,
      ).toBe(true)
    }
  })

  it('keeps the 65-command source map unique and fully categorized', async () => {
    const commandMap = parseYaml(await readFile(commandMapPath, 'utf8')) as CommandMap
    expect(commandMap.schema_version).toBe(1)
    const mappings = commandMap.mappings ?? []
    expect(mappings).toHaveLength(65)

    const sourceCommands = mappings.map((entry) => entry.source_command)
    expect(sourceCommands.every((sourceCommand) => typeof sourceCommand === 'string')).toBe(true)
    expect(new Set(sourceCommands).size).toBe(sourceCommands.length)
    expect(mappings.every((entry) => entry.category && entry.target && entry.status)).toBe(true)
  })
})
