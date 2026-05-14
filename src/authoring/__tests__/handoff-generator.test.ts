import { describe, expect, it } from 'vitest'

import { parseHandoffManifest } from '../../handoffs/manifest'
import { generateAuthoringHandoffDraft } from '../handoff-generator'

describe('generateAuthoringHandoffDraft', () => {
  it('generates valid draft HandoffManifest YAML from structured handoff steps', () => {
    const draft = generateAuthoringHandoffDraft({
      slug: 'followup-handoffs',
      name: 'FirmVault Follow-up Handoffs',
      domain: 'firmvault',
      description: 'Draft handoff graph for follow-up review routing.',
      source: {
        design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
        inspected_paths: ['handoffs/firmvault/paralegal.yaml', 'quests/firmvault.yaml'],
      },
      handoffs: [
        {
          slug: 'paralegal-to-attorney-followup-review',
          from: 'firmvault-paralegal',
          to: 'attorney-review',
          trigger: 'followup_summary_ready',
          gate: 'human_attorney_review',
          required_artifacts: ['docs/followup-summary.md', '.waypoint/firmvault/case.yaml'],
        },
      ],
    })

    expect(draft.kind).toBe('handoff')
    expect(draft.path).toBe('handoffs/firmvault/followup-handoffs.yaml')
    expect(draft.write_default).toBe(false)
    expect(draft.validation.ok).toBe(true)
    expect(draft.warnings).toContain('draft only: not written or installed')

    const parsed = parseHandoffManifest(draft.yaml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.manifest.slug).toBe('followup-handoffs')
    expect(parsed.manifest.handoffs).toEqual([
      expect.objectContaining({
        slug: 'paralegal-to-attorney-followup-review',
        from: 'firmvault-paralegal',
        to: 'attorney-review',
        trigger: 'followup_summary_ready',
        gate: 'human_attorney_review',
      }),
    ])
    expect(parsed.manifest.metadata?.authoring).toMatchObject({
      generated_by: 'waypoint-author',
      approval_required: true,
      install_default: false,
      design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
    })
    expect(parsed.manifest.metadata?.firmvault).toMatchObject({
      external_side_effects: 'forbidden',
      human_gates_required: true,
    })
  })

  it('rejects unsafe handoff step artifacts before emitting YAML', () => {
    const draft = generateAuthoringHandoffDraft({
      slug: 'bad-handoffs',
      name: 'Bad Handoffs',
      source: { inspected_paths: ['docs/plans/bad.md'] },
      handoffs: [
        {
          slug: 'bad-step',
          from: 'operator-a',
          to: 'operator-b',
          trigger: 'ready',
          required_artifacts: ['../escape.md'],
        },
      ],
    })

    expect(draft.validation.ok).toBe(false)
    expect(draft.validation.errors.join('\n')).toContain('handoff bad-step required artifact ../escape.md must be a safe relative path')
    expect(draft.yaml).toBe('')
  })
})
