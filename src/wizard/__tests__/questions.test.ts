import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'

import type { WizardAmbiguity, WizardAnswer } from '../types.ts'
import {
  generateWizardQuestions,
  nextWizardQuestion,
  readWizardQuestions,
  writeWizardQuestions,
} from '../questions.ts'

function ambiguity(overrides: Partial<WizardAmbiguity>): WizardAmbiguity {
  return {
    id: 'ambiguity-001',
    kind: 'unknown_classification',
    message: 'Shadow requires classification review before it can support a domain fact.',
    related_shadow_paths: ['.waypoint/shadows/documents/unknown/scan-001.md'],
    ...overrides,
  }
}

describe('Wizard clarification questions', () => {
  it('turns ambiguities into stable one-at-a-time questions', () => {
    const questions = generateWizardQuestions({
      domain: 'documents',
      ambiguities: [
        ambiguity({
          id: 'ambiguity-001',
          kind: 'duplicate_proposed_fact',
          fact: 'documents.contracts.signed_agreement',
          message: 'Multiple shadows propose the same fact; ask which evidence should be used before apply.',
          related_shadow_paths: [
            '.waypoint/shadows/documents/documents/agreement.md',
            '.waypoint/shadows/documents/documents/retainer.md',
          ],
        }),
        ambiguity({
          id: 'ambiguity-002',
          related_shadow_paths: ['.waypoint/shadows/documents/unknown/scan-001.md'],
        }),
      ],
    })

    expect(questions).toHaveLength(2)
    expect(questions[0]).toMatchObject({
      id: 'question-ambiguity-001',
      status: 'pending',
      domain: 'documents',
      fact: 'documents.contracts.signed_agreement',
      related_shadow_paths: [
        '.waypoint/shadows/documents/documents/agreement.md',
        '.waypoint/shadows/documents/documents/retainer.md',
      ],
    })
    expect(questions[0]?.prompt).toContain('Which shadow should support documents.contracts.signed_agreement?')
    expect(questions[1]).toMatchObject({
      id: 'question-ambiguity-002',
      status: 'pending',
      related_shadow_paths: ['.waypoint/shadows/documents/unknown/scan-001.md'],
    })
    expect(questions[1]?.prompt).toContain('What category should this shadow use?')
    expect(nextWizardQuestion(questions, [])?.id).toBe('question-ambiguity-001')
  })

  it('uses recorded answers to suppress already-resolved questions', () => {
    const questions = generateWizardQuestions({
      domain: 'documents',
      ambiguities: [
        ambiguity({ id: 'ambiguity-001' }),
        ambiguity({ id: 'ambiguity-002', related_shadow_paths: ['.waypoint/shadows/documents/unknown/scan-002.md'] }),
      ],
    })
    const answers: WizardAnswer[] = [
      {
        question_id: 'question-ambiguity-001',
        answer: 'Use correspondence, not intake.',
        answered_at: '2026-05-14T01:00:00.000Z',
      },
    ]

    expect(nextWizardQuestion(questions, answers)?.id).toBe('question-ambiguity-002')
    expect(generateWizardQuestions({ domain: 'documents', ambiguities: [ambiguity({ id: 'ambiguity-001' })], answers })).toEqual([])
  })

  it('persists questions under .waypoint/wizard/questions.yaml', async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), 'waypoint-wizard-questions-'))
    const questions = generateWizardQuestions({
      domain: 'documents',
      ambiguities: [ambiguity({ id: 'ambiguity-001' })],
    })

    const result = await writeWizardQuestions({ caseRoot, questions })
    const raw = await readFile(result.path, 'utf8')
    const parsed = parseYaml(raw) as { questions: unknown[] }

    expect(result.relative_path).toBe('.waypoint/wizard/questions.yaml')
    expect(parsed.questions).toHaveLength(1)
    await expect(readWizardQuestions({ caseRoot })).resolves.toEqual(questions)
  })
})
