/**
 * Producer-side artifact contracts (rsc-6al).
 *
 * `required_paths` verification proves a declared artifact EXISTS and is
 * non-empty; it says nothing about whether the content satisfies its
 * consumer. A contract closes the gap by running a CONSUMER-DERIVED check
 * against the scratch before verify-then-apply admits anything into the
 * project tree — the producer task fails at completion, with the consumer's
 * own diagnostics, while the fix is one retry away instead of a failed
 * downstream node.
 *
 * Registry rules mirror the deterministic entrypoint registry: contracts are
 * vetted host code keyed by name; an unknown name fails closed (compile
 * admission refuses it, and the runtime refuses it again if one slips
 * through). A contract inspects — it NEVER writes to the scratch or the
 * project tree.
 *
 * Contracts are a worker-recipe feature: deterministic recipes are already
 * vetted code that fails loudly on its own inputs and needs no second judge.
 *
 * The core distribution ships an EMPTY registry: contracts are a host
 * extension point. A host (or a later core module) registers vetted checks
 * here; recipes then name them in `artifact_contract` metadata.
 */

export interface ArtifactContractInput {
  /**
   * Directory holding the artifacts under judgement. The verify-then-apply
   * scratch when jailed; the project root itself on a scratchless run (the
   * agent wrote in place) — a declared contract always runs.
   */
  readonly scratchDir: string
  /** The real project root — sources under judgement resolve here. */
  readonly projectRoot: string
}

/** Returns consumer-grade problems; empty means the contract is satisfied. */
export type ArtifactContractCheck = (input: ArtifactContractInput) => Promise<readonly string[]>

const CONTRACTS: Record<string, ArtifactContractCheck> = {}

export function knownArtifactContracts(): readonly string[] {
  return Object.keys(CONTRACTS)
}

export function artifactContractFor(name: string): ArtifactContractCheck | null {
  return CONTRACTS[name] ?? null
}

/**
 * Register a vetted contract — the host extension point this module exists
 * for. Re-registering a name replaces it (idempotent host startup); there is
 * no unregister because a contract a running route can name must never
 * vanish mid-flight.
 */
export function registerArtifactContract(name: string, check: ArtifactContractCheck): void {
  CONTRACTS[name] = check
}
