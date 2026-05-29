import { describe, expect, it } from 'vitest'

import type { WaypointBeadsIssueSpec } from './compiler.ts'
import { describeWaypointBeadsIssue } from './descriptions.ts'

describe('Waypoint Beads issue descriptions', () => {
  it('renders provider-executable recipe instructions with policy, artifacts, and completion rules', () => {
    const description = describeWaypointBeadsIssue({
      logicalId: 'plan:draft',
      title: 'Draft the implementation plan',
      issueType: 'task',
      labels: ['waypoint'],
      metadata: {
        waypoint: {
          schema_version: 1,
          kind: 'recipe',
          quest_slug: 'delivery',
          route_id: 'route-001',
          node_key: 'draft',
          recipe_slug: 'plan-writer',
          recipe: {
            name: 'Plan Writer',
            description: 'Turns context into an executable plan.',
            prompt: 'Read the repository context and write docs/plan.md with risks and verification steps.',
            tools: ['read_file', 'write_file'],
          },
          subject: { type: 'project', id: 'local' },
          scaffold: {
            workstream: 'delivery',
            milestone: 'v1',
            phase: 'plan',
            plan_ref: 'draft',
          },
          source: {
            quest_path: 'quests/delivery.yaml',
            recipe_path: 'recipes/plan-writer.yaml',
          },
          policy: { external_side_effects: 'forbidden' },
          artifacts: [
            {
              path: 'docs/plan.md',
              required: true,
              verifier: { kind: 'required_paths', checks: ['exists', 'non_empty'] },
            },
          ],
        },
      },
    })

    expect(description).toContain('# Draft the implementation plan')
    expect(description).toContain('## Objective\nDraft the implementation plan')
    expect(description).toContain('- Node: draft')
    expect(description).toContain('- Scaffold: delivery/v1/plan/draft')
    expect(description).toContain('Name: Plan Writer')
    expect(description).toContain('Prompt:\nRead the repository context and write docs/plan.md with risks and verification steps.')
    expect(description).toContain('- read_file')
    expect(description).toContain('- External side effects: forbidden')
    expect(description).toContain('- docs/plan.md (required; verifier required_paths; checks exists, non_empty)')
    expect(description).toContain('leave a concise Beads note/comment summarizing the result.')
    expect(description).toContain('- Close this Beads issue when the work is complete.')
  })

  it('keeps gates and waits explicit instead of making them look like normal worker tasks', () => {
    const gateDescription = describeWaypointBeadsIssue(baseIssue('gate', { gate: { required: true, kind: 'approval' } }))
    const waitDescription = describeWaypointBeadsIssue(baseIssue('wait', { wait: { kind: 'external', condition: 'signed docs received' } }))

    expect(gateDescription).toContain('This is a gate node. Do not approve or bypass it')
    expect(waitDescription).toContain('This is a wait node. Do not mark it complete until its wait condition is satisfied.')
    expect(waitDescription).toContain('Condition: signed docs received')
  })
})

function baseIssue(
  kind: 'gate' | 'wait',
  extra: Pick<WaypointBeadsIssueSpec['metadata']['waypoint'], 'gate' | 'wait'>,
): WaypointBeadsIssueSpec {
  return {
    logicalId: `plan:${kind}`,
    title: `${kind} title`,
    issueType: 'task',
    labels: ['waypoint'],
    metadata: {
      waypoint: {
        schema_version: 1,
        kind,
        quest_slug: 'delivery',
        route_id: 'route-001',
        node_key: kind,
        subject: { type: 'project', id: 'local' },
        source: { quest_path: 'quests/delivery.yaml' },
        policy: { external_side_effects: 'none', ...(kind === 'gate' ? { requires_human_review: true } : {}) },
        ...extra,
      },
    },
  }
}
