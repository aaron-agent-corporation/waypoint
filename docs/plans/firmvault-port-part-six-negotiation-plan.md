# FirmVault Part Six-E Negotiation Wave Implementation Plan

> **For Hermes:** Use subagent-driven-development only after this plan is committed. Execute with primary-source grounding, TDD, and one verified slice.

**Goal:** Port the FirmVault negotiation workflows into standalone Waypoint so a per-case folder can track offers, evaluate offers, document client decisions, and prepare/document negotiation responses without external side effects.

**Architecture:** Keep the existing standalone FirmVault model: source-backed Recipe manifests plus explicit Quest plan bindings and canonical `.waypoint/firmvault/negotiation.yaml` state. Landmark projection remains deterministic from explicit status fields and existing evidence paths only; no arbitrary legal-folder inference.

**Tech Stack:** TypeScript, YAML manifests, Vitest, `@waypoint/folder-host`, source CLI smoke tests.

---

## Primary source authority

Read these Mission Control workflow sources before implementation and cite them in metadata:

- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-track-offers.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-offer-evaluation.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-negotiate-claim.yaml`

No matching Mission Control `recipes/firmvault-negotiation-*` directories currently exist, so this slice must use workflow-backed Recipe manifests and must not claim per-recipe `recipe.yaml`/`SOUL.md`/`REVIEW.md` provenance.

## Target negotiation recipes

Create source-backed, workflow-derived manifests under `recipes/firmvault/`:

1. `negotiation-track-offer.yaml` → `firmvault-negotiation-track-offer`
2. `negotiation-offer-evaluation.yaml` → `firmvault-negotiation-offer-evaluation`
3. `negotiation-document-client-decision.yaml` → `firmvault-negotiation-document-client-decision`
4. `negotiation-prepare-response.yaml` → `firmvault-negotiation-prepare-response`
5. `negotiation-document-response.yaml` → `firmvault-negotiation-document-response`

All prompts must preserve the FirmVault safety contract:

- Work only in the local Waypoint project folder.
- No external communications or side effects.
- Produce drafts, ledgers, handoffs, blocked notes, or review questions only.
- Do not invent facts, amounts, parties, deadlines, client authority, or settlement terms.
- External acceptance/counter/rejection communications require human-gate evidence before landmarks are satisfied.

## Target Quest changes

Modify `quests/firmvault.yaml`:

- Add the 5 negotiation recipe slugs to the top-level `recipes:` list after demand recipes.
- Replace `firmvault-negotiation-deferred` with source-backed negotiation plans from the three workflows:
  - wait for offer/response (`wait`)
  - log incoming offer (`recipe`)
  - prepare offer evaluation (`recipe`)
  - client offer decision (`gate`)
  - document client decision (`recipe`)
  - prepare negotiation response (`recipe`)
  - human send negotiation response (`gate`)
  - document negotiation response (`recipe`)
- Preserve `plan_ref` as lifecycle identity and bind executable recipes only through `metadata.waypoint.recipe.slug`.
- Include `metadata.source_port.workflow_id`, `source_node`, `source_workflow`, and `output_landmarks` for each plan.
- Update `metadata.source_port.status` to `part_six_e_negotiation_wave`.

Expected count changes after this slice:

- FirmVault installed recipes: 38
- FirmVault scaffold plans/tasks: 65
- FirmVault landmarks: 57
- Total bundled recipes: 73

## Target state/landmark changes

Modify `packages/waypoint-folder-host/src/firmvault/state.ts`:

- Expand `FIRMVAULT_LANDMARK_SLUGS` with:
  - `initial_offer_received`
  - `offer_documented`
  - `offer_evaluated`
  - `net_to_client_prepared`
  - `client_advised_of_offer`
  - `offer_decision_documented`
  - `negotiation_response_prepared`
  - `negotiation_response_human_sent`
  - `negotiation_result_documented`
- `initial_offer_received` already exists as a minimal placeholder; replace/expand the negotiation section so all nine negotiation landmarks are projected from `negotiation.yaml`.
- Continue projecting `settlement_reached` from `settlement.yaml` until the settlement wave owns the settlement state.
- Initialize `negotiation.yaml` with explicit nested fields for offers, evaluation, client decision, response preparation, human send, and result documentation.
- Use accepted statuses like `received`, `documented`, `prepared`, `evaluated`, `reviewed`, `advised`, `sent`, `complete`, `accepted`, `countered`, `rejected`, but require at least one existing evidence path for each satisfied landmark.

## TDD task sequence

### Task 1: Add RED tests for negotiation manifests and Quest scaffold

**Files:**

- Modify: `src/__tests__/firmvault-recipe-port.test.ts`
- Modify: `src/__tests__/firmvault-quest-skeleton.test.ts`

**Steps:**

1. Add the 5 negotiation slugs to the expected FirmVault recipe list.
2. Update the recipe-port test to allow workflow-backed manifests with `source_workflow` when per-recipe source dirs do not exist.
3. Add negotiation phase assertions for the 8 plan refs, 5 recipe slugs, 2 gates, and 1 wait.
4. Run:
   - `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts`
5. Expected RED: missing new recipe manifests and missing negotiation Quest plans.

### Task 2: Add RED tests for negotiation landmark projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

**Steps:**

1. Add a test that initializes a temp case, creates negotiation evidence files, patches `.waypoint/firmvault/negotiation.yaml`, and expects all 9 negotiation landmarks to satisfy.
2. Run:
   - `pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts`
3. Expected RED: missing landmark keys or missing projection behavior.

### Task 3: Implement negotiation state projection

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Steps:**

1. Add negotiation landmark slugs in the intended order after `demand_sent` and before settlement landmarks.
2. Expand `initialNegotiationState()` with nested explicit status/evidence fields.
3. Add `factLandmark(...)` projections for the new negotiation landmarks.
4. Re-run the state test until GREEN.

### Task 4: Add workflow-derived Recipe manifests

**Files:**

- Create the 5 `recipes/firmvault/negotiation-*.yaml` files.

**Steps:**

1. Use the Mission Control workflow node `task_goal` and canonical paths as source content.
2. Include metadata:
   - `source_port.status: ported_from_mission_control_workflow`
   - `source_repository: /Users/aaronwhaley/Github/mission-control`
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
git add docs/plans/firmvault-port-part-six-negotiation-plan.md recipes/firmvault/negotiation-*.yaml quests/firmvault.yaml packages/waypoint-folder-host/src/firmvault/state.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts src/__tests__/waypoint-docs.test.ts scripts/firmvault-folder-smoke.mjs docs/waypoint-quest-catalog.md docs/plans/waypoint-source-port-status.md WAYPOINT_RESUME_PLAN.md
git commit -m "feat(firmvault): port negotiation wave"
```

Post-commit verification:

```bash
git log --oneline -1
git status --short --branch
```
