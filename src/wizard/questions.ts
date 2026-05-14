import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import type { FirmVaultWizardAmbiguity } from './firmvault-review'
import { assertWithinRoot, safeWizardArtifactPath } from './paths'
import type { WizardAnswer, WizardDomain, WizardQuestion } from './types'

export interface GenerateWizardQuestionsInput {
  domain: WizardDomain
  ambiguities: FirmVaultWizardAmbiguity[]
  answers?: WizardAnswer[]
}

export interface WriteWizardQuestionsInput {
  caseRoot: string
  questions: WizardQuestion[]
}

export interface WriteWizardQuestionsResult {
  path: string
  relative_path: string
  questions_written: number
}

export interface ReadWizardQuestionsInput {
  caseRoot: string
}

const QUESTIONS_RELATIVE_PATH = safeWizardArtifactPath('questions.yaml')

export function generateWizardQuestions(input: GenerateWizardQuestionsInput): WizardQuestion[] {
  const answeredIds = new Set((input.answers ?? []).map((answer) => answer.question_id))

  return [...input.ambiguities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((ambiguity): WizardQuestion => {
      const question: WizardQuestion = {
        id: questionIdForAmbiguity(ambiguity.id),
        prompt: promptForAmbiguity(ambiguity),
        status: 'pending',
        domain: input.domain,
        related_shadow_paths: [...ambiguity.related_shadow_paths],
      }

      if (ambiguity.fact) {
        question.fact = ambiguity.fact
      }

      return question
    })
    .filter((question) => !answeredIds.has(question.id))
}

export function nextWizardQuestion(
  questions: WizardQuestion[],
  answers: WizardAnswer[],
): WizardQuestion | undefined {
  const answeredIds = new Set(answers.map((answer) => answer.question_id))

  return [...questions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .find((question) => question.status === 'pending' && !answeredIds.has(question.id))
}

export async function writeWizardQuestions(input: WriteWizardQuestionsInput): Promise<WriteWizardQuestionsResult> {
  const caseRoot = path.resolve(input.caseRoot)
  const outputPath = path.resolve(caseRoot, QUESTIONS_RELATIVE_PATH)
  assertWithinRoot(caseRoot, outputPath)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    yamlStringify({
      schema_version: 1,
      questions: input.questions,
    }),
    'utf8',
  )

  return {
    path: outputPath,
    relative_path: QUESTIONS_RELATIVE_PATH,
    questions_written: input.questions.length,
  }
}

export async function readWizardQuestions(input: ReadWizardQuestionsInput): Promise<WizardQuestion[]> {
  const caseRoot = path.resolve(input.caseRoot)
  const questionsPath = path.resolve(caseRoot, QUESTIONS_RELATIVE_PATH)
  assertWithinRoot(caseRoot, questionsPath)

  let raw: string
  try {
    raw = await readFile(questionsPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const parsed = yamlParse(raw) as { questions?: WizardQuestion[] } | null
  if (!parsed || !Array.isArray(parsed.questions)) {
    return []
  }

  return parsed.questions
}

function questionIdForAmbiguity(ambiguityId: string): string {
  return `question-${ambiguityId}`
}

function promptForAmbiguity(ambiguity: FirmVaultWizardAmbiguity): string {
  if (ambiguity.kind === 'duplicate_proposed_fact' && ambiguity.fact) {
    return `Which shadow should support ${ambiguity.fact}? Options: ${ambiguity.related_shadow_paths.join(', ')}`
  }

  if (ambiguity.kind === 'unknown_classification') {
    return `What FirmVault category should this shadow use? Shadow: ${ambiguity.related_shadow_paths.join(', ')}`
  }

  return ambiguity.message
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
