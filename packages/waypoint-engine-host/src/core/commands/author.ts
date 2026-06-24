import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  generateAuthoringDesignSpec,
  generateAuthoringHandoffDraft,
  generateAuthoringQuestDraft,
  generateAuthoringRecipeDraft,
  parseQuestManifest,
  parseRecipeManifest,
} from '@waypoint/core'
import { getWaypointProjectPaths } from '@waypoint/folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

type ManifestDraft = { kind: 'recipe' | 'quest'; path: string; yaml: string; validation: { ok: boolean; errors: readonly string[] } }

const PROPOSAL_ID = /^(quest|recipe)\/[a-z0-9-]+$/
const TARGET_PATH = /^(quests|recipes)\/[a-z0-9-]+\.ya?ml$/
const SLUG = /^[a-z0-9-]+$/

function assertValid(draft: { validation: { ok: boolean; errors: readonly string[] } }): void {
  if (!draft.validation.ok) {
    throw new EngineError('Authoring draft invalid', { code: 'VALIDATION', issues: [...draft.validation.errors] })
  }
}

function readSlugFromYaml(yaml: string): string | null {
  const match = yaml.match(/^slug:\s*(\S+)\s*$/m)
  return match ? match[1] : null
}

export function registerAuthorCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('author.recipe', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { spec?: Parameters<typeof generateAuthoringRecipeDraft>[0] }
    if (!input.spec) throw new EngineError('author.recipe requires a spec', { code: 'VALIDATION', field: 'spec' })
    const draft = generateAuthoringRecipeDraft(input.spec)
    assertValid(draft)
    return ok('author.recipe', { draft })
  })

  bus.register('author.quest', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { spec?: Parameters<typeof generateAuthoringQuestDraft>[0] }
    if (!input.spec) throw new EngineError('author.quest requires a spec', { code: 'VALIDATION', field: 'spec' })
    const draft = generateAuthoringQuestDraft(input.spec)
    assertValid(draft)
    return ok('author.quest', { draft })
  })

  bus.register('author.designSpec', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { input?: Parameters<typeof generateAuthoringDesignSpec>[0] }
    if (!input.input) throw new EngineError('author.designSpec requires an input', { code: 'VALIDATION', field: 'input' })
    return ok('author.designSpec', { draft: generateAuthoringDesignSpec(input.input) })
  })

  bus.register('author.handoff', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { input?: Parameters<typeof generateAuthoringHandoffDraft>[0] }
    if (!input.input) throw new EngineError('author.handoff requires an input', { code: 'VALIDATION', field: 'input' })
    return ok('author.handoff', { draft: generateAuthoringHandoffDraft(input.input) })
  })

  // Write a reviewable PENDING proposal — never the catalog directly (UC4).
  bus.register('author.promote', async (payload) => {
    const { root } = ctx.session.requireActive()
    const body = (payload ?? {}) as { draft?: ManifestDraft } & Partial<ManifestDraft>
    const draft = body.draft ?? (body as ManifestDraft)
    if (!draft || typeof draft.yaml !== 'string' || (draft.kind !== 'recipe' && draft.kind !== 'quest')) {
      throw new EngineError('author.promote requires a draft { kind, path, yaml }', { code: 'VALIDATION', field: 'draft' })
    }
    const slug = basename(draft.path, '.yaml')
    if (!SLUG.test(slug)) throw new EngineError(`Unsafe draft slug: ${slug}`, { code: 'VALIDATION', field: 'path' })
    if (!TARGET_PATH.test(draft.path)) {
      throw new EngineError(`Unsafe catalog path: ${draft.path}`, { code: 'VALIDATION', field: 'path' })
    }
    const manifestSlug = readSlugFromYaml(draft.yaml)
    if (manifestSlug !== null && manifestSlug !== slug) {
      throw new EngineError(`Manifest slug '${manifestSlug}' does not match filename '${slug}'`, {
        code: 'VALIDATION',
        field: 'slug',
      })
    }

    const proposalDir = join(getWaypointProjectPaths(root).waypointDir, 'proposals', draft.kind)
    await mkdir(proposalDir, { recursive: true })
    await writeFile(join(proposalDir, `${slug}.yaml`), draft.yaml, 'utf8')
    const sidecar = {
      proposalId: `${draft.kind}/${slug}`,
      kind: draft.kind,
      slug,
      targetCatalogPath: draft.path,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }
    await writeFile(join(proposalDir, `${slug}.proposal.json`), JSON.stringify(sidecar, null, 2), 'utf8')
    return ok('author.promote', { proposalId: sidecar.proposalId, status: sidecar.status })
  })

  // Land an approved proposal into the workspace catalog dir; id-only, path-safe.
  bus.register('author.approveProposal', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { id?: string }
    if (!input.id || !PROPOSAL_ID.test(input.id)) {
      throw new EngineError(`Invalid proposal id: ${String(input.id)}`, { code: 'VALIDATION', field: 'id' })
    }
    const [kind, slug] = input.id.split('/')
    const waypointDir = getWaypointProjectPaths(root).waypointDir
    const proposalDir = join(waypointDir, 'proposals', kind)
    const sidecarPath = join(proposalDir, `${slug}.proposal.json`)

    let sidecar: { targetCatalogPath?: string }
    try {
      sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as { targetCatalogPath?: string }
    } catch {
      throw new EngineError(`Proposal not found: ${input.id}`, { code: 'NOT_FOUND', field: 'id' })
    }
    const target = sidecar.targetCatalogPath
    if (!target || !TARGET_PATH.test(target)) {
      throw new EngineError(`Proposal has an unsafe target path: ${String(target)}`, { code: 'VALIDATION', field: 'id' })
    }
    const manifest = await readFile(join(proposalDir, `${slug}.yaml`), 'utf8')

    if (kind === 'recipe') {
      const parsed = parseRecipeManifest(manifest)
      if (!parsed.ok) {
        throw new EngineError(parsed.error.message, {
          code: 'VALIDATION',
          field: 'prompt',
          issues: [parsed.error.message],
        })
      }
    }

    if (kind === 'quest') {
      const parsed = parseQuestManifest(manifest)
      if (!parsed.ok) {
        throw new EngineError(parsed.error.message, {
          code: 'VALIDATION',
          field: 'quest',
          issues: [parsed.error.message],
        })
      }
    }

    const dest = join(waypointDir, target)
    await ctx.session.mutate(async () => {
      await mkdir(dirname(dest), { recursive: true })
      const tmp = `${dest}.tmp`
      await writeFile(tmp, manifest, 'utf8')
      await rename(tmp, dest)
      await writeFile(
        sidecarPath,
        JSON.stringify({ ...sidecar, status: 'approved', approvedAt: new Date().toISOString() }, null, 2),
        'utf8',
      )
    })
    return ok('author.approveProposal', { proposalId: input.id, path: target })
  })
}
