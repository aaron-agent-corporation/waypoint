// How a gate decision reads in the case's activity log. Kept out of
// state.test.ts because that file needs a live Postgres; the title choice is
// pure and should be verifiable without one.

import { describe, expect, it } from 'vitest'

import { gateDecisionActivityTitle } from './state.ts'

describe('gate decision narration', () => {
  it('uses the gate\'s human title, not its node slug', () => {
    const title = gateDecisionActivityTitle(
      'approved',
      'records-human-send-request',
      'Send the records and bills request to Norton Audubon Hospital',
    )
    expect(title).toBe('Approved: Send the records and bills request to Norton Audubon Hospital')
    expect(title).not.toContain('records-human-send-request')
  })

  it('names a decline the same way', () => {
    expect(gateDecisionActivityTitle('rejected', 'pip-human-send-packet', 'Send the PIP packet'))
      .toBe('Declined: Send the PIP packet')
  })

  it('deslugs the node when the gate has no title', () => {
    const title = gateDecisionActivityTitle('approved', 'records-human-send-request', null)
    expect(title).toBe('Approved: records human send request')
  })

  it('treats a blank title as no title', () => {
    expect(gateDecisionActivityTitle('approved', 'pip-human-send-packet', '   '))
      .toBe('Approved: pip human send packet')
  })

  it('never carries the route id into what a human reads', () => {
    // The route id belongs in the frontmatter refs, which is the machine
    // channel; the title is prose for the attorney reading the case later.
    for (const taskTitle of ['Send the request', null]) {
      expect(gateDecisionActivityTitle('approved', 'some-gate', taskTitle)).not.toMatch(/route-\d+/)
    }
  })
})
