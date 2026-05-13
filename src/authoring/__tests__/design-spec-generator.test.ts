import { describe, expect, it } from 'vitest'

import { generateAuthoringDesignSpec, reviewAuthoringDesignSpec } from '../design-spec-generator'

describe('Waypoint authoring design spec generator', () => {
  it('emits a reviewable markdown design spec from brainstorming answers', () => {
    const result = generateAuthoringDesignSpec({
      title: 'FirmVault Followup Workflow',
      kind: 'quest',
      domain: 'firmvault',
      inspected_paths: ['quests/firmvault.yaml', 'recipes/firmvault/demand-package-assembly.yaml'],
      goal: 'Track follow-up work after demand package review without sending external messages.',
      constraints: ['No external side effects', 'Legal landmarks only change through explicit state'],
      approaches: [
        { slug: 'extend-firmvault', title: 'Extend FirmVault Quest', tradeoffs: ['Least operator context switching'], recommended: true },
        { slug: 'separate-followup', title: 'Separate Followup Quest', tradeoffs: ['Cleaner package boundary'], recommended: false },
      ],
      lifecycle: {
        workstreams: [
          {
            key: 'firmvault-followup',
            name: 'FirmVault Followup',
            milestones: [
              {
                key: 'post-demand',
                title: 'Post-demand followup ready',
                phases: [{ key: 'review', title: 'Review and plan followup', plans: ['docs/plans/generated-followup-plan.md'] }],
              },
            ],
          },
        ],
      },
      roles: ['firmvault-paralegal', 'attorney-review'],
      tool_boundaries: ['Use waypoint firmvault state show before proposing mutations.'],
      verification: ['pnpm exec vitest run src/authoring/__tests__/design-spec-generator.test.ts'],
    })

    expect(result.review.ok).toBe(true)
    expect(result.markdown).toContain('# FirmVault Followup Workflow')
    expect(result.markdown).toContain('## Current Context Inspected')
    expect(result.markdown).toContain('- `quests/firmvault.yaml`')
    expect(result.markdown).toContain('## Approaches and Trade-offs')
    expect(result.markdown).toContain('### Recommended: Extend FirmVault Quest')
    expect(result.markdown).toContain('## Lifecycle Map')
    expect(result.markdown).toContain('workstream: `firmvault-followup`')
    expect(result.markdown).toContain('## Approval Status')
    expect(result.markdown).toContain('status: pending')
    expect(result.markdown).not.toContain('schema_version: 1')
  })

  it('flags incomplete specs during self-review', () => {
    const review = reviewAuthoringDesignSpec(`# Bad Spec\n\nTODO\n\n## Approaches and Trade-offs\n\n## Verification Strategy\n`)

    expect(review.ok).toBe(false)
    expect(review.findings).toEqual(expect.arrayContaining(['spec contains TODO/TBD placeholders']))
  })
})
