/**
 * Four-layer composition for a `runtime.kind: cordis` worker.
 *
 *   Layer 1  base       plumbing every worker shares (sessions, report seam, policy)
 *   Layer 2  recipe     prompt, skills, references, tools, model class
 *   Layer 3  project    .waypoint/config.yaml — class -> model, declared roots
 *   Layer 4  dispatch   the work order, the plan node's access map, fan-out item
 *
 * v1 is a FLAT DETERMINISTIC MERGE, not patch-by-row-id. Nothing here needs
 * that apparatus yet, and adding it before something does would make the
 * composition harder to read for no property gained.
 *
 * DETERMINISM IS THE CONTRACT. The same recipe on the same project produces a
 * byte-identical plan, and `planDigest()` proves it. This is the prose-gate
 * discipline applied to composition: the composer RESOLVES AND COPIES, it never
 * authors. Every free-text value in the output traces to a layer that supplied
 * it verbatim, which is what lets a gate reviewer trust the assembled prompt.
 *
 * The dispatch layer can only ever NARROW. A plan node may hand a worker less
 * than the project declares; it may never hand it more. A dispatch naming a
 * root the project never declared is refused here rather than resolved against
 * the filesystem, so a widened access map fails before it can reach the jail.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

import type { RecipeManifest } from '@waypoint/core'

import type { RecipeModelClass } from '../work-order.ts'
import type { WaypointProjectRootConfig } from '../../project/config.ts'

export class CordisCompositionError extends Error {}

/** Layer 1 — named so it is visible in the plan rather than implied by code. */
export interface CordisBaseLayer {
  readonly sessions: true
  readonly reportSeam: true
  readonly policy: 'closed'
}

export const CORDIS_BASE_LAYER: CordisBaseLayer = { sessions: true, reportSeam: true, policy: 'closed' }

/** Layer 3 — the project's contribution, mirroring `.waypoint/config.yaml`. */
export interface CordisProjectLayer {
  readonly projectRoot: string
  /** Declared named roots. A reference or tool path outside these is refused. */
  readonly roots: Readonly<Record<string, WaypointProjectRootConfig>>
  /** class -> concrete (provider, model), already routed by model-routing.ts. */
  readonly provider: string
  readonly model: string
  /**
   * Where skills are looked for, in order — FIRST HIT WINS.
   *
   * Ordered rather than single because three places legitimately hold a skill
   * and they are not equals:
   *
   *   1. the project's own `skills` root — an operator's tuning for this case,
   *      which must beat the shipped copy or the override is pointless;
   *   2. `.waypoint/skills` — the installed bundle, kept current by the catalog
   *      installer under the same manifest rule recipes follow;
   *   3. the bundle's own `skills/` — the fallback when running from source
   *      against a case that has not been installed into.
   *
   * These roots are the FENCE as well as the search path: a resolved skill must
   * land inside one of them. That is tighter than checking the project's data
   * roots, and it means a project need not declare a `skills` root at all to
   * use a shipped recipe.
   */
  readonly skillsRoots: readonly string[]
  /** The case root that `references:` resolve against. */
  readonly caseRoot: string
}

/** Layer 4 — this dispatch only. */
export interface CordisDispatchLayer {
  readonly routeId: string
  readonly taskId: string
  readonly prompt: string
  /** The plan node's access map. Narrows layer 3's roots; never widens them. */
  readonly access?: Readonly<Record<string, string>>
  readonly outputArtifacts?: readonly string[]
  readonly fanoutItem?: { readonly slug: string; readonly label: string; readonly path?: string }
}

export interface CordisResolvedSkill {
  readonly name: string
  readonly path: string
  readonly content: string
}

export interface CordisResolvedReference {
  readonly name: string
  readonly path: string
}

/** The merged result: everything the composer needs, and nothing it invented. */
export interface CordisCompositionPlan {
  readonly base: CordisBaseLayer
  readonly recipe: RecipeManifest
  readonly modelClass: RecipeModelClass
  readonly provider: string
  readonly model: string
  readonly tools: readonly string[]
  readonly toolGroup: string | undefined
  readonly projectRoot: string
  readonly caseRoot: string
  /**
   * Root name -> absolute path, narrowed by the dispatch access map. This is
   * the WORKER's world: references and every tool path are fenced against it.
   */
  readonly roots: Readonly<Record<string, string>>
  /**
   * Every root the project declares, un-narrowed.
   *
   * Skills are fenced against THIS rather than `roots`, and the distinction is
   * a real one, not a loophole: a skill is read by the composer in the host
   * process and baked into the system prompt, where the worker's access map has
   * no meaning. Fencing skills by the plan node's map would mean a node that
   * grants only `case` could not carry a cite-discipline skill — the recipe
   * would have to widen the worker's data access in order to give it an
   * instruction, which is exactly backwards.
   */
  readonly declaredRoots: Readonly<Record<string, string>>
  readonly dispatch: CordisDispatchLayer
}

/**
 * Merge the four layers, refusing rather than reconciling.
 *
 * The one asymmetry worth stating plainly: layers 1-3 describe what a worker
 * MAY have; layer 4 decides what this particular run DOES have, and can only
 * subtract. Anything else would let a plan node grant itself capability the
 * project never approved.
 */
export function mergeCordisLayers(
  recipe: RecipeManifest,
  project: CordisProjectLayer,
  dispatch: CordisDispatchLayer,
): CordisCompositionPlan {
  const declared = Object.keys(project.roots)
  const declaredRoots: Record<string, string> = {}
  for (const [name, config] of Object.entries(project.roots)) {
    declaredRoots[name] = resolve(project.projectRoot, config.path)
  }
  const roots: Record<string, string> = {}

  if (dispatch.access === undefined) {
    Object.assign(roots, declaredRoots)
  } else {
    for (const name of Object.keys(dispatch.access)) {
      const config = project.roots[name]
      if (!config) {
        throw new CordisCompositionError(
          `dispatch requests root '${name}', which the project does not declare ` +
            `(has: ${declared.sort().join(', ') || 'none'}). A dispatch narrows the project's ` +
            'roots; it never widens them.',
        )
      }
      roots[name] = resolve(project.projectRoot, config.path)
    }
  }

  return {
    base: CORDIS_BASE_LAYER,
    recipe,
    modelClass: recipe.runtime?.model_class ?? 'high',
    provider: project.provider,
    model: project.model,
    tools: recipe.tools ?? [],
    toolGroup: recipe.runtime?.tool_group,
    projectRoot: project.projectRoot,
    caseRoot: project.caseRoot,
    roots,
    declaredRoots,
    dispatch,
  }
}

/**
 * A stable fingerprint of the worker's SHAPE.
 *
 * Deliberately excludes the dispatch prompt, route id and task id: two
 * dispatches of one recipe on one project are the same worker doing different
 * work, and the digest is there to say what the worker WAS without replaying
 * what it was TOLD. That is the property that makes it useful on a gate — a
 * reviewer can confirm the shape is the approved one without reading the
 * instruction, and can see instantly when the shape changed.
 */
export function cordisPlanDigest(plan: CordisCompositionPlan, skills: readonly CordisResolvedSkill[]): string {
  const shape = {
    recipe: plan.recipe.slug,
    prompt: plan.recipe.prompt,
    provider: plan.provider,
    model: plan.model,
    tools: [...plan.tools].sort(),
    tool_group: plan.toolGroup ?? null,
    // The skill CONTENT, not just the name: an edited skill file is a different
    // worker even though the recipe is byte-identical. A digest that missed
    // that would certify a shape that had quietly changed underneath it.
    skills: [...skills].map((s) => ({ name: s.name, sha: sha256(s.content) })).sort((a, b) => cmp(a.name, b.name)),
    references: [...(plan.recipe.references ?? [])].sort(),
    roots: Object.keys(plan.roots).sort(),
  }
  return sha256(JSON.stringify(shape)).slice(0, 16)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Does this relative name stay inside the directory it will be joined to? */
function isContained(name: string): boolean {
  const rel = relative('.', join('.', name))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Every path must land inside a declared root — the seatbelt rule, one layer early. */
function insideRoots(path: string, roots: Readonly<Record<string, string>>): boolean {
  const target = resolve(path)
  return Object.values(roots).some((root) => {
    const rel = relative(resolve(root), target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

/**
 * A skill is `<skillsRoot>/<name>.md`, read VERBATIM.
 *
 * The composer never summarises, rewrites, or invents skill text — the same
 * rule the prose compiler follows for quest YAML. If the file is missing or
 * empty the composition fails by name, before a model is reached: a skill that
 * silently resolved to nothing would leave a worker running without the
 * discipline its recipe claims it has, and nothing downstream would notice.
 */
export async function resolveCordisSkills(
  names: readonly string[],
  skillsRoots: readonly string[],
): Promise<readonly CordisResolvedSkill[]> {
  const searched = skillsRoots.filter((root) => root !== '')
  const out: CordisResolvedSkill[] = []
  for (const name of [...names].sort()) {
    // A skill name MAY be namespaced (`medical-layer/cite-discipline`): the
    // bundle groups skills by area, and a flat namespace would collide the
    // moment two areas each want a `report-discipline`. What it may NOT do is
    // leave the root — an absolute name, or one that climbs out with `..`, is
    // refused before any root is touched.
    if (isAbsolute(name) || !isContained(name)) {
      throw new CordisCompositionError(
        `skill '${name}' escapes its skills root — a skill name is a path RELATIVE to a root, ` +
          'and may not be absolute or climb out of it',
      )
    }
    let found: CordisResolvedSkill | undefined
    for (const root of searched) {
      const path = join(root, `${name}.md`)
      const content = await readFile(path, 'utf8').catch(() => null)
      if (content === null) continue
      if (content.trim() === '') {
        throw new CordisCompositionError(
          `skill '${name}' is empty at ${path} — refusing to mount an empty section`,
        )
      }
      found = { name, path, content }
      break
    }
    if (!found) {
      throw new CordisCompositionError(
        `skill '${name}' names no file in any skills root — a skill must be real content, not a label. ` +
          `Searched, in order: ${searched.map((r) => join(r, `${name}.md`)).join(', ') || '(no skills root configured)'}`,
      )
    }
    out.push(found)
  }
  return out
}

/**
 * References are resolved and checked to exist, but NOT read at compose time —
 * the worker reads them through `read_reference`, so the tool is the audit
 * point and there is exactly one place a read is recorded.
 */
export async function resolveCordisReferences(
  names: readonly string[],
  caseRoot: string,
  roots: Readonly<Record<string, string>>,
): Promise<readonly CordisResolvedReference[]> {
  const out: CordisResolvedReference[] = []
  for (const name of [...names].sort()) {
    const path = join(caseRoot, name)
    if (!insideRoots(path, roots)) {
      throw new CordisCompositionError(
        `reference '${name}' resolves to ${path}, which is outside the project's declared roots — refused`,
      )
    }
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new CordisCompositionError(`reference '${name}' names no file at ${path}`)
    out.push({ name, path })
  }
  return out
}
