import type {
  BundledWaypointCatalog,
  CatalogQuestManifest,
  CatalogRecipeManifest,
  WaypointCatalogEntry,
} from '../catalog/bundled.ts'

export type WaypointBeadsIssueKind =
  | 'route'
  | 'recipe'
  | 'gate'
  | 'wait'
  | 'handoff'
  | 'artifact'
  | 'checkpoint'
  | 'discussion'
  | 'node'
export type WaypointBeadsIssueType = 'epic' | 'task'
export type WaypointBeadsDependencyType = 'blocks'
export type WaypointBeadsExternalSideEffects = 'forbidden' | 'gated' | 'none' | 'unspecified'

export interface WaypointBeadsSubject {
  readonly type: string
  readonly id: string
}

export interface CompileQuestToBeadsGraphInput {
  readonly quest: string
  readonly routeId?: string
  readonly subject?: WaypointBeadsSubject
}

export interface WaypointBeadsArtifactSpec {
  readonly path: string
  readonly required: true
  readonly required_when?: string
  readonly verifier?: WaypointBeadsArtifactVerifierSpec
}

export interface WaypointBeadsArtifactVerifierSpec {
  readonly kind: string
  readonly checks?: readonly string[]
}

export interface WaypointBeadsGateSpec {
  readonly required?: true
  readonly kind?: string
}

export interface WaypointBeadsWaitSpec {
  readonly kind?: string
  readonly type?: string
  readonly condition?: string
  readonly days?: number
  readonly exit_landmark?: string
}

export interface WaypointBeadsHandoffSpec {
  readonly kind: string
  readonly gate_required?: boolean
  readonly gate_ref?: string
  readonly required_artifacts?: readonly string[]
}

export interface WaypointBeadsScaffoldRef {
  readonly workstream?: string
  readonly milestone?: string
  readonly phase?: string
  readonly plan_ref?: string
  readonly wave?: number
  readonly sequence?: number
}

export interface WaypointBeadsSourceRef {
  readonly quest_path: string
  readonly recipe_path?: string
}

export interface WaypointBeadsPolicy {
  readonly external_side_effects: WaypointBeadsExternalSideEffects
  readonly requires_human_review?: true
}

export interface WaypointBeadsRecipeRuntimeSpec {
  readonly tools?: readonly string[]
  readonly runtime?: unknown
}

export interface WaypointBeadsMetadata {
  readonly waypoint: {
    readonly schema_version: 1
    readonly kind: WaypointBeadsIssueKind
    readonly quest_slug: string
    readonly route_id: string
    readonly node_key?: string
    readonly recipe_slug?: string
    readonly recipe?: WaypointBeadsRecipeRuntimeSpec
    readonly subject: WaypointBeadsSubject
    readonly scaffold?: WaypointBeadsScaffoldRef
    readonly source: WaypointBeadsSourceRef
    readonly policy: WaypointBeadsPolicy
    readonly artifacts?: readonly WaypointBeadsArtifactSpec[]
    readonly gate?: WaypointBeadsGateSpec
    readonly wait?: WaypointBeadsWaitSpec
    readonly handoff?: WaypointBeadsHandoffSpec
  }
}

export interface WaypointBeadsIssueSpec {
  readonly logicalId: string
  readonly title: string
  readonly issueType: WaypointBeadsIssueType
  readonly labels: readonly string[]
  readonly parent?: string
  readonly metadata: WaypointBeadsMetadata
}

export interface WaypointBeadsDependencySpec {
  readonly type: WaypointBeadsDependencyType
  readonly dependent: string
  readonly dependency: string
}

export interface WaypointBeadsGraph {
  readonly quest: CatalogQuestManifest
  readonly root: WaypointBeadsIssueSpec
  readonly issues: readonly WaypointBeadsIssueSpec[]
  readonly dependencies: readonly WaypointBeadsDependencySpec[]
}

interface ScaffoldPlanNode {
  readonly logicalId: string
  readonly title: string
  readonly planRef: string
  readonly wave: number
  readonly recipeSlug?: string
  readonly artifacts: readonly WaypointBeadsArtifactSpec[]
  readonly gate?: WaypointBeadsGateSpec
  readonly wait?: WaypointBeadsWaitSpec
  readonly handoff?: WaypointBeadsHandoffSpec
  readonly isGate: boolean
  readonly explicitKind?: WaypointBeadsIssueKind
  readonly metadata: Record<string, unknown>
  readonly scaffold: Required<WaypointBeadsScaffoldRef>
}

export function compileQuestToBeadsGraph(
  catalog: BundledWaypointCatalog,
  input: CompileQuestToBeadsGraphInput,
): WaypointBeadsGraph {
  const resolved = catalog.resolveQuestRecipes(input.quest)
  if (!resolved.ok) {
    throw new Error(resolved.message)
  }

  const routeId = input.routeId ?? `route:${resolved.quest.slug}`
  const subject = input.subject ?? { type: 'folder', id: 'local' }
  const recipeEntryBySlug = new Map(resolved.recipeEntries.map((entry) => [entry.slug, entry]))
  const recipeBySlug = new Map(resolved.recipes.map((recipe) => [recipe.slug, recipe]))

  const root = createIssueSpec({
    logicalId: `route:${resolved.quest.slug}`,
    title: resolved.quest.name,
    issueType: 'epic',
    labels: labelsFor(resolved.quest.slug, 'route'),
    metadata: {
      waypoint: {
        schema_version: 1,
        kind: 'route',
        quest_slug: resolved.quest.slug,
        route_id: routeId,
        subject,
        source: { quest_path: questSourcePath(resolved.questEntry) },
        policy: {
          external_side_effects: externalSideEffectsFromMetadata(resolved.quest.metadata),
        },
      },
    },
  })

  const planNodes = flattenScaffoldPlans(resolved.quest)
  const childIssues =
    planNodes.length > 0
      ? planNodes.map((node) =>
          issueFromPlanNode({
            node,
            quest: resolved.quest,
            questEntry: resolved.questEntry,
            routeId,
            subject,
            parent: root.logicalId,
            recipe: node.recipeSlug ? recipeBySlug.get(node.recipeSlug) : undefined,
            recipeEntry: node.recipeSlug ? recipeEntryBySlug.get(node.recipeSlug) : undefined,
          }),
        )
      : resolved.recipes.map((recipe) =>
          issueFromRecipe({
            recipe,
            recipeEntry: recipeEntryBySlug.get(recipe.slug),
            quest: resolved.quest,
            questEntry: resolved.questEntry,
            routeId,
            subject,
            parent: root.logicalId,
          }),
        )

  return {
    quest: resolved.quest,
    root,
    issues: [root, ...childIssues],
    dependencies: compileWaveDependencies(planNodes),
  }
}

function issueFromPlanNode(input: {
  readonly node: ScaffoldPlanNode
  readonly quest: CatalogQuestManifest
  readonly questEntry: WaypointCatalogEntry<CatalogQuestManifest>
  readonly routeId: string
  readonly subject: WaypointBeadsSubject
  readonly parent: string
  readonly recipe?: CatalogRecipeManifest
  readonly recipeEntry?: WaypointCatalogEntry<CatalogRecipeManifest>
}): WaypointBeadsIssueSpec {
  const kind: WaypointBeadsIssueKind = input.node.isGate
    ? 'gate'
    : input.node.recipeSlug
      ? 'recipe'
      : (input.node.explicitKind ?? (input.node.artifacts.length > 0 ? 'artifact' : 'checkpoint'))

  return createIssueSpec({
    logicalId: input.node.logicalId,
    title: input.node.title,
    issueType: 'task',
    labels: labelsFor(input.quest.slug, kind),
    parent: input.parent,
    metadata: {
      waypoint: {
        schema_version: 1,
        kind,
        quest_slug: input.quest.slug,
        route_id: input.routeId,
        node_key: input.node.planRef,
        ...(input.node.recipeSlug ? { recipe_slug: input.node.recipeSlug } : {}),
        ...(recipeRuntimeSpec(input.recipe) ? { recipe: recipeRuntimeSpec(input.recipe) } : {}),
        subject: input.subject,
        scaffold: input.node.scaffold,
        source: {
          quest_path: questSourcePath(input.questEntry),
          ...(input.recipeEntry ? { recipe_path: recipeSourcePath(input.recipeEntry) } : {}),
        },
        policy: {
          external_side_effects: externalSideEffectsFromMetadata(input.recipe?.metadata ?? input.quest.metadata),
          ...(input.node.isGate ? { requires_human_review: true } : {}),
        },
        ...(input.node.artifacts.length > 0 ? { artifacts: input.node.artifacts } : {}),
        ...(input.node.gate ? { gate: input.node.gate } : {}),
        ...(input.node.wait ? { wait: input.node.wait } : {}),
        ...(input.node.handoff ? { handoff: input.node.handoff } : {}),
      },
    },
  })
}

function issueFromRecipe(input: {
  readonly recipe: CatalogRecipeManifest
  readonly recipeEntry?: WaypointCatalogEntry<CatalogRecipeManifest>
  readonly quest: CatalogQuestManifest
  readonly questEntry: WaypointCatalogEntry<CatalogQuestManifest>
  readonly routeId: string
  readonly subject: WaypointBeadsSubject
  readonly parent: string
}): WaypointBeadsIssueSpec {
  return createIssueSpec({
    logicalId: `recipe:${input.recipe.slug}`,
    title: input.recipe.name,
    issueType: 'task',
    labels: labelsFor(input.quest.slug, 'recipe'),
    parent: input.parent,
    metadata: {
      waypoint: {
        schema_version: 1,
        kind: 'recipe',
        quest_slug: input.quest.slug,
        route_id: input.routeId,
        node_key: input.recipe.slug,
        recipe_slug: input.recipe.slug,
        ...(recipeRuntimeSpec(input.recipe) ? { recipe: recipeRuntimeSpec(input.recipe) } : {}),
        subject: input.subject,
        source: {
          quest_path: questSourcePath(input.questEntry),
          ...(input.recipeEntry ? { recipe_path: recipeSourcePath(input.recipeEntry) } : {}),
        },
        policy: {
          external_side_effects: externalSideEffectsFromMetadata(input.recipe.metadata ?? input.quest.metadata),
        },
      },
    },
  })
}

function createIssueSpec(issue: WaypointBeadsIssueSpec): WaypointBeadsIssueSpec {
  return issue
}

function labelsFor(questSlug: string, kind: WaypointBeadsIssueKind): readonly string[] {
  return ['waypoint', 'beads-runtime', `quest:${questSlug}`, `waypoint-kind:${kind}`]
}

function compileWaveDependencies(planNodes: readonly ScaffoldPlanNode[]): readonly WaypointBeadsDependencySpec[] {
  const orderedGroups: ScaffoldPlanNode[][] = []
  let currentGroupKey: string | null = null

  for (const node of planNodes) {
    const groupKey = `${node.scaffold.workstream}/${node.scaffold.milestone}/${node.scaffold.phase}/${node.wave}`
    if (groupKey !== currentGroupKey) {
      orderedGroups.push([node])
      currentGroupKey = groupKey
    } else {
      orderedGroups[orderedGroups.length - 1]?.push(node)
    }
  }

  const dependencies: WaypointBeadsDependencySpec[] = []
  for (let i = 1; i < orderedGroups.length; i += 1) {
    const previousWaveNodes = orderedGroups[i - 1] ?? []
    const currentWaveNodes = orderedGroups[i] ?? []
    for (const dependent of currentWaveNodes) {
      for (const dependency of previousWaveNodes) {
        dependencies.push({
          type: 'blocks',
          dependent: dependent.logicalId,
          dependency: dependency.logicalId,
        })
      }
    }
  }
  return dependencies
}

function flattenScaffoldPlans(quest: CatalogQuestManifest): readonly ScaffoldPlanNode[] {
  const scaffolds = asRecord(quest.scaffolds)
  const workstreams = asArray(scaffolds?.workstreams)
  const nodes: ScaffoldPlanNode[] = []
  let sequence = 0

  for (const workstreamValue of workstreams) {
    const workstream = asRecord(workstreamValue)
    const workstreamKey = stringValue(workstream?.key)
    if (!workstreamKey) continue

    for (const milestoneValue of asArray(workstream?.milestones)) {
      const milestone = asRecord(milestoneValue)
      const milestoneVersion = stringValue(milestone?.version_label)
      if (!milestoneVersion) continue

      for (const phaseValue of asArray(milestone?.phases)) {
        const phase = asRecord(phaseValue)
        const phaseSlug = stringValue(phase?.phase_slug)
        if (!phaseSlug) continue

        for (const planValue of asArray(phase?.plans)) {
          const plan = asRecord(planValue)
          if (!plan) continue
          const planRef = stringValue(plan?.plan_ref)
          if (!planRef) continue

          const metadata = asRecord(plan?.metadata) ?? {}
          const waypoint = asRecord(metadata.waypoint)
          const requiredWhen = stringValue(waypoint?.required_when)
          const recipe = asRecord(waypoint?.recipe)
          const recipeSlug = stringValue(recipe?.slug)
          const gate = asRecord(waypoint?.gate)
          const wait = asRecord(waypoint?.wait)
          const handoff = asRecord(waypoint?.handoff)
          const explicitKind = waypointIssueKindFromNodeMetadata(asRecord(waypoint?.node))
          const artifactVerifier = artifactVerifierSpecFromMetadata(
            asRecord(waypoint?.artifact_verifier) ?? asRecord(waypoint?.verifier),
          )
          const artifacts = asArray(waypoint?.output_artifacts)
            .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
            .map((path) => ({
              path,
              required: true as const,
              ...(requiredWhen ? { required_when: requiredWhen } : {}),
              ...(artifactVerifier ? { verifier: artifactVerifier } : {}),
            }))

          sequence += 1
          nodes.push({
            logicalId: `plan:${planRef}`,
            title: stringValue(plan.title) ?? planRef,
            planRef,
            wave: numberValue(plan.wave) ?? sequence,
            ...(recipeSlug ? { recipeSlug } : {}),
            artifacts,
            ...(gateSpecFromMetadata(gate) ? { gate: gateSpecFromMetadata(gate) } : {}),
            ...(waitSpecFromMetadata(wait) ? { wait: waitSpecFromMetadata(wait) } : {}),
            ...(handoffSpecFromMetadata(handoff) ? { handoff: handoffSpecFromMetadata(handoff) } : {}),
            isGate: gate?.required === true,
            ...(explicitKind ? { explicitKind } : {}),
            metadata,
            scaffold: {
              workstream: workstreamKey,
              milestone: milestoneVersion,
              phase: phaseSlug,
              plan_ref: planRef,
              wave: numberValue(plan.wave) ?? sequence,
              sequence,
            },
          })
        }
      }
    }
  }

  return nodes
}

function gateSpecFromMetadata(gate: Record<string, unknown> | undefined): WaypointBeadsGateSpec | undefined {
  if (!gate) return undefined
  const required = gate.required === true
  const kind = stringValue(gate.kind)
  if (!required && !kind) return undefined
  return {
    ...(required ? { required: true as const } : {}),
    ...(kind ? { kind } : {}),
  }
}

function waitSpecFromMetadata(wait: Record<string, unknown> | undefined): WaypointBeadsWaitSpec | undefined {
  if (!wait) return undefined
  const spec: WaypointBeadsWaitSpec = {
    ...(stringValue(wait.kind) ? { kind: stringValue(wait.kind) } : {}),
    ...(stringValue(wait.type) ? { type: stringValue(wait.type) } : {}),
    ...(stringValue(wait.condition) ? { condition: stringValue(wait.condition) } : {}),
    ...(numberValue(wait.days) ? { days: numberValue(wait.days) } : {}),
    ...(stringValue(wait.exit_landmark) ? { exit_landmark: stringValue(wait.exit_landmark) } : {}),
  }
  return Object.keys(spec).length > 0 ? spec : undefined
}

function handoffSpecFromMetadata(handoff: Record<string, unknown> | undefined): WaypointBeadsHandoffSpec | undefined {
  if (!handoff) return undefined
  const kind = stringValue(handoff.kind)
  if (!kind) return undefined
  const requiredArtifacts = asArray(handoff.required_artifacts).filter(
    (artifact): artifact is string => typeof artifact === 'string' && artifact.trim() !== '',
  )
  return {
    kind,
    ...(typeof handoff.gate_required === 'boolean' ? { gate_required: handoff.gate_required } : {}),
    ...(stringValue(handoff.gate_ref) ? { gate_ref: stringValue(handoff.gate_ref) } : {}),
    ...(requiredArtifacts.length > 0 ? { required_artifacts: requiredArtifacts } : {}),
  }
}

function artifactVerifierSpecFromMetadata(
  verifier: Record<string, unknown> | undefined,
): WaypointBeadsArtifactVerifierSpec | undefined {
  const kind = stringValue(verifier?.kind)
  if (!kind) return undefined
  const checks = asArray(verifier?.checks).filter((check): check is string => typeof check === 'string' && check.trim() !== '')
  return {
    kind,
    ...(checks.length > 0 ? { checks } : {}),
  }
}

function externalSideEffectsFromMetadata(metadata: unknown): WaypointBeadsExternalSideEffects {
  const meta = asRecord(metadata)
  const safety = asRecord(meta?.safety)
  const waypoint = asRecord(meta?.waypoint)
  const sourcePort = asRecord(meta?.source_port)
  const sideEffects =
    stringValue(safety?.external_side_effects) ??
    stringValue(waypoint?.external_side_effects) ??
    stringValue(sourcePort?.external_side_effects)
  if (sideEffects === 'forbidden' || sideEffects === 'gated' || sideEffects === 'none') {
    return sideEffects
  }
  return 'unspecified'
}

function recipeRuntimeSpec(recipe: CatalogRecipeManifest | undefined): WaypointBeadsRecipeRuntimeSpec | undefined {
  if (!recipe) return undefined
  const spec: WaypointBeadsRecipeRuntimeSpec = {
    ...(recipe.tools ? { tools: recipe.tools } : {}),
    ...(recipe.runtime !== undefined ? { runtime: recipe.runtime } : {}),
  }
  return spec.tools || spec.runtime !== undefined ? spec : undefined
}

function waypointIssueKindFromNodeMetadata(node: Record<string, unknown> | undefined): WaypointBeadsIssueKind | undefined {
  const type = stringValue(node?.type)
  if (type === 'wait' || type === 'handoff' || type === 'checkpoint' || type === 'discussion' || type === 'node') {
    return type
  }
  if (type === 'delay' || type === 'timer' || type === 'dependency') {
    return 'wait'
  }
  return undefined
}

function questSourcePath(entry: WaypointCatalogEntry<CatalogQuestManifest>): string {
  return `quests/${entry.relativePath}`
}

function recipeSourcePath(entry: WaypointCatalogEntry<CatalogRecipeManifest>): string {
  return `recipes/${entry.relativePath}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
