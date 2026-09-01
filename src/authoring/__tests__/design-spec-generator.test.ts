import { describe, expect, it } from 'vitest'

import { generateAuthoringDesignSpec, reviewAuthoringDesignSpec } from '../design-spec-generator.ts'

describe('Waypoint authoring design spec generator', () => {
  it('emits a reviewable markdown design spec from brainstorming answers', () => {
    const result = generateAuthoringDesignSpec({
      title: 'Acme Followup Workflow',
      kind: 'quest',
      domain: 'acme',
      inspected_paths: ['quests/acme.yaml', 'recipes/acme/demand-package-assembly.yaml'],
      goal: 'Track follow-up work after demand package review without sending external messages.',
      constraints: ['No external side effects', 'Legal landmarks only change through explicit state'],
      approaches: [
        { slug: 'extend-acme', title: 'Extend Acme Quest', tradeoffs: ['Least operator context switching'], recommended: true },
        { slug: 'separate-followup', title: 'Separate Followup Quest', tradeoffs: ['Cleaner package boundary'], recommended: false },
      ],
      lifecycle: {
        workstreams: [
          {
            key: 'acme-followup',
            name: 'Acme Followup',
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
      roles: ['acme-agent', 'attorney-review'],
      tool_boundaries: ['Use runner acme state show before proposing mutations.'],
      verification: ['pnpm exec vitest run src/authoring/__tests__/design-spec-generator.test.ts'],
    })

    expect(result.review.ok).toBe(true)
    expect(result.markdown).toContain('# Acme Followup Workflow')
    expect(result.markdown).toContain('## Current Context Inspected')
    expect(result.markdown).toContain('- `quests/acme.yaml`')
    expect(result.markdown).toContain('## Approaches and Trade-offs')
    expect(result.markdown).toContain('### Recommended: Extend Acme Quest')
    expect(result.markdown).toContain('## Lifecycle Map')
    expect(result.markdown).toContain('workstream: `acme-followup`')
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
