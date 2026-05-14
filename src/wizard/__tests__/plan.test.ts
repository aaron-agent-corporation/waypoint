import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'

import { buildWizardAdoptionPlan, writeWizardAdoptionPlan } from '../plan'
import type { WizardAnswer, WizardProposedFact, WizardQuestion, WizardShadowRecord } from '../types'

function shadow(kind: string, filename: string): WizardShadowRecord {
  return {
    id: `shadow-${filename}`,
    domain: 'firmvault',
    shadow_path: `.waypoint/shadows/firmvault/${kind}/${filename}.md`,
    source: {
      path: `/tmp/source/${filename}.pdf`,
      root_relative_path: `${filename}.pdf`,
      sha256: `hash-${filename}`,
      size_bytes: 123,
      media_type: 'application/pdf',
      discovered_at: '2026-05-14T00:00:00.000Z',
    },
    classification: {
      kind,
      confidence: kind === 'unknown' ? 'low' : 'high',
      rationale: `test ${kind}`,
      review_required: kind === 'unknown',
    },
    review_status: 'pending',
  }
}

function proposedFact(overrides: Partial<WizardProposedFact> = {}): WizardProposedFact {
  return {
    id: 'proposed-fact-001',
    fact: 'client.contracts.fee_agreement',
    status: 'proposed',
    evidence_shadow: '.waypoint/shadows/firmvault/contracts/Fee Agreement.md',
    source_path: '/tmp/source/Fee Agreement.pdf',
    confidence: 'high',
    review_required: true,
    approved: true,
    ...overrides,
  }
}

describe('Wizard adoption plans', () => {
  it('builds a durable safe adoption plan from shadows, facts, questions, answers, and review items', () => {
    const questions: WizardQuestion[] = [
      {
        id: 'question-ambiguity-001',
        prompt: 'What FirmVault category should this shadow use?',
        status: 'pending',
        domain: 'firmvault',
        related_shadow_paths: ['.waypoint/shadows/firmvault/unknown/scan-001.md'],
      },
    ]
    const answers: WizardAnswer[] = [
      {
        question_id: 'question-ambiguity-002',
        answer: 'This is correspondence.',
        answered_at: '2026-05-14T01:00:00.000Z',
      },
    ]

    const plan = buildWizardAdoptionPlan({
      domain: 'firmvault',
      sourceRoot: '/tmp/source',
      targetCaseRoot: '/tmp/case',
      shadows: [shadow('contracts', 'Fee Agreement'), shadow('unknown', 'scan-001')],
      proposedFacts: [proposedFact()],
      questions,
      answers,
      missingExpectedDocuments: ['client.authorizations.hipaa'],
      warnings: ['Review unknown classifications before apply.'],
    })

    expect(plan).toMatchObject({
      schema_version: 1,
      domain: 'firmvault',
      source_root: '/tmp/source',
      target_case_root: '/tmp/case',
      missing_expected_documents: ['client.authorizations.hipaa'],
      warnings: ['Review unknown classifications before apply.'],
      safety: {
        external_side_effects: 'forbidden',
        source_mutation: 'forbidden',
        legal_facts_from_shadows: 'forbidden',
      },
    })
    expect(plan.shadows).toHaveLength(2)
    expect(plan.questions).toEqual(questions)
    expect(plan.answers).toEqual(answers)
    expect(plan.proposed_facts).toHaveLength(1)
    expect(plan.proposed_facts[0]).toMatchObject({
      fact: 'client.contracts.fee_agreement',
      approved: false,
      review_required: true,
    })
  })

  it('writes adoption-plan.yaml under the case .waypoint/wizard directory', async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-wizard-plan-'))
    const plan = buildWizardAdoptionPlan({
      domain: 'firmvault',
      sourceRoot: '/tmp/source',
      targetCaseRoot: caseRoot,
      shadows: [shadow('contracts', 'Fee Agreement')],
      proposedFacts: [proposedFact()],
      questions: [],
      answers: [],
      missingExpectedDocuments: [],
      warnings: [],
    })

    const result = await writeWizardAdoptionPlan({ caseRoot, plan })
    const raw = await readFile(result.path, 'utf8')
    const parsed = parseYaml(raw) as { schema_version: number; proposed_facts: WizardProposedFact[] }

    expect(result.relative_path).toBe('.waypoint/wizard/adoption-plan.yaml')
    expect(result.proposed_facts_written).toBe(1)
    expect(parsed.schema_version).toBe(1)
    expect(parsed.proposed_facts[0]?.approved).toBe(false)
  })
})
