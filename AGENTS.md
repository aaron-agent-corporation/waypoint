# Waypoint Coding Agent Instructions

This repo is **Waypoint**: a host-agnostic lifecycle + workflow execution runtime extracted from Mission Control. It combines lifecycle/intent modeling — workstreams, milestones, phases, plans — with executable DAG workflows — routes, nodes, recipes, review gates, and autopilot.

These instructions apply to autonomous coding agents working in this repository.

## Product rule

Waypoint is the portable runtime. Mission Control is only the first host/adapter. Do not add Mission Control assumptions to core runtime code unless the task explicitly targets an adapter or compatibility layer.

GSD is historical inspiration and compatibility naming in some docs/catalog assets. Do not rebrand Waypoint back into GSD or Mission Control.

## Runtime modes

Waypoint supports multiple host runtime paths. Keep them separate:

- `folder` is the default route backend and stores route/task state under `.waypoint/`.
- `beads` is an explicit route backend and materializes route work into Beads issues. Beads uses embedded Dolt in this checkout.
- Gas City is an optional execution supervisor for Beads-backed routes. It is not a third route backend and must not replace the existing `folder` or `beads` modes.
- Codex can be a Gas City provider/agent target, but Codex provider behavior belongs to the host/runtime layer, not `@waypoint/core`.

The current local-main testing setup intentionally keeps the Beads Dolt remote in `.beads/config.yaml`:

```text
sync.remote: file:///Users/aaronwhaley/.beads-remotes/waypoint
```

Preserve that local setup while comparing runtime modes. If Gas City becomes the primary production runtime, revisit this as a portable/shared sync policy instead of hard-coding a personal remote.

## Current architecture map

Primary directories:

- `src/` — `@waypoint/core`, the portable runtime.
  - `commands/` — command grammar parsing.
  - `contracts/` — host interfaces such as store, authz, event bus, recipe runtime, clock, and ID generator.
  - `discussion/` — task-scoped discussion metadata and auto-response contracts.
  - `routes/` — route keys and scope primitives.
  - `autopilot/` — autopilot progress helpers.
  - `wizard/` — folder organization, FirmVault apply/review/facts/classification, path/shadow handling.
  - `authoring/` — questionnaire and handoff generation utilities.
  - `quests/`, `handoffs/` — manifest parsing/resolution and registries.
- `packages/waypoint-cli/` — CLI commands and command surfaces.
- `packages/waypoint-folder-host/` — local folder host, tasks store, recipe runtime, FirmVault integration surface.
  - `src/beads/` — Beads route backend adapter, graph compiler, readback, transitions, and smoke-facing command boundary.
  - `src/gascity/` — optional Gas City runtime adapter over Beads routes, including preflight, sling/delegation, metadata, routing, and diagnostics.
- `examples/host-minimal/` — minimal external host reference.
- `examples/folder-host-quest/` — runnable local folder host walkthrough.
- `examples/hermes-operator-adapter/` and `examples/hermes-runtime-adapter/` — Hermes/Gary integration examples.
- `docs/` — design docs, operations runbook, Quest catalog, command maps, and plans.
- `quests/`, `recipes/`, `operators/`, `handoffs/` — bundled catalog content.
- `scripts/` — smoke tests, package staging, built-import verification, FirmVault simulations, and the Gas City runtime smoke harness.

## Code-KG repo map

This repo uses Code-KG as the agent-facing repository map for codebase
navigation, semantic search, connected tests, and drift checks.

Generated knowledge and metadata live in:

- `lat.md/` — reviewable knowledge base and source map.
- `.code-kg/` — Code-KG metadata and materialization manifest.
- `.codex/hooks.json` — Codex hook installed by Code-KG.

Useful commands:

```bash
# Semantic or lexical repository search. Uses semantic search when configured.
code-kg search "<question>" --backend auto-semantic

# Read a full knowledge-base section by ID.
code-kg section "<section-id>"

# Validate Code-KG installation and source/knowledge consistency.
code-kg agents status
code-kg check
code-kg drift

# Reindex local semantic search after large source or knowledge changes.
code-kg semantic reindex
```

Use Code-KG before touching unfamiliar code. Start with `code-kg search` for the
subsystem or symbol, read the relevant `code-kg section` output, then inspect
raw source and nearby tests.

## Development commands

Use `pnpm` unless a package-specific doc says otherwise.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm smoke:folder-host
```

Other useful smoke checks from `package.json`:

```bash
pnpm smoke:firmvault-folder
pnpm smoke:firmvault-bootstrap
pnpm smoke:firmvault-document-ingestion
pnpm smoke:firmvault-lifecycle-simulation
pnpm smoke:firmvault-staged-guidance
pnpm smoke:firmvault-existing-case-adoption
pnpm smoke:waypoint-wizard-firmvault
pnpm smoke:wpo-integration
pnpm smoke:gascity-runtime
pnpm build
pnpm verify:built-imports
```

For targeted work, prefer narrow Vitest runs, for example:

```bash
pnpm exec vitest run src/wizard/__tests__/organize.test.ts
pnpm exec vitest run packages/waypoint-folder-host/src/tasks
pnpm exec vitest run packages/waypoint-cli/src/commands
```

## Hard constraints

1. Keep core host-agnostic. Do not import Mission Control, Hermes, FirmVault, Gas City, Beads/Dolt, provider CLIs, filesystem, process, or CLI-only assumptions into core contracts unless the existing boundary already allows it.
2. Preserve the standard error envelope: `{ "ok": false, "action": "error", "error": "...", "details": "optional" }` with validation details normalized to `{ code, path, message }`.
3. Do not bypass route gates, approval gates, or review gates in tests or runtime code. Model the gate explicitly.
4. Keep deterministic boundaries: use injected `IClock`, `IIdGenerator`, host store, and recipe runtime where the architecture expects them.
5. Do not make agents/autopilot destructive by default. Folder-host and FirmVault flows should preview/shadow before applying when the API supports it.
6. Preserve unrelated dirty work. Run `git status --short` before editing and do not clean or revert files outside the task.
7. No secrets in code, docs, logs, fixtures, or final summaries. Redact as `[REDACTED]`.
8. When a change affects host integration, update docs/examples in the same slice or explicitly report the doc gap.

## FirmVault-specific cautions

Waypoint has a FirmVault surface, but FirmVault remains a legal/case-work source-of-truth system. For FirmVault features:

- Validate case slugs and paths with the existing safe-path utilities.
- Keep document handoff status explicit.
- Do not mutate real case folders in tests; use temp folders and smoke fixtures.
- Any behavior that would affect legal/client communications must remain gated for human review.

## Required agent behavior

Before editing:

```bash
git status --short
git branch --show-current
```

During work:

- Read the relevant docs and Code-KG sections before changing a subsystem.
- For Gas City or Beads work, start with `docs/waypoint-folder-host.md`, `docs/plans/2026-05-27-waypoint-beads-runtime.md`, `docs/plans/2026-05-27-waypoint-gascity-runtime.md`, and the Code-KG `cross-cutting.gascity-runtime` / `cross-cutting.beads-read-models` sections.
- Keep diffs small and scoped.
- Add or update tests near the code you change.
- Prefer interfaces/contracts over host-specific shortcuts.

Before finishing:

```bash
git diff --check
pnpm test        # or the narrowest relevant test run if the full suite is too much
pnpm typecheck   # when type-level behavior changed
```

Report:

- files changed,
- tests/checks run,
- Code-KG query, section, check, or drift result used if relevant,
- remaining blockers or decisions,
- whether the worktree was dirty before and after.

<!-- code-kg:agents:start -->
## code-kg

This project may have a reviewable knowledge base in `lat.md/` and Code-KG metadata in `.code-kg/`.

Rules:
- Before broad source reads, grep/glob searches, or answering codebase-structure questions, use `code-kg search "<question>"` or MCP `codekg_search` first.
- For conceptual queries, prefer `code-kg search "<question>" --backend auto-semantic` or `codekg_search` with `backend: "auto-semantic"` so semantic search is used when configured and lexical search is used as a fallback.
- Use `code-kg section "<section-id>"` or MCP `codekg_section` to read full sections with outgoing and incoming relationships before opening raw source.
- Treat `lat.md/` as the primary map and raw source as the implementation detail to inspect after the relevant knowledge sections are known.
- After modifying code or knowledge docs, run `code-kg check` and use `code-kg drift` to compare source and the knowledge base.
- Do not manually add source backlinks; use `code-kg apply-backlinks --preview` and then `code-kg apply-backlinks --write` only for sections marked edit-safe.
<!-- code-kg:agents:end -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.
<!-- END BEADS CODEX SETUP -->
