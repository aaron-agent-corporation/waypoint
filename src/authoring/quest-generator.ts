import { stringify as yamlStringify } from 'yaml'
import { parseQuestManifest } from '../quests/manifest.ts'
import type { AuthoringManifestDraftValidation } from './recipe-generator.ts'
import { isSafeRelativePath, isSafeSlug, validateCommonDraftInput } from './recipe-generator.ts'

export type AuthoringQuestTaskDraft =
  | {
      readonly ref: string
      readonly title: string
      readonly type: 'recipe'
      readonly recipe?: string
      readonly wave?: number
    }
  | {
      readonly ref: string
      readonly title: string
      readonly type: 'gate'
      readonly gate_kind?: string
      readonly wave?: number
    }
  | {
      readonly ref: string
      readonly title: string
      readonly type: 'checkpoint'
      readonly wave?: number
    }

export type AuthoringQuestPhaseDraft = {
  readonly key: string
  readonly title: string
  readonly tasks: readonly AuthoringQuestTaskDraft[]
}

export type GenerateAuthoringQuestDraftInput = {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly domain?: string
  readonly workflow: string
  readonly recipes?: readonly string[]
  readonly phases: readonly AuthoringQuestPhaseDraft[]
  readonly source: {
    readonly design_spec_path?: string
    readonly inspected_paths: readonly string[]
  }
}

export type GenerateAuthoringQuestDraftResult = {
  readonly kind: 'quest'
  readonly path: string
  readonly yaml: string
  readonly write_default: false
  readonly validation: AuthoringManifestDraftValidation
  readonly warnings: readonly string[]
}

export function generateAuthoringQuestDraft(input: GenerateAuthoringQuestDraftInput): GenerateAuthoringQuestDraftResult {
  const errors = validateCommonDraftInput(input.slug, input.name, input.source.inspected_paths)
  if (!isSafeRelativePath(input.workflow) || !input.workflow.startsWith('workflows/')) {
    errors.push('workflow must be a safe relative workflows/ path')
  }
  if (input.phases.length === 0) errors.push('phases must include at least one phase')

  for (const recipe of input.recipes ?? []) {
    if (!isSafeSlug(recipe)) errors.push(`recipe ${recipe} must be a safe lowercase slug`)
  }
  for (const phase of input.phases) {
    if (!isSafeSlug(phase.key)) errors.push(`phase ${phase.key} must use a safe lowercase key`)
    if (phase.title.trim() === '') errors.push(`phase ${phase.key} title is required`)
    if (phase.tasks.length === 0) errors.push(`phase ${phase.key} must include at least one task`)
    for (const task of phase.tasks) {
      if (!isSafeSlug(task.ref)) errors.push(`task ref ${task.ref} must be a safe lowercase slug`)
      if (task.title.trim() === '') errors.push(`task ${task.ref} title is required`)
      if (task.type === 'recipe' && !task.recipe) errors.push(`recipe task ${task.ref} must include recipe`)
      if (task.type === 'recipe' && task.recipe && !isSafeSlug(task.recipe)) {
        errors.push(`recipe task ${task.ref} recipe must be a safe lowercase slug`)
      }
    }
  }

  const path = `quests/${input.slug}.yaml`
  if (errors.length > 0) return failedQuestDraft(path, errors)

  const manifest = {
    schema_version: 1,
    slug: input.slug,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    workflow: input.workflow,
    ...(input.recipes && input.recipes.length > 0 ? { recipes: input.recipes } : {}),
    scaffolds: {
      workstreams: [
        {
          key: input.domain ?? input.slug,
          name: `${input.name} Draft`,
          milestones: [
            {
              version_label: 'draft',
              title: `${input.name} draft milestone`,
              phases: input.phases.map((phase, phaseIndex) => ({
                phase_key: String(phaseIndex + 1).padStart(2, '0'),
                phase_slug: phase.key,
                lifecycle_phase: phase.key,
                plans: phase.tasks.map((task, taskIndex) => ({
                  plan_ref: task.ref,
                  title: task.title,
                  wave: task.wave ?? (taskIndex + 1) * 10,
                })),
              })),
            },
          ],
        },
      ],
    },
    metadata: {
      authoring: {
        generated_by: 'runner-author',
        approval_required: true,
        install_default: false,
        ...(input.source.design_spec_path ? { design_spec_path: input.source.design_spec_path } : {}),
        inspected_paths: input.source.inspected_paths,
        draft_tasks: input.phases.flatMap((phase) =>
          phase.tasks.map((task) => ({
            phase: phase.key,
            ref: task.ref,
            type: task.type,
            ...(task.type === 'recipe' ? { recipe: task.recipe } : {}),
            ...(task.type === 'gate' ? { gate_kind: task.gate_kind ?? 'human_review' } : {}),
          })),
        ),
      },
    },
  }

  const yaml = yamlStringify(manifest)
  const parsed = parseQuestManifest(yaml)
  if (parsed.ok === false) return failedQuestDraft(path, [`generated quest failed validation: ${parsed.error.message}`])

  return {
    kind: 'quest',
    path,
    yaml,
    write_default: false,
    validation: { ok: true, errors: [] },
    warnings: ['draft only: not written or installed', 'approval required before installation or route use'],
  }
}

function failedQuestDraft(path: string, errors: readonly string[]): GenerateAuthoringQuestDraftResult {
  return {
    kind: 'quest',
    path,
    yaml: '',
    write_default: false,
    validation: { ok: false, errors },
    warnings: ['draft rejected before YAML emission'],
  }
}
