import { describe, expect, it } from 'vitest'

import { explainWaypointTool, getWaypointToolRegistry, listWaypointToolsForOperator, registerWaypointTool } from '../registry.ts'

describe('Waypoint tool registry', () => {
  it('ships only the example definitions referenced by the bundled research-analyst operator', () => {
    const registry = getWaypointToolRegistry()

    expect(registry.map((tool) => tool.slug)).toEqual(['example.search', 'example.summarize'])
  })

  it('lists the example tools for the bundled research-analyst operator', async () => {
    const result = await listWaypointToolsForOperator('research-analyst')

    expect(result).toMatchObject({ ok: true, operator_slug: 'research-analyst' })
    if (result.ok) {
      expect(result.tools.map((tool) => tool.slug)).toEqual(['example.search', 'example.summarize'])
    }
  })

  it('registerWaypointTool adds a host tool definition (host registration seam)', () => {
    registerWaypointTool({
      slug: 'host.probe',
      command: 'host probe --json',
      description: 'Host-registered probe tool.',
      inputs: [],
      evidence_behavior: 'none',
      side_effect_class: 'read_only',
      can_affect_domain_landmarks: false,
      safety_notes: [],
      examples: [],
    })

    expect(getWaypointToolRegistry().map((tool) => tool.slug)).toContain('host.probe')
  })

  it('registerWaypointTool replaces an existing definition by slug (last wins)', () => {
    const base = {
      command: 'host probe --json',
      description: 'Replacement description.',
      inputs: [],
      evidence_behavior: 'none',
      side_effect_class: 'read_only' as const,
      can_affect_domain_landmarks: false,
      safety_notes: [],
      examples: [],
    }
    registerWaypointTool({ ...base, slug: 'host.replaceable', description: 'First description.' })
    registerWaypointTool({ ...base, slug: 'host.replaceable', description: 'Replacement description.' })

    const matches = getWaypointToolRegistry().filter((tool) => tool.slug === 'host.replaceable')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.description).toBe('Replacement description.')
  })

  it('rejects an unknown operator', async () => {
    const result = await listWaypointToolsForOperator('missing-operator')

    expect(result).toMatchObject({ ok: false, code: 'unknown_operator' })
  })

  it('rejects an unknown tool slug', async () => {
    const result = await explainWaypointTool('missing.tool')

    expect(result).toMatchObject({ ok: false, code: 'unknown_tool' })
  })
})
