/**
 * Deep structural validation for a quest manifest's `scaffolds` tree.
 *
 * The catalog loader type-checks only the shallow manifest fields; the
 * scaffolds tree used to pass through as `unknown`, so a malformed quest
 * (hand-edited or prose-compiled) failed silently or at runtime. This is
 * the compile fence: validate the waypoint-critical structure at load time and
 * fail loud with a path-annotated message.
 *
 * Unknown extra keys are allowed (forward compatibility); known keys are
 * type-checked; waypoint-critical fields (plan_ref/title/wave, a valid
 * node.type, recipe.slug on recipe nodes, gate.kind on gates) are required.
 */

import { whenPredicateProblems } from '../pgdurable/when.ts'

const NODE_TYPES = new Set([
  'checkpoint',
  'recipe',
  'gate',
  'artifact',
  'handoff',
  'wait',
  'discussion',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pushIfNotString(errors: string[], value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}: expected non-empty string`)
  }
}

function checkStringArray(errors: string[], value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected list of strings`)
    return
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string') errors.push(`${path}[${i}]: expected string`)
  })
}

/**
 * Per-plan access map (rsc-8ip): `{ <root binding> -> 'ro' | 'rw' }`. Names
 * reference roots declared in `.waypoint/config.yaml`. Declarative only here —
 * shape validation, no cross-reference to config and no overlap enforcement
 * (the profile compiler resolves overlaps — ro-holes and the same-path
 * fail-closed — at compile time, rsc-urj/rsc-w0z).
 */
function checkAccessMap(errors: string[], value: unknown, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected mapping of root -> 'ro' | 'rw'`)
    return
  }
  for (const [binding, mode] of Object.entries(value)) {
    // 'ro?'/'rw?' are optional bindings (rsc-rvz): operator-granted external
    // roots (e.g. user_case) the jail skips when the project lacks them.
    if (mode !== 'ro' && mode !== 'rw' && mode !== 'ro?' && mode !== 'rw?') {
      errors.push(`${path}.${binding}: expected 'ro', 'rw', 'ro?', or 'rw?'`)
    }
  }
}

function checkPlanWaypoint(errors: string[], value: unknown, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected mapping`)
    return
  }
  const node = value.node
  if (!isRecord(node) || typeof node.type !== 'string') {
    errors.push(`${path}.node.type: required`)
    return
  }
  if (!NODE_TYPES.has(node.type)) {
    errors.push(`${path}.node.type: unknown type '${node.type}' (expected one of ${[...NODE_TYPES].join(', ')})`)
  }
  if (node.type === 'recipe') {
    const recipe = value.recipe
    if (!isRecord(recipe) || typeof recipe.slug !== 'string' || recipe.slug.length === 0) {
      errors.push(`${path}.recipe.slug: required for recipe nodes`)
    }
  }
  if (node.type === 'gate') {
    const gate = value.gate
    if (!isRecord(gate) || typeof gate.kind !== 'string' || gate.kind.length === 0) {
      errors.push(`${path}.gate.kind: required for gate nodes`)
    }
  }
  if (value.required_when !== undefined && typeof value.required_when !== 'string') {
    errors.push(`${path}.required_when: expected string`)
  }
  // X2: `when` is a machine-evaluable SQL predicate (df.if condition), unlike
  // required_when's worker-judged prose. Admission is fail closed — the same
  // rules the df compiler enforces (see pgdurable/when.ts).
  if (value.when !== undefined) {
    if (typeof value.when !== 'string' || value.when.trim().length === 0) {
      errors.push(`${path}.when: expected a non-empty string (machine-evaluable SQL predicate)`)
    } else {
      for (const problem of whenPredicateProblems(value.when)) {
        errors.push(`${path}.when: ${problem}`)
      }
      if (node.type === 'gate') {
        errors.push(`${path}.when: gates are human decision points and are never machine-skipped (fail closed)`)
      }
    }
  }
  if (value.output_artifacts !== undefined) {
    checkStringArray(errors, value.output_artifacts, `${path}.output_artifacts`)
  }
  if (value.access !== undefined) {
    checkAccessMap(errors, value.access, `${path}.access`)
  }
  if (value.instructions !== undefined) {
    checkStringArray(errors, value.instructions, `${path}.instructions`)
  }
  if (value.artifact_verifier !== undefined) {
    const verifier = value.artifact_verifier
    if (!isRecord(verifier) || typeof verifier.kind !== 'string') {
      errors.push(`${path}.artifact_verifier.kind: required`)
    } else if (verifier.checks !== undefined) {
      checkStringArray(errors, verifier.checks, `${path}.artifact_verifier.checks`)
    }
  }
  if (value.review !== undefined) {
    const review = value.review
    if (!isRecord(review)) {
      errors.push(`${path}.review: expected mapping`)
    } else if (review.checks !== undefined) {
      checkStringArray(errors, review.checks, `${path}.review.checks`)
    }
  }
  if (value.handoff !== undefined) {
    const handoff = value.handoff
    if (!isRecord(handoff) || typeof handoff.kind !== 'string') {
      errors.push(`${path}.handoff.kind: required`)
    }
  }
  if (value.wait !== undefined) {
    const wait = value.wait
    if (!isRecord(wait) || typeof wait.kind !== 'string') {
      errors.push(`${path}.wait.kind: required`)
    }
    // X3: gates are never clock-bound — humans decide, never the clock.
    if (node.type === 'gate') {
      errors.push(`${path}.wait: gates park indefinitely; humans decide, never the clock (fail closed)`)
    }
  }
  if (node.type === 'wait') {
    // X3: a wait must be endable — by the clock (days) or by an observed
    // landmark. One with neither is unbounded and unresolvable.
    const wait = isRecord(value.wait) ? value.wait : {}
    const hasDays = typeof wait.days === 'number' && Number.isFinite(wait.days) && wait.days >= 0
    const hasLandmark = ['landmark', 'exit_landmark'].some(
      (key) => typeof wait[key] === 'string' && (wait[key] as string).trim().length > 0,
    )
    if (!hasDays && !hasLandmark) {
      errors.push(`${path}.wait: a wait needs days (clock) or a landmark (observed exit) — one with neither can never end (fail closed)`)
    }
  }
}

function checkPlan(errors: string[], value: unknown, path: string): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected mapping`)
    return
  }
  pushIfNotString(errors, value.plan_ref, `${path}.plan_ref`)
  pushIfNotString(errors, value.title, `${path}.title`)
  if (typeof value.wave !== 'number' || !Number.isInteger(value.wave) || value.wave < 1) {
    errors.push(`${path}.wave: expected positive integer`)
  }
  const metadata = value.metadata
  if (metadata !== undefined) {
    if (!isRecord(metadata)) {
      errors.push(`${path}.metadata: expected mapping`)
    } else if (metadata.runner !== undefined) {
      checkPlanWaypoint(errors, metadata.runner, `${path}.metadata.runner`)
    }
  }
}

function checkPhase(errors: string[], value: unknown, path: string, planRefs: Map<string, string>): void {
  if (!isRecord(value)) {
    errors.push(`${path}: expected mapping`)
    return
  }
  pushIfNotString(errors, value.phase_key, `${path}.phase_key`)
  pushIfNotString(errors, value.phase_slug, `${path}.phase_slug`)
  pushIfNotString(errors, value.lifecycle_phase, `${path}.lifecycle_phase`)
  if (value.plans === undefined) return
  if (!Array.isArray(value.plans)) {
    errors.push(`${path}.plans: expected list`)
    return
  }
  value.plans.forEach((plan, i) => {
    const planPath = `${path}.plans[${i}]`
    checkPlan(errors, plan, planPath)
    if (isRecord(plan) && typeof plan.plan_ref === 'string') {
      const existing = planRefs.get(plan.plan_ref)
      if (existing !== undefined) {
        errors.push(`${planPath}.plan_ref: duplicate '${plan.plan_ref}' (also at ${existing})`)
      } else {
        planRefs.set(plan.plan_ref, planPath)
      }
    }
  })
}

/**
 * Validate a quest manifest's `scaffolds` value. Returns path-annotated
 * error strings; empty means valid. `undefined` scaffolds is valid (a quest
 * may be a bare recipe roster).
 */
export function validateQuestScaffolds(scaffolds: unknown): string[] {
  const errors: string[] = []
  if (scaffolds === undefined || scaffolds === null) return errors
  if (!isRecord(scaffolds)) return ['scaffolds: expected mapping']
  if (scaffolds.workstreams === undefined) return errors
  if (!Array.isArray(scaffolds.workstreams)) return ['scaffolds.workstreams: expected list']

  scaffolds.workstreams.forEach((ws, wi) => {
    const wsPath = `scaffolds.workstreams[${wi}]`
    if (!isRecord(ws)) {
      errors.push(`${wsPath}: expected mapping`)
      return
    }
    pushIfNotString(errors, ws.key, `${wsPath}.key`)
    pushIfNotString(errors, ws.name, `${wsPath}.name`)
    if (!Array.isArray(ws.milestones)) {
      errors.push(`${wsPath}.milestones: expected list`)
      return
    }
    ws.milestones.forEach((ms, mi) => {
      const msPath = `${wsPath}.milestones[${mi}]`
      if (!isRecord(ms)) {
        errors.push(`${msPath}: expected mapping`)
        return
      }
      pushIfNotString(errors, ms.version_label, `${msPath}.version_label`)
      pushIfNotString(errors, ms.title, `${msPath}.title`)
      if (!Array.isArray(ms.phases)) {
        errors.push(`${msPath}.phases: expected list`)
        return
      }
      // plan_refs must be unique across the whole milestone — gates and
      // handoffs reference them by ref.
      const planRefs = new Map<string, string>()
      ms.phases.forEach((ph, pi) => {
        checkPhase(errors, ph, `${msPath}.phases[${pi}]`, planRefs)
      })
    })
  })
  return errors
}
