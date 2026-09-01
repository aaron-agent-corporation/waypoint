import { parse as yamlParse } from 'yaml'

/**
 * RecipeManifest — the structural shape of a Recipe manifest (YAML file).
 *
 * A Recipe is a named, reusable agent definition. It captures a prompt,
 * runtime hints (model, temperature, tokens), an allowed tool list, and
 * an optional set of subagent references. Recipes are composed by Quests.
 */
export type RecipeManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly prompt: string
  readonly description?: string
  readonly runtime?: RecipeRuntimeHints
  readonly tools?: readonly string[]
  /**
   * For `kind: cordis` — named skills, each resolving to `<skills root>/<name>.md`
   * and mounted as a prompt section carrying the file's content VERBATIM.
   *
   * The point of the field is that a skill stops being advice. Today skill text
   * reaches a worker as prose someone pasted into `prompt:`, which means nothing
   * checks that it is current, nothing records which version ran, and a typo in
   * the name is invisible. Named here, an unresolvable skill fails composition
   * by name before a model is reached, and the assembled prompt carries the
   * source path of every section.
   *
   * The composer TRANSLATES; it never authors — the same rule the prose
   * compiler follows for quest YAML.
   */
  readonly skills?: readonly string[]
  /**
   * For `kind: cordis` — the documents this recipe may read, relative to the
   * case root, and THE ONLY ONES. They are reachable through the `read_reference`
   * tool whose schema enumerates exactly these names; there is no open file read
   * on a cordis worker, so an unlisted document does not exist in its world.
   *
   * Absent or empty grants no reading tool at all, rather than a tool that
   * always refuses: a capability that was not granted should not be present.
   */
  readonly references?: readonly string[]
  readonly subagents?: readonly string[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type RecipeModelClass = 'high' | 'medium' | 'low'

/**
 * Execution kind. `agent` (the default) is a prompt run by the worker host
 * spawning the configured agent command. `deterministic` is a vetted
 * host-side step (a named `entrypoint`, no prompt, no model) the bridge runs
 * as a subprocess under the same Seatbelt write jail — used for mechanical,
 * exact work (copying/segmenting documents into a package) that must not be
 * entrusted to a language model. See docs/designs/deterministic-recipes.md.
 *
 * `pi` is an agent recipe run by the in-process pi-agent-core loop
 * (PiRecipeRuntime, rsc-tka) instead of spawning `claude -p`: it resolves
 * model_class → (provider, model) via the provider registry, drives the
 * chosen provider off the stored OAuth, grants recipe-scoped tools from a
 * vetted registry, and enforces the Console policy at beforeToolCall. Like
 * `agent`, it carries a prompt; unlike `deterministic`, no entrypoint. See
 * docs/designs/pi-runtime-pivot-scope.md.
 *
 * `cordis` is an agent recipe composed by the Waypoint harness: the recipe names
 * every layer of its worker — skills, references, tools, model class — and the
 * composer refuses at compose time if any named thing does not resolve. Unlike
 * `pi`, whose tools come from an in-process registry, a cordis worker's tools
 * come from the Waypoint MCP server, sliced by `tool_group`. Like `agent` and
 * `pi` it carries a prompt; unlike `deterministic`, no entrypoint.
 * See docs/designs/waypoint-harness.md.
 */
export type RecipeRuntimeKind = 'agent' | 'deterministic' | 'pi' | 'cordis'

export type RecipeRuntimeHints = {
  readonly model?: string
  /**
   * Capability tier, resolved against the project's configured providers at
   * dispatch time (runtime.worker.model_args in .waypoint/config.yaml).
   * Preferred over `model`: a class survives provider changes, a model id
   * does not. Unset = the runtime's default target/model.
   */
  readonly model_class?: RecipeModelClass
  /**
   * Which slice of its tool surface this step is given, for workers that run
   * on a CLOSED surface instead of read/bash/write (an MCP tool server).
   * Reaches the worker as WAYPOINT_TOOL_GROUP; the surface fails closed on a name
   * it does not know.
   *
   * This is how one tool surface serves a whole quest without handing every
   * step every capability: the refuter gets no way to rewrite the pages it is
   * judging, the extractor gets no way to post to the billing ledger, and
   * neither can reach the other's report file. A step's blast radius becomes
   * the group named here, and it is reviewable in the recipe diff.
   *
   * Absent = the surface decides, which for a shell-and-files worker is
   * everything it can reach, as before.
   */
  readonly tool_group?: string
  readonly temperature?: number
  readonly max_tokens?: number
  /** Execution kind; absent = 'agent'. */
  readonly kind?: RecipeRuntimeKind
  /**
   * For `kind: cordis` — how many model turns this worker may take before the
   * host calls it exhausted.
   *
   * A turn budget is a real property of the work, not a constant: a census over
   * three documents and a full-size extraction over three hundred are the same
   * recipe shape and nowhere near the same number of turns. The default (24) was
   * chosen for a small case and silently caps a large one, so the recipe that
   * knows the size of its job gets to say.
   *
   * Exhaustion is never `finished`. Raising this buys more attempts at the work;
   * it does not change what counts as having done it.
   */
  readonly max_turns?: number
  /**
   * For `kind: deterministic` — the vetted host-step name the deterministic
   * runtime resolves to an argv. Not an arbitrary command: unknown
   * entrypoints fail closed (no arbitrary code path from recipe YAML).
   */
  readonly entrypoint?: string
}

const RECIPE_MODEL_CLASSES: readonly RecipeModelClass[] = ['high', 'medium', 'low']
const RECIPE_RUNTIME_KINDS: readonly RecipeRuntimeKind[] = ['agent', 'deterministic', 'pi', 'cordis']

/**
 * `skills:` and `references:` are cordis-only. Accepting them silently on any
 * other kind would be the worst of both worlds: the recipe author believes a
 * skill is loaded and enforced, and the runtime that actually runs never looks
 * at the field. Refuse instead — the same lesson as `tool_group`.
 */
const CORDIS_ONLY_FIELDS = ['skills', 'references'] as const

/**
 * The kinds that actually READ `tools:`. Everything that needs to know — the
 * bridge, an audit, a lint, a doc — asks here rather than restating the list.
 *
 * Restating it is the whole reason this exists. `tools:` looks like a
 * restriction on every recipe that carries one, and on `agent`/`worker` it is
 * inert: the field is parsed, stored, never forwarded, and 118 recipes read as
 * though they were sandboxed when nothing narrowed them. The audit item that
 * tracked this was written with the wrong predicate twice — first "pi only",
 * which was right until cordis landed and then silently was not, and once
 * recommending the field be deleted outright, which would have broken the two
 * legal `kind: pi` recipes that do enforce it. Two wrong answers to one
 * question is a sign the question had no single owner.
 *
 * Add a kind that consumes the field and this list is the one place to change.
 */
const TOOLS_CONSUMING_KINDS: readonly RecipeRuntimeKind[] = ['pi', 'cordis']

/**
 * Whether a recipe's `tools:` reaches the runtime that will execute it — i.e.
 * whether the list restricts anything. False means the field is documentation
 * at best: state that plainly rather than letting a reader assume a sandbox.
 */
export function runtimeKindConsumesTools(kind: RecipeRuntimeKind | undefined): boolean {
  // Absent kind is the `agent`/worker default, which does not forward tools.
  return kind !== undefined && TOOLS_CONSUMING_KINDS.includes(kind)
}

/** The kinds that enforce `tools:`, for messages that need to name them. */
export function toolsConsumingRuntimeKinds(): readonly RecipeRuntimeKind[] {
  return TOOLS_CONSUMING_KINDS
}

function stringList(
  raw: Record<string, unknown>,
  field: string,
): RecipeManifestParseError | readonly string[] | undefined {
  if (!(field in raw) || raw[field] === undefined) return undefined
  const value = raw[field]
  if (!Array.isArray(value)) {
    return { code: 'invalid_field_type', message: `${field} must be an array`, path: field }
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || (value[i] as string).trim() === '') {
      return {
        code: 'invalid_field_type',
        message: `${field} entries must be non-empty strings`,
        path: `${field}[${i}]`,
      }
    }
  }
  // A name repeated is a mistake, not an intention: it would mount the same
  // prompt section twice or enumerate a reference twice in the tool schema.
  const seen = new Set<string>()
  for (const entry of value as readonly string[]) {
    if (seen.has(entry)) {
      return { code: 'invalid_field_type', message: `${field} lists '${entry}' more than once`, path: field }
    }
    seen.add(entry)
  }
  return value as readonly string[]
}

function isParseError(value: unknown): value is RecipeManifestParseError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
}

export type RecipeManifestParseResult =
  | { readonly ok: true; readonly manifest: RecipeManifest }
  | { readonly ok: false; readonly error: RecipeManifestParseError }

export type RecipeManifestParseErrorCode =
  | 'invalid_input'
  | 'empty_input'
  | 'parse_error'
  | 'not_a_map'
  | 'missing_schema_version'
  | 'unsupported_schema_version'
  | 'missing_field'
  | 'invalid_field_type'

export type RecipeManifestParseError = {
  readonly code: RecipeManifestParseErrorCode
  readonly message: string
  readonly path?: string
}

const SUPPORTED_SCHEMA_VERSIONS = new Set<number>([1])

export function parseRecipeManifest(yamlText: unknown): RecipeManifestParseResult {
  if (typeof yamlText !== 'string') {
    return { ok: false, error: { code: 'invalid_input', message: 'input must be a string' } }
  }
  if (yamlText.trim() === '') {
    return { ok: false, error: { code: 'empty_input', message: 'input is empty' } }
  }

  let parsed: unknown
  try {
    parsed = yamlParse(yamlText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'yaml parse failed'
    return { ok: false, error: { code: 'parse_error', message: msg } }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: { code: 'not_a_map', message: 'top-level must be a mapping' } }
  }

  const raw = parsed as Record<string, unknown>

  if (!('schema_version' in raw)) {
    return { ok: false, error: { code: 'missing_schema_version', message: 'schema_version is required' } }
  }
  const schemaVersion = raw.schema_version
  if (typeof schemaVersion !== 'number' || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return {
      ok: false,
      error: {
        code: 'unsupported_schema_version',
        message: `schema_version must be one of: ${Array.from(SUPPORTED_SCHEMA_VERSIONS).join(', ')}`,
      },
    }
  }

  // Peek at the runtime kind first: a deterministic recipe is a host step
  // with no prompt, so `prompt` is required only for agent recipes.
  const runtimeRaw =
    typeof raw.runtime === 'object' && raw.runtime !== null && !Array.isArray(raw.runtime)
      ? (raw.runtime as Record<string, unknown>)
      : undefined
  const isDeterministic = runtimeRaw?.kind === 'deterministic'
  const requiredStringFields = isDeterministic ? (['slug', 'name'] as const) : (['slug', 'name', 'prompt'] as const)

  for (const field of requiredStringFields) {
    if (!(field in raw)) {
      return { ok: false, error: { code: 'missing_field', message: `${field} is required`, path: field } }
    }
    if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: `${field} must be a non-empty string`, path: field },
      }
    }
  }

  if ('description' in raw && raw.description !== undefined && typeof raw.description !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_field_type', message: 'description must be a string', path: 'description' },
    }
  }

  let runtime: RecipeRuntimeHints | undefined
  if ('runtime' in raw && raw.runtime !== undefined) {
    if (typeof raw.runtime !== 'object' || raw.runtime === null || Array.isArray(raw.runtime)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'runtime must be a mapping', path: 'runtime' },
      }
    }
    const rr = raw.runtime as Record<string, unknown>
    if ('model' in rr && rr.model !== undefined && typeof rr.model !== 'string') {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'runtime.model must be a string', path: 'runtime.model' },
      }
    }
    if (
      'model_class' in rr &&
      rr.model_class !== undefined &&
      !RECIPE_MODEL_CLASSES.includes(rr.model_class as RecipeModelClass)
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: `runtime.model_class must be one of: ${RECIPE_MODEL_CLASSES.join(', ')}`,
          path: 'runtime.model_class',
        },
      }
    }
    if ('temperature' in rr && rr.temperature !== undefined && typeof rr.temperature !== 'number') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.temperature must be a number',
          path: 'runtime.temperature',
        },
      }
    }
    if ('max_tokens' in rr && rr.max_tokens !== undefined && typeof rr.max_tokens !== 'number') {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.max_tokens must be a number',
          path: 'runtime.max_tokens',
        },
      }
    }
    if ('kind' in rr && rr.kind !== undefined && !RECIPE_RUNTIME_KINDS.includes(rr.kind as RecipeRuntimeKind)) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: `runtime.kind must be one of: ${RECIPE_RUNTIME_KINDS.join(', ')}`,
          path: 'runtime.kind',
        },
      }
    }
    if ('max_turns' in rr && rr.max_turns !== undefined) {
      if (rr.kind !== 'cordis') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message:
              `runtime.max_turns is only meaningful for runtime.kind: cordis — the runtime for kind ` +
              `'${(rr.kind as string) ?? 'agent'}' never reads it. Refusing rather than accepting a field ` +
              'that would silently do nothing.',
            path: 'runtime.max_turns',
          },
        }
      }
      if (typeof rr.max_turns !== 'number' || !Number.isInteger(rr.max_turns) || rr.max_turns < 1) {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'runtime.max_turns must be a positive whole number of turns',
            path: 'runtime.max_turns',
          },
        }
      }
    }
    if ('entrypoint' in rr && rr.entrypoint !== undefined && typeof rr.entrypoint !== 'string') {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'runtime.entrypoint must be a string', path: 'runtime.entrypoint' },
      }
    }
    if (
      'tool_group' in rr &&
      rr.tool_group !== undefined &&
      (typeof rr.tool_group !== 'string' || rr.tool_group.trim() === '')
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.tool_group must be a non-empty string',
          path: 'runtime.tool_group',
        },
      }
    }
    // A cordis recipe is an agent, not a host step — an entrypoint on one would
    // be read by nothing. Say so rather than ignoring it.
    if (rr.kind === 'cordis' && rr.entrypoint !== undefined) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message: 'runtime.entrypoint is meaningless for runtime.kind: cordis (that is a deterministic recipe field)',
          path: 'runtime.entrypoint',
        },
      }
    }
    // A deterministic recipe is defined by its host step: entrypoint is required.
    if (isDeterministic && (typeof rr.entrypoint !== 'string' || rr.entrypoint.trim() === '')) {
      return {
        ok: false,
        error: {
          code: 'missing_field',
          message: 'runtime.entrypoint is required (non-empty) when runtime.kind is deterministic',
          path: 'runtime.entrypoint',
        },
      }
    }
    runtime = {
      ...(typeof rr.model === 'string' ? { model: rr.model } : {}),
      ...(RECIPE_MODEL_CLASSES.includes(rr.model_class as RecipeModelClass)
        ? { model_class: rr.model_class as RecipeModelClass }
        : {}),
      ...(typeof rr.temperature === 'number' ? { temperature: rr.temperature } : {}),
      ...(typeof rr.max_tokens === 'number' ? { max_tokens: rr.max_tokens } : {}),
      ...(RECIPE_RUNTIME_KINDS.includes(rr.kind as RecipeRuntimeKind) ? { kind: rr.kind as RecipeRuntimeKind } : {}),
      ...(typeof rr.entrypoint === 'string' ? { entrypoint: rr.entrypoint } : {}),
      ...(typeof rr.max_turns === 'number' ? { max_turns: rr.max_turns } : {}),
      // tool_group rides to the worker as WAYPOINT_TOOL_GROUP — it is what
      // slices the closed tool surface per step and arms the report guards.
      // Until 2026-08-08 this line was missing: the type declared the field,
      // the recipes set it, and the parser dropped it — so every in-vivo
      // worker got the FULL surface and no report guard ever ran outside
      // the test suite. The declaration was not the wiring.
      ...(typeof rr.tool_group === 'string' && rr.tool_group.trim() !== '' ? { tool_group: rr.tool_group } : {}),
    }
  }

  let tools: readonly string[] | undefined
  if ('tools' in raw && raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'tools must be an array', path: 'tools' },
      }
    }
    for (let i = 0; i < raw.tools.length; i++) {
      if (typeof raw.tools[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'tools entries must be strings',
            path: `tools[${i}]`,
          },
        }
      }
    }
    tools = raw.tools as readonly string[]
    // Item 29 (D2): a `tools:` list on a kind that never reads it looks like
    // a sandbox and restricts nothing — 78 recipes read as restricted while
    // nothing narrowed them. Refuse, same lesson as the cordis-only fields.
    // The predicate is derived (H-6), never restated here.
    const declaredKind = runtimeRaw?.kind as RecipeRuntimeKind | undefined
    if (!runtimeKindConsumesTools(declaredKind)) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message:
            `tools is only enforced for runtime.kind ${toolsConsumingRuntimeKinds().join(' / ')} — the ` +
            `runtime for kind '${declaredKind ?? 'agent'}' never reads it. Refusing rather than ` +
            `accepting a list that would silently restrict nothing.`,
          path: 'tools',
        },
      }
    }
  }

  // skills / references — cordis-only, and strictly typed. Validated even when
  // the kind is wrong, so an author gets the type error as well as the
  // wrong-kind error rather than discovering the second after fixing the first.
  const isCordis = runtimeRaw?.kind === 'cordis'
  let skills: readonly string[] | undefined
  let references: readonly string[] | undefined
  for (const field of CORDIS_ONLY_FIELDS) {
    const parsedList = stringList(raw, field)
    if (isParseError(parsedList)) return { ok: false, error: parsedList }
    if (parsedList === undefined) continue
    if (!isCordis) {
      return {
        ok: false,
        error: {
          code: 'invalid_field_type',
          message:
            `${field} is only meaningful for runtime.kind: cordis — the runtime for ` +
            `kind '${(runtimeRaw?.kind as string) ?? 'agent'}' never reads it. Refusing rather ` +
            `than accepting a field that would silently do nothing.`,
          path: field,
        },
      }
    }
    if (field === 'skills') skills = parsedList
    else references = parsedList
  }

  let subagents: readonly string[] | undefined
  if ('subagents' in raw && raw.subagents !== undefined) {
    if (!Array.isArray(raw.subagents)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'subagents must be an array', path: 'subagents' },
      }
    }
    for (let i = 0; i < raw.subagents.length; i++) {
      if (typeof raw.subagents[i] !== 'string') {
        return {
          ok: false,
          error: {
            code: 'invalid_field_type',
            message: 'subagents entries must be strings',
            path: `subagents[${i}]`,
          },
        }
      }
    }
    subagents = raw.subagents as readonly string[]
  }

  let metadata: Record<string, unknown> | undefined
  if ('metadata' in raw && raw.metadata !== undefined) {
    if (typeof raw.metadata !== 'object' || raw.metadata === null || Array.isArray(raw.metadata)) {
      return {
        ok: false,
        error: { code: 'invalid_field_type', message: 'metadata must be a mapping', path: 'metadata' },
      }
    }
    metadata = raw.metadata as Record<string, unknown>
  }

  const manifest: RecipeManifest = {
    schema_version: schemaVersion as 1,
    slug: raw.slug as string,
    name: raw.name as string,
    // Deterministic recipes carry no prompt; keep the field a string ('')
    // so consumers and the type guard stay uniform.
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(runtime && Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(references ? { references } : {}),
    ...(subagents ? { subagents } : {}),
    ...(metadata ? { metadata } : {}),
  }

  return { ok: true, manifest }
}

export function isRecipeManifest(value: unknown): value is RecipeManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.schema_version === 1 &&
    typeof v.slug === 'string' &&
    typeof v.name === 'string' &&
    typeof v.prompt === 'string'
  )
}
