# WPO9 — Handoff Graph Authoring Wizard

## Goal

Add Spine authoring support for draft handoff graph manifests so users can brainstorm/design handoffs and then generate safe, non-installed handoff YAML drafts through the same authoring workflow used for recipes and quests.

## Scope

1. Add a core handoff draft generator:
   - Input: graph slug/name/domain, source design/provenance paths, and handoff steps.
   - Output: YAML draft, target path, validation status, and draft warnings.
   - Validate generated YAML with `parseHandoffManifest`.
   - Preserve authoring metadata and source-inspected paths.
   - Keep `write_default: false`.

2. Add CLI wiring:
   - `runner author handoff --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]`
   - Match recipe/quest approval gating.
   - Match existing safe output path handling.

3. Improve authoring questionnaire metadata for `handoff_graph`:
   - Include `handoff_manifest` in approval-required outputs.
   - Include handoff-specific questions for routes, triggers, gates, and required artifacts.

4. Verification:
   - RED tests before implementation.
   - Focused Vitest for authoring generator/questionnaires/CLI.
   - Build, built-import verification, full test suite before commit.

## Non-goals

- No runtime handoff execution.
- No external side effects.
- No automatic installation of generated handoff manifests.
- No edits to bundled FirmVault handoff graph except tests that use it as source context.

## Gates

- `pnpm exec vitest run src/authoring/__tests__/handoff-generator.test.ts src/authoring/__tests__/questionnaires.test.ts packages/spine-cli/src/commands/author.test.ts`
- `pnpm build`
- `pnpm verify:built-imports`
- `pnpm test`
- Commit only if all required gates pass.
