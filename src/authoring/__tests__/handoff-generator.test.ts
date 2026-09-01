import { describe, expect, it } from 'vitest'

import { parseHandoffManifest } from '../../handoffs/manifest.ts'
import { generateAuthoringHandoffDraft } from '../handoff-generator.ts'

describe('generateAuthoringHandoffDraft', () => {
  it('generates valid draft HandoffManifest YAML from structured handoff steps', () => {
    const draft = generateAuthoringHandoffDraft({
      slug: 'followup-handoffs',
      name: 'Acme Follow-up Handoffs',
      domain: 'acme',
      description: 'Draft handoff graph for follow-up review routing.',
      source: {
        design_spec_path: 'docs/plans/generated-acme-followup-design.md',
        inspected_paths: ['handoffs/acme/agent.yaml', 'quests/acme.yaml'],
      },
      handoffs: [
        {
          slug: 'agent-to-attorney-followup-review',
          from: 'acme-agent',
          to: 'attorney-review',
          trigger: 'followup_summary_ready',
          gate: 'human_attorney_review',
          required_artifacts: ['docs/followup-summary.md', '.waypoint/acme/case.yaml'],
        },
      ],
    })

    expect(draft.kind).toBe('handoff')
    expect(draft.path).toBe('handoffs/acme/followup-handoffs.yaml')
    expect(draft.write_default).toBe(false)
    expect(draft.validation.ok).toBe(true)
    expect(draft.warnings).toContain('draft only: not written or installed')

    const parsed = parseHandoffManifest(draft.yaml)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.manifest.slug).toBe('followup-handoffs')
    expect(parsed.manifest.handoffs).toEqual([
      expect.objectContaining({
        slug: 'agent-to-attorney-followup-review',
        from: 'acme-agent',
        to: 'attorney-review',
        trigger: 'followup_summary_ready',
        gate: 'human_attorney_review',
      }),
    ])
    expect(parsed.manifest.metadata?.authoring).toMatchObject({
      generated_by: 'runner-author',
      approval_required: true,
      install_default: false,
      design_spec_path: 'docs/plans/generated-acme-followup-design.md',
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
