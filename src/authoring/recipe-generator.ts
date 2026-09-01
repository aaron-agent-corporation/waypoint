import { stringify as yamlStringify } from 'yaml'
import { parseRecipeManifest } from '../recipes/manifest.ts'

export type GenerateAuthoringRecipeDraftInput = {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly prompt: string
  readonly domain?: string
  readonly tools?: readonly string[]
  readonly source: {
    readonly design_spec_path?: string
    readonly inspected_paths: readonly string[]
  }
}

export type AuthoringManifestDraftValidation =
  | { readonly ok: true; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly string[] }

export type GenerateAuthoringRecipeDraftResult = {
  readonly kind: 'recipe'
  readonly path: string
  readonly yaml: string
  readonly write_default: false
  readonly validation: AuthoringManifestDraftValidation
  readonly warnings: readonly string[]
}

export function generateAuthoringRecipeDraft(input: GenerateAuthoringRecipeDraftInput): GenerateAuthoringRecipeDraftResult {
  const errors = validateCommonDraftInput(input.slug, input.name, input.source.inspected_paths)
  if (input.prompt.trim() === '') errors.push('prompt is required')
  // Item 29: `tools:` is refused on kinds that never read it, and drafts are
  // the default (agent/worker) kind — so a tools request cannot be honored.
  // Refusing with the reason beats emitting a draft that fails its own
  // validation with a parser message the author has to decode.
  if ((input.tools ?? []).length > 0) {
    errors.push(
      'tools is only enforced for runtime.kind pi / cordis, and generated drafts run as the default worker kind — ' +
        'omit tools, or author the recipe by hand with an explicit consuming kind',
    )
  }

  const path = `recipes/${input.slug}.yaml`
  if (errors.length > 0) return failedRecipeDraft(path, errors)

  const manifest = {
    schema_version: 1,
    slug: input.slug,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    prompt: input.prompt,
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
  const parsed = parseRecipeManifest(yaml)
  if (parsed.ok === false) return failedRecipeDraft(path, [`generated recipe failed validation: ${parsed.error.message}`])

  return {
    kind: 'recipe',
    path,
    yaml,
    write_default: false,
    validation: { ok: true, errors: [] },
    warnings: ['draft only: not written or installed', 'approval required before installation or route use'],
  }
}

function failedRecipeDraft(path: string, errors: readonly string[]): GenerateAuthoringRecipeDraftResult {
  return {
    kind: 'recipe',
    path,
    yaml: '',
    write_default: false,
    validation: { ok: false, errors },
    warnings: ['draft rejected before YAML emission'],
  }
}

export function validateCommonDraftInput(slug: string, name: string, inspectedPaths: readonly string[]): string[] {
  const errors: string[] = []
  if (!isSafeSlug(slug)) errors.push('slug must be a safe lowercase slug')
  if (name.trim() === '') errors.push('name is required')
  if (inspectedPaths.length === 0) errors.push('inspected_paths must include at least one primary source path')
  for (const inspectedPath of inspectedPaths) {
    if (!isSafeRelativePath(inspectedPath)) errors.push(`inspected path ${inspectedPath} must be a safe relative path`)
  }
  return errors
}

export function isSafeSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value) || /^[a-z0-9]$/.test(value)
}

export function isSafeToolSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9_.-]*[a-z0-9]$/.test(value) || /^[a-z0-9]$/.test(value)
}

export function isSafeRelativePath(value: string): boolean {
  return value.trim() !== '' && !value.startsWith('/') && !value.includes('..') && !value.includes('\\')
}
