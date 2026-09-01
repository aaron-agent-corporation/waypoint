import { join } from 'node:path'

import {
  loadProviderRegistry,
  readWaypointProjectConfig,
  resolveModelTarget,
  type ModelTargets,
  type ProviderRegistry,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

const CLASSES = ['high', 'medium', 'low'] as const

/**
 * `waypoint providers [--json]` — the model-routing readout (rsc-bpg).
 *
 * Shows the user-level provider registry (~/.waypoint/config.yaml → model_providers:) and,
 * when run inside a project, resolves each capability class through the project's
 * `runtime.model_targets` against that registry. A class whose target names an
 * unregistered provider shows as UNRESOLVED with the reason — the same
 * subscription-first fail-closed the runtime enforces, made visible before a
 * dispatch ever runs.
 */
export async function runProvidersCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const cwd = io.cwd ?? process.cwd()
  const registry = await loadProviderRegistry()
  const modelTargets = await readProjectModelTargets(cwd)

  const resolutions = CLASSES.map((cls) => {
    const declared = modelTargets?.[cls] !== undefined
    const result = resolveModelTarget(cls, { modelTargets, registry })
    if (result.ok) {
      return { class: cls, status: 'resolved' as const, provider: result.target.provider, model: result.target.model, auth: result.auth }
    }
    // A class the project never routed is not an error — only a DECLARED target
    // whose provider is unregistered is a misconfiguration that should fail.
    return declared
      ? { class: cls, status: 'error' as const, reason: result.reason }
      : { class: cls, status: 'unrouted' as const }
  })
  const ok = !resolutions.some((r) => r.status === 'error')

  if (json) {
    io.stdout(JSON.stringify({ providers: registry, resolutions }, null, 2))
    return ok ? 0 : 1
  }

  renderRegistry(registry, io)
  io.stdout('')
  renderResolutions(resolutions, modelTargets, io)
  return ok ? 0 : 1
}

async function readProjectModelTargets(cwd: string): Promise<ModelTargets | undefined> {
  try {
    const config = await readWaypointProjectConfig(join(cwd, '.waypoint', 'config.yaml'))
    return config.runtime.model_targets
  } catch {
    return undefined // not inside a project (or unreadable config): registry-only view
  }
}

function renderRegistry(registry: ProviderRegistry, io: WaypointCliIo): void {
  const ids = Object.keys(registry)
  io.stdout('Provider registry (~/.waypoint/config.yaml → model_providers:):')
  if (ids.length === 0) {
    io.stdout('  (none configured — add a `model_providers:` block; subscription providers are non-metered, api_key are opt-in)')
    return
  }
  for (const id of ids.sort()) io.stdout(`  - ${id} (${registry[id]!.auth})`)
}

type Resolution =
  | { class: string; status: 'resolved'; provider: string; model: string; auth: string }
  | { class: string; status: 'error'; reason: string }
  | { class: string; status: 'unrouted' }

function renderResolutions(resolutions: ReadonlyArray<Resolution>, modelTargets: ModelTargets | undefined, io: WaypointCliIo): void {
  if (modelTargets === undefined) {
    io.stdout('Model routing: no project in scope (run inside a project with runtime.model_targets to resolve classes).')
    return
  }
  io.stdout('Model routing (class -> provider/model):')
  for (const r of resolutions) {
    if (r.status === 'resolved') io.stdout(`  ${r.class}: ${r.provider}/${r.model} (${r.auth})`)
    else if (r.status === 'unrouted') io.stdout(`  ${r.class}: (unrouted)`)
    else io.stdout(`  ${r.class}: MISCONFIGURED — ${r.reason}`)
  }
}
