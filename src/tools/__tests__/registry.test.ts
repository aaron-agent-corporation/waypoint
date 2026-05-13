import { describe, expect, it } from 'vitest'

import { explainWaypointTool, listWaypointToolsForOperator } from '../registry'

describe('Waypoint tool registry', () => {
  it('lists safe tool definitions for the FirmVault paralegal operator', async () => {
    const result = await listWaypointToolsForOperator('firmvault-paralegal')

    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error(result.error)
    expect(result.tools.map((tool) => tool.slug)).toEqual(
      expect.arrayContaining(['firmvault.guidance', 'firmvault.state.set', 'firmvault.document.handoff', 'firmvault.landmarks']),
    )
    expect(result.tools.every((tool) => tool.command.startsWith('waypoint '))).toBe(true)
    expect(result.tools.find((tool) => tool.slug === 'firmvault.document.add')).toMatchObject({
      side_effect_class: 'local_file_copy',
      can_affect_legal_landmarks: false,
    })
  })

  it('explains firmvault.state.set with required inputs and safety notes', async () => {
    const result = await explainWaypointTool('firmvault.state.set')

    expect(result.ok).toBe(true)
    if (result.ok === false) throw new Error(result.error)
    expect(result.tool.slug).toBe('firmvault.state.set')
    expect(result.tool.side_effect_class).toBe('local_state_mutation')
    expect(result.tool.can_affect_legal_landmarks).toBe(true)
    expect(result.tool.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'fact', required: true }),
        expect.objectContaining({ name: 'status', required: true }),
        expect.objectContaining({ name: 'evidence', required: true }),
      ]),
    )
    expect(result.tool.safety_notes.join('\n')).toContain('validated evidence')
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
