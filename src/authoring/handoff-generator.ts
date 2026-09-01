import { stringify as yamlStringify } from 'yaml'
import { parseHandoffManifest } from '../handoffs/manifest.ts'
import type { AuthoringManifestDraftValidation } from './recipe-generator.ts'
import { isSafeRelativePath, isSafeSlug, isSafeToolSlug, validateCommonDraftInput } from './recipe-generator.ts'

export type AuthoringHandoffStepDraft = {
  readonly slug: string
  readonly from: string
  readonly to: string
  readonly trigger: string
  readonly gate?: string
  readonly required_artifacts?: readonly string[]
}

export type GenerateAuthoringHandoffDraftInput = {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly domain?: string
  readonly handoffs: readonly AuthoringHandoffStepDraft[]
  readonly source: {
    readonly design_spec_path?: string
    readonly inspected_paths: readonly string[]
  }
}

export type GenerateAuthoringHandoffDraftResult = {
  readonly kind: 'handoff'
  readonly path: string
  readonly yaml: string
  readonly write_default: false
  readonly validation: AuthoringManifestDraftValidation
  readonly warnings: readonly string[]
}

export function generateAuthoringHandoffDraft(input: GenerateAuthoringHandoffDraftInput): GenerateAuthoringHandoffDraftResult {
  const errors = validateCommonDraftInput(input.slug, input.name, input.source.inspected_paths)
  if (input.domain !== undefined && !isSafeSlug(input.domain)) errors.push('domain must be a safe lowercase slug when provided')
  if (input.handoffs.length === 0) errors.push('handoffs must include at least one handoff step')

  for (const handoff of input.handoffs) {
    if (!isSafeSlug(handoff.slug)) errors.push(`handoff ${handoff.slug} must use a safe lowercase slug`)
    if (!isSafeSlug(handoff.from)) errors.push(`handoff ${handoff.slug} from must be a safe lowercase slug`)
    if (!isSafeSlug(handoff.to)) errors.push(`handoff ${handoff.slug} to must be a safe lowercase slug`)
    if (handoff.trigger.trim() === '') errors.push(`handoff ${handoff.slug} trigger is required`)
    if (handoff.gate !== undefined && !isSafeToolSlug(handoff.gate)) errors.push(`handoff ${handoff.slug} gate must be a safe identifier`)
    for (const artifact of handoff.required_artifacts ?? []) {
      if (!isSafeRelativePath(artifact)) errors.push(`handoff ${handoff.slug} required artifact ${artifact} must be a safe relative path`)
    }
  }

  const path = input.domain ? `handoffs/${input.domain}/${input.slug}.yaml` : `handoffs/${input.slug}.yaml`
  if (errors.length > 0) return failedHandoffDraft(path, errors)

  const manifest = {
    schema_version: 1,
    slug: input.slug,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    handoffs: input.handoffs.map((handoff) => ({
      slug: handoff.slug,
      from: handoff.from,
      to: handoff.to,
      trigger: handoff.trigger,
      ...(handoff.required_artifacts && handoff.required_artifacts.length > 0 ? { required_artifacts: handoff.required_artifacts } : {}),
      ...(handoff.gate ? { gate: handoff.gate } : {}),
    })),
    metadata: {
      authoring: {
        generated_by: 'runner-author',
        approval_required: true,
        install_default: false,
        ...(input.source.design_spec_path ? { design_spec_path: input.source.design_spec_path } : {}),
        inspected_paths: input.source.inspected_paths,
      },
    },
  }

  const yaml = yamlStringify(manifest)
  const parsed = parseHandoffManifest(yaml)
  if (parsed.ok === false) return failedHandoffDraft(path, [`generated handoff manifest failed validation: ${parsed.error.message}`])

  return {
    kind: 'handoff',
    path,
    yaml,
    write_default: false,
    validation: { ok: true, errors: [] },
    warnings: ['draft only: not written or installed', 'approval required before installation or route use'],
  }
}

function failedHandoffDraft(path: string, errors: readonly string[]): GenerateAuthoringHandoffDraftResult {
  return {
    kind: 'handoff',
    path,
    yaml: '',
    write_default: false,
    validation: { ok: false, errors },
    warnings: ['draft rejected before YAML emission'],
  }
}
