# FirmVault Part Six-F Settlement, Liens, and Final Distribution Wave Implementation Plan

> **For Hermes:** Use subagent-driven-development only after this plan is committed. Execute with primary-source grounding, TDD, and one verified implementation slice.

**Goal:** Port the FirmVault settlement-processing, settlement-lien, final lien-resolution, and final-distribution workflows into standalone Waypoint so a per-case folder can track accepted settlement facts through authorization, release, funds receipt, lien resolution, and final distribution without external side effects.

**Architecture:** Keep the existing standalone FirmVault model: source-backed Recipe manifests, explicit Quest plan bindings, and canonical `.waypoint/firmvault/*.yaml` state. Landmark projection remains deterministic from explicit status fields and existing evidence paths only; Waypoint must not infer legal truth from arbitrary legacy folder files.

**Tech Stack:** TypeScript, YAML manifests, Vitest, `@waypoint/folder-host`, source CLI smoke tests.

---

## Primary source authority

Read these Mission Control workflow sources before implementation and cite them in Recipe/Quest metadata:

- `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-settlement-processing.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-settlement-lien-negotiation.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-lien-resolution.yaml`
- `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-final-distribution.yaml`

No matching Mission Control per-recipe directories are required for this slice. If none exist for a target slug, use workflow-backed Recipe manifests and do not claim `recipe.yaml`/`SOUL.md`/`REVIEW.md` provenance.

## Target recipes

Create source-backed, workflow-derived manifests under `recipes/firmvault/`:

### Settlement processing

1. `settlement-prepare-statement.yaml` → `firmvault-settlement-prepare-statement`
2. `settlement-prepare-authorization.yaml` → `firmvault-settlement-prepare-authorization`
3. `settlement-document-funds.yaml` → `firmvault-settlement-document-funds`

### Settlement lien negotiation

4. `settlement-lien-audit.yaml` → `firmvault-settlement-lien-audit`
5. `settlement-lien-document-result.yaml` → `firmvault-settlement-lien-document-result`

### Final lien resolution

6. `lien-resolution-review-inventory.yaml` → `firmvault-lien-resolution-review-inventory`
7. `lien-resolution-prepare-final-request.yaml` → `firmvault-lien-resolution-prepare-final-request`
8. `lien-resolution-document-final-amount.yaml` → `firmvault-lien-resolution-document-final-amount`
9. `lien-resolution-document-payment.yaml` → `firmvault-lien-resolution-document-payment`

### Final distribution

10. `final-distribution-prepare-statement.yaml` → `firmvault-final-distribution-prepare-statement`
11. `final-distribution-zero-trust.yaml` → `firmvault-final-distribution-zero-trust`

All prompts must preserve the FirmVault safety contract:

- Work only in the local Waypoint project folder.
- No external communications or side effects.
- Produce drafts, ledgers, handoffs, blocked notes, or review questions only.
- Do not invent facts, amounts, parties, deadlines, client authority, lien terms, payment facts, settlement funds, or trust-account balances.
- Human signature, release execution, send/payment/receipt, and distribution facts require human-gate evidence before landmarks are satisfied.

## Target Quest changes

Modify `quests/firmvault.yaml`:

- Add the 11 recipe slugs to the top-level `recipes:` list after negotiation recipes.
- Replace `firmvault-settlement-deferred` with source-backed settlement processing, settlement-lien, and final-distribution plans.
- Replace `firmvault-liens-deferred` with source-backed final lien-resolution plans while preserving the already-ported early-lien plans.
- Preserve `plan_ref` as lifecycle identity and bind executable recipes only through `metadata.waypoint.recipe.slug`.
- Include `metadata.source_port.workflow_id`, `source_node`, `source_workflow`, and `output_landmarks` for each plan.
- Update `metadata.source_port.status` to `part_six_f_settlement_distribution_wave`.

Expected count changes after this slice:

- FirmVault installed recipes: 49
- FirmVault scaffold plans/tasks: 83
- FirmVault landmarks: 77
- Total bundled recipes: 84

## Target Quest phase structure

### Settlement phase

Replace the single deferred settlement checkpoint with 13 plans:

1. Prepare settlement statement (`recipe`)
2. Prepare authorization to settle (`recipe`)
3. Client settlement authorization (`gate`)
4. Execute release (`gate`)
5. Wait for settlement funds (`wait`)
6. Document settlement funds receipt (`recipe`)
7. Audit settlement liens (`recipe`)
8. Human lien strategy review (`gate`)
9. Document settlement lien result (`recipe`)
10. Prepare final distribution statement (`recipe`)
11. Human issue client distribution (`gate`)
12. Human confirm client receipt (`gate`)
13. Document trust account zeroed / final distribution complete (`recipe`)

### Liens phase

Keep the early-lien identification plans and replace the final lien-resolution deferred checkpoint with 7 plans:

1. Review lien inventory (`recipe`)
2. Prepare final lien request (`recipe`)
3. Human send final lien request (`gate`)
4. Wait for final lien amount (`wait`)
5. Document final lien amount (`recipe`)
6. Human lien payment review (`gate`)
7. Document lien payment (`recipe`)

## Target state/landmark changes

Modify `packages/waypoint-folder-host/src/firmvault/state.ts`:

- Expand `FIRMVAULT_LANDMARK_SLUGS` with these settlement/distribution landmarks:
  - `settlement_statement_prepared`
  - `authorization_to_settle_prepared`
  - `client_authorized`
  - `release_executed`
  - `funds_received`
  - `settlement_liens_audited`
  - `liens_prioritized`
  - `lien_available_funds_calculated`
  - `settlement_lien_strategy_reviewed`
  - `liens_negotiated`
  - `final_distribution_statement_prepared`
  - `client_distribution_issued`
  - `client_distributed`
  - `trust_account_zeroed`
- Expand lien state projection with:
  - `liens_opened`
  - `final_amount_request_prepared`
  - `final_amounts_requested`
  - `final_amounts_received`
  - `lien_payment_authorized`
  - `liens_paid`
- Keep existing `settlement_reached` and `final_distribution_complete`, but move `final_distribution_complete` to explicit final-distribution state semantics instead of the old placeholder only.
- Initialize `settlement.yaml` with explicit nested fields for settlement statement, authorization, client authorization, release, funds receipt, settlement-lien audit/strategy/result, final distribution statement, client distribution issuance/receipt, trust-account zeroing, and final distribution completion.
- Extend `liens.yaml` with explicit final-lien-resolution fields for inventory, final amount request, final amount receipt, payment authorization, payment documentation, and paid/negotiated status.
- Use accepted statuses like `prepared`, `authorized`, `executed`, `received`, `cleared`, `audited`, `reviewed`, `documented`, `negotiated`, `issued`, `confirmed`, `zeroed`, `complete`, and `paid`, but require at least one existing evidence path for each satisfied landmark.

## TDD task sequence

### Task 1: Add RED tests for settlement/final-lien manifests and Quest scaffold

**Files:**

- Modify: `src/__tests__/firmvault-recipe-port.test.ts`
- Modify: `src/__tests__/firmvault-quest-skeleton.test.ts`

**Steps:**

1. Add the 11 target slugs to the expected FirmVault recipe list.
2. Add settlement phase assertions for the 13 source-backed settlement/final-distribution plan refs.
3. Add liens phase assertions for the 7 final-lien-resolution plan refs.
4. Run:
   - `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts`
5. Expected RED: missing new recipe manifests and deferred Quest plans still present.

### Task 2: Add RED tests for settlement, lien-resolution, and final-distribution landmark projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

**Steps:**

1. Add a test that initializes a temp case, creates settlement/lien evidence files, patches `.waypoint/firmvault/settlement.yaml` and `.waypoint/firmvault/liens.yaml`, and expects all new landmarks to satisfy.
2. Run:
   - `pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts`
3. Expected RED: missing landmark keys or missing projection behavior.

### Task 3: Implement state projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Steps:**

1. Add the new landmark slugs in source-workflow order after negotiation/settlement anchors.
2. Expand initial `settlement.yaml` and `liens.yaml` state with explicit nested status/evidence fields.
3. Add `factLandmark(...)` projections for all new landmarks.
4. Re-run the state test until GREEN.

### Task 4: Add workflow-derived Recipe manifests

**Files:**

- Create the 11 target `recipes/firmvault/*.yaml` files.

**Steps:**

1. Use Mission Control workflow node `task_goal` and canonical paths as source content.
2. Include metadata:
   - `source_port.status: ported_from_mission_control_workflow`
   - `source_repository: /Users/aaronwhaley/Github/Active Projects/mission-control`
   - `source_workflow: workflows/<workflow>.yaml`
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
git add docs/plans/firmvault-port-part-six-settlement-distribution-plan.md recipes/firmvault/settlement-*.yaml recipes/firmvault/lien-resolution-*.yaml recipes/firmvault/final-distribution-*.yaml quests/firmvault.yaml packages/waypoint-folder-host/src/firmvault/state.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts src/__tests__/waypoint-docs.test.ts scripts/firmvault-folder-smoke.mjs docs/waypoint-quest-catalog.md docs/plans/waypoint-source-port-status.md WAYPOINT_RESUME_PLAN.md
git commit -m "feat(firmvault): port settlement distribution wave"
```

Post-commit verification:

```bash
git log --oneline -1
git status --short --branch
```
