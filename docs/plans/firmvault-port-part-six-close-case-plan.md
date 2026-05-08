# FirmVault Part Six-G Close Case Wave Implementation Plan

> **For Hermes:** Use subagent-driven-development only after this plan is committed. Execute with primary-source grounding, TDD, and one verified implementation slice.

**Goal:** Port the FirmVault close-case workflow into standalone Waypoint so a per-case folder can verify closure readiness, prepare/send the closing letter through a human gate, archive the file through a human gate, and document final case closure without external side effects.

**Architecture:** Keep the existing standalone FirmVault model: source-backed Recipe manifests, explicit Quest plan bindings, and canonical `.waypoint/firmvault/*.yaml` state. Landmark projection remains deterministic from explicit status fields and existing evidence paths only; Waypoint must not infer legal truth from arbitrary legacy folder files.

**Tech Stack:** TypeScript, YAML manifests, Vitest, `@waypoint/folder-host`, source CLI smoke tests.

---

## Primary source authority

Read this Mission Control workflow source before implementation and cite it in Recipe/Quest metadata:

- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-close-case.yaml`

No matching Mission Control per-recipe directories are required for this slice. If none exist for a target slug, use workflow-backed Recipe manifests and do not claim `recipe.yaml`/`SOUL.md`/`REVIEW.md` provenance.

## Target recipes

Create source-backed, workflow-derived manifests under `recipes/firmvault/`:

1. `close-case-verify-readiness.yaml` → `firmvault-close-case-verify-readiness`
2. `close-case-prepare-letter.yaml` → `firmvault-close-case-prepare-letter`
3. `close-case-document-closure.yaml` → `firmvault-close-case-document-closure`

All prompts must preserve the FirmVault safety contract:

- Work only in the local Waypoint project folder.
- No external communications or side effects.
- Produce checklists, drafts, handoffs, blocked notes, or local closure ledgers only.
- Do not invent closure facts, final-letter send facts, archive references, retention dates, client responses, or case-closed authority.
- Human send/archive facts require human-gate evidence before landmarks are satisfied.

## Target Quest changes

Modify `quests/firmvault.yaml`:

- Add the 3 recipe slugs to the top-level `recipes:` list after settlement/final-distribution recipes.
- Replace `firmvault-close-deferred` with source-backed close-case plans from `firmvault-close-case.yaml`:
  - verify closure readiness (`recipe`)
  - prepare closing letter (`recipe`)
  - human send closing letter (`gate`)
  - human archive file (`gate`)
  - document case closed (`recipe`)
- Preserve `plan_ref` as lifecycle identity and bind executable recipes only through `metadata.waypoint.recipe.slug`.
- Include `metadata.source_port.workflow_id`, `source_node`, `source_workflow`, and `output_landmarks` for each plan.
- Update `metadata.source_port.status` to `part_six_g_close_case_wave`.

Expected count changes after this slice:

- FirmVault installed recipes: 52
- FirmVault scaffold plans/tasks: 87
- FirmVault landmarks: 82
- Total bundled recipes: 87

## Target state/landmark changes

Modify `packages/waypoint-folder-host/src/firmvault/state.ts`:

- Add close-case landmarks after `final_distribution_complete`:
  - `all_obligations_verified`
  - `final_letter_prepared`
  - `final_letter_sent`
  - `case_archived`
  - `case_closed`
- Initialize explicit close state in `settlement.yaml` or a compatible existing state file. Prefer a nested `closing` object in `settlement.yaml` to avoid adding a new state file late in the port unless tests justify it.
- Project each landmark only from explicit status fields and existing evidence paths:
  - `closing.readiness.status` accepted: `verified`, `complete`, `ready`
  - `closing.letter.prepared.status` accepted: `prepared`, `drafted`, `complete`
  - `closing.letter.sent.status` accepted: `sent`, `delivered`
  - `closing.archive.status` accepted: `archived`, `complete`
  - `closing.case.status` accepted: `closed`, `complete`

## TDD task sequence

### Task 1: Add RED tests for close recipes and Quest scaffold

**Files:**

- Modify: `src/__tests__/firmvault-recipe-port.test.ts`
- Modify: `src/__tests__/firmvault-quest-skeleton.test.ts`

**Steps:**

1. Add the 3 close-case slugs to the expected FirmVault recipe list.
2. Add close-phase assertions for the 5 plan refs, 3 recipe slugs, and 2 gates.
3. Run:
   - `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts`
4. Expected RED: missing new recipe manifests and close Quest plans.

### Task 2: Add RED tests for close landmark projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

**Steps:**

1. Add a test that initializes a temp case, creates close evidence files, patches `.waypoint/firmvault/settlement.yaml`, and expects all 5 close landmarks to satisfy.
2. Run:
   - `pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts`
3. Expected RED: missing landmark keys or missing projection behavior.

### Task 3: Implement close state projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Steps:**

1. Add close landmark slugs in the intended order after `final_distribution_complete`.
2. Expand `initialSettlementState()` with nested explicit `closing` status/evidence fields.
3. Add `factLandmark(...)` projections for the new close landmarks.
4. Re-run the state test until GREEN.

### Task 4: Add workflow-derived Recipe manifests

**Files:**

- Create the 3 `recipes/firmvault/close-case-*.yaml` files.

**Steps:**

1. Use Mission Control workflow node `task_goal` text as source content.
2. Include metadata:
   - `source_port.status: ported_from_mission_control_workflow`
   - `source_repository: /Users/aaronwhaley/Github/mission-control`
   - `source_workflow: workflows/firmvault-close-case.yaml`
   - `source_node: <node>`
   - `external_side_effects: forbidden`
3. Validate manifests with recipe-port tests.

### Task 5: Update Quest, docs, smoke counts

**Files:**

- Modify: `quests/firmvault.yaml`
- Modify: `docs/waypoint-quest-catalog.md`
- Modify: `docs/plans/waypoint-source-port-status.md`
- Modify: `WAYPOINT_RESUME_PLAN.md`
- Modify: `src/__tests__/waypoint-docs.test.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `scripts/firmvault-folder-smoke.mjs`

**Steps:**

1. Update exact counts and status text.
2. Do not weaken loader-backed assertions.
3. Re-run focused docs/FirmVault tests.

### Task 6: Verification and commit

Run:

```bash
pnpm exec vitest run \
  packages/waypoint-folder-host/src/firmvault/state.test.ts \
  packages/waypoint-cli/src/commands/firmvault.test.ts \
  src/__tests__/firmvault-recipe-port.test.ts \
  src/__tests__/firmvault-quest-skeleton.test.ts \
  src/__tests__/waypoint-docs.test.ts
pnpm test -- --run
pnpm typecheck
pnpm build
node scripts/firmvault-folder-smoke.mjs
git diff --check
```

If all gates pass, commit:

```bash
git add docs/plans/firmvault-port-part-six-close-case-plan.md recipes/firmvault/close-case-*.yaml quests/firmvault.yaml packages/waypoint-folder-host/src/firmvault/state.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts src/__tests__/waypoint-docs.test.ts scripts/firmvault-folder-smoke.mjs docs/waypoint-quest-catalog.md docs/plans/waypoint-source-port-status.md WAYPOINT_RESUME_PLAN.md
git commit -m "feat(firmvault): port close case wave"
```

Post-commit verification:

```bash
git log --oneline -1
git status --short --branch
```
