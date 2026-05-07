# FirmVault Port Part One Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Land the first standalone Waypoint FirmVault slice: a source-backed workflow port map plus a bundled `firmvault` Quest skeleton that can be installed and started by the existing folder-host implementation.

**Architecture:** Use the existing Waypoint folder-host catalog/start/task materialization path as-is. Part One does not add a new runtime engine; it adds source-backed catalog data and tests that prove the `firmvault` Quest uses current scaffold metadata (`metadata.waypoint.node.type`, explicit `metadata.waypoint.recipe.slug`, gates, waits, checkpoints) and does not fall back from `plan_ref` to executable slugs.

**Tech Stack:** TypeScript, Vitest, YAML manifests, current Waypoint bundled catalog loader, current folder-host `.waypoint/` YAML/JSONL state, Mission Control FirmVault workflow YAML as primary source.

---

## Source Evidence Used for This Plan

Primary source commands run before writing this plan showed:

- Waypoint repo: `/Users/aaronwhaley/Github/waypoint`
  - `git log --oneline -20` showed `42dd86d docs(firmvault): plan folder workflow port` at HEAD.
  - `git status --short --branch` showed `## main...origin/main [ahead 1]` before this plan file was written.
- Mission Control repo: `/Users/aaronwhaley/Github/mission-control`
  - `git status --short --branch` showed `## feat/waypoint-runtime-slice`.
  - `git log --oneline -5` showed `5585a59 feat(waypoint): add agent authorship + loop prevention to discussion messages (W1)` at HEAD.
- Current Mission Control FirmVault workflow source:
  - 22 files matched `/Users/aaronwhaley/Github/mission-control/workflows/firmvault*.yaml`.
  - Parsing those files produced 43 FirmVault workflow entries when counting both standalone workflow YAML files and the aggregate `firmvault-workflows.yaml` entries.
- Current folder-host behavior relevant to Part One:
  - `packages/waypoint-folder-host/src/catalog/bundled.ts` recursively loads YAML manifests under `quests/` and `recipes/` and resolves each Quest's `recipes:` list.
  - `packages/waypoint-folder-host/src/tasks/store.ts` derives task kind from `metadata.waypoint.node.type`, then explicit `metadata.waypoint.recipe.slug`, discussion, or gate metadata; default is `checkpoint`.
  - `packages/waypoint-folder-host/src/autopilot/run.ts` already fails closed when recipe/discussion tasks lack explicit metadata.

## Part One Definition

Part One covers two tightly coupled deliverables:

1. **FVP0 Inventory and Port Map** — create machine-readable and human-readable maps from current Mission Control sources.
2. **FVP1 FirmVault Quest Skeleton** — add the initial `quests/firmvault.yaml` scaffold using only existing Waypoint schema and current folder-host execution metadata.

Part One stops before full recipe prompt porting, passive landmark resolution, or package/tarball smoke expansion. Those are FVP2+.

## Acceptance Gates

Part One is complete only when all of these are true:

- `docs/quests/firmvault-workflow-map.yaml` exists and includes the initial required workflow ids:
  - `firmvault-case-setup`
  - `firmvault-document-collection`
  - `firmvault-accident-report`
  - `firmvault-medical-provider-setup`
  - `firmvault-client-check-in-cadence`
  - `firmvault-request-medical-records`
  - `firmvault-demand-readiness`
  - `firmvault-draft-demand`
  - `firmvault-send-demand`
  - `firmvault-track-offers`
  - `firmvault-offer-evaluation`
  - `firmvault-negotiate-claim`
  - `firmvault-settlement-processing`
  - `firmvault-lien-resolution`
  - `firmvault-final-distribution`
  - `firmvault-close-case`
- `docs/plans/firmvault-workflow-port-map.md` explains the source map, duplicated source situation, and first-wave scope.
- `quests/firmvault.yaml` appears in the bundled catalog as Quest slug `firmvault`.
- `waypoint quests` lists `firmvault` through the existing CLI/catalog path.
- `waypoint init --quest firmvault` installs `.waypoint/quests/firmvault.yaml` into a temp folder.
- `waypoint start --quest firmvault` creates route/tasks from the scaffold in a temp folder.
- Every `metadata.waypoint.recipe.slug` in the Quest scaffold is listed in `recipes:` and resolves to a bundled Recipe manifest. If FVP2 has not landed yet, Part One must create minimal safe placeholder Recipe manifests for the Wave 0/1 slugs with source metadata and no external side effects.
- No scaffold task relies on `plan_ref` as a Recipe slug.

## Out of Scope for Part One

- No real FirmVault case folder writes.
- No external email/fax/portal/phone actions.
- No Mission Control cutover.
- No passive landmark resolver implementation.
- No full recipe prompt port beyond minimal safe placeholders required for catalog resolution.
- No full expansion into every later wave. Later waves are represented in the map and high-level scaffold phases only.

---

## Task 1: Add RED Map Coverage Test

**Objective:** Define the expected source-backed inventory behavior before generating the map.

**Files:**
- Create: `src/__tests__/firmvault-workflow-port-map.test.ts`
- Read source: `/Users/aaronwhaley/Github/mission-control/workflows/firmvault*.yaml`

**Step 1: Write the failing test**

Create `src/__tests__/firmvault-workflow-port-map.test.ts` with tests that:

- Parse `docs/quests/firmvault-workflow-map.yaml`.
- Assert `source.repositories.mission_control.path === "/Users/aaronwhaley/Github/mission-control"`.
- Assert `source.workflow_glob === "workflows/firmvault*.yaml"`.
- Assert the required workflow ids listed in Acceptance Gates exist.
- Assert each workflow entry has:
  - `id`
  - `source_files`
  - `wave`
  - `phase`
  - `node_count`
  - `recipe_slugs`
  - `trigger_landmarks`
  - `output_landmarks`
  - `human_gates`
  - `waits`
  - `canonical_paths`
- Assert every workflow entry's `source_files` path exists under `/Users/aaronwhaley/Github/mission-control`.

**Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-workflow-port-map.test.ts
```

Expected: FAIL because `docs/quests/firmvault-workflow-map.yaml` does not exist yet.

**Step 3: Commit?**

Do not commit the RED test alone unless implementation is interrupted. Keep it as part of the FVP0 commit if GREEN lands in the same working session.

## Task 2: Generate the Machine-Readable Port Map

**Objective:** Create `docs/quests/firmvault-workflow-map.yaml` from current Mission Control source files.

**Files:**
- Create: `docs/quests/firmvault-workflow-map.yaml`
- Source: `/Users/aaronwhaley/Github/mission-control/workflows/firmvault*.yaml`
- Source: `/Users/aaronwhaley/Github/mission-control/src/lib/firmvault-passive-landmarks.ts`
- Source: `/Users/aaronwhaley/Github/mission-control/docs/superpowers/plans/2026-04-28-firmvault-workflow-build-roadmap.md`

**Implementation notes:**

- Prefer a short generation/check script in `scripts/` only if it will remain useful. Otherwise generate once and verify with tests.
- Preserve both source layers:
  - aggregate source: `workflows/firmvault-workflows.yaml`
  - standalone executable definitions: `workflows/firmvault-*.yaml`
- Where aggregate and standalone definitions share the same workflow id, record both under `source_files` and mark `source_priority: standalone_then_aggregate`.
- Wave labels for Part One:
  - `0-onboarding`: case setup, document collection
  - `1-file-setup`: accident report, medical provider setup, client check-in
  - `2-insurance-and-treatment`: BI/PIP, provider status, records/bills
  - `3-demand`: demand readiness, draft demand, send demand
  - `4-negotiation`: track offers, offer evaluation, negotiate claim
  - `5-settlement-and-liens`: settlement processing, settlement lien negotiation, lien resolution, final distribution
  - `6-close`: close case
- `canonical_paths` can start as source-extracted paths from workflow `config.canonical_paths` where present plus known starter folders from the existing plan. Do not invent exact client paths beyond source evidence; use `[]` and `notes` when not yet known.
- Redact any sensitive sample values if encountered.

**Step 1: Write the YAML map**

Include this top-level shape:

```yaml
schema_version: 1
kind: firmvault_workflow_port_map
source:
  repositories:
    mission_control:
      path: /Users/aaronwhaley/Github/mission-control
      branch: feat/waypoint-runtime-slice
  workflow_glob: workflows/firmvault*.yaml
  passive_landmarks_source: src/lib/firmvault-passive-landmarks.ts
workflows:
  - id: firmvault-case-setup
    phase: onboarding
    wave: 0-onboarding
    status: initial_wave
    source_files:
      - workflows/firmvault-case-setup.yaml
      - workflows/firmvault-workflows.yaml
    node_count: 2
    recipe_slugs:
      - firmvault-case-setup-create-shell
    trigger_landmarks: []
    output_landmarks:
      - case_setup_complete
      - client_info_received
    human_gates:
      - human_case_setup_review
    waits: []
    canonical_paths: []
    notes:
      - Standalone workflow source is preferred for executable node names.
```

**Step 2: Run GREEN check**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-workflow-port-map.test.ts
```

Expected: PASS.

## Task 3: Add Human-Readable Port Map Notes

**Objective:** Add a readable planning artifact for humans before the Quest skeleton is written.

**Files:**
- Create: `docs/plans/firmvault-workflow-port-map.md`
- Read: `docs/quests/firmvault-workflow-map.yaml`

**Content requirements:**

- Explain the source authority stack.
- State the duplicate-source rule: standalone `workflows/firmvault-*.yaml` beats aggregate entries when node names differ, but aggregate source still preserves older roadmap/wave intent.
- List Part One included waves and deferred waves.
- State the safety rule: recipes may draft/handoff but not send external communications.
- State that real case folders are not touched in automated verification.

**Verification:**

Extend `src/__tests__/firmvault-workflow-port-map.test.ts` to assert the markdown doc exists and mentions:

- `standalone_then_aggregate`
- `No external side effects`
- `temp FirmVault-style case folder`

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-workflow-port-map.test.ts
```

Expected: PASS.

## Task 4: Add RED FirmVault Quest Catalog Test

**Objective:** Define the expected Quest skeleton behavior before adding `quests/firmvault.yaml`.

**Files:**
- Create: `src/__tests__/firmvault-quest-skeleton.test.ts`
- Future target: `quests/firmvault.yaml`

**Test requirements:**

- Load bundled catalog through `loadBundledWaypointCatalog()`.
- Assert `catalog.quests.has('firmvault') === true`.
- Resolve Quest recipes through `catalog.resolveQuestRecipes('firmvault')` and assert `ok === true`.
- Traverse `quest.scaffolds.workstreams[].milestones[].phases[].plans[]` and assert:
  - all plan refs are unique;
  - phases include onboarding, file-setup, treatment-monitoring, records-bills, demand, negotiation, settlement, liens, close;
  - each plan with `metadata.waypoint.node.type === 'recipe'` has `metadata.waypoint.recipe.slug`;
  - every explicit recipe slug is listed in Quest `recipes:`;
  - no recipe slug equals its containing `plan_ref` unless that is intentionally documented under `metadata.source_port.allow_plan_ref_recipe_slug === true` (Part One should not need this exception);
  - gates use `metadata.waypoint.gate.required === true`;
  - waits use `metadata.waypoint.wait` or node type `wait`.

**Step 1: Write failing test**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected: FAIL because `firmvault` Quest is not in the catalog yet.

## Task 5: Add Minimal Safe FirmVault Recipe Placeholders

**Objective:** Ensure Part One Quest recipe references resolve without claiming full recipe prompt porting.

**Files:**
- Create under existing recipe manifest format, likely:
  - `recipes/firmvault/case-setup-create-shell.yaml`
  - `recipes/firmvault/document-collection-review-intake.yaml`
  - `recipes/firmvault/document-collection-request-missing-documents.yaml`
  - `recipes/firmvault/document-collection-send-signature-packets.yaml`
  - `recipes/firmvault/accident-report-analyze.yaml`
  - `recipes/firmvault/medical-provider-setup-case.yaml`
  - `recipes/firmvault/client-check-in-start-cadence.yaml`
  - `recipes/firmvault/client-check-in-prepare-handoff.yaml`

**Manifest requirements:**

Each placeholder must be honest and safe:

```yaml
schema_version: 1
slug: firmvault-case-setup-create-shell
name: FirmVault Case Setup Create Shell
description: Placeholder Recipe manifest for Part One Quest skeleton resolution; full prompt port lands in FVP2.
prompt: >
  Safe placeholder for the FirmVault folder-host port. Do not send external communications or modify external systems. Produce local draft/handoff artifacts only.
tools:
  - file_read
  - file_write
metadata:
  source_port:
    status: placeholder_until_fvp2
    source_repository: /Users/aaronwhaley/Github/mission-control
    source_workflows:
      - workflows/firmvault-case-setup.yaml
    external_side_effects: forbidden
```

**Verification:**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected: still FAIL until `quests/firmvault.yaml` exists, but unresolved recipe errors should not be the final failure after Task 6.

## Task 6: Add `quests/firmvault.yaml` Wave 0/1 Skeleton

**Objective:** Add the installable FirmVault Quest skeleton using current Waypoint schema only.

**Files:**
- Create: `quests/firmvault.yaml`
- Read: `quests/waypoint.yaml` for scaffold shape
- Read: `docs/quests/firmvault-workflow-map.yaml` for source-backed plan refs

**Quest requirements:**

Top-level:

```yaml
schema_version: 1
slug: firmvault
name: FirmVault Case Workflow
description: >
  Standalone Waypoint Quest for a FirmVault personal-injury case folder.
workflow: workflows/firmvault.yaml
recipes:
  - firmvault-case-setup-create-shell
  - firmvault-document-collection-review-intake
  - firmvault-document-collection-request-missing-documents
  - firmvault-document-collection-send-signature-packets
  - firmvault-accident-report-analyze
  - firmvault-medical-provider-setup-case
  - firmvault-client-check-in-start-cadence
  - firmvault-client-check-in-prepare-handoff
```

Scaffold phases must include at least:

- `onboarding`
- `file-setup`
- `treatment-monitoring`
- `records-bills`
- `demand`
- `negotiation`
- `settlement`
- `liens`
- `close`

Part One plan entries should include Wave 0/1 executable-safe tasks:

- case setup recipe task
- human case setup review gate
- document checklist review recipe task
- missing documents request handoff recipe task
- signature packet handoff recipe task
- signed document wait/checkpoint
- onboarding documents human confirmation gate
- accident report analysis/request task
- accident report wait/checkpoint
- accident report human confirmation gate
- medical provider setup recipe task
- medical provider setup human gate
- client check-in cadence task
- client contact handoff task
- human client contact gate

Later phases can be checkpoint placeholders with `metadata.source_port.status: deferred_after_part_one`, not recipe tasks.

**Metadata rules:**

- Recipe task:

```yaml
metadata:
  waypoint:
    node:
      type: recipe
    recipe:
      slug: firmvault-case-setup-create-shell
  source_port:
    workflow_id: firmvault-case-setup
    source_node: create_case_workspace
```

- Gate task:

```yaml
metadata:
  waypoint:
    node:
      type: gate
    gate:
      required: true
      kind: human_case_setup_review
  source_port:
    workflow_id: firmvault-case-setup
    source_node: human_case_setup_review
```

- Wait/checkpoint task:

```yaml
metadata:
  waypoint:
    node:
      type: wait
    wait:
      kind: passive_landmark_or_time
      landmark: full_intake_complete
      days: 7
  source_port:
    workflow_id: firmvault-document-collection
    source_node: wait_for_signed_documents
```

**Verification:**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected: PASS.

## Task 7: Add Temp Folder CLI Smoke for Part One

**Objective:** Prove the existing folder-host implementation can install and start `firmvault` without new runtime code.

**Files:**
- Extend or create: `src/__tests__/firmvault-quest-skeleton.test.ts`
- Use temp directories only.

**Test behavior:**

Use the current CLI source path:

```bash
node /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts init --quest firmvault
node /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts status
node /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts start --quest firmvault
node /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts routes
node /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts tasks --route-id route-001
```

Assert:

- `.waypoint/config.yaml` exists.
- `.waypoint/quests/firmvault.yaml` exists.
- `.waypoint/routes/route-001.yaml` exists.
- `.waypoint/events/route-001.jsonl` contains `route.started`.
- `.waypoint/tasks/tasks.yaml` contains nonzero tasks and includes at least one each of `recipe`, `gate`, `wait`, and `checkpoint` kinds.
- No `.waypoint/` was created at repo root.

**Verification:**

Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected: PASS.

## Task 8: Run Part One Regression Gates

**Objective:** Verify the new catalog data did not break the existing folder-host/package path.

Run in order:

```bash
pnpm exec vitest run src/__tests__/firmvault-workflow-port-map.test.ts src/__tests__/firmvault-quest-skeleton.test.ts
pnpm smoke:folder-host
pnpm smoke:install
pnpm test
pnpm typecheck
```

Expected:

- Targeted FirmVault tests pass.
- Existing smoke scripts pass unchanged.
- Full test suite passes.
- Typecheck exits `0`.

## Task 9: Commit Part One

**Objective:** Commit only after tests pass and evidence is visible in the same turn.

Run:

```bash
git status --short
git add docs/plans/firmvault-workflow-port-map.md docs/quests/firmvault-workflow-map.yaml quests/firmvault.yaml recipes/firmvault src/__tests__/firmvault-workflow-port-map.test.ts src/__tests__/firmvault-quest-skeleton.test.ts
git commit -m "feat(firmvault): add initial folder Quest skeleton"
git log --oneline -5
git status --short --branch
```

Report only the commit hash shown by `git log` after the commit exists.

## Stop Point After Part One

After Part One, do not jump to Mission Control cutover. The next destination is **FVP2: Port Initial FirmVault Recipes**, replacing the placeholder Recipe manifests with source-backed prompts from Mission Control recipe/SOP material while preserving the no-external-side-effects safety rule.
