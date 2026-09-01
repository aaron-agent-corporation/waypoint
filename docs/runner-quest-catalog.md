# Waypoint Quest Catalog

<!-- GENERATED FILE — do not edit by hand. Regenerate with `pnpm docs:catalog`. -->

This catalog is generated from the Quest and Recipe manifests currently present on disk by
`scripts/generate-quest-catalog.mjs` (`pnpm docs:catalog`), which reads them through the same
`loadQuestsFromDirectory` / `loadRecipesFromDirectory` loaders the runtime uses. Every slug, name,
path, description, recipe list and side-effect declaration below is copied verbatim from a manifest.
`pnpm docs:catalog:check` (and `src/__tests__/runner-docs.test.ts`) fails when the committed doc
differs from a fresh generation.

It describes the bundled Waypoint Quest/Recipe library — the scaffold content Waypoint
ships. A host embedding the waypoint authors and installs its own catalog alongside (or
instead of) this one; the loaders treat every quest the same.

## Loader-backed counts

- Total Quests loaded from disk: 1
- Total Recipes loaded from disk: 1
- Waypoint source-derived Recipes: 0
- Source command mappings documented: 65

Counts above are based on manifest files under `quests/` and `recipes/` and are covered by `src/__tests__/runner-docs.test.ts`.

## Attribution and license

Waypoint itself is MIT-licensed under `LICENSE` (Copyright (c) 2026 Aaron Whaley).

The bundled source-derived Quest/Recipe artifacts are adaptations of the get-shit-done-cc project by Lex Christopherson:

- Upstream local snapshot checked for P7: `/Users/aaronwhaley/Downloads/get-shit-done-main/`
- Upstream license read for P7: `MIT License`
- Upstream copyright read for P7: `Copyright (c) 2025 Lex Christopherson`
- Preserved repo attribution: `third_party/gsd/LICENSE`
- Preserved repo notice: `third_party/gsd/NOTICE.md`

When redistributing Waypoint with the Waypoint source-derived Quest/Recipe library, preserve `third_party/gsd/LICENSE` and `third_party/gsd/NOTICE.md`.

Per-Quest source attribution below is read from each manifest's own `metadata.source` /
`metadata.source_port`.

## Quests

All 1 Quest manifests under `quests/`, grouped by `metadata.runner.quest_family`.

### Primary starter Quests

Quests a user can choose when setting up a folder (`metadata.runner.quest_family: primary_starter`).


### Other Quests

Quests that declare no `metadata.runner.quest_family` — demonstration and utility manifests.

- `runner` — Project Delivery
  - Path: `quests/runner.yaml`
  - Description: A bare project-delivery scaffold: initialize → discuss → plan → execute → verify → ship, with human gates at plan, verify and ship. It carries no working steps of its own — every plan is a checkpoint a person or another process fills in, except the discuss step, which opens a task-scoped conversation. This is the neutral lifecycle skeleton, not a workflow anyone is offered: the coding agents it used to dispatch (planner, executor, debugger, code-reviewer, security-auditor and the rest of the get-shit-done-cc port) were dropped on 2026-08-24 when the coding suite was retired.
  - Recipes: `scaffold-discussion`
  - Source attribution: `get-shit-done-cc` (MIT licensed)

## Recipes

All 1 Recipe manifests under `recipes/`, in slug order.

- `scaffold-discussion` — Scaffold Discussion
  - Path: `recipes/scaffold/discussion.yaml`
  - Description: The one dispatch the bare `runner` lifecycle scaffold makes: a task-scoped conversation with the operator about what a step is for and when it is done. It exists because a discussion plan's `Agent:` is resolved as a recipe at dispatch, and because `runner` is the only quest in the catalog that carries a discussion plan at all — so this is also the only exercise the task-discussion machinery gets. Not offered to users: `runner` is off the starter menu.
  - External side effects: `forbidden`

## Deferred / not implemented in this repo

- No standalone source CLI is implemented here.
- No first-class sub-Quest schema field exists yet; command mapping intent lives in metadata/docs.
- No built-in recipe executor is shipped in the standalone core package yet; hosts provide `IRecipeRuntime`.
- Namespace commands from the upstream source CLI (`ns-*`) remain deferred optional mappings, documented in `docs/quests/runner-command-map.md`.
