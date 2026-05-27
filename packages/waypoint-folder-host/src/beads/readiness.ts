import type { BundledWaypointCatalog, CatalogQuestManifest, CatalogRecipeManifest, WaypointCatalogEntry } from '../catalog/bundled.ts'

export type WaypointBeadsCatalogReadinessFindingSeverity = 'error' | 'warning'

export type WaypointBeadsCatalogReadinessFindingCode =
  | 'missing_plan_node_type'
  | 'mapped_recipe_placeholder_not_expanded'
  | 'recipe_node_missing_recipe_slug'
  | 'unresolved_plan_recipe'
  | 'gate_missing_required'
  | 'gate_missing_kind'
  | 'wait_missing_condition'
  | 'handoff_missing_kind'
  | 'handoff_missing_gate_ref'
  | 'artifact_missing_verifier'
  | 'recipe_missing_side_effect_policy'
  | 'recipe_missing_tools'

export interface WaypointBeadsCatalogReadinessFinding {
  readonly code: WaypointBeadsCatalogReadinessFindingCode
  readonly severity: WaypointBeadsCatalogReadinessFindingSeverity
  readonly message: string
  readonly quest_slug?: string
  readonly plan_ref?: string
  readonly recipe_slug?: string
  readonly source_path?: string
}

export interface WaypointBeadsCatalogReadinessSummary {
  readonly total: number
  readonly errors: number
  readonly warnings: number
  readonly by_code: Readonly<Record<WaypointBeadsCatalogReadinessFindingCode, number>>
}

export interface WaypointBeadsCatalogReadinessReport {
  readonly ok: boolean
  readonly findings: readonly WaypointBeadsCatalogReadinessFinding[]
  readonly summary: WaypointBeadsCatalogReadinessSummary
}

export function checkWaypointCatalogBeadsReadiness(catalog: BundledWaypointCatalog): WaypointBeadsCatalogReadinessReport {
  const findings: WaypointBeadsCatalogReadinessFinding[] = []
  const questEntryBySlug = new Map(catalog.questEntries.map((entry) => [entry.slug, entry]))
  const recipeEntryBySlug = new Map(catalog.recipeEntries.map((entry) => [entry.slug, entry]))
  const recipeSlugs = new Set(catalog.recipes.list().map((recipe) => recipe.slug))

  for (const quest of catalog.quests.list()) {
    collectQuestFindings(findings, quest, questEntryBySlug.get(quest.slug), recipeSlugs)
  }

  for (const recipe of catalog.recipes.list()) {
    collectRecipeFindings(findings, recipe, recipeEntryBySlug.get(recipe.slug))
  }

  return {
    ok: findings.every((finding) => finding.severity !== 'error'),
    findings,
    summary: summarizeFindings(findings),
  }
}

function collectQuestFindings(
  findings: WaypointBeadsCatalogReadinessFinding[],
  quest: CatalogQuestManifest,
  entry: WaypointCatalogEntry<CatalogQuestManifest> | undefined,
  recipeSlugs: ReadonlySet<string>,
): void {
  for (const plan of flattenQuestPlans(quest)) {
    const waypoint = asRecord(plan.metadata?.waypoint)
    const node = asRecord(waypoint?.node)
    const nodeType = stringValue(node?.type)
    const recipe = asRecord(waypoint?.recipe)
    const recipeSlug = stringValue(recipe?.slug)
    const gate = asRecord(waypoint?.gate)
    const wait = asRecord(waypoint?.wait)
    const handoff = asRecord(waypoint?.handoff)
    const outputArtifacts = asArray(waypoint?.output_artifacts)
    const artifactVerifier = asRecord(waypoint?.artifact_verifier) ?? asRecord(waypoint?.verifier)

    if (!nodeType) {
      findings.push({
        code: 'missing_plan_node_type',
        severity: 'error',
        message: `Quest plan ${quest.slug}/${plan.plan_ref} is missing metadata.waypoint.node.type`,
        quest_slug: quest.slug,
        plan_ref: plan.plan_ref,
        source_path: questSourcePath(entry),
      })
    }

    if (isMappedRecipePlaceholder(plan.title) && nodeType !== 'recipe') {
      findings.push({
        code: 'mapped_recipe_placeholder_not_expanded',
        severity: 'error',
        message: `Quest plan ${quest.slug}/${plan.plan_ref} still uses the generated mapped Recipe placeholder instead of explicit Recipe nodes`,
        quest_slug: quest.slug,
        plan_ref: plan.plan_ref,
        source_path: questSourcePath(entry),
      })
    }

    if (nodeType === 'recipe' && !recipeSlug) {
      findings.push({
        code: 'recipe_node_missing_recipe_slug',
        severity: 'error',
        message: `Recipe node ${quest.slug}/${plan.plan_ref} is missing metadata.waypoint.recipe.slug`,
        quest_slug: quest.slug,
        plan_ref: plan.plan_ref,
        source_path: questSourcePath(entry),
      })
    }

    if (recipeSlug && !recipeSlugs.has(recipeSlug)) {
      findings.push({
        code: 'unresolved_plan_recipe',
        severity: 'error',
        message: `Quest plan ${quest.slug}/${plan.plan_ref} references unknown Recipe ${recipeSlug}`,
        quest_slug: quest.slug,
        plan_ref: plan.plan_ref,
        recipe_slug: recipeSlug,
        source_path: questSourcePath(entry),
      })
    }

    if (nodeType === 'gate' || gate?.required === true) {
      if (gate?.required !== true) {
        findings.push({
          code: 'gate_missing_required',
          severity: 'error',
          message: `Gate node ${quest.slug}/${plan.plan_ref} must set metadata.waypoint.gate.required: true`,
          quest_slug: quest.slug,
          plan_ref: plan.plan_ref,
          source_path: questSourcePath(entry),
        })
      }
      if (!stringValue(gate?.kind)) {
        findings.push({
          code: 'gate_missing_kind',
          severity: 'warning',
          message: `Gate node ${quest.slug}/${plan.plan_ref} should declare metadata.waypoint.gate.kind`,
          quest_slug: quest.slug,
          plan_ref: plan.plan_ref,
          source_path: questSourcePath(entry),
        })
      }
    }

    if (nodeType === 'wait' || nodeType === 'delay' || nodeType === 'timer' || nodeType === 'dependency' || wait) {
      if (!stringValue(wait?.type) && !stringValue(wait?.condition) && !stringValue(wait?.kind)) {
        findings.push({
          code: 'wait_missing_condition',
          severity: 'error',
          message: `Wait node ${quest.slug}/${plan.plan_ref} must declare wait type, kind, or condition metadata`,
          quest_slug: quest.slug,
          plan_ref: plan.plan_ref,
          source_path: questSourcePath(entry),
        })
      }
    }

    if (nodeType === 'handoff') {
      if (!stringValue(handoff?.kind)) {
        findings.push({
          code: 'handoff_missing_kind',
          severity: 'error',
          message: `Handoff node ${quest.slug}/${plan.plan_ref} must declare metadata.waypoint.handoff.kind`,
          quest_slug: quest.slug,
          plan_ref: plan.plan_ref,
          source_path: questSourcePath(entry),
        })
      }

      const requiresGate = handoff?.gate_required === true || titleImpliesHumanHandoffGate(plan.title)
      if (requiresGate && !stringValue(handoff?.gate_ref)) {
        findings.push({
          code: 'handoff_missing_gate_ref',
          severity: 'error',
          message: `Handoff node ${quest.slug}/${plan.plan_ref} must declare metadata.waypoint.handoff.gate_ref`,
          quest_slug: quest.slug,
          plan_ref: plan.plan_ref,
          source_path: questSourcePath(entry),
        })
      }
    }

    if (outputArtifacts.length > 0 && !stringValue(artifactVerifier?.kind)) {
      findings.push({
        code: 'artifact_missing_verifier',
        severity: 'warning',
        message: `Artifact-producing node ${quest.slug}/${plan.plan_ref} should declare verifier metadata with a kind`,
        quest_slug: quest.slug,
        plan_ref: plan.plan_ref,
        source_path: questSourcePath(entry),
      })
    }
  }
}

function collectRecipeFindings(
  findings: WaypointBeadsCatalogReadinessFinding[],
  recipe: CatalogRecipeManifest,
  entry: WaypointCatalogEntry<CatalogRecipeManifest> | undefined,
): void {
  if (externalSideEffectsFromMetadata(recipe.metadata) === 'unspecified') {
    findings.push({
      code: 'recipe_missing_side_effect_policy',
      severity: 'error',
      message: `Recipe ${recipe.slug} is missing explicit external side-effect policy`,
      recipe_slug: recipe.slug,
      source_path: recipeSourcePath(entry),
    })
  }

  if (!recipe.tools || recipe.tools.length === 0) {
    findings.push({
      code: 'recipe_missing_tools',
      severity: 'warning',
      message: `Recipe ${recipe.slug} should declare required tools`,
      recipe_slug: recipe.slug,
      source_path: recipeSourcePath(entry),
    })
  }
}

interface QuestPlanRef {
  readonly plan_ref: string
  readonly title?: string
  readonly metadata?: Record<string, unknown>
}

function flattenQuestPlans(quest: CatalogQuestManifest): readonly QuestPlanRef[] {
  const plans: QuestPlanRef[] = []
  const scaffolds = asRecord(quest.scaffolds)
  for (const workstreamValue of asArray(scaffolds?.workstreams)) {
    const workstream = asRecord(workstreamValue)
    for (const milestoneValue of asArray(workstream?.milestones)) {
      const milestone = asRecord(milestoneValue)
      for (const phaseValue of asArray(milestone?.phases)) {
        const phase = asRecord(phaseValue)
        for (const planValue of asArray(phase?.plans)) {
          const plan = asRecord(planValue)
          const planRef = stringValue(plan?.plan_ref)
          if (!planRef) continue
          plans.push({
            plan_ref: planRef,
            ...(stringValue(plan?.title) ? { title: stringValue(plan?.title) } : {}),
            ...(asRecord(plan?.metadata) ? { metadata: asRecord(plan?.metadata) } : {}),
          })
        }
      }
    }
  }
  return plans
}

function summarizeFindings(findings: readonly WaypointBeadsCatalogReadinessFinding[]): WaypointBeadsCatalogReadinessSummary {
  const byCode = Object.fromEntries(findingCodes.map((code) => [code, 0])) as Record<WaypointBeadsCatalogReadinessFindingCode, number>
  for (const finding of findings) {
    byCode[finding.code] += 1
  }
  return {
    total: findings.length,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    by_code: byCode,
  }
}

const findingCodes: readonly WaypointBeadsCatalogReadinessFindingCode[] = [
  'missing_plan_node_type',
  'mapped_recipe_placeholder_not_expanded',
  'recipe_node_missing_recipe_slug',
  'unresolved_plan_recipe',
  'gate_missing_required',
  'gate_missing_kind',
  'wait_missing_condition',
  'handoff_missing_kind',
  'handoff_missing_gate_ref',
  'artifact_missing_verifier',
  'recipe_missing_side_effect_policy',
  'recipe_missing_tools',
]

function isMappedRecipePlaceholder(title: unknown): boolean {
  return typeof title === 'string' && title.trim().toLowerCase() === 'run the mapped waypoint recipes'
}

function titleImpliesHumanHandoffGate(title: unknown): boolean {
  return typeof title === 'string' && /\b(attorney|client|external)\b/i.test(title)
}

type WaypointBeadsExternalSideEffects = 'forbidden' | 'gated' | 'none' | 'unspecified'

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

function questSourcePath(entry: WaypointCatalogEntry<CatalogQuestManifest> | undefined): string | undefined {
  return entry ? `quests/${entry.relativePath}` : undefined
}

function recipeSourcePath(entry: WaypointCatalogEntry<CatalogRecipeManifest> | undefined): string | undefined {
  return entry ? `recipes/${entry.relativePath}` : undefined
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
