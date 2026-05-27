# FirmVault Part Six-C Records/Bills/Chronology Port Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after the plan is committed or included in the implementation slice.

**Goal:** Expand the standalone FirmVault Quest from setup/insurance/treatment/lien-discovery into the provider-scoped medical records, bills, and chronology wave.

**Architecture:** Keep Waypoint's folder-host model as the source of truth. Port Mission Control's `firmvault-request-medical-records` workflow into explicit Quest scaffold plans and source-backed Recipe manifests, while projecting progress from product-owned `.waypoint/firmvault/records.yaml` state plus evidence paths. Do not infer truth from arbitrary legacy FirmVault folders.

**Tech Stack:** TypeScript, YAML Quest/Recipe manifests, Vitest, Node CLI smoke tests, explicit `.waypoint/firmvault/*.yaml` case state.

---

## Source Authority

Primary sources for this slice:

- Mission Control workflow: `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-request-medical-records.yaml`
- Mission Control recipes:
  - `recipes/firmvault-medical-records-verify-authorization`
  - `recipes/firmvault-request-records-bills-prepare-request`
  - `recipes/firmvault-request-records-bills-send-request`
  - `recipes/firmvault-request-records-bills-follow-up`
  - `recipes/firmvault-medical-records-receive-and-process`
  - `recipes/firmvault-medical-chronology-update`
  - plus current records-specific recipe source folders already present in Mission Control for first/second/escalation variants
- Waypoint workflow map: `docs/quests/firmvault-workflow-map.yaml`
- Current FirmVault Quest: `quests/firmvault.yaml`
- Current state projection: `packages/waypoint-folder-host/src/firmvault/state.ts`

## Task 1: RED tests for records/bills expansion

**Objective:** Make the current suite fail because records/bills slugs, scaffold nodes, state file, and landmark count are missing.

**Files:**

- Modify: `src/__tests__/firmvault-recipe-port.test.ts`
- Modify: `src/__tests__/firmvault-quest-skeleton.test.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `scripts/firmvault-folder-smoke.mjs`

**Expected RED command:**

```bash
pnpm exec vitest run \
  src/__tests__/firmvault-recipe-port.test.ts \
  src/__tests__/firmvault-quest-skeleton.test.ts \
  packages/waypoint-folder-host/src/firmvault/state.test.ts \
  packages/waypoint-cli/src/commands/firmvault.test.ts
```

Expected: fail on missing records/bills Recipe manifests, missing scaffold plan refs, missing `records.yaml`, and old landmark count.

## Task 2: Port records/bills Recipe manifests

**Objective:** Add source-backed Waypoint Recipe manifests for the records/bills/chronology wave.

**Files:**

- Create under `recipes/firmvault/`:
  - `medical-records-verify-authorization.yaml`
  - `request-records-bills-prepare-request.yaml`
  - `request-records-bills-send-request.yaml`
  - `request-records-bills-follow-up.yaml`
  - `medical-records-receive-and-process.yaml`
  - `medical-chronology-update.yaml`
  - `medical-records-prepare-request.yaml`
  - `medical-records-send-request.yaml`
  - `medical-records-first-follow-up.yaml`
  - `medical-records-second-follow-up.yaml`
  - `medical-records-escalate-delay.yaml`

**Rules:**

- Preserve Mission Control `recipe.yaml`, `SOUL.md`, and `REVIEW.md` as provenance in `metadata.source_port`.
- Convert `/workspace` language to local Waypoint project-folder language.
- Keep all external communications as draft/handoff only.
- Remove active secret/model/runtime instructions from the Waypoint manifest.
- Keep `external_side_effects: forbidden`.

## Task 3: Expand `quests/firmvault.yaml`

**Objective:** Replace the records/bills deferred checkpoint with explicit workflow plans matching `firmvault-request-medical-records.yaml`.

**Files:**

- Modify: `quests/firmvault.yaml`

**Expected scaffold behavior:**

- Quest recipes increase from 17 to 28.
- Quest start materializes 51 plans/tasks.
- Records/bills phase includes recipe, wait, and human gate nodes for authorization verification, request preparation, human send handoff, follow-ups, receipt/processing, chronology update, and provider-workflow completion review.

## Task 4: Expand explicit case-state projection

**Objective:** Add `records.yaml` and deterministic records/bills landmarks.

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

**Landmarks to add:**

- `medical_auth_verified`
- `records_request_packet_prepared`
- `records_requested_all_providers`
- `first_records_follow_up_complete`
- `second_records_follow_up_complete`
- `third_records_follow_up_complete`
- `records_request_escalated`
- `records_and_bills_processed`
- `all_records_received`
- `medical_chronology_updated`
- `medical_records_request_workflow_complete`

Expected total landmark count after this slice: 42.

## Task 5: Update smoke/docs expectations

**Objective:** Keep CLI smoke and docs assertions aligned with the expanded FirmVault catalog and state contract.

**Files:**

- Modify: `scripts/firmvault-folder-smoke.mjs`
- Modify docs/tests that assert loader-backed counts if the catalog count changes.

## Verification Gate

Run and quote these before reporting complete:

```bash
pnpm exec vitest run \
  src/__tests__/firmvault-recipe-port.test.ts \
  src/__tests__/firmvault-quest-skeleton.test.ts \
  packages/waypoint-folder-host/src/firmvault/state.test.ts \
  packages/waypoint-cli/src/commands/firmvault.test.ts
pnpm smoke:firmvault-folder
pnpm test
pnpm typecheck
pnpm build
git diff --check
git log --oneline -5
git status --short --branch
```

## Out of Scope

- No Mission Control bridge.
- No runtime sending of medical-records requests.
- No arbitrary legacy-folder scraping.
- No demand/negotiation/settlement/final lien resolution wave in this slice.
