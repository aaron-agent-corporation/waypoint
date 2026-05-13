import { describe, expect, it } from 'vitest'
import { parseQuestManifest } from '../../quests/manifest'
import { generateAuthoringQuestDraft } from '../quest-generator'

describe('generateAuthoringQuestDraft', () => {
  it('generates valid draft QuestManifest YAML from phases, recipe tasks, and human gates', () => {
    const draft = generateAuthoringQuestDraft({
      slug: 'firmvault-followup',
      name: 'FirmVault Follow-up Quest',
      domain: 'firmvault',
      description: 'Draft follow-up route for a FirmVault case.',
      workflow: 'workflows/firmvault-followup.yaml',
      recipes: ['firmvault-client-followup'],
      source: {
        design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
        inspected_paths: ['quests/firmvault.yaml', 'docs/plans/generated-firmvault-followup-design.md'],
      },
      phases: [
        {
          key: 'followup',
          title: 'Follow-up',
          tasks: [
            { ref: 'client-followup-task', title: 'Prepare client follow-up', type: 'recipe', recipe: 'firmvault-client-followup' },
            { ref: 'human-review-gate', title: 'Human review before contact', type: 'gate', gate_kind: 'human_review' },
          ],
        },
      ],
    })

    expect(draft.kind).toBe('quest')
    expect(draft.path).toBe('quests/firmvault-followup.yaml')
    expect(draft.write_default).toBe(false)
    expect(draft.validation.ok).toBe(true)
    expect(draft.warnings).toContain('draft only: not written or installed')

    const parsed = parseQuestManifest(draft.yaml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('generated quest did not parse')
    expect(parsed.manifest.slug).toBe('firmvault-followup')
    expect(parsed.manifest.recipes).toEqual(['firmvault-client-followup'])
    expect(parsed.manifest.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases?.[0]?.plans).toHaveLength(2)
    expect(parsed.manifest.metadata?.authoring).toMatchObject({
      generated_by: 'waypoint-author',
      approval_required: true,
      install_default: false,
      design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
    })
  })

  it('rejects recipe tasks that do not name a recipe slug', () => {
    const draft = generateAuthoringQuestDraft({
      slug: 'bad-quest',
      name: 'Bad Quest',
      workflow: 'workflows/bad.yaml',
      source: { inspected_paths: ['docs/plans/bad.md'] },
      phases: [
        {
          key: 'bad',
          title: 'Bad',
          tasks: [{ ref: 'missing-recipe-task', title: 'Missing recipe', type: 'recipe' }],
        },
      ],
    })

    expect(draft.validation.ok).toBe(false)
    expect(draft.validation.errors.join('\n')).toContain('recipe task missing-recipe-task must include recipe')
    expect(draft.yaml).toBe('')
  })
})
