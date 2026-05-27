import type { BundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  compileQuestToBeadsGraph,
  type CompileQuestToBeadsGraphInput,
  type WaypointBeadsDependencySpec,
  type WaypointBeadsDependencyType,
  type WaypointBeadsGraph,
  type WaypointBeadsIssueSpec,
  type WaypointBeadsIssueType,
  type WaypointBeadsMetadata,
} from './compiler.ts'
import { describeWaypointBeadsIssue } from './descriptions.ts'

export interface WaypointBeadsIssueCreateInput {
  readonly title: string
  readonly description: string
  readonly issueType: WaypointBeadsIssueType
  readonly labels: readonly string[]
  readonly metadata: WaypointBeadsMetadata
  readonly parent?: string
}

export interface WaypointBeadsIssueCreateResult {
  readonly id: string
}

export interface WaypointBeadsDependencyCreateInput {
  readonly dependent: string
  readonly dependency: string
  readonly type: WaypointBeadsDependencyType
}

export interface WaypointBeadsIssueClient {
  createIssue(input: WaypointBeadsIssueCreateInput): Promise<WaypointBeadsIssueCreateResult>
  addDependency(input: WaypointBeadsDependencyCreateInput): Promise<void>
}

export interface InstantiateWaypointRouteInBeadsInput extends CompileQuestToBeadsGraphInput {
  readonly client: WaypointBeadsIssueClient
}

export interface WaypointBeadsInstantiatedIssue {
  readonly logicalId: string
  readonly beadsId: string
  readonly spec: WaypointBeadsIssueSpec
}

export interface WaypointBeadsInstantiatedDependency {
  readonly type: WaypointBeadsDependencyType
  readonly dependent: string
  readonly dependency: string
  readonly dependentLogicalId: string
  readonly dependencyLogicalId: string
}

export interface WaypointBeadsInstantiationResult {
  readonly graph: WaypointBeadsGraph
  readonly root: WaypointBeadsInstantiatedIssue
  readonly issues: readonly WaypointBeadsInstantiatedIssue[]
  readonly dependencies: readonly WaypointBeadsInstantiatedDependency[]
}

export async function instantiateWaypointRouteInBeads(
  catalog: BundledWaypointCatalog,
  input: InstantiateWaypointRouteInBeadsInput,
): Promise<WaypointBeadsInstantiationResult> {
  const graph = compileQuestToBeadsGraph(catalog, input)
  const issueIdsByLogicalId = new Map<string, string>()
  const issues: WaypointBeadsInstantiatedIssue[] = []

  for (const issue of graph.issues) {
    const parent = parentBeadsId(issue, issueIdsByLogicalId)
    const created = await input.client.createIssue({
      title: issue.title,
      description: describeWaypointBeadsIssue(issue),
      issueType: issue.issueType,
      labels: issue.labels,
      metadata: issue.metadata,
      ...(parent ? { parent } : {}),
    })
    issueIdsByLogicalId.set(issue.logicalId, created.id)
    issues.push({ logicalId: issue.logicalId, beadsId: created.id, spec: issue })
  }

  const dependencies: WaypointBeadsInstantiatedDependency[] = []
  for (const dependency of graph.dependencies) {
    const instantiated = instantiateDependency(dependency, issueIdsByLogicalId)
    await input.client.addDependency({
      type: instantiated.type,
      dependent: instantiated.dependent,
      dependency: instantiated.dependency,
    })
    dependencies.push(instantiated)
  }

  const root = issues[0]
  if (!root) {
    throw new Error('Waypoint Beads graph did not produce a route root issue')
  }

  return {
    graph,
    root,
    issues,
    dependencies,
  }
}

function parentBeadsId(issue: WaypointBeadsIssueSpec, issueIdsByLogicalId: ReadonlyMap<string, string>): string | undefined {
  if (!issue.parent) return undefined
  const parent = issueIdsByLogicalId.get(issue.parent)
  if (!parent) {
    throw new Error(`Parent Beads issue has not been created for ${issue.logicalId}: ${issue.parent}`)
  }
  return parent
}

function instantiateDependency(
  dependency: WaypointBeadsDependencySpec,
  issueIdsByLogicalId: ReadonlyMap<string, string>,
): WaypointBeadsInstantiatedDependency {
  const dependent = issueIdsByLogicalId.get(dependency.dependent)
  const blocker = issueIdsByLogicalId.get(dependency.dependency)
  if (!dependent || !blocker) {
    throw new Error(`Cannot instantiate Beads dependency ${dependency.dependent} -> ${dependency.dependency}`)
  }
  return {
    type: dependency.type,
    dependent,
    dependency: blocker,
    dependentLogicalId: dependency.dependent,
    dependencyLogicalId: dependency.dependency,
  }
}
