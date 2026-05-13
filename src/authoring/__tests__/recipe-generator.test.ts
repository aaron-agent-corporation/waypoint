import { describe, expect, it } from 'vitest'
import { parseRecipeManifest } from '../../recipes/manifest'
import { generateAuthoringRecipeDraft } from '../recipe-generator'

describe('generateAuthoringRecipeDraft', () => {
  it('generates valid draft RecipeManifest YAML from structured answers without writing files', () => {
    const draft = generateAuthoringRecipeDraft({
      slug: 'firmvault-client-followup',
      name: 'FirmVault Client Follow-up',
      domain: 'firmvault',
      description: 'Prepare a local client follow-up checklist from case evidence.',
      prompt: 'Review case-local evidence and prepare a client follow-up handoff. Do not contact the client.',
      tools: ['file_read', 'search_files', 'file_write'],
      source: {
        design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
        inspected_paths: ['quests/firmvault.yaml', 'recipes/firmvault/client-check-in-start-cadence.yaml'],
      },
    })

    expect(draft.kind).toBe('recipe')
    expect(draft.path).toBe('recipes/firmvault-client-followup.yaml')
    expect(draft.write_default).toBe(false)
    expect(draft.validation.ok).toBe(true)
    expect(draft.warnings).toContain('draft only: not written or installed')

    const parsed = parseRecipeManifest(draft.yaml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.manifest.slug).toBe('firmvault-client-followup')
    expect(parsed.manifest.tools).toEqual(['file_read', 'search_files', 'file_write'])
    expect(parsed.manifest.metadata?.authoring).toMatchObject({
      generated_by: 'waypoint-author',
      approval_required: true,
      install_default: false,
      design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
    })
    expect(parsed.manifest.metadata?.firmvault).toMatchObject({
      external_side_effects: 'forbidden',
      legal_landmarks_updated_by_default: false,
    })
  })

  it('rejects unsafe slugs before emitting YAML', () => {
    const draft = generateAuthoringRecipeDraft({
      slug: '../escape',
      name: 'Escape',
      description: 'Unsafe recipe',
      prompt: 'No-op',
      tools: ['file_read'],
      source: { inspected_paths: ['docs/plans/example.md'] },
    })

    expect(draft.validation.ok).toBe(false)
    expect(draft.validation.errors.join('\n')).toContain('slug must be a safe lowercase slug')
    expect(draft.yaml).toBe('')
  })
})
