import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  adoptFirmVaultLegacyCase,
  inspectFirmVaultLegacyCase,
  previewFirmVaultCaseAdoption,
} from './adoption.ts'
import { getFirmVaultCaseGuidance } from './state.ts'

async function tempLegacyCaseRoot(name = 'legacy-smith-case'): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'waypoint-firmvault-adoption-'))
  const root = join(parent, name)
  await mkdir(root, { recursive: true })
  return root
}

async function writeLegacyFile(root: string, path: string, content = 'fixture'): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true })
  await writeFile(join(root, path), content, 'utf8')
}

describe('FirmVault existing case adoption', () => {
  it('inspects sparse source-backed folders without mutating them', async () => {
    const root = await tempLegacyCaseRoot('amaree-stewart-premise-06-17-2022')
    await writeLegacyFile(root, 'Dashboard.md', '# Amaree Stewart\n')
    await writeLegacyFile(root, 'documents/liens/lien-notice.md', '---\ndocument_category: liens\ndocument_type: lien_notice\n---\n# Lien\n')

    const inspection = await inspectFirmVaultLegacyCase(root)

    expect(inspection.schema_version).toBe(1)
    expect(inspection.mutates_state).toBe(false)
    expect(inspection.case_slug).toBe('amaree-stewart-premise-06-17-2022')
    expect(inspection.legacy_state.present).toBe(false)
    expect(inspection.waypoint_state.present).toBe(false)
    expect(inspection.source_counts.by_extension['.md']).toBe(2)
    expect(inspection.source_counts.by_top_level.documents).toBe(1)
    expect(inspection.document_frontmatter.categories.liens).toBe(1)
    expect(inspection.warnings).toContain('legacy state.yaml not found')
    expect(existsSync(join(root, '.waypoint'))).toBe(false)
  })

  it('previews conservative adoption proposals from real folder signals', async () => {
    const root = await tempLegacyCaseRoot('abigail-whaley')
    await writeLegacyFile(root, 'state.yaml', 'current_phase: phase_3_demand\nlandmarks:\n  full_intake_complete: true\n')
    await writeLegacyFile(root, 'Dashboard.md', '# Abigail Whaley\n')
    await writeLegacyFile(root, 'claims/bi-claim.md', '---\nclaim_type: bodily_injury\nstatus: open\n---\n# BI claim\n')
    await writeLegacyFile(root, 'documents/police-reports/crash-report.md', '---\ndocument_category: police-reports\ndocument_type: police_report\n---\n# Police report\n')
    await writeLegacyFile(root, 'documents/medical/provider-record.md', '---\ndocument_category: medical\nrecords_received: true\nbills_received: true\n---\n# Medical\n')
    await writeLegacyFile(root, 'demand/readiness.md', '# Demand readiness\n')

    const preview = await previewFirmVaultCaseAdoption(root)

    expect(preview.schema_version).toBe(1)
    expect(preview.mutates_state).toBe(false)
    expect(preview.legacy_phase).toBe('phase_3_demand')
    expect(preview.waypoint_state_present).toBe(false)
    expect(preview.proposed_facts.map((proposal) => proposal.fact)).toEqual(expect.arrayContaining([
      'case.setup',
      'accident.police_report',
      'insurance.bi.carrier_identified',
      'providers.setup',
      'records.processing',
      'records.received',
      'demand.readiness.materials',
    ]))
    const police = preview.proposed_facts.find((proposal) => proposal.fact === 'accident.police_report')
    expect(police).toMatchObject({
      suggested_status: 'received',
      confidence: 'high',
      safe_to_apply_automatically: true,
    })
    expect(police?.evidence_candidates[0]?.path).toBe('documents/police-reports/crash-report.md')
    expect(preview.blocked_or_needs_confirmation.some((item) => item.fact === 'demand.send')).toBe(true)
  })

  it('initializes Waypoint state and applies only safe evidence-backed proposals through state APIs', async () => {
    const root = await tempLegacyCaseRoot('brandon-robinson-jr')
    await writeLegacyFile(root, 'state.yaml', 'current_phase: phase_2_treatment\n')
    await writeLegacyFile(root, 'Dashboard.md', '# Brandon Robinson Jr\n')
    await writeLegacyFile(root, 'documents/police-reports/report.md', '---\ndocument_category: police-reports\n---\n')
    await writeLegacyFile(root, 'documents/insurance/bi-claim.md', '---\ndocument_category: insurance\n---\n')
    await writeLegacyFile(root, 'documents/medical/records.md', '---\ndocument_category: medical\nrecords_received: true\nbills_received: true\n---\n')

    const result = await adoptFirmVaultLegacyCase(root, { caseType: 'personal_injury', applySafe: true })

    expect(result.schema_version).toBe(1)
    expect(result.mutates_state).toBe(true)
    expect(result.case_slug).toBe('brandon-robinson-jr')
    expect(result.applied_facts.map((item) => item.fact)).toEqual(expect.arrayContaining([
      'case.setup',
      'accident.police_report',
      'insurance.bi.carrier_identified',
      'providers.setup',
      'records.processing',
      'records.received',
    ]))
    expect(result.skipped_facts.some((item) => item.fact === 'client.intake')).toBe(true)
    expect(result.landmarks_after.satisfied).toBeGreaterThan(result.landmarks_before.satisfied)

    const events = await readFile(join(root, '.waypoint/firmvault/events.jsonl'), 'utf8')
    expect(events).toContain('firmvault.case_state.initialized')
    expect(events).toContain('firmvault.state.updated')
    const accident = yamlParse(await readFile(join(root, '.waypoint/firmvault/accident.yaml'), 'utf8')) as any
    expect(accident.accident.police_report.status).toBe('received')
    expect(accident.accident.police_report.evidence[0].path).toBe('documents/police-reports/report.md')
  })

  it('surfaces needs_adoption guidance for legacy folders before Waypoint state exists', async () => {
    const root = await tempLegacyCaseRoot('legacy-needs-adoption')
    await writeLegacyFile(root, 'Dashboard.md', '# Legacy Case\n')
    await writeLegacyFile(root, 'documents/medical/records.md', '---\ndocument_category: medical\n---\n')

    const guidance = await getFirmVaultCaseGuidance(root)

    expect(guidance.stage).toBe('needs_adoption')
    expect(guidance.landmarks).toEqual({ satisfied: 0, total: 82 })
    expect(guidance.next_actions.required[0]).toMatchObject({
      fact: 'firmvault.adopt.preview',
      command_hint: 'waypoint firmvault adopt preview --json',
    })
    expect(guidance.warnings).toContain('Waypoint FirmVault state is missing; run adoption preview before normal guidance.')
  })
})
