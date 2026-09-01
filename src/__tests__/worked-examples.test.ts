import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  loadQuestsFromDirectory,
  loadRecipesFromDirectory,
  resolveQuestRecipes,
} from '../index.ts'

// This test loads the real `quests/` and `recipes/` directories at the repo
// root and verifies the worked examples round-trip through the loaders and
// cross-resolve cleanly. It's intentionally end-to-end.

const here = dirname(fileURLToPath(import.meta.url))
// here = /.../runner/src/__tests__ → go up 2 levels to repo root
const repoRoot = resolve(here, '..', '..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')
const commandMapPath = resolve(repoRoot, 'docs', 'quests', 'runner-command-map.yaml')

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
  it('loads the repo-root catalog and resolves every quest\'s recipe references', async () => {
    // Was: the worked example (quests/example.yaml + the two flat recipes) and
    // the get-shit-done-cc port. All of it is gone — the example on 2026-08-24
    // (D10, a quest with zero plans that compiled to nothing), the coding suite
    // the same day (D6). What this test still earns its keep for is the thing it
    // always actually checked: every manifest on disk loads, slugs are unique,
    // and no quest names a recipe that is not there.
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error('quest load failed')
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    expect(quests.registry.has('example')).toBe(false)
    expect(quests.registry.has('code-review')).toBe(false)
    expect(recipes.registry.list().filter((r) => r.slug.startsWith('runner-'))).toEqual([])

    for (const quest of quests.registry.list()) {
      const resolved = resolveQuestRecipes(quest, recipes.registry)
      expect(resolved.ok, `${quest.slug} has unresolved recipe references`).toBe(true)
    }

    // The lifecycle scaffold survives the coding suite that used to fill it.
    const scaffold = quests.registry.get('runner')
    expect(scaffold).toBeDefined()
    if (!scaffold) throw new Error('missing runner scaffold')
    expect(scaffold.workflow).toBe('workflows/runner.yaml')
    // One dispatch left: the discuss step's conversation agent.
    expect(scaffold.recipes ?? []).toEqual(['scaffold-discussion'])
    expect(
      scaffold.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases?.map((phase) => phase.phase_slug),
    ).toEqual(['initialize', 'discuss', 'plan', 'execute', 'verify', 'ship'])

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
    // The command map is the record of the get-shit-done-cc port and stays as
    // history. Its one still-ported target, commands/gsd/code-review.md, points
    // at a quest deleted on 2026-08-24 (D6); the mapping now reads as what it
    // is — a port that happened and was later withdrawn.
    expect(mappingTargetsByCommand.get('commands/gsd/code-review.md')).toMatchObject({
      target: 'quests/code-review.yaml',
      status: 'ported',
    })
  })
})
