import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { stringify as yamlStringify } from 'yaml'

import { assertWithinRoot, safeWizardArtifactPath } from './paths'
import type {
  WizardAdoptionPlan,
  WizardAnswer,
  WizardDomain,
  WizardProposedFact,
  WizardQuestion,
  WizardShadowRecord,
} from './types'

export interface BuildWizardAdoptionPlanInput {
  domain: WizardDomain
  sourceRoot: string
  targetCaseRoot: string
  shadows: WizardShadowRecord[]
  proposedFacts: WizardProposedFact[]
  questions: WizardQuestion[]
  answers: WizardAnswer[]
  missingExpectedDocuments: string[]
  warnings: string[]
}

export interface WriteWizardAdoptionPlanInput {
  caseRoot: string
  plan: WizardAdoptionPlan
}

export interface WriteWizardAdoptionPlanResult {
  path: string
  relative_path: string
  proposed_facts_written: number
}

const ADOPTION_PLAN_RELATIVE_PATH = safeWizardArtifactPath('adoption-plan.yaml')

export function buildWizardAdoptionPlan(input: BuildWizardAdoptionPlanInput): WizardAdoptionPlan {
  return {
    schema_version: 1,
    domain: input.domain,
    source_root: input.sourceRoot,
    target_case_root: input.targetCaseRoot,
    shadows: [...input.shadows],
    proposed_facts: input.proposedFacts.map((fact) => ({
      ...fact,
      approved: false,
    })),
    questions: [...input.questions],
    answers: [...input.answers],
    missing_expected_documents: [...input.missingExpectedDocuments].sort(),
    warnings: [...input.warnings],
    safety: {
      external_side_effects: 'forbidden',
      source_mutation: 'forbidden',
      legal_facts_from_shadows: 'forbidden',
    },
  }
}

export async function writeWizardAdoptionPlan(
  input: WriteWizardAdoptionPlanInput,
): Promise<WriteWizardAdoptionPlanResult> {
  const caseRoot = path.resolve(input.caseRoot)
  const outputPath = path.resolve(caseRoot, ADOPTION_PLAN_RELATIVE_PATH)
  assertWithinRoot(caseRoot, outputPath)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, yamlStringify(input.plan), 'utf8')

  return {
    path: outputPath,
    relative_path: ADOPTION_PLAN_RELATIVE_PATH,
    proposed_facts_written: input.plan.proposed_facts.length,
  }
}
