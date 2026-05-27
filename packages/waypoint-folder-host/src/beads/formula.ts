import type { BundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  compileQuestToBeadsGraph,
  type CompileQuestToBeadsGraphInput,
  type WaypointBeadsGraph,
  type WaypointBeadsIssueSpec,
  type WaypointBeadsMetadata,
  type WaypointBeadsSubject,
} from './compiler.ts'
import { describeWaypointBeadsIssue } from './descriptions.ts'

export type WaypointBeadsFormulaType = 'workflow'
export type WaypointBeadsFormulaStepType = 'task' | 'bug' | 'feature' | 'epic' | 'chore'

export interface WaypointBeadsFormulaVar {
  readonly description?: string
  readonly default?: string
  readonly required?: true
  readonly type?: 'string'
}

export interface WaypointBeadsFormulaStep {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly type?: WaypointBeadsFormulaStepType
  readonly labels?: readonly string[]
  readonly metadata?: WaypointBeadsMetadata
  readonly needs?: readonly string[]
}

export interface WaypointBeadsFormula {
  readonly formula: string
  readonly description?: string
  readonly version: 1
  readonly type: WaypointBeadsFormulaType
  readonly pour: true
  readonly vars: Readonly<Record<string, WaypointBeadsFormulaVar>>
  readonly steps: readonly WaypointBeadsFormulaStep[]
}

export interface CompileWaypointCatalogToBeadsFormulasInput {
  readonly routeIdPrefix?: string
  readonly subject?: WaypointBeadsSubject
}

export interface WaypointBeadsFormulaFileSpec {
  readonly relativePath: string
  readonly formula: WaypointBeadsFormula
  readonly content: string
}

export function compileQuestToBeadsFormula(
  catalog: BundledWaypointCatalog,
  input: CompileQuestToBeadsGraphInput,
): WaypointBeadsFormula {
  const graph = compileQuestToBeadsGraph(catalog, {
    ...input,
    routeId: input.routeId ?? '{{route_id}}',
    subject: input.subject ?? { type: '{{subject_type}}', id: '{{subject_id}}' },
  })
  const childIssues = graph.issues.filter((issue) => issue.logicalId !== graph.root.logicalId)
  const stepIdByLogicalId = createStepIdMap(childIssues)
  const dependenciesByDependent = groupDependenciesByDependent(graph, stepIdByLogicalId)

  return {
    formula: formulaNameForQuest(graph.quest.slug),
    description: formulaDescription(graph),
    version: 1,
    type: 'workflow',
    pour: true,
    vars: formulaVars(input),
    steps: childIssues.map((issue) => formulaStep(issue, stepIdByLogicalId, dependenciesByDependent)),
  }
}

export function compileWaypointCatalogToBeadsFormulas(
  catalog: BundledWaypointCatalog,
  input: CompileWaypointCatalogToBeadsFormulasInput = {},
): readonly WaypointBeadsFormula[] {
  return catalog.quests.list().map((quest) =>
    compileQuestToBeadsFormula(catalog, {
      quest: quest.slug,
      ...(input.routeIdPrefix ? { routeId: `${input.routeIdPrefix}:${quest.slug}` } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
    }),
  )
}

export function exportWaypointCatalogAsBeadsFormulaFiles(
  catalog: BundledWaypointCatalog,
  input: CompileWaypointCatalogToBeadsFormulasInput = {},
): readonly WaypointBeadsFormulaFileSpec[] {
  return compileWaypointCatalogToBeadsFormulas(catalog, input).map((formula) => ({
    relativePath: `formulas/${formula.formula}.formula.json`,
    formula,
    content: serializeWaypointBeadsFormulaJson(formula),
  }))
}

export function serializeWaypointBeadsFormulaJson(formula: WaypointBeadsFormula): string {
  return `${JSON.stringify(formula, null, 2)}\n`
}

function formulaStep(
  issue: WaypointBeadsIssueSpec,
  stepIdByLogicalId: ReadonlyMap<string, string>,
  dependenciesByDependent: ReadonlyMap<string, readonly string[]>,
): WaypointBeadsFormulaStep {
  return {
    id: stepIdByLogicalId.get(issue.logicalId) ?? formulaStepIdBase(issue.logicalId),
    title: issue.title,
    description: describeWaypointBeadsIssue(issue),
    type: issue.issueType,
    labels: issue.labels,
    metadata: issue.metadata,
    ...(dependenciesByDependent.has(issue.logicalId) ? { needs: dependenciesByDependent.get(issue.logicalId) } : {}),
  }
}

function groupDependenciesByDependent(
  graph: WaypointBeadsGraph,
  stepIdByLogicalId: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>()
  for (const dependency of graph.dependencies) {
    const dependencyStepId = stepIdByLogicalId.get(dependency.dependency)
    if (!dependencyStepId) continue
    const needs = grouped.get(dependency.dependent) ?? []
    needs.push(dependencyStepId)
    grouped.set(dependency.dependent, needs)
  }
  return grouped
}

function createStepIdMap(issues: readonly WaypointBeadsIssueSpec[]): ReadonlyMap<string, string> {
  const stepIdsByLogicalId = new Map<string, string>()
  const countsByBase = new Map<string, number>()

  for (const issue of issues) {
    const base = formulaStepIdBase(issue.logicalId)
    const seenCount = countsByBase.get(base) ?? 0
    countsByBase.set(base, seenCount + 1)
    stepIdsByLogicalId.set(issue.logicalId, seenCount === 0 ? base : `${base}-${seenCount + 1}`)
  }

  return stepIdsByLogicalId
}

function formulaStepIdBase(logicalId: string): string {
  const unprefixed = logicalId.replace(/^[^:]+:/, '')
  const sanitized = unprefixed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'step'
}

function formulaNameForQuest(questSlug: string): string {
  return `waypoint-${formulaStepIdBase(questSlug)}`
}

function formulaDescription(graph: WaypointBeadsGraph): string {
  const description = graph.quest.description?.trim()
  const header = `Waypoint Quest workflow for ${graph.quest.name}.`
  return description ? `${header}\n\n${description}` : header
}

function formulaVars(input: CompileQuestToBeadsGraphInput): Readonly<Record<string, WaypointBeadsFormulaVar>> {
  return {
    route_id: formulaVar('Waypoint route identifier for this run.', input.routeId),
    subject_type: formulaVar('Waypoint subject type for this run.', input.subject?.type),
    subject_id: formulaVar('Waypoint subject identifier for this run.', input.subject?.id),
  }
}

function formulaVar(description: string, defaultValue: string | undefined): WaypointBeadsFormulaVar {
  return defaultValue
    ? { description, default: defaultValue, type: 'string' }
    : { description, required: true, type: 'string' }
}
