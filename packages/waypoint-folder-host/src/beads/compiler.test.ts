import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { compileQuestToBeadsGraph } from './compiler.ts'

describe('Waypoint Beads graph compiler', () => {
  it('compiles a Quest without scaffold plans into Beads task specs for referenced Recipes', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const graph = compileQuestToBeadsGraph(catalog, {
      quest: 'example',
      routeId: 'route-example',
      subject: { type: 'folder', id: 'local' },
    })

    expect(graph.root.title).toBe('Example Quest')
    expect(graph.root.issueType).toBe('epic')
    expect(graph.root.metadata.waypoint.kind).toBe('route')
    expect(graph.issues.map((issue) => issue.logicalId)).toEqual([
      'route:example',
      'recipe:doc-writer',
      'recipe:reviewer',
    ])
    expect(graph.issues.find((issue) => issue.logicalId === 'recipe:doc-writer')?.metadata.waypoint).toMatchObject({
      kind: 'recipe',
      quest_slug: 'example',
      route_id: 'route-example',
      recipe_slug: 'doc-writer',
      recipe: {
        tools: ['read_file', 'write_file', 'search_files'],
        runtime: {
          model: 'claude-sonnet-4',
          temperature: 0.3,
          max_tokens: 4000,
        },
      },
    })
    expect(graph.dependencies).toEqual([])
  })

  it('preserves recipe policy, output artifacts, gates, and wave blockers from Quest scaffolds', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const graph = compileQuestToBeadsGraph(catalog, {
      quest: 'referral-package',
      routeId: 'route-referral',
      subject: { type: 'folder', id: 'referral-fixture' },
    })

    const chronology = graph.issues.find((issue) => issue.logicalId === 'plan:medical-chronology-update')
    expect(chronology?.metadata.waypoint).toMatchObject({
      kind: 'recipe',
      quest_slug: 'referral-package',
      route_id: 'route-referral',
      node_key: 'medical-chronology-update',
      recipe_slug: 'firmvault-medical-chronology-update',
      policy: { external_side_effects: 'forbidden' },
    })
    expect(chronology?.metadata.waypoint.artifacts).toContainEqual({
      path: '03-medical/medical-chronology-output/medical-chronology.html',
      required: true,
      required_when: 'medical_records_present',
      verifier: {
        kind: 'required_paths',
        checks: ['exists', 'non_empty', 'directory_non_empty'],
      },
    })

    const gate = graph.issues.find((issue) => issue.logicalId === 'plan:attorney-handoff-gate')
    expect(gate?.metadata.waypoint).toMatchObject({
      kind: 'gate',
      policy: { requires_human_review: true },
      gate: { required: true, kind: 'attorney_handoff_approval' },
      scaffold: {
        workstream: 'referral-package',
        milestone: 'v1',
        phase: 'quality-control',
        plan_ref: 'attorney-handoff-gate',
      },
    })

    const handoff = graph.issues.find((issue) => issue.logicalId === 'plan:handoff-ready-summary')
    expect(handoff?.metadata.waypoint).toMatchObject({
      kind: 'handoff',
      handoff: {
        kind: 'attorney_referral_package',
        gate_required: true,
        gate_ref: 'attorney-handoff-gate',
      },
    })

    expect(graph.dependencies).toContainEqual({
      type: 'blocks',
      dependent: 'plan:start-here-draft',
      dependency: 'plan:medical-chronology-update',
    })
    expect(graph.dependencies).toContainEqual({
      type: 'blocks',
      dependent: 'plan:package-qc',
      dependency: 'plan:start-here-draft',
    })
    expect(graph.dependencies).toContainEqual({
      type: 'blocks',
      dependent: 'plan:handoff-ready-summary',
      dependency: 'plan:attorney-handoff-gate',
    })
  })
})
