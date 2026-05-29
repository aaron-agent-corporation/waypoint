import { describe, expect, it } from 'vitest'

import type { WaypointBeadsIssueSnapshotReader } from '../beads/cli-client.ts'
import {
  formatWaypointGasCityMetadataVerificationFailure,
  verifyWaypointGasCityRouteMetadata,
} from './metadata.ts'

describe('verifyWaypointGasCityRouteMetadata', () => {
  it('passes when the routed Bead carries Gas City metadata', async () => {
    const verification = await verifyWaypointGasCityRouteMetadata({
      issueReader: createIssueReader({
        id: 'bd-001',
        title: 'Waypoint route',
        status: 'open',
        metadata: {
          'gc.routed_to': 'waypoint/codex',
          molecule_id: 'wpg-9ay',
        },
      }),
      beadId: 'bd-001',
      target: 'waypoint/codex',
    })

    expect(verification).toMatchObject({
      ok: true,
      beadId: 'bd-001',
      target: 'waypoint/codex',
      routedTo: 'waypoint/codex',
      moleculeId: 'wpg-9ay',
      diagnostics: [],
    })
  })

  it('returns repair guidance when route metadata is missing', async () => {
    const verification = await verifyWaypointGasCityRouteMetadata({
      issueReader: createIssueReader({
        id: 'bd-001',
        title: 'Waypoint route',
        status: 'open',
        metadata: {
          waypoint: { route_id: 'route-001' },
        },
      }),
      beadId: 'bd-001',
      target: 'waypoint/codex',
      expectedMoleculeId: 'wpg-9ay',
    })

    expect(verification.ok).toBe(false)
    expect(formatWaypointGasCityMetadataVerificationFailure(verification)).toContain(
      'bd update bd-001 --set-metadata gc.routed_to=waypoint/codex --set-metadata molecule_id=wpg-9ay',
    )
  })

  it('throws when the routed Bead cannot be read from Beads snapshots', async () => {
    await expect(
      verifyWaypointGasCityRouteMetadata({
        issueReader: createIssueReader({
          id: 'bd-other',
          title: 'Other',
          status: 'open',
          metadata: {},
        }),
        beadId: 'bd-001',
        target: 'waypoint/codex',
      }),
    ).rejects.toThrow('Beads issue was not found: bd-001')
  })
})

function createIssueReader(issue: {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly assignee?: string
  readonly metadata?: unknown
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return {
        issues: [issue],
        dependencies: [],
      }
    },
  }
}
