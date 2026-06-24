import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const recipeSpec = {
  slug: 'demo-recipe',
  name: 'Demo Recipe',
  prompt: 'Do the demo work.',
  source: { inspected_paths: ['src/index.ts'] },
}

describe('engine-host author commands (folder)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  })
  afterEach(async () => {
    await cleanup(dir)
  })

  it('generates a recipe draft (no write) with yaml + validation', async () => {
    const res = (await host.dispatch('author.recipe', { spec: recipeSpec })) as unknown as {
      ok: boolean
      draft: { kind: string; path: string; yaml: string }
    }
    expect(res.ok).toBe(true)
    expect(res.draft).toMatchObject({ kind: 'recipe', path: 'recipes/demo-recipe.yaml' })
    expect(res.draft.yaml).toContain('slug: demo-recipe')
  })

  it('rejects an invalid draft with VALIDATION + structured issues', async () => {
    const res = await host.dispatch('author.recipe', {
      spec: { slug: 'Bad Slug', name: '', prompt: '', source: { inspected_paths: [] } },
    })
    expect(res).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })
    expect((res as { details: { issues?: string[] } }).details.issues?.length ?? 0).toBeGreaterThan(0)
  })

  it('promote creates a pending proposal and leaves the catalog unchanged', async () => {
    const draftRes = (await host.dispatch('author.recipe', { spec: recipeSpec })) as unknown as {
      draft: { kind: string; path: string; yaml: string }
    }
    const promoted = (await host.dispatch('author.promote', { draft: draftRes.draft })) as unknown as {
      ok: boolean
      proposalId: string
    }
    expect(promoted.ok).toBe(true)
    // Opaque id, not a filesystem path.
    expect(promoted.proposalId).toBe('recipe/demo-recipe')
    // Proposal written; catalog target NOT written yet.
    expect(await exists(join(dir, '.waypoint', 'proposals', 'recipe', 'demo-recipe.proposal.json'))).toBe(true)
    expect(await exists(join(dir, '.waypoint', 'recipes', 'demo-recipe.yaml'))).toBe(false)
  })

  it('approveProposal lands the manifest in the workspace catalog directory', async () => {
    const draftRes = (await host.dispatch('author.recipe', { spec: recipeSpec })) as unknown as {
      draft: { kind: string; path: string; yaml: string }
    }
    const promoted = (await host.dispatch('author.promote', { draft: draftRes.draft })) as unknown as { proposalId: string }
    const approved = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(approved).toMatchObject({ ok: true, action: 'author.approveProposal' })
    const landed = join(dir, '.waypoint', 'recipes', 'demo-recipe.yaml')
    expect(await exists(landed)).toBe(true)
    expect(await readFile(landed, 'utf8')).toContain('slug: demo-recipe')
  })

  it('approveProposal rejects path-escape ids without touching disk', async () => {
    for (const id of ['recipe/../config', 'recipe/demo-recipe/../../x', '../recipe/x', 'recipe/Bad Slug']) {
      const res = await host.dispatch('author.approveProposal', { id })
      expect(res, `id ${id} must be rejected`).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })
    }
    expect(await exists(join(dir, '.waypoint', 'config.yaml.yaml'))).toBe(false)
  })

  it('approveProposal rejects a malformed quest (recipes: not-an-array) with VALIDATION and does NOT land the file', async () => {
    // Quest YAML where `recipes` is a scalar string, not an array — invalid for parseQuestManifest
    const malformedYaml = `schema_version: 1\nslug: bad-quest\nname: Bad Quest\nworkflow: workflows/bad-quest.md\nrecipes: not-an-array\n`
    const draft = { kind: 'quest', path: 'quests/bad-quest.yaml', yaml: malformedYaml }
    const promoted = (await host.dispatch('author.promote', { draft })) as unknown as { ok: boolean; proposalId: string }
    expect(promoted.ok).toBe(true)

    const res = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(res).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })

    // Must NOT have landed the file in the workspace catalog.
    expect(await exists(join(dir, '.waypoint', 'quests', 'bad-quest.yaml'))).toBe(false)
  })

  it('approveProposal rejects a prompt-less recipe with VALIDATION and does NOT land the file', async () => {
    // Promote a recipe YAML that has no prompt — valid for the catalog schema but
    // invalid for the runtime schema (parseRecipeManifest requires a non-empty prompt).
    const promptlessYaml = `schema_version: 1\nslug: prompt-less\nname: Prompt Less Recipe\n`
    const draft = { kind: 'recipe', path: 'recipes/prompt-less.yaml', yaml: promptlessYaml }
    const promoted = (await host.dispatch('author.promote', { draft })) as unknown as { ok: boolean; proposalId: string }
    expect(promoted.ok).toBe(true)

    const res = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(res).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })

    // Must NOT have landed the file in the workspace catalog.
    expect(await exists(join(dir, '.waypoint', 'recipes', 'prompt-less.yaml'))).toBe(false)
  })

  // N6: a proposal's kind (from the id) and its target directory (from the promoted
  // path) are independently controlled. A VALID quest whose path is under recipes/
  // would otherwise land in .waypoint/recipes/ and shadow a bundled recipe of the
  // same slug in the overlay merge. approveProposal must reject the mismatch.
  it('approveProposal rejects a quest whose target path is under recipes/ and does NOT land the file', async () => {
    const questYaml = `schema_version: 1\nslug: sneaky\nname: Sneaky Quest\nworkflow: workflows/sneaky.md\n`
    const draft = { kind: 'quest', path: 'recipes/sneaky.yaml', yaml: questYaml }
    const promoted = (await host.dispatch('author.promote', { draft })) as unknown as { ok: boolean; proposalId: string }
    expect(promoted.ok).toBe(true)
    expect(promoted.proposalId).toBe('quest/sneaky')

    const res = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(res).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })

    // Must NOT have shadowed a recipe by landing under recipes/.
    expect(await exists(join(dir, '.waypoint', 'recipes', 'sneaky.yaml'))).toBe(false)
  })

  it('approveProposal still admits a matching quest -> quests/ write (cross-check happy path)', async () => {
    const questYaml = `schema_version: 1\nslug: ok-quest\nname: OK Quest\nworkflow: workflows/ok-quest.md\n`
    const draft = { kind: 'quest', path: 'quests/ok-quest.yaml', yaml: questYaml }
    const promoted = (await host.dispatch('author.promote', { draft })) as unknown as { proposalId: string }
    const approved = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(approved).toMatchObject({ ok: true, action: 'author.approveProposal' })
    expect(await exists(join(dir, '.waypoint', 'quests', 'ok-quest.yaml'))).toBe(true)
  })

  it('approveProposal rejects a recipe whose target path is under quests/ and does NOT land the file', async () => {
    const recipeYaml = `schema_version: 1\nslug: sneaky\nname: Sneaky Recipe\nprompt: Do the work.\n`
    const draft = { kind: 'recipe', path: 'quests/sneaky.yaml', yaml: recipeYaml }
    const promoted = (await host.dispatch('author.promote', { draft })) as unknown as { ok: boolean; proposalId: string }
    expect(promoted.ok).toBe(true)
    expect(promoted.proposalId).toBe('recipe/sneaky')

    const res = await host.dispatch('author.approveProposal', { id: promoted.proposalId })
    expect(res).toMatchObject({ ok: false, action: 'error', details: { code: 'VALIDATION' } })

    // Must NOT have shadowed a quest by landing under quests/.
    expect(await exists(join(dir, '.waypoint', 'quests', 'sneaky.yaml'))).toBe(false)
  })
})
