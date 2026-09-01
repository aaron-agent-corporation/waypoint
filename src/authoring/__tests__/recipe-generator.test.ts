import { describe, expect, it } from 'vitest'
import { parseRecipeManifest } from '../../recipes/manifest.ts'
import { generateAuthoringRecipeDraft } from '../recipe-generator.ts'

describe('generateAuthoringRecipeDraft', () => {
  it('generates valid draft RecipeManifest YAML from structured answers without writing files', () => {
    const draft = generateAuthoringRecipeDraft({
      slug: 'acme-client-followup',
      name: 'Acme Client Follow-up',
      domain: 'acme',
      description: 'Prepare a local client follow-up checklist from case evidence.',
      prompt: 'Review case-local evidence and prepare a client follow-up handoff. Do not contact the client.',
      source: {
        design_spec_path: 'docs/plans/generated-acme-followup-design.md',
        inspected_paths: ['quests/acme.yaml', 'recipes/acme/client-check-in-start-cadence.yaml'],
      },
    })

    expect(draft.kind).toBe('recipe')
    expect(draft.path).toBe('recipes/acme-client-followup.yaml')
    expect(draft.write_default).toBe(false)
    expect(draft.validation.ok).toBe(true)
    expect(draft.warnings).toContain('draft only: not written or installed')

    const parsed = parseRecipeManifest(draft.yaml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.manifest.slug).toBe('acme-client-followup')
    expect(parsed.manifest.metadata?.authoring).toMatchObject({
      generated_by: 'runner-author',
      approval_required: true,
      install_default: false,
      design_spec_path: 'docs/plans/generated-acme-followup-design.md',
    })
  })

  it('rejects unsafe slugs before emitting YAML', () => {
    const draft = generateAuthoringRecipeDraft({
      slug: '../escape',
      name: 'Escape',
      description: 'Unsafe recipe',
      prompt: 'No-op',
      source: { inspected_paths: ['docs/plans/example.md'] },
    })

    expect(draft.validation.ok).toBe(false)
    expect(draft.validation.errors.join('\n')).toContain('slug must be a safe lowercase slug')
    expect(draft.yaml).toBe('')
  })

  it('refuses a tools request with the reason, not a draft that fails its own validation', () => {
    // Item 29: drafts run as the default worker kind, which never reads
    // tools: — the parser refuses the field there, so the generator refuses
    // the request up front and says what would honor it.
    const draft = generateAuthoringRecipeDraft({
      slug: 'wants-tools',
      name: 'Wants Tools',
      prompt: 'No-op',
      tools: ['file_read'],
      source: { inspected_paths: ['docs/plans/example.md'] },
    })

    expect(draft.validation.ok).toBe(false)
    expect(draft.validation.errors.join('\n')).toContain('pi / cordis')
    expect(draft.yaml).toBe('')
  })
})
