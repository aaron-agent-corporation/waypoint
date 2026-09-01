/**
 * Fan-out: one authored plan becomes N sibling plans, one per item, at START
 * time (rsc-m23.7).
 *
 * Why this is a compile-time expansion and not a loop in the graph: `df.loop`
 * is the engine's only iteration operator and it is guardrailed SHUT against
 * recipes — a loop iteration is ContinuedAsNew, so the whole graph re-executes
 * with fresh history and a recipe would re-enqueue a worker run every pass
 * (docs/designs/df-operator-coverage.md, the B4.5 finding, executed in vivo).
 * The precedent for doing it here instead is X5: the `{waypoint_*}` start-time
 * variables are substituted at compile time for the same reason — the runtime
 * construct was broken, the values are start-time constants either way, and
 * conversion-time expansion has identical semantics with no engine exposure.
 *
 * What it buys, and why the medical layer needed it: coverage stops being
 * something a worker remembers and becomes a row count. A worker that is handed
 * one item cannot skip an item it was never handed, every item gets its own
 * task/dispatch (so it checkpoints and retries alone), and "did every item get
 * worked" is a SELECT against tasks rather than a question for the agent. The
 * closed-tool-surface runs lost six and one encounters respectively because
 * `list_documents` handed over the whole worklist once and nothing tracked it
 * afterwards.
 *
 * Determinism contract, same as the df compiler and tools/prose: byte-stable
 * output for identical input. Items are sorted before expansion, so filesystem
 * order never reaches the graph.
 *
 * The expansion TRANSLATES; it never authors. Every free-text value is copied
 * from the plan, with `{item}` / `{item_slug}` substituted from the resolved
 * item — the author writes the sentence, the expansion fills the blank.
 */

import { readdir } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One resolved fan-out item: what the worker will be handed. */
export interface FanoutItem {
  /** Stable identity, used in the derived plan_ref. */
  readonly slug: string
  /** What the author's `{item}` renders as. */
  readonly label: string
  /** Project-relative path this item stands for, when it has one. */
  readonly path?: string
}

export interface FanoutSpec {
  /** Directory, project-relative, whose entries become items. */
  readonly dir: string
  /** Glob-free suffix filter; an entry must end with it. */
  readonly ends_with?: string
  /**
   * True when the items are SUBDIRECTORIES rather than files. The case's
   * provider registry is one directory per provider, so the first version of
   * this — files only, matched on '.md' — would have fanned out over the
   * registry's README and nothing else: a fan-out that resolves to the wrong
   * one item is worse than one that resolves to none.
   */
  readonly directories?: boolean
  /** Refuse to start on an empty list unless the author opted in. */
  readonly allow_empty?: boolean
}

/**
 * plan_ref is escaped wherever the df compiler interpolates it, but a derived
 * ref also becomes a node identity and a task key, so keep it to the charset
 * the rest of the route model already uses. Fail closed on anything else — a
 * slug that needs escaping is a slug that will surprise someone later.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

const FANOUT_SEPARATOR = '--'

/** Reads the fan-out block off a plan's metadata, or undefined if it has none. */
export function fanoutSpecFor(metadata: Record<string, unknown> | undefined): FanoutSpec | undefined {
  const runner = isRecord(metadata?.runner) ? metadata.runner : undefined
  const fanout = isRecord(runner?.fanout) ? runner.fanout : undefined
  if (fanout === undefined) return undefined
  const dir = fanout.dir
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('fanout block has no `dir` to expand over (fail closed)')
  }
  return {
    dir,
    ...(typeof fanout.ends_with === 'string' ? { ends_with: fanout.ends_with } : {}),
    ...(fanout.directories === true ? { directories: true } : {}),
    ...(fanout.allow_empty === true ? { allow_empty: true } : {}),
  }
}

/**
 * Turns directory entries into fan-out items: sorted, filtered, de-suffixed.
 *
 * Pure so the ordering rule is testable without a filesystem — the caller reads
 * the directory, this decides what the graph sees.
 */
export function fanoutItemsFrom(spec: FanoutSpec, entries: readonly string[]): FanoutItem[] {
  const suffix = spec.ends_with
  const kept = suffix === undefined ? [...entries] : entries.filter((entry) => entry.endsWith(suffix))
  // Sort BEFORE slugging: the graph must not depend on readdir order.
  kept.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return kept.map((entry) => {
    const label = suffix === undefined ? entry : entry.slice(0, entry.length - suffix.length)
    if (!SLUG_PATTERN.test(label)) {
      throw new Error(
        `fan-out item ${JSON.stringify(entry)} in '${spec.dir}' does not yield a usable plan ref ` +
          `(expected ${String(SLUG_PATTERN)}) — it would become a task key, so it must be a plain slug (fail closed)`,
      )
    }
    return { slug: label, label, path: `${spec.dir}/${entry}` }
  })
}

/**
 * The one impure step: read the directory a fan-out expands over.
 *
 * Kept apart from the pure core above so the ordering and admission rules stay
 * testable without a filesystem. `dir` is project-relative and must stay inside
 * the project — a fan-out is authored in a quest, and a quest must not be able
 * to reach out of the case it runs in.
 */
export async function readFanoutDirectory(projectRoot: string, spec: FanoutSpec, planRef: string): Promise<FanoutItem[]> {
  if (isAbsolute(spec.dir) || normalize(spec.dir).split('/').includes('..')) {
    throw new Error(
      `plan '${planRef}' fans out over '${spec.dir}', which leaves the project — fan-out directories are ` +
        `project-relative (fail closed)`,
    )
  }
  let entries: string[]
  try {
    const found = await readdir(join(projectRoot, spec.dir), { withFileTypes: true })
    // Filter by kind BEFORE the pure half sees names: whether an item is a file
    // or a directory is a filesystem fact, not an ordering rule.
    entries = found
      .filter((entry) => (spec.directories === true ? entry.isDirectory() : entry.isFile()))
      .map((entry) => entry.name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `plan '${planRef}' fans out over '${spec.dir}', which could not be read — the step would cover nothing ` +
        `(fail closed): ${message}`,
    )
  }
  return fanoutItemsFrom(spec, entries)
}

/**
 * Expand a quest manifest's scaffolds against the project on disk. This is the
 * seam route start calls: everything downstream — task materialization, the df
 * compiler, the when-predicate probe — then sees N plans and needs no knowledge
 * that a fan-out ever existed.
 */
export async function expandQuestFanoutFromDisk<T extends { readonly scaffolds?: unknown }>(
  projectRoot: string,
  quest: T,
): Promise<T> {
  if (quest.scaffolds === undefined) return quest
  // Resolve every directory first: expandQuestFanout is synchronous by design
  // (it is the deterministic half), so the reads happen up front.
  const resolved = new Map<string, FanoutItem[]>()
  for (const plan of fanoutPlansOf(quest.scaffolds)) {
    resolved.set(plan.planRef, await readFanoutDirectory(projectRoot, plan.spec, plan.planRef))
  }
  if (resolved.size === 0) return quest
  const scaffolds = expandQuestFanout(quest.scaffolds, (_spec, planRef) => resolved.get(planRef) ?? [])
  return { ...quest, scaffolds }
}

/** Every fan-out plan in a scaffold, so start can read each directory once. */
function fanoutPlansOf(scaffolds: unknown): { planRef: string; spec: FanoutSpec }[] {
  const found: { planRef: string; spec: FanoutSpec }[] = []
  if (!isRecord(scaffolds) || !Array.isArray(scaffolds.workstreams)) return found
  for (const workstream of scaffolds.workstreams) {
    if (!isRecord(workstream) || !Array.isArray(workstream.milestones)) continue
    for (const milestone of workstream.milestones) {
      if (!isRecord(milestone) || !Array.isArray(milestone.phases)) continue
      for (const phase of milestone.phases) {
        if (!isRecord(phase) || !Array.isArray(phase.plans)) continue
        for (const plan of phase.plans) {
          if (!isRecord(plan) || typeof plan.plan_ref !== 'string') continue
          const spec = fanoutSpecFor(isRecord(plan.metadata) ? plan.metadata : undefined)
          if (spec !== undefined) found.push({ planRef: plan.plan_ref, spec })
        }
      }
    }
  }
  return found
}

/** Substitutes the item into author text. Translation, not authoring. */
function renderTemplate(text: string, item: FanoutItem): string {
  return text.split('{item_slug}').join(item.slug).split('{item}').join(item.label)
}

/**
 * Expands every fan-out plan in a quest's scaffolds into one plan per item,
 * leaving every other plan untouched and in place.
 *
 * Expanded siblings keep the source plan's wave, so they compile to the X1
 * parallel-join that is already conformance-tested — the fan-out runs in
 * parallel and the route joins before the next wave.
 */
export function expandQuestFanout(
  scaffolds: unknown,
  resolve: (spec: FanoutSpec, planRef: string) => readonly FanoutItem[],
): unknown {
  if (!isRecord(scaffolds) || !Array.isArray(scaffolds.workstreams)) return scaffolds
  return {
    ...scaffolds,
    workstreams: scaffolds.workstreams.map((workstream) => {
      if (!isRecord(workstream) || !Array.isArray(workstream.milestones)) return workstream
      return {
        ...workstream,
        milestones: workstream.milestones.map((milestone) => {
          if (!isRecord(milestone) || !Array.isArray(milestone.phases)) return milestone
          return {
            ...milestone,
            phases: milestone.phases.map((phase) => {
              if (!isRecord(phase) || !Array.isArray(phase.plans)) return phase
              return { ...phase, plans: phase.plans.flatMap((plan) => expandPlan(plan, resolve)) }
            }),
          }
        }),
      }
    }),
  }
}

function expandPlan(plan: unknown, resolve: (spec: FanoutSpec, planRef: string) => readonly FanoutItem[]): unknown[] {
  if (!isRecord(plan) || typeof plan.plan_ref !== 'string') return [plan]
  const metadata = isRecord(plan.metadata) ? plan.metadata : undefined
  const spec = fanoutSpecFor(metadata)
  if (spec === undefined) return [plan]

  const items = resolve(spec, plan.plan_ref)
  if (items.length === 0) {
    if (spec.allow_empty !== true) {
      // A fan-out over nothing is a step that silently does no work — the exact
      // class of loss this primitive exists to close. Refuse before any rows.
      throw new Error(
        `plan '${plan.plan_ref}' fans out over '${spec.dir}', which resolved to no items — ` +
          `the step would silently do nothing (set fanout.allow_empty to accept an empty run, fail closed)`,
      )
    }
    return []
  }

  const runner = isRecord(metadata?.runner) ? metadata.runner : {}
  const seen = new Set<string>()
  return items.map((item) => {
    const planRef = `${plan.plan_ref}${FANOUT_SEPARATOR}${item.slug}`
    if (seen.has(planRef)) {
      throw new Error(`fan-out of plan '${plan.plan_ref}' produced the duplicate ref '${planRef}' (fail closed)`)
    }
    seen.add(planRef)
    const { fanout: _dropped, ...runnerRest } = runner as Record<string, unknown>
    return {
      ...plan,
      plan_ref: planRef,
      title: typeof plan.title === 'string' ? renderTemplate(plan.title, item) : plan.title,
      metadata: {
        ...metadata,
        runner: {
          ...runnerRest,
          // What the worker host hands the worker. The expansion is invisible
          // to every downstream consumer except this: the work order names the
          // one item this dispatch owns.
          fanout_item: { slug: item.slug, label: item.label, ...(item.path === undefined ? {} : { path: item.path }) },
        },
      },
    }
  })
}
