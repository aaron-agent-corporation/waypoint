import { stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

import type { OperatorInstructionLayer, OperatorManifest } from './manifest.ts'

export type OperatorInstructionResolution = {
  readonly operator_slug: string
  readonly layers: readonly ResolvedOperatorInstructionLayer[]
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}

export type ResolvedOperatorInstructionLayer = {
  readonly kind: OperatorInstructionLayer['kind']
  readonly ref: string
  readonly exists: boolean
  readonly required: boolean
  readonly resolved_path?: string
}

export type ResolveOperatorInstructionsOptions = {
  readonly repoRoot: string
  readonly skillRoots?: readonly string[]
}

export async function resolveOperatorInstructions(
  operator: OperatorManifest,
  options: ResolveOperatorInstructionsOptions,
): Promise<OperatorInstructionResolution> {
  const warnings: string[] = []
  const errors: string[] = []
  const layers: ResolvedOperatorInstructionLayer[] = []

  for (const layer of operator.instructions?.layers ?? []) {
    const required = layer.required === true

    if (isDisallowedInstructionRef(layer.ref)) {
      layers.push({ kind: layer.kind, ref: layer.ref, exists: false, required })
      errors.push(`instruction layer ref is disallowed because it points to a secret-like path: ${layer.ref}`)
      continue
    }

    const resolvedPath = await resolveLayerPath(layer, options)
    const exists = resolvedPath !== undefined
    layers.push({
      kind: layer.kind,
      ref: layer.ref,
      exists,
      required,
      ...(resolvedPath ? { resolved_path: resolvedPath } : {}),
    })

    if (!exists && required) {
      errors.push(`required instruction layer missing: ${layer.ref}`)
    } else if (!exists) {
      warnings.push(`optional instruction layer missing: ${layer.ref}`)
    }
  }

  return { operator_slug: operator.slug, layers, warnings, errors }
}

async function resolveLayerPath(
  layer: OperatorInstructionLayer,
  options: ResolveOperatorInstructionsOptions,
): Promise<string | undefined> {
  if (layer.kind === 'skill') {
    for (const root of options.skillRoots ?? []) {
      const candidates = [join(root, layer.ref, 'SKILL.md'), join(root, layer.ref)]
      for (const candidate of candidates) {
        if (await pathExists(candidate)) return candidate
      }
    }
    return undefined
  }

  const candidate = resolve(options.repoRoot, layer.ref)
  const repoRoot = resolve(options.repoRoot)
  if (!isInside(candidate, repoRoot)) return undefined
  return (await pathExists(candidate)) ? candidate : undefined
}

function isDisallowedInstructionRef(ref: string): boolean {
  const normalized = normalize(ref)
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  return segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))
}

function isInside(candidate: string, root: string): boolean {
  const withSep = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(withSep)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
