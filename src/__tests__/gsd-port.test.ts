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
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')
const commandMapPath = resolve(repoRoot, 'docs', 'quests', 'gsd-command-map.yaml')

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
      readonly waypoint?: {
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

describe('GSD Quest/Recipe port structural smoke coverage', () => {
  it('loads the full GSD port corpus with unique slugs and resolved recipes', async () => {
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

    const gsdRecipeSlugs = recipeSlugs.filter((slug) => slug.startsWith('gsd-')).sort()
    expect(gsdRecipeSlugs).toHaveLength(33)
    expect(gsdRecipeSlugs).toEqual([
      'gsd-advisor-researcher',
      'gsd-ai-researcher',
      'gsd-assumptions-analyzer',
      'gsd-code-fixer',
      'gsd-code-reviewer',
      'gsd-codebase-mapper',
      'gsd-debug-session-manager',
      'gsd-debugger',
      'gsd-doc-classifier',
      'gsd-doc-synthesizer',
      'gsd-doc-verifier',
      'gsd-doc-writer',
      'gsd-domain-researcher',
      'gsd-eval-auditor',
      'gsd-eval-planner',
      'gsd-executor',
      'gsd-framework-selector',
      'gsd-integration-checker',
      'gsd-intel-updater',
      'gsd-nyquist-auditor',
      'gsd-pattern-mapper',
      'gsd-phase-researcher',
      'gsd-plan-checker',
      'gsd-planner',
      'gsd-project-researcher',
      'gsd-research-synthesizer',
      'gsd-roadmapper',
      'gsd-security-auditor',
      'gsd-ui-auditor',
      'gsd-ui-checker',
      'gsd-ui-researcher',
      'gsd-user-profiler',
      'gsd-verifier',
    ])

    for (const quest of quests.registry.list()) {
      const resolved = resolveQuestRecipes(quest, recipes.registry)
      expect(resolved.ok, `${quest.slug} has unresolved recipe references`).toBe(true)
    }
  })

  it('keeps the main GSD Quest scaffold explicit about discussion and human gates', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const gsd = quests.registry.get('gsd')
    expect(gsd).toBeDefined()
    if (!gsd) throw new Error('missing gsd Quest')

    const phases = flattenPhases(gsd)
    const phasesBySlug = new Map(phases.map((phase) => [phase.phase_slug, phase]))
    expect([...phasesBySlug.keys()]).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])

    for (const phase of phases) {
      expect(phase.plans?.length, `${phase.phase_slug} should expose structural plan checkpoints`).toBeGreaterThan(0)
    }

    expect(phasesBySlug.get('discuss')?.plans?.some((plan) => plan.metadata?.waypoint?.discussion?.enabled)).toBe(true)
    expect(phasesBySlug.get('discuss')?.plans?.some((plan) => plan.metadata?.waypoint?.discussion?.agent === 'gsd-doc-writer')).toBe(true)

    for (const gatedPhase of ['plan', 'verify', 'ship']) {
      expect(
        phasesBySlug
          .get(gatedPhase)
          ?.plans?.some((plan) => plan.metadata?.waypoint?.gate?.required === true),
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
