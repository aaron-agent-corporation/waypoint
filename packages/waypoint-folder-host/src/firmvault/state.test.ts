import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  FIRMVAULT_CASE_STATE_FILES,
  FIRMVAULT_LANDMARK_SLUGS,
  initFirmVaultCaseState,
  readFirmVaultLandmarkProjection,
} from './state.ts'

async function tempCaseRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-state-'))
}

async function patchYaml(path: string, patcher: (value: any) => void): Promise<void> {
  const parsed = yamlParse(await readFile(path, 'utf8')) as any
  patcher(parsed)
  await writeFile(path, yamlStringify(parsed), 'utf8')
}

describe('FirmVault case state contract', () => {
  it('initializes product-owned FirmVault YAML state with all landmarks unsatisfied', async () => {
    const root = await tempCaseRoot()

    const result = await initFirmVaultCaseState(root, {
      caseType: 'personal_injury',
      caseSlug: 'smith-v-acme',
      now: new Date('2026-05-08T00:00:00.000Z'),
    })

    expect(result.stateDir).toBe(join(root, '.waypoint', 'firmvault'))
    for (const relativePath of FIRMVAULT_CASE_STATE_FILES) {
      expect(existsSync(join(result.stateDir, relativePath))).toBe(true)
    }

    const projection = await readFirmVaultLandmarkProjection(root)
    expect(Object.keys(projection.landmarks)).toEqual([...FIRMVAULT_LANDMARK_SLUGS])
    for (const slug of FIRMVAULT_LANDMARK_SLUGS) {
      expect(projection.landmarks[slug].satisfied).toBe(false)
      expect(projection.landmarks[slug].evidence).toEqual([])
    }
    expect(projection.warnings).toEqual([])
  })

  it('projects full_intake_complete from explicit client statuses and existing evidence', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'client'), { recursive: true })
    await mkdir(join(root, 'documents', 'signed'), { recursive: true })
    await writeFile(join(root, 'client', 'intake.md'), '# Intake complete\n', 'utf8')
    await writeFile(join(root, 'documents', 'signed', 'fee-agreement.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'signed', 'hipaa.pdf'), 'fixture', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'client.yaml'), (clientState) => {
      clientState.client.intake.status = 'complete'
      clientState.client.intake.evidence = [{ path: 'client/intake.md' }]
      clientState.client.contracts.fee_agreement.status = 'signed'
      clientState.client.contracts.fee_agreement.evidence = [{ path: 'documents/signed/fee-agreement.pdf' }]
      clientState.client.authorizations.hipaa.status = 'signed'
      clientState.client.authorizations.hipaa.evidence = [{ path: 'documents/signed/hipaa.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.full_intake_complete).toMatchObject({ satisfied: true })
    expect(projection.landmarks.full_intake_complete.evidence.map((item) => item.path)).toEqual([
      'client/intake.md',
      'documents/signed/fee-agreement.pdf',
      'documents/signed/hipaa.pdf',
    ])
  })

  it('projects demand and settlement landmarks from explicit status fields', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'documents', 'outgoing'), { recursive: true })
    await mkdir(join(root, 'documents', 'settlement'), { recursive: true })
    await writeFile(join(root, 'documents', 'outgoing', 'demand.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'settlement', 'release.pdf'), 'fixture', 'utf8')
    await writeFile(join(root, 'documents', 'settlement', 'distribution.pdf'), 'fixture', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'demand.yaml'), (demandState) => {
      demandState.demand.status = 'sent'
      demandState.demand.evidence = [{ path: 'documents/outgoing/demand.pdf' }]
    })
    await patchYaml(join(root, '.waypoint', 'firmvault', 'settlement.yaml'), (settlementState) => {
      settlementState.settlement.status = 'signed'
      settlementState.settlement.evidence = [{ path: 'documents/settlement/release.pdf' }]
      settlementState.settlement.distribution.status = 'complete'
      settlementState.settlement.distribution.evidence = [{ path: 'documents/settlement/distribution.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.demand_sent.satisfied).toBe(true)
    expect(projection.landmarks.settlement_reached.satisfied).toBe(true)
    expect(projection.landmarks.final_distribution_complete.satisfied).toBe(true)
  })

  it('projects BI and PIP insurance landmarks from explicit insurance state fields', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'insurance'), { recursive: true })
    await mkdir(join(root, 'documents', 'generated', 'insurance'), { recursive: true })
    await mkdir(join(root, 'documents', 'sent', 'insurance'), { recursive: true })
    await mkdir(join(root, 'documents', 'received', 'insurance'), { recursive: true })
    await writeFile(join(root, 'insurance', 'bi-acme.md'), '# BI carrier\n', 'utf8')
    await writeFile(join(root, 'documents', 'generated', 'insurance', 'bi-acme-lor.md'), '# BI LOR\n', 'utf8')
    await writeFile(join(root, 'documents', 'sent', 'insurance', 'bi-acme-lor-sent.md'), '# Sent BI LOR\n', 'utf8')
    await writeFile(join(root, 'documents', 'received', 'insurance', 'bi-ack.md'), '# BI ack\n', 'utf8')
    await writeFile(join(root, 'insurance', 'pip-acme.md'), '# PIP carrier\n', 'utf8')
    await writeFile(join(root, 'documents', 'generated', 'insurance', 'pip-acme-application.md'), '# PIP app\n', 'utf8')
    await writeFile(join(root, 'documents', 'generated', 'insurance', 'pip-acme-lor.md'), '# PIP LOR\n', 'utf8')
    await writeFile(join(root, 'documents', 'sent', 'insurance', 'pip-acme-application-sent.md'), '# Sent PIP app\n', 'utf8')
    await writeFile(join(root, 'documents', 'sent', 'insurance', 'pip-acme-lor-sent.md'), '# Sent PIP LOR\n', 'utf8')
    await writeFile(join(root, 'documents', 'received', 'insurance', 'pip-ack.md'), '# PIP ack\n', 'utf8')
    await writeFile(join(root, 'documents', 'received', 'insurance', 'pip-approval.md'), '# PIP approval\n', 'utf8')
    await writeFile(join(root, 'documents', 'received', 'insurance', 'pip-status.md'), '# PIP status\n', 'utf8')
    await writeFile(join(root, 'documents', 'received', 'insurance', 'pip-exhausted.md'), '# PIP exhausted\n', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'insurance.yaml'), (insuranceState) => {
      insuranceState.insurance.bi.carrier_identified.status = 'identified'
      insuranceState.insurance.bi.carrier_identified.evidence = [{ path: 'insurance/bi-acme.md' }]
      insuranceState.insurance.bi.lor.prepared.status = 'prepared'
      insuranceState.insurance.bi.lor.prepared.evidence = [{ path: 'documents/generated/insurance/bi-acme-lor.md' }]
      insuranceState.insurance.bi.lor.sent.status = 'sent'
      insuranceState.insurance.bi.lor.sent.evidence = [{ path: 'documents/sent/insurance/bi-acme-lor-sent.md' }]
      insuranceState.insurance.bi.acknowledgment.status = 'checked'
      insuranceState.insurance.bi.acknowledgment.evidence = [{ path: 'documents/received/insurance/bi-ack.md' }]
      insuranceState.insurance.pip.track.status = 'active'
      insuranceState.insurance.pip.track.evidence = [{ path: 'insurance/pip-acme.md' }]
      insuranceState.insurance.pip.carrier_identified.status = 'identified'
      insuranceState.insurance.pip.carrier_identified.evidence = [{ path: 'insurance/pip-acme.md' }]
      insuranceState.insurance.pip.application.prepared.status = 'prepared'
      insuranceState.insurance.pip.application.prepared.evidence = [{ path: 'documents/generated/insurance/pip-acme-application.md' }]
      insuranceState.insurance.pip.lor.prepared.status = 'prepared'
      insuranceState.insurance.pip.lor.prepared.evidence = [{ path: 'documents/generated/insurance/pip-acme-lor.md' }]
      insuranceState.insurance.pip.application.filed.status = 'filed'
      insuranceState.insurance.pip.application.filed.evidence = [{ path: 'documents/sent/insurance/pip-acme-application-sent.md' }]
      insuranceState.insurance.pip.lor.sent.status = 'sent'
      insuranceState.insurance.pip.lor.sent.evidence = [{ path: 'documents/sent/insurance/pip-acme-lor-sent.md' }]
      insuranceState.insurance.pip.acknowledgment.status = 'checked'
      insuranceState.insurance.pip.acknowledgment.evidence = [{ path: 'documents/received/insurance/pip-ack.md' }]
      insuranceState.insurance.pip.approval.status = 'approved'
      insuranceState.insurance.pip.approval.evidence = [{ path: 'documents/received/insurance/pip-approval.md' }]
      insuranceState.insurance.pip.status_check.status = 'checked'
      insuranceState.insurance.pip.status_check.evidence = [{ path: 'documents/received/insurance/pip-status.md' }]
      insuranceState.insurance.pip.benefits.status = 'exhausted'
      insuranceState.insurance.pip.benefits.evidence = [{ path: 'documents/received/insurance/pip-exhausted.md' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    for (const slug of [
      'at_fault_insurance_identified',
      'bi_lor_prepared',
      'bi_lor_sent',
      'bi_acknowledgment_checked',
      'pip_track_active',
      'pip_carrier_identified',
      'pip_application_prepared',
      'pip_lor_prepared',
      'pip_application_filed',
      'pip_lor_sent',
      'pip_acknowledgment_checked',
      'pip_approved',
      'pip_status_checked',
      'pip_benefits_exhausted',
    ] as const) {
      expect(projection.landmarks[slug].satisfied, slug).toBe(true)
      expect(projection.landmarks[slug].evidence.length, slug).toBeGreaterThan(0)
    }
  })


  it('projects treatment-status and early lien landmarks from explicit provider and lien state fields', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    await mkdir(join(root, 'medical-providers', 'acme-chiropractic'), { recursive: true })
    await mkdir(join(root, 'liens'), { recursive: true })
    await mkdir(join(root, 'activity'), { recursive: true })
    await writeFile(join(root, 'medical-providers', 'acme-chiropractic', 'treatment.md'), '# Treatment status\n', 'utf8')
    await writeFile(join(root, 'activity', 'provider-status-review.md'), '# Provider status review\n', 'utf8')
    await writeFile(join(root, 'liens', 'health-plan.md'), '# Health plan lien\n', 'utf8')
    await writeFile(join(root, 'activity', 'early-lien-review.md'), '# Early lien review\n', 'utf8')

    await patchYaml(join(root, '.waypoint', 'firmvault', 'providers.yaml'), (providersState) => {
      providersState.treatment_status = {
        provider_list_reviewed: { status: 'reviewed', evidence: [{ path: 'activity/provider-status-review.md' }] },
        provider_status_updated: { status: 'updated', evidence: [{ path: 'medical-providers/acme-chiropractic/treatment.md' }] },
        provider_followups_flagged: { status: 'flagged', evidence: [{ path: 'activity/provider-status-review.md' }] },
        human_review: { status: 'reviewed', evidence: [{ path: 'activity/provider-status-review.md' }] },
        treatment_complete: { status: 'complete', evidence: [{ path: 'medical-providers/acme-chiropractic/treatment.md' }] },
      }
    })
    await patchYaml(join(root, '.waypoint', 'firmvault', 'liens.yaml'), (liensState) => {
      liensState.early_identification.health_coverage.status = 'categorized'
      liensState.early_identification.health_coverage.evidence = [{ path: 'activity/early-lien-review.md' }]
      liensState.early_identification.clues_reviewed.status = 'reviewed'
      liensState.early_identification.clues_reviewed.evidence = [{ path: 'activity/early-lien-review.md' }]
      liensState.early_identification.liens.status = 'identified'
      liensState.early_identification.liens.evidence = [{ path: 'liens/health-plan.md' }]
      liensState.early_identification.inventory_review.status = 'reviewed'
      liensState.early_identification.inventory_review.evidence = [{ path: 'activity/early-lien-review.md' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)
    for (const slug of [
      'provider_list_reviewed',
      'provider_status_updated',
      'provider_followups_flagged',
      'treatment_status_reviewed',
      'treatment_complete',
      'health_coverage_categorized',
      'lien_clues_reviewed',
      'liens_identified',
      'lien_inventory_reviewed',
    ] as const) {
      expect(projection.landmarks[slug].satisfied, slug).toBe(true)
      expect(projection.landmarks[slug].evidence.length, slug).toBeGreaterThan(0)
    }
  })


  it('keeps landmarks unsatisfied when explicit status lacks existing evidence', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })

    await patchYaml(join(root, '.waypoint', 'firmvault', 'demand.yaml'), (demandState) => {
      demandState.demand.status = 'sent'
      demandState.demand.evidence = [{ path: 'documents/outgoing/missing-demand.pdf' }]
    })

    const projection = await readFirmVaultLandmarkProjection(root)

    expect(projection.landmarks.demand_sent.satisfied).toBe(false)
    expect(projection.landmarks.demand_sent.evidence).toEqual([])
    expect(projection.warnings).toContain(
      'demand_sent evidence path does not exist: documents/outgoing/missing-demand.pdf',
    )
  })
})
