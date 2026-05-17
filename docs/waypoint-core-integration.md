# Integrating `@waypoint/core` in a new system

This guide documents how to embed the host-agnostic Waypoint runtime
core (`@waypoint/core`) in any system — not just Mission Control.

## What the core provides

`@waypoint/core` ships only pure runtime/orchestration logic:

- **Envelope contracts**
  - `makeErrorEnvelope(error, details?)`
  - `normalizeValidationDetails(issues)`
- **Command grammar**
  - `parseWaypointCommand(raw)` → `WaypointParsedCommand`
- **Route primitives**
  - `buildWaypointRouteKey({ subjectType, subjectId, definitionSlug, definitionVersion })`
  - `normalizeWaypointScope(...)`, `isWaypointSubjectType(...)`
- **Autopilot**
  - `hasWaypointAutopilotProgress(...)`
- **Discussion**
  - conversation id helpers, metadata helpers, auto-response gating
- **Quests & Recipes**
  - `parseQuestManifest(yaml)` / `parseRecipeManifest(yaml)`
  - `createQuestRegistry()` / `createRecipeRegistry()`
  - `loadQuestsFromDirectory(path)` / `loadRecipesFromDirectory(path)`
  - `resolveQuestRecipes(quest, recipeRegistry)`
- **Host contracts (interfaces only — you implement these):**
  - `IWaypointStore`, `IWaypointAuthz`, `IEventBus`, `IRecipeRuntime`,
    `IClock`, `IIdGenerator`

The core contains **no Next.js, no database, no HTTP framework, no
Mission Control-specific types**. It is deliberately portable.

## Minimum integration steps

1. **Add the package** (inside this repo: TS path alias
   `@waypoint/core` → `packages/waypoint-core/src/index.ts`).
2. **Implement host adapters** for whichever contracts your host uses:
   - Storage: translate core `WaypointRouteRecord`/`WaypointEventRecord`
     to your database schema.
   - Authorization: enforce actor/project/mutate semantics.
   - Event bus: forward core-emitted events to your pub/sub / streaming
     layer (Slack, websockets, SSE, Kafka…).
   - Recipe runtime: if your host uses agents/recipes, implement
     `startRecipe/getRun/cancelRun` against your execution substrate.
3. **Wire command entrypoints** (HTTP handler, CLI, chatops) to:
   - Call `parseWaypointCommand` on the raw text.
   - Translate the parsed command to your adapters (start route, list,
     gate decision, etc.).
   - Use `makeErrorEnvelope` for any error response.
4. **Maintain envelope parity** with the established contract:
   - Error: `{ ok:false, action:'error', error, details? }`
   - Success: action-specific, stable across hosts.

## Quests and Recipes

A **Quest** is a reusable, named journey template — the roadmap a
project follows (e.g. "FirmVault", "Project Delivery (GSD)", "bugfix", "research
spike"). A **Recipe** is a reusable, named agent definition — the
prompt plus runtime orchestration hints for one specialist agent.
Quests compose Recipes.

Both are YAML documents loaded from disk. See
`docs/plans/waypoint-quests-and-recipes.md` for the full design.

### Folder layout

Hosts typically expose two directories (recursive nesting supported):

```
quests/
  waypoint.yaml
  bugfix.yaml
  research/
    spike.yaml
recipes/
  doc-writer.yaml
  reviewer.yaml
  dev/
    debugger.yaml
    planner.yaml
```

### Quest manifest (minimum shape)

```yaml
schema_version: 1
slug: waypoint
name: Project Delivery (GSD)
description: Discover, plan, execute, verify, ship.

runtime:
  workflow: waypoint-plan-execution
  version: 1

scaffolds:
  workstreams:
    - key: core
      name: Core
      milestones:
        - key: v1
          name: v1
          phases:
            - key: discuss
              name: Discuss
              plans:
                - key: p1
                  title: Frame the problem

recipes:
  - doc-writer
  - reviewer
```

### Recipe manifest (minimum shape)

```yaml
schema_version: 1
slug: doc-writer
name: Doc Writer
description: Drafts project docs from outlines.
prompt: |
  You are a technical doc writer. Given an outline, produce a
  clean, concise markdown document.
runtime:
  kind: agent
  allowed_tools:
    - file.read
    - file.write
```

### Loading from a directory

```ts
import {
  loadQuestsFromDirectory,
  loadRecipesFromDirectory,
  resolveQuestRecipes,
} from '@waypoint/core'

const questsResult = await loadQuestsFromDirectory('./quests')
const recipesResult = await loadRecipesFromDirectory('./recipes')

if (!questsResult.ok) throw new Error('Quest load failed')
if (!recipesResult.ok) throw new Error('Recipe load failed')

const quest = questsResult.registry.get('waypoint')
if (!quest) throw new Error('Quest gsd not found')

const resolved = resolveQuestRecipes(quest, recipesResult.registry)
if (!resolved.ok) {
  // resolved.error.missingSlugs lists recipe slugs the Quest
  // referenced but which were not registered.
  throw new Error('Quest references missing recipes')
}

// resolved.recipes is the concrete RecipeManifest[] for this Quest.
```

### Quest adoption flow

When a project opts in to a Quest:

1. Load Quest and Recipe registries from disk (above).
2. Look up the Quest by slug. Resolve its recipes (verifies every
   referenced Recipe exists).
3. Walk the Quest's `scaffolds` block and create the corresponding
   workstream/milestone/phase/plan records through your
   `IWaypointStore`. This produces the lifecycle skeleton described in
   the Quest.
4. Record the Quest's runtime workflow slug + version on the project
   (host-specific field) so future route starts know which workflow to
   bind plans to.
5. The project is now Waypoint-ready: plans can be routed through the
   Quest's workflow using `buildWaypointRouteKey` and the standard
   route APIs.

### Why Quests and Recipes are separate from `IWaypointStore`

Quests and Recipes are **reusable templates** — they live on disk
under source control and travel with the product. Routes, events, and
lifecycle records are **per-project state** and live behind
`IWaypointStore`. Keeping them apart means:

- Multiple projects can adopt the same Quest without duplicating the
  manifest.
- Updates to a Quest manifest don't rewrite historical project state.
- A host can swap storage backends (SQLite → Postgres → folder) without
  touching its Quest/Recipe library.

## Portability proof

See `examples/waypoint-host-minimal/`. It provides an executable,
tested proof that a brand-new host can:

- parse and validate a Waypoint command through core,
- start a route through an in-memory `IWaypointStore`,
- emit typed events through a custom `IEventBus`,
- run a stub `IRecipeRuntime` — all without importing from Mission
  Control or Next.js.

Run the example:

```
pnpm exec vitest run examples/waypoint-host-minimal/src/
```

A boundary test in that example (`boundaries.test.ts`) fails if
`host.ts` ever imports anything other than `@waypoint/core` or a Node
built-in, which is the primary long-term guard against regressions.

See also `examples/quest-recipe-demo/` (end-to-end Quest + Recipe
loading, resolution, and scaffolding walkthrough).

For a concrete folder-backed host adapter, see `docs/waypoint-folder-host.md` and
`examples/folder-host-quest/README.md`. The folder host stores route YAML,
event JSONL, task YAML, discussion JSONL, and autopilot run history directly
under a project-local `.waypoint/` directory.

## Recommended integration patterns

- **Thin host adapters:** Keep host-specific code out of core. The more
  logic lives in adapters, the easier it is to host Waypoint elsewhere.
- **Compliance tests:** When adding a new host adapter, re-use the
  core contract test packs (`packages/waypoint-core/src/__tests__/*`)
  as specification and add host-level compliance tests that exercise
  the adapter against those contracts.
- **Versioning:** Treat `@waypoint/core` exports as the stable public
  API; internal file layout can change without consumer impact.
- **Envelope discipline:** Use core helpers (`makeErrorEnvelope`,
  `normalizeValidationDetails`) everywhere. Never hand-format error
  responses in adapters.
- **Quest/Recipe discipline:** Treat Quest and Recipe YAML as product
  artifacts. Version them in source control; parse them through the
  core parsers on load; never hand-construct manifests in application
  code.

## Definition of "Waypoint-ready" host

A host is Waypoint-ready when:

1. It consumes orchestration logic only through `@waypoint/core`.
2. It implements required `IWaypointStore`, `IWaypointAuthz`,
   `IEventBus`, and (optionally) `IRecipeRuntime` adapters.
3. Its command/API error responses match the Waypoint envelope contract.
4. It passes its own adapter compliance tests against the core contract
   test packs.
5. No core imports from host-specific modules.
6. It loads Quests and Recipes from a documented directory layout
   through the core loaders (no inline manifest construction).
