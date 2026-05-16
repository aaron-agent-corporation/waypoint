import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import {
  applyFirmVaultWizardPlan,
  buildWizardAdoptionPlan,
  buildWizardOrganizationPlan,
  createWizardShadows,
  detectFirmVaultWizardAmbiguities,
  generateFirmVaultMissingDocumentChecklist,
  generateWizardQuestions,
  isWizardDomain,
  nextWizardQuestion,
  parseWizardShadowMarkdown,
  proposeFirmVaultFactsFromShadows,
  readWizardAnswers,
  readWizardQuestions,
  recordWizardAnswer,
  scanWizardSource,
  writeWizardAdoptionPlan,
  writeWizardOrganizationPlan,
  writeWizardOrganizedCasePackage,
  writeWizardQuestions,
} from '@waypoint/core'

import type { WaypointCliIo } from '../bin'
import type {
  WizardAdoptionPlan,
  WizardDomain,
  WizardShadowRecord,
  WizardApplyGuidanceResult,
  WizardApplyStateResult,
  WizardOrganizationPlan,
} from '@waypoint/core'

type WizardFirmVaultStateModule = {
  readonly setFirmVaultCaseFact: (
    caseRoot: string,
    input: {
      readonly fact: string
      readonly status: string
      readonly evidence: readonly { readonly path: string; readonly kind?: string; readonly note?: string }[]
      readonly note?: string
    },
  ) => Promise<WizardApplyStateResult>
  readonly getFirmVaultCaseGuidance: (caseRoot: string) => Promise<WizardApplyGuidanceResult>
}

export async function runWizardCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args

  if (subcommand === 'scan') {
    return runWizardScan(args.slice(1), io)
  }

  if (subcommand === 'shadow') {
    return runWizardShadow(args.slice(1), io)
  }

  if (subcommand === 'organize') {
    return runWizardOrganize(args.slice(1), io)
  }

  if (subcommand === 'questions') {
    return runWizardQuestions(args.slice(1), io)
  }

  if (subcommand === 'answer') {
    return runWizardAnswer(args.slice(1), io)
  }

  if (subcommand === 'plan') {
    return runWizardPlan(args.slice(1), io)
  }

  if (subcommand === 'apply') {
    return runWizardApply(args.slice(1), io)
  }

  io.stderr(`Unknown Wizard subcommand: ${subcommand ?? '(none)'}`)
  io.stderr('Run waypoint wizard --help for usage.')
  return 1
}

export async function runWizardScan(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let domain: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const result = await scanWizardSource({ sourceRoot: sourcePath, domain })

    if (jsonOutput) {
      io.stdout(JSON.stringify(result, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Scan`)
      io.stdout(`=========================`)
      io.stdout(`Source: ${result.source_root}`)
      io.stdout(`Domain: ${result.domain}`)
      io.stdout(`Files found: ${result.files_found}`)
      if (result.warnings.length > 0) {
        io.stdout(`Warnings:`)
        for (const warning of result.warnings) {
          io.stdout(`  - ${warning}`)
        }
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardShadow(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let targetPath: string | undefined
  let domain: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--target' || arg === '-t') {
      targetPath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!targetPath) {
    io.stderr('Missing required option: --target <case-root>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const scan = await scanWizardSource({ sourceRoot: sourcePath, domain })
    const shadowResult = await createWizardShadows({ scan, targetRoot: targetPath, domain })
    const response = {
      domain,
      source_root: scan.source_root,
      target_root: shadowResult.target_root,
      shadows_created: shadowResult.shadows.length,
      shadow_paths: shadowResult.shadows.map((shadow) => shadow.shadow_path),
      shadows: shadowResult.shadows,
      warnings: scan.warnings,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Shadows`)
      io.stdout(`========================`)
      io.stdout(`Source: ${scan.source_root}`)
      io.stdout(`Target: ${shadowResult.target_root}`)
      io.stdout(`Domain: ${domain}`)
      io.stdout(`Shadows created: ${shadowResult.shadows.length}`)
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardOrganize(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let sourcePath: string | undefined
  let targetPath: string | undefined
  let domain: string | undefined
  let copyFiles = false
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--source' || arg === '-s') {
      sourcePath = args[++i]
    } else if (arg === '--target' || arg === '-t') {
      targetPath = args[++i]
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i]
    } else if (arg === '--copy-files') {
      copyFiles = true
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!sourcePath) {
    io.stderr('Missing required option: --source <path>')
    return 1
  }

  if (!targetPath) {
    io.stderr('Missing required option: --target <case-root>')
    return 1
  }

  if (!domain) {
    io.stderr('Missing required option: --domain <domain>')
    return 1
  }

  if (!isWizardDomain(domain)) {
    io.stderr(`Unsupported Wizard domain: ${domain}`)
    return 1
  }

  try {
    const scan = await scanWizardSource({ sourceRoot: sourcePath, domain })
    const shadowResult = await createWizardShadows({ scan, targetRoot: targetPath, domain })
    const shadows = shadowResult.shadows.map((shadow) => ({
      id: shadow.id,
      domain: shadow.domain,
      shadow_path: path.relative(shadowResult.target_root, shadow.shadow_path),
      source: shadow.source,
      classification: shadow.classification,
      review_status: shadow.review_status,
    }))
    const plan = buildWizardOrganizationPlan({
      domain,
      sourceRoot: scan.source_root,
      targetCaseRoot: shadowResult.target_root,
      shadows,
    })
    const result = await writeWizardOrganizedCasePackage({
      caseRoot: shadowResult.target_root,
      plan,
      copyFiles,
    })
    const response = {
      domain,
      source_root: scan.source_root,
      target_root: result.case_root,
      copy_files: copyFiles,
      shadows_created: shadowResult.shadows.length,
      documents_planned: result.documents_planned,
      source_files_copied: result.source_files_copied,
      documents_copied: result.documents_copied,
      artifacts: result.artifacts,
      warnings: [...scan.warnings, ...plan.warnings],
      legal_facts_from_organization: plan.legal_facts_from_organization,
      source_files_read_only: plan.source_files_read_only,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Organize`)
      io.stdout(`========================`)
      io.stdout(`Source: ${scan.source_root}`)
      io.stdout(`Target: ${result.case_root}`)
      io.stdout(`Domain: ${domain}`)
      io.stdout(`Shadows created: ${shadowResult.shadows.length}`)
      io.stdout(`Documents planned: ${result.documents_planned}`)
      io.stdout(`Source files copied: ${result.source_files_copied}`)
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardQuestions(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  try {
    const questions = await readWizardQuestions({ caseRoot: casePath })
    const answers = await readWizardAnswers({ caseRoot: casePath })
    const nextQuestion = nextWizardQuestion(questions, answers) ?? null
    const response = {
      case_root: casePath,
      questions_found: questions.length,
      answers_found: answers.length,
      pending_count: questions.filter((question) => question.status === 'pending' && !answers.some((answer) => answer.question_id === question.id)).length,
      next_question: nextQuestion,
      questions,
      answers,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Questions`)
      io.stdout(`=========================`)
      io.stdout(`Case: ${casePath}`)
      io.stdout(`Questions found: ${questions.length}`)
      if (nextQuestion) {
        io.stdout(`Next question: ${nextQuestion.id}`)
        io.stdout(nextQuestion.prompt)
      } else {
        io.stdout('Next question: none')
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardPlan(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let writePlanPath: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--write-plan') {
      writePlanPath = args[++i]
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  try {
    const caseRoot = path.resolve(casePath)
    const shadows = await readWizardShadowRecords(caseRoot)
    const organizationPlan = await readWizardOrganizationPlan(caseRoot)
    const domain = inferWizardPlanDomain(shadows, organizationPlan)
    const proposedFacts = domain === 'firmvault' ? proposeFirmVaultFactsFromShadows(shadows) : []
    const ambiguities = domain === 'firmvault'
      ? detectFirmVaultWizardAmbiguities({ shadows, proposedFacts })
      : []
    const existingAnswers = await readWizardAnswers({ caseRoot })
    const existingQuestions = await readWizardQuestions({ caseRoot })
    const generatedQuestions = generateWizardQuestions({ domain, ambiguities, answers: existingAnswers })
    const questions = mergeWizardQuestions(existingQuestions, generatedQuestions)
    if (questions.length > 0) {
      await writeWizardQuestions({ caseRoot, questions })
    }
    const missingExpectedDocuments = domain === 'firmvault'
      ? generateFirmVaultMissingDocumentChecklist({ shadows, proposedFacts })
      : []
    const plan = buildWizardAdoptionPlan({
      domain,
      sourceRoot: inferWizardSourceRoot(shadows),
      targetCaseRoot: caseRoot,
      shadows,
      proposedFacts,
      questions,
      answers: existingAnswers,
      missingExpectedDocuments,
      warnings: ambiguities.map((ambiguity) => ambiguity.message),
      organizationPlan: organizationPlan ?? undefined,
    })

    const writeResult = writePlanPath
      ? await writeWizardAdoptionPlanAtRelativePath(caseRoot, writePlanPath, plan)
      : await writeWizardAdoptionPlan({ caseRoot, plan })
    const response = {
      case_root: caseRoot,
      domain,
      plan_path: writeResult.path,
      plan_relative_path: writeResult.relative_path,
      shadows_count: shadows.length,
      proposed_facts_count: plan.proposed_facts.length,
      questions_count: plan.questions.length,
      answers_count: plan.answers.length,
      missing_expected_documents: plan.missing_expected_documents,
      warnings: plan.warnings,
      plan,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Adoption Plan`)
      io.stdout(`==============================`)
      io.stdout(`Case: ${caseRoot}`)
      io.stdout(`Plan: ${writeResult.path}`)
      io.stdout(`Shadows: ${shadows.length}`)
      io.stdout(`Proposed facts: ${plan.proposed_facts.length}`)
      io.stdout(`Questions: ${plan.questions.length}`)
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardApply(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let planPath = '.waypoint/wizard/adoption-plan.yaml'
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--plan') {
      planPath = args[++i] ?? ''
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  if (!isSafeWizardPlanPath(planPath)) {
    io.stderr('--plan must be a safe relative path under .waypoint/wizard/')
    return 1
  }

  try {
    const caseRoot = path.resolve(casePath)
    const resolvedPlanPath = path.resolve(caseRoot, planPath)
    if (!resolvedPlanPath.startsWith(`${caseRoot}${path.sep}`)) {
      throw new Error('--plan must stay inside the case root')
    }

    const rawPlan = await readFile(resolvedPlanPath, 'utf8')
    const plan = yamlParse(rawPlan) as WizardAdoptionPlan
    const firmVault = await importFirmVaultStateModule()
    const result = await applyFirmVaultWizardPlan({
      caseRoot,
      plan,
      setFirmVaultCaseFact: firmVault.setFirmVaultCaseFact,
      getFirmVaultCaseGuidance: firmVault.getFirmVaultCaseGuidance,
    })

    const response = {
      ...result,
      plan_path: resolvedPlanPath,
      plan_relative_path: planPath,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Apply`)
      io.stdout(`=====================`)
      io.stdout(`Case: ${caseRoot}`)
      io.stdout(`Plan: ${resolvedPlanPath}`)
      io.stdout(`Applied facts: ${result.applied_facts.length}`)
      io.stdout(`Skipped facts: ${result.skipped_facts.length}`)
      if (result.guidance) {
        io.stdout(`Guidance stage: ${result.guidance.stage}`)
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}

export async function runWizardAnswer(args: readonly string[], io: WaypointCliIo): Promise<number> {
  let casePath: string | undefined
  let questionId: string | undefined
  let answerText: string | undefined
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--case' || arg === '-c') {
      casePath = args[++i]
    } else if (arg === '--question' || arg === '-q') {
      questionId = args[++i]
    } else if (arg === '--answer' || arg === '-a') {
      answerText = args.slice(i + 1).filter((token) => token !== '--json' && token !== '-j').join(' ')
      jsonOutput = jsonOutput || args.slice(i + 1).some((token) => token === '--json' || token === '-j')
      break
    } else if (arg === '--json' || arg === '-j') {
      jsonOutput = true
    } else {
      io.stderr(`Unknown option: ${arg}`)
      return 1
    }
  }

  if (!casePath) {
    io.stderr('Missing required option: --case <case-root>')
    return 1
  }

  if (!questionId) {
    io.stderr('Missing required option: --question <id>')
    return 1
  }

  if (!answerText || answerText.trim().length === 0) {
    io.stderr('Missing required option: --answer <text>')
    return 1
  }

  try {
    const result = await recordWizardAnswer({
      caseRoot: casePath,
      questionId,
      answer: answerText,
    })
    const questions = await readWizardQuestions({ caseRoot: casePath })
    const answers = await readWizardAnswers({ caseRoot: casePath })
    const nextQuestion = nextWizardQuestion(questions, answers) ?? null
    const response = {
      case_root: casePath,
      answer_path: result.path,
      answer_relative_path: result.relative_path,
      answers_written: result.answers_written,
      answer: result.answer,
      next_question: nextQuestion,
    }

    if (jsonOutput) {
      io.stdout(JSON.stringify(response, null, 2))
    } else {
      io.stdout(`Waypoint Wizard Answer`)
      io.stdout(`======================`)
      io.stdout(`Case: ${casePath}`)
      io.stdout(`Question: ${result.answer.question_id}`)
      io.stdout(`Answers written: ${result.answers_written}`)
      if (nextQuestion) {
        io.stdout(`Next question: ${nextQuestion.id}`)
        io.stdout(nextQuestion.prompt)
      } else {
        io.stdout('Next question: none')
      }
    }

    return 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr(message)
    return 1
  }
}


async function readWizardShadowRecords(caseRoot: string): Promise<WizardShadowRecord[]> {
  const shadowsRoot = path.resolve(caseRoot, '.waypoint', 'shadows')
  const markdownPaths = await listMarkdownFiles(shadowsRoot)
  const records: WizardShadowRecord[] = []

  for (const markdownPath of markdownPaths) {
    const markdown = await readFile(markdownPath, 'utf8')
    const parsed = parseWizardShadowMarkdown(markdown)
    records.push({
      id: `shadow-${parsed.frontmatter.source.sha256.slice(0, 12)}`,
      domain: parsed.frontmatter.domain,
      shadow_path: parsed.frontmatter.waypoint.canonical_path,
      source: parsed.frontmatter.source,
      classification: parsed.frontmatter.classification,
      review_status: parsed.frontmatter.review.status,
    })
  }

  return records.sort((left, right) => left.shadow_path.localeCompare(right.shadow_path))
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function readWizardOrganizationPlan(caseRoot: string): Promise<WizardOrganizationPlan | null> {
  try {
    const rawPlan = await readFile(path.join(caseRoot, '.waypoint', 'wizard', 'organization-plan.yaml'), 'utf8')
    return yamlParse(rawPlan) as WizardOrganizationPlan
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function inferWizardPlanDomain(shadows: WizardShadowRecord[], organizationPlan?: WizardOrganizationPlan | null): WizardDomain {
  const [first] = shadows
  return organizationPlan?.domain ?? first?.domain ?? 'firmvault'
}

function inferWizardSourceRoot(shadows: WizardShadowRecord[]): string {
  const [first] = shadows
  if (!first) {
    return ''
  }

  const sourcePath = path.resolve(first.source.path)
  const relativePath = first.source.root_relative_path
  if (relativePath && sourcePath.endsWith(relativePath)) {
    const root = sourcePath.slice(0, sourcePath.length - relativePath.length)
    return root.endsWith(path.sep) ? root.slice(0, -1) : root
  }

  return path.dirname(sourcePath)
}

function mergeWizardQuestions(
  existingQuestions: Awaited<ReturnType<typeof readWizardQuestions>>,
  generatedQuestions: Awaited<ReturnType<typeof generateWizardQuestions>>,
): Awaited<ReturnType<typeof readWizardQuestions>> {
  const questionsById = new Map(existingQuestions.map((question) => [question.id, question]))
  for (const question of generatedQuestions) {
    if (!questionsById.has(question.id)) {
      questionsById.set(question.id, question)
    }
  }

  return Array.from(questionsById.values()).sort((left, right) => left.id.localeCompare(right.id))
}

async function writeWizardAdoptionPlanAtRelativePath(
  caseRoot: string,
  requestedPath: string,
  plan: Parameters<typeof writeWizardAdoptionPlan>[0]['plan'],
): Promise<{ path: string; relative_path: string; proposed_facts_written: number }> {
  if (path.isAbsolute(requestedPath) || requestedPath.includes('..') || !requestedPath.startsWith('.waypoint/wizard/')) {
    throw new Error('--write-plan must be a safe relative path under .waypoint/wizard/')
  }

  const outputPath = path.resolve(caseRoot, requestedPath)
  const resolvedCaseRoot = path.resolve(caseRoot)
  if (!outputPath.startsWith(`${resolvedCaseRoot}${path.sep}`)) {
    throw new Error('--write-plan must stay inside the case root')
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, yamlStringify(plan), 'utf8')
  return {
    path: outputPath,
    relative_path: requestedPath,
    proposed_facts_written: plan.proposed_facts.length,
  }
}

function isSafeWizardPlanPath(planPath: string): boolean {
  if (!planPath) return false
  if (path.isAbsolute(planPath)) return false
  const normalized = path.posix.normalize(planPath.split(path.sep).join('/'))
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return false
  return normalized === '.waypoint/wizard/adoption-plan.yaml' || normalized.startsWith('.waypoint/wizard/')
}

async function importFirmVaultStateModule(): Promise<WizardFirmVaultStateModule> {
  return await import('@waypoint/folder-host') as unknown as WizardFirmVaultStateModule
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
