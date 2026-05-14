import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { initFirmVaultCaseState, readFirmVaultCaseState, readFirmVaultLandmarkProjection, setFirmVaultCaseFact, getFirmVaultCaseGuidance } from '@waypoint/folder-host'
import { applyFirmVaultWizardPlan } from '../firmvault-apply'
import type { WizardAdoptionPlan } from '../types'

describe('applyFirmVaultWizardPlan', () => {
  it('applies approved FirmVault proposed facts through the safe state API and skips unapproved facts', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-apply-case-'))
    await initFirmVaultCaseState(caseRoot, { caseType: 'personal_injury', caseSlug: 'wizard-apply-case' })

    const feeAgreementShadow = '.waypoint/shadows/firmvault/contracts/fee-agreement.md'
    const hipaaShadow = '.waypoint/shadows/firmvault/authorizations/hipaa-authorization.md'
    await mkdir(join(caseRoot, '.waypoint', 'shadows', 'firmvault', 'contracts'), { recursive: true })
    await mkdir(join(caseRoot, '.waypoint', 'shadows', 'firmvault', 'authorizations'), { recursive: true })
    await writeFile(join(caseRoot, feeAgreementShadow), 'fee agreement shadow', 'utf8')
    await writeFile(join(caseRoot, hipaaShadow), 'hipaa shadow', 'utf8')

    const before = await readFirmVaultLandmarkProjection(caseRoot)
    expect(before.landmarks.full_intake_complete?.satisfied).toBe(false)

    const plan: WizardAdoptionPlan = {
      schema_version: 1,
      domain: 'firmvault',
      source_root: '/read-only/source',
      target_case_root: caseRoot,
      source_inventory: { files_found: 2, files: [] },
      shadow_map: [],
      classifications: [],
      shadows: [],
      proposed_facts: [
        {
          id: 'fact-fee-agreement',
          fact: 'client.contracts.fee_agreement',
          status: 'signed',
          evidence_shadow: feeAgreementShadow,
          source_path: '/read-only/source/Fee Agreement.pdf',
          confidence: 'high',
          review_required: true,
          approved: true,
        },
        {
          id: 'fact-hipaa',
          fact: 'client.authorizations.hipaa',
          status: 'signed',
          evidence_shadow: hipaaShadow,
          source_path: '/read-only/source/HIPAA Authorization.pdf',
          confidence: 'high',
          review_required: true,
          approved: false,
        },
      ],
      questions: [],
      answers: [],
      q_and_a: { questions_total: 0, questions_pending: 0, answers_total: 0 },
      missing_expected_documents: [],
      warnings: [],
      approvals: { approved_facts: 1, unapproved_facts: 1 },
      safety: {
        external_side_effects: 'forbidden',
        source_mutation: 'forbidden',
        legal_facts_from_shadows: 'forbidden',
      },
    }

    const result = await applyFirmVaultWizardPlan({
      caseRoot,
      plan,
      setFirmVaultCaseFact,
      getFirmVaultCaseGuidance,
    })

    expect(result.applied_facts).toHaveLength(1)
    expect(result.applied_facts[0]).toMatchObject({
      id: 'fact-fee-agreement',
      fact: 'client.contracts.fee_agreement',
      status: 'signed',
      evidence_shadow: feeAgreementShadow,
      source_path: '/read-only/source/Fee Agreement.pdf',
    })
    expect(result.applied_facts[0]?.state_result.evidence).toEqual([
      expect.objectContaining({ path: feeAgreementShadow, kind: 'wizard_shadow' }),
    ])
    expect(result.skipped_facts).toEqual([
      expect.objectContaining({ id: 'fact-hipaa', fact: 'client.authorizations.hipaa', reason: 'unapproved' }),
    ])
    expect(result.guidance?.stage).toBeTruthy()

    const clientState = await readFirmVaultCaseState(caseRoot, { section: 'client' })
    const client = clientState.state.client as {
      contracts?: { fee_agreement?: { evidence?: Array<{ path: string }> } }
      authorizations?: { hipaa?: { evidence?: Array<{ path: string }> } }
    }
    expect(client.contracts?.fee_agreement?.evidence?.map((entry) => entry.path)).toContain(feeAgreementShadow)
    expect(client.authorizations?.hipaa?.evidence?.map((entry) => entry.path) ?? []).not.toContain(hipaaShadow)

    const after = await readFirmVaultLandmarkProjection(caseRoot)
    expect(after.landmarks.full_intake_complete?.satisfied).toBe(false)
  })
})
