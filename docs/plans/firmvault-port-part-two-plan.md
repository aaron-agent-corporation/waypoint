# FirmVault Port Part Two Implementation Plan

> **For Gary/Hermes:** Use `subagent-driven-development` only after this plan is committed. Execute one task at a time, with RED/GREEN tests and primary-source evidence in the same turn as any completion claim.

**Goal:** Replace the eight Part One placeholder FirmVault Recipe manifests with source-backed Waypoint Recipe manifests for the Wave 0/1 Quest scaffold, while preserving the folder-host safety boundary: local draft/handoff artifacts only, no external communications, no real case-folder writes during automated verification.

**Architecture:** Keep the existing Waypoint Recipe schema and bundled catalog path. Part Two is a recipe-content port, not a new runtime engine. Each `recipes/firmvault/*.yaml` manifest should be derived from the matching Mission Control recipe card (`recipe.yaml`, `SOUL.md`, `REVIEW.md`) and remain executable only through explicit Quest scaffold bindings (`metadata.waypoint.recipe.slug`).

**Tech Stack:** TypeScript, Vitest, YAML manifests, existing Waypoint recipe parser/catalog loader, Mission Control recipe card sources.

---

## Source Evidence Checked Before Writing This Plan

- Waypoint repo: `/Users/aaronwhaley/Github/waypoint`
  - `git log --oneline -5` showed `41e57de feat(firmvault): add workflow map and Quest skeleton` at HEAD.
  - `git status --short --branch` showed `## main...origin/main [ahead 3]` before this plan file was written.
- Part One plan stop point: `docs/plans/firmvault-port-part-one-plan.md` lines 507-509 state the next destination is **FVP2: Port Initial FirmVault Recipes**, replacing placeholder manifests with source-backed prompts while preserving no external side effects.
- Current Part One placeholders exist under `recipes/firmvault/` for these eight slugs:
  - `firmvault-case-setup-create-shell`
  - `firmvault-document-collection-review-intake`
  - `firmvault-document-collection-request-missing-documents`
  - `firmvault-document-collection-send-signature-packets`
  - `firmvault-accident-report-analyze`
  - `firmvault-medical-provider-setup-case`
  - `firmvault-client-check-in-start-cadence`
  - `firmvault-client-check-in-prepare-handoff`
- Mission Control source recipe directories exist at `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/` for all eight slugs, and each contains:
  - `recipe.yaml`
  - `SOUL.md`
  - `REVIEW.md`
- The existing Waypoint Recipe manifest parser requires only current schema fields (`schema_version`, `slug`, `name`, `prompt`) and allows optional `description`, `runtime`, `tools`, `subagents`, and `metadata`.

## Part Two Definition

Part Two covers two coupled deliverables:

1. **FVP2A Recipe Port Contract Tests** — tests that prove the eight FirmVault recipes are no longer placeholders and carry source-backed metadata, safety constraints, and review criteria.
2. **FVP2B Source-Backed Recipe Manifests** — replacement of the eight placeholder manifests with prompts converted from Mission Control `SOUL.md` / `REVIEW.md` / `recipe.yaml`, adapted to Waypoint folder-host semantics.

Part Two stops before passive landmark resolution, case-folder doctor/template creation, later-wave recipe expansion, and Mission Control cutover.

## Acceptance Gates

Part Two is complete only when all of these are true:

- `src/__tests__/firmvault-recipe-port.test.ts` exists and covers all eight Wave 0/1 recipe slugs.
- Every `recipes/firmvault/*.yaml` referenced by `quests/firmvault.yaml`:
  - parses through the existing Recipe manifest parser;
  - resolves through the bundled catalog;
  - has `metadata.source_port.status: ported_from_mission_control`;
  - lists the Mission Control source files used (`recipe.yaml`, `SOUL.md`, `REVIEW.md`);
  - has `metadata.source_port.external_side_effects: forbidden`;
  - includes review criteria derived from the source `REVIEW.md`;
  - includes safety language forbidding external sends/faxes/portal submissions/client contact claims;
  - does **not** contain the Part One placeholder phrase `Placeholder Recipe manifest for Part One Quest skeleton resolution`.
- The recipe prompts are adapted to folder-host local execution, not copied as Mission Control-only instructions:
  - `workspace` / case folder is described as the local Waypoint project folder;
  - generated communications are draft/handoff artifacts only;
  - raw sensitive values must be absent or redacted as `[REDACTED]` if encountered.
- Existing Part One Quest skeleton tests still pass.
- Broader verification passes before commit:
  - `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts`
  - `pnpm smoke:folder-host`
  - `pnpm smoke:install`
  - `pnpm test`
  - `pnpm typecheck`

## Out of Scope for Part Two

- No real FirmVault case folder writes.
- No actual email, fax, portal, phone, or insurer/client communications.
- No passive landmark resolver implementation.
- No CLI `firmvault doctor` command.
- No later-wave recipe expansion beyond the eight Wave 0/1 slugs already used by `quests/firmvault.yaml`.
- No Mission Control runtime bridge or cutover.
- No schema changes unless existing parser/catalog tests prove the current schema cannot express source-backed recipes. Default assumption: no schema changes.

---

## Task 1: Add RED Recipe Port Contract Test

**Objective:** Define the source-backed recipe requirements before replacing placeholders.

**Files:**
- Create: `src/__tests__/firmvault-recipe-port.test.ts`
- Read: `quests/firmvault.yaml`
- Read: `recipes/firmvault/*.yaml`
- Read source: `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/{recipe.yaml,SOUL.md,REVIEW.md}`

**Test requirements:**

- Load `quests/firmvault.yaml` and collect its `recipes:` list.
- Assert the list equals or includes the eight Wave 0/1 slugs from Part One.
- Load bundled catalog with `loadBundledWaypointCatalog()` and assert each slug resolves.
- Parse each recipe manifest and assert:
  - `schema_version === 1`
  - `slug` matches filename/source slug
  - `name` is non-empty
  - `description` is non-empty
  - `prompt` is non-empty and longer than the placeholder prompt
  - `prompt` includes `No external side effects`
  - `prompt` includes `local Waypoint project folder`
  - `prompt` does not include the exact placeholder phrase from Part One
  - `metadata.source_port.status === "ported_from_mission_control"`
  - `metadata.source_port.source_repository === "/Users/aaronwhaley/Github/Active Projects/mission-control"`
  - `metadata.source_port.source_recipe === "recipes/<slug>"`
  - `metadata.source_port.source_files` includes `recipe.yaml`, `SOUL.md`, and `REVIEW.md`
  - `metadata.source_port.external_side_effects === "forbidden"`
  - `metadata.source_port.review_criteria` is a non-empty array
- Assert every referenced Mission Control source file exists.
- Assert no recipe prompt contains obvious unredacted secret markers such as `OPENROUTER_API_KEY` as an active instruction or any `sk-` token pattern.

**Verify RED:**

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts
```

Expected: FAIL because the Part One manifests still use `placeholder_until_fvp2` and placeholder prompts.

## Task 2: Port Case Setup Recipe

**Slug:** `firmvault-case-setup-create-shell`

**Source files:**
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/firmvault-case-setup-create-shell/recipe.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/firmvault-case-setup-create-shell/SOUL.md`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/firmvault-case-setup-create-shell/REVIEW.md`

**Port requirements:**

- Preserve the source intent: create or verify the native FirmVault case shell from accepted intake information.
- Adapt `copy_case_template` into a folder-host-safe instruction: prepare/verify local scaffold expectations and draft exact missing-path remediation; do not silently create real non-`.waypoint` case files during automated tests unless a future command explicitly supports it.
- Preserve path contract examples from the source prompt where safe.
- Preserve review rejection rules: no invented paths/facts, no raw PHI, no deprecated JSON state, no partial scaffold marked complete.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts
```

Expected: still FAIL until all eight recipes are ported, but this slug's placeholder/status assertions should pass.

## Task 3: Port Document Collection Recipes

**Slugs:**
- `firmvault-document-collection-review-intake`
- `firmvault-document-collection-request-missing-documents`
- `firmvault-document-collection-send-signature-packets`

**Source files:**
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/recipe.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/SOUL.md`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/REVIEW.md`

**Port requirements:**

- Review intake: evidence-backed onboarding completeness only; do not assume signatures or documents.
- Request missing documents: prepare auditable handoff artifacts only; do not send messages or claim client contact.
- Send signature packets: stage signature packet handoff only; do not send signature packets externally.
- Preserve review criteria from each `REVIEW.md` as structured metadata.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts
```

## Task 4: Port File-Setup / Provider / Client Check-In Recipes

**Slugs:**
- `firmvault-accident-report-analyze`
- `firmvault-medical-provider-setup-case`
- `firmvault-client-check-in-start-cadence`
- `firmvault-client-check-in-prepare-handoff`

**Source files:**
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/recipe.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/SOUL.md`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/recipes/<slug>/REVIEW.md`

**Port requirements:**

- Accident report: analyze/update local accident report evidence only; no invented accident facts.
- Medical provider setup: create/normalize provider ledger expectations from evidence only; no invented provider data.
- Client check-in cadence: establish/verify local cadence records without contacting the client.
- Client check-in handoff: prepare a human-facing script/task handoff without sending or claiming contact.
- Preserve each source review checklist as structured metadata.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts
```

Expected after Task 4: PASS.

## Task 5: Run FirmVault Targeted Regression

**Objective:** Ensure the source-backed recipes still resolve through the Part One Quest skeleton and catalog path.

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-workflow-port-map.test.ts src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected: PASS.

## Task 6: Run Full Regression Gates

Run in order:

```bash
pnpm smoke:folder-host
pnpm smoke:install
pnpm test
pnpm typecheck
```

Expected:

- existing folder-host smoke remains green;
- local install smoke remains green;
- full Vitest suite remains green;
- `pnpm typecheck` exits `0`.

## Task 7: Commit Part Two

Only after the verification output is visible in the same turn:

```bash
git status --short
git add docs/plans/firmvault-port-part-two-plan.md src/__tests__/firmvault-recipe-port.test.ts recipes/firmvault
git commit -m "feat(firmvault): port initial Recipe prompts"
git log --oneline -5
git status --short --branch
```

Report only the commit hash shown by `git log` after the commit exists.

## Stop Point After Part Two

After Part Two, do not jump to Mission Control cutover. The next destination is **FVP3: FirmVault Case Folder Template / Doctor**, a read-only detector/diagnostic for FirmVault-style canonical folders, followed by **FVP4: Local Landmark Resolver**.
