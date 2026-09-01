import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from './bundled.ts'
import { auditCatalogRecipes, findingsOfCode } from './audit.ts'

/**
 * H-7: a recipe naming a skill that does not exist used to fail at compose —
 * correct, but only for a recipe someone actually dispatched, which for the
 * closed-surface quest meant never. H-6: `tools:` restricts nothing outside the
 * kinds that read it, and reads like a sandbox everywhere else.
 */

async function catalogWithRecipe(recipeYaml: string, skills: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'catalog-audit-'))
  await mkdir(join(root, 'quests'), { recursive: true })
  await mkdir(join(root, 'recipes'), { recursive: true })
  await mkdir(join(root, 'skills'), { recursive: true })
  await writeFile(
    join(root, 'quests', 'q.yaml'),
    'schema_version: 1\nslug: q\nname: Q\nworkflow: q\ndescription: d\nrecipes: []\n',
    'utf8',
  )
  await writeFile(join(root, 'recipes', 'r.yaml'), recipeYaml, 'utf8')
  for (const [name, body] of Object.entries(skills)) {
    const path = join(root, 'skills', `${name}.md`)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body, 'utf8')
  }
  return loadBundledWaypointCatalog({ root })
}

const cordisRecipe = (extra: string): string =>
  `schema_version: 1\nslug: r\nname: R\nprompt: do the thing\nruntime:\n  kind: cordis\n  model_class: high\n  max_turns: 4\n${extra}`

describe('the catalog audit catches what parsing cannot', () => {
  it('names a skill that resolves nowhere, and the paths it looked in', async () => {
    const catalog = await catalogWithRecipe(cordisRecipe('skills:\n  - medical-layer/nope\n'))

    const findings = await auditCatalogRecipes(catalog)

    const skillFindings = findingsOfCode(findings, 'unresolvable-skill')
    expect(skillFindings).toHaveLength(1)
    expect(skillFindings[0]!.message).toContain('medical-layer/nope')
    // The searched paths are the actionable half — losing them makes the
    // finding a label rather than a fix.
    expect(skillFindings[0]!.message).toContain('Searched, in order')
  })

  it('stays quiet when the named skill is really there', async () => {
    const catalog = await catalogWithRecipe(cordisRecipe('skills:\n  - medical-layer/real\n'), {
      'medical-layer/real': '# Real\n\nSomething worth mounting.\n',
    })

    expect(findingsOfCode(await auditCatalogRecipes(catalog), 'unresolvable-skill')).toEqual([])
  })

  // Item 29 retired the audit's inert-tools finding by moving the refusal into
  // the parser: a recipe whose kind never reads tools: no longer loads at all.
  it('reports a recipe the loose loader accepts but the authoritative parser refuses', async () => {
    // The discovery loader keeps a deliberately loose shape, so a recipe with
    // tools: on a non-consuming kind still LISTS — but every dispatch goes
    // through parseRecipeManifest, which now refuses it (item 29). The audit
    // is what keeps that gap visible before a case hits it at start.
    const catalog = await catalogWithRecipe(
      'schema_version: 1\nslug: r\nname: R\nprompt: p\nruntime:\n  kind: agent\ntools:\n  - read\n  - bash\n',
    )

    const findings = findingsOfCode(await auditCatalogRecipes(catalog), 'invalid-manifest')

    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toContain('tools is only enforced')
    expect(findings[0]!.message).toContain('pi / cordis')
  })

  it('raises nothing for tools: on the kinds that enforce it', async () => {
    for (const kind of ['pi', 'cordis']) {
      const catalog = await catalogWithRecipe(
        `schema_version: 1\nslug: r\nname: R\nprompt: p\nruntime:\n  kind: ${kind}\ntools:\n  - read_page\n`,
      )
      expect(findingsOfCode(await auditCatalogRecipes(catalog), 'invalid-manifest'), kind).toEqual([])
    }
  })
})

describe('the shipped bundle', () => {
  it('has no recipe naming a skill the bundle cannot supply', async () => {
    // The bundle is curated: a skill it names is a skill it must carry. This is
    // the check that would have caught a renamed or dropped skill file before a
    // case hit it at compose.
    const findings = findingsOfCode(await auditCatalogRecipes(await loadBundledWaypointCatalog()), 'unresolvable-skill')

    expect(findings.map((f) => f.message)).toEqual([])
  })

  it('has no recipe the authoritative parser refuses — the inert-tools ratchet closed at zero', async () => {
    // The predecessor of this test was a ratchet (≤118, later 78) while the
    // inert-tools population's disposition was undecided. Item 29 decided it:
    // the parser refuses tools: on a non-consuming kind and the 78 offenders
    // were stripped. Every bundled recipe must survive the parser every
    // dispatch goes through — a new offender fails here, not at a case start.
    const findings = findingsOfCode(
      await auditCatalogRecipes(await loadBundledWaypointCatalog()),
      'invalid-manifest',
    )

    expect(findings.map((f) => f.message)).toEqual([])
  })
})
