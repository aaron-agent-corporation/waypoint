import { describe, expect, it } from 'vitest'

import { createAuthoringDraft, validateAuthoringDraft } from '../draft'

describe('Waypoint authoring draft contract', () => {
  it('creates draft-only generated files with the brainstorming gate preserved', () => {
    const draft = createAuthoringDraft({
      kind: 'quest',
      title: 'FirmVault Followup Workflow',
      source: 'questionnaire',
      answers: { goal: 'Track follow-up tasks after demand package review.' },
      brainstorm_context: { inspected_paths: ['quests/firmvault.yaml', 'recipes/firmvault'] },
      questions: [
        { id: 'goal', prompt: 'What is the user trying to accomplish in plain language?', order: 1 },
        { id: 'constraints', prompt: 'What constraints are non-negotiable?', order: 2 },
      ],
      approaches: [
        { slug: 'minimal', title: 'Minimal extension', tradeoffs: ['Fastest to validate'], recommended: true },
        { slug: 'new-quest', title: 'Separate Quest', tradeoffs: ['Cleaner separation', 'More setup'], recommended: false },
      ],
      design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
      generated_files: [
        {
          path: 'docs/plans/generated-firmvault-followup-design.md',
          purpose: 'Reviewable design spec before implementation planning.',
          content: '# Design Spec\n',
        },
      ],
    })

    expect(draft.schema_version).toBe(1)
    expect(draft.kind).toBe('quest')
    expect(draft.generated_files[0]).toMatchObject({ install_default: false })
    expect(draft.brainstorm_context.inspected_paths).toContain('quests/firmvault.yaml')
    expect(draft.questions.map((question) => question.order)).toEqual([1, 2])
    expect(draft.approaches).toHaveLength(2)
    expect(draft.approaches.some((approach) => approach.recommended)).toBe(true)
    expect(draft.approval).toEqual({ required: true, status: 'pending' })
    expect(draft.next_actions).toContain('Review and approve the design spec before implementation planning or manifest generation.')
    expect(validateAuthoringDraft(draft)).toEqual({ ok: true, errors: [] })
  })

  it('rejects drafts that skip the brainstorming comparison gate', () => {
    const draft = createAuthoringDraft({
      kind: 'recipe',
      title: 'Unsafe Shortcut',
      source: 'prompt',
      answers: {},
      brainstorm_context: { inspected_paths: [] },
      questions: [{ id: 'goal', prompt: 'Goal?', order: 1 }],
      approaches: [{ slug: 'only', title: 'Only approach', tradeoffs: [], recommended: true }],
      generated_files: [],
    })

    const validation = validateAuthoringDraft(draft)

    expect(validation.ok).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining(['draft must include at least two approaches before recommending one']))
  })

  it('rejects generated files that would install by default', () => {
    const draft = createAuthoringDraft({
      kind: 'operator',
      title: 'Operator Draft',
      source: 'questionnaire',
      answers: {},
      brainstorm_context: { inspected_paths: ['operators/firmvault/paralegal.yaml'] },
      questions: [{ id: 'goal', prompt: 'Goal?', order: 1 }],
      approaches: [
        { slug: 'a', title: 'Approach A', tradeoffs: ['simple'], recommended: true },
        { slug: 'b', title: 'Approach B', tradeoffs: ['complete'], recommended: false },
      ],
      generated_files: [
        {
          path: 'operators/new.yaml',
          purpose: 'Should remain a draft.',
          content: 'schema_version: 1\n',
          install_default: true,
        },
      ],
    })

    const validation = validateAuthoringDraft(draft)

    expect(validation.ok).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining(['generated files must be drafts with install_default: false']))
  })
})
