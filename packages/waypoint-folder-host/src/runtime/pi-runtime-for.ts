import { getWaypointProjectPaths } from '../project/root.ts'
import { readWaypointProjectConfig, type WaypointProjectPiPolicyRule, type WaypointProjectRootConfig, type WaypointProjectSandboxConfig } from '../project/config.ts'
import { loadProviderRegistry, type ModelTargets } from './model-routing.ts'
import { PiRecipeRuntime } from './pi-runtime.ts'

/**
 * Build the pi runtime for a project (rsc-tka) — the pi-kind sibling of
 * {@link deterministicRuntimeFor}. Both the durable bridge and the autopilot
 * take a `kind: pi` fork and construct the runtime here so the two paths stay
 * identical.
 *
 * It wires three project-scoped inputs:
 *  - the USER provider registry (`~/.waypoint/config.yaml` → providers),
 *    read from the environment (rsc-bpg) — which providers are reachable;
 *  - the PROJECT model targets (`.waypoint/config.yaml` → runtime.model_targets),
 *    the class → (provider, model) map; and
 *  - the worker task-timeout budget.
 * Any config read failure falls back to defaults (empty targets → the runtime
 * fails closed at model routing, which is the correct posture).
 *
 * TOOLS (rsc-bhc): the built-in access-map fs tools (read_file / write_file /
 * list_dir) are recognized by the runtime and confined to the project's named
 * `roots:` crossed with each plan's `access:` map — the same boundary the jailed
 * `claude -p` worker gets, enforced in-process by the tool guard (pi-fs-tools.ts).
 * A recipe that grants none stays a reason-and-report worker. Loading the roots
 * here is what arms that confinement; without them a recipe granting an fs tool
 * fails closed at build.
 *
 * POLICY (rsc-bhc part 3): the project's `runtime.pi_policy` DENY rules bind here
 * — forwarded to the runtime, which builds the `beforeToolCall` policy from them
 * (buildPiPolicy) and forwards them into the jailed child so both A′ tiers enforce
 * the same deny-list. DENY-only, ALLOW by default; there is no ASK (a headless
 * worker has no interactive approver — human-decision is a gate).
 */
export async function piRecipeRuntimeFor(projectRoot: string): Promise<PiRecipeRuntime> {
  const registry = await loadProviderRegistry(process.env)
  let modelTargets: ModelTargets | undefined
  let timeoutMs: number | undefined
  let roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
  let sandbox: WaypointProjectSandboxConfig | undefined
  let envAllow: readonly string[] | undefined
  let piPolicy: readonly WaypointProjectPiPolicyRule[] | undefined
  try {
    const config = await readWaypointProjectConfig(getWaypointProjectPaths(projectRoot).configPath)
    modelTargets = config.runtime.model_targets
    roots = config.roots
    sandbox = config.runtime.sandbox
    piPolicy = config.runtime.pi_policy
    envAllow = config.runtime.worker?.env_allow
    if (config.runtime.worker?.task_timeout_minutes) {
      timeoutMs = config.runtime.worker.task_timeout_minutes * 60_000
    }
  } catch {
    // defaults: no targets (fail closed at routing), no roots (fs tools fail
    // closed at build), default budget
  }
  return new PiRecipeRuntime({
    registry,
    ...(modelTargets ? { modelTargets } : {}),
    ...(roots ? { roots } : {}),
    // The jailed-path inputs (rsc-0fx, A′): sandbox to fail closed on the microVM
    // tier, env_allow to widen the child's allowlist, and the real process.env as
    // the spawn base (which carries the seatbelt gate + the credential to broker).
    ...(sandbox ? { sandbox } : {}),
    ...(piPolicy ? { piPolicy } : {}),
    ...(envAllow ? { envAllow } : {}),
    env: process.env,
    ...(timeoutMs ? { timeoutMs } : {}),
  })
}
