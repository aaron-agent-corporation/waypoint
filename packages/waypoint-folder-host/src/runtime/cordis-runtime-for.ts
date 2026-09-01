import { getWaypointProjectPaths } from '../project/root.ts'
import {
  readWaypointProjectConfig,
  type WaypointProjectRootConfig,
  type WaypointProjectSandboxConfig,
} from '../project/config.ts'
import { readSandboxBindingRecord } from '../sandbox/binding-record.ts'
import { loadProviderRegistry, type ModelTargets } from './model-routing.ts'
import { CordisRecipeRuntime } from './cordis-runtime.ts'
import type { CordisLanePicker } from './cordis-jailed-runtime.ts'

/**
 * Build the cordis runtime for a project — the kind-`cordis` sibling of
 * {@link piRecipeRuntimeFor} and {@link deterministicRuntimeFor}. Both the
 * durable bridge and the autopilot take the same fork and construct the runtime
 * here, so the two paths cannot drift.
 *
 * It wires the same three project-scoped inputs the pi factory does:
 *  - the USER provider registry (`~/.waypoint/config.yaml` → providers),
 *    read from the environment — which providers are reachable at all;
 *  - the PROJECT model targets (`.waypoint/config.yaml` → runtime.model_targets),
 *    the class → (provider, model) map; and
 *  - the worker task-timeout budget.
 *
 * ROOTS matter more here than on the pi path. They are the jail's base
 * capability set AND the fence every skill and reference path is checked
 * against, so a config read failure leaves them empty — which fails closed at
 * composition rather than opening anything. Defaults here are always the
 * restrictive reading; an unreadable config must never widen a worker.
 */
export interface CordisRecipeRuntimeForOptions {
  /**
   * S2 (item 52): the admitted sandbox binding from the DURABLE ROUTE ROW —
   * the bridge passes what the start stamped, so a route runs under the
   * binding it started with. When absent (autopilot, dev drivers, pre-S2
   * routes), the per-project provisioning record file is the fallback.
   */
  readonly managedBinding?: unknown
  /**
   * L5: the dispatch-time lane picker. The bridge builds it from the pg lane
   * locks + subscription homes + brain reserve; callers without a pg pool
   * (autopilot, dev drivers) leave it unset and the jailed path fails closed
   * with the no-lane refusal rather than running without cross-process
   * exclusion.
   */
  readonly lanePicker?: CordisLanePicker
}

export async function cordisRecipeRuntimeFor(
  projectRoot: string,
  options?: CordisRecipeRuntimeForOptions,
): Promise<CordisRecipeRuntime> {
  const registry = await loadProviderRegistry(process.env)
  let modelTargets: ModelTargets | undefined
  let timeoutMs: number | undefined
  let roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
  let sandbox: WaypointProjectSandboxConfig | undefined
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    modelTargets = config.runtime.model_targets
    roots = config.roots
    sandbox = config.runtime.sandbox
    if (config.runtime.worker?.task_timeout_minutes) {
      timeoutMs = config.runtime.worker.task_timeout_minutes * 60_000
    }
  } catch (error) {
    // defaults: no targets (fail closed at model routing), no roots (fail
    // closed at composition), default budget. ONE failure is never lenient:
    // a present-but-invalid `runtime.sandbox` block. Its parser throws so a
    // typo'd sandbox cannot degrade to "no sandbox" — swallowing that here
    // would run the worker unjailed on the host, believed sandboxed.
    if (error instanceof Error && error.message.includes('Invalid runtime.sandbox')) throw error
  }
  // Sandbox posture (S1→S2): the route row's stamped binding wins when the
  // caller has one (the bridge path); the per-project provisioning record file
  // is the fallback for callers without a durable row. Read OUTSIDE the lenient
  // config catch — a present-but-corrupt record must fail the attempt loudly,
  // never read as "no sandbox".
  const managedBinding =
    options?.managedBinding !== undefined
      ? options.managedBinding
      : sandbox !== undefined
        ? await readSandboxBindingRecord(projectRoot)
        : undefined
  return new CordisRecipeRuntime({
    registry,
    ...(modelTargets ? { modelTargets } : {}),
    ...(roots ? { roots } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(managedBinding !== undefined ? { managedBinding } : {}),
    ...(options?.lanePicker ? { lanePicker: options.lanePicker } : {}),
    // The real process env carries the WAYPOINT_SEATBELT gate the jail consults.
    env: process.env,
    ...(timeoutMs ? { timeoutMs } : {}),
  })
}
