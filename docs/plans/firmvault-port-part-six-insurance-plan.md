# FirmVault Port Part Six-A Insurance Wave Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after this plan is committed or when Aaron explicitly directs same-turn execution. Ground every claim in repo, source files, test output, and git history.

**Goal:** Expand the standalone FirmVault Quest from the onboarding/file-setup skeleton into the first live-tested insurance wave: BI claim setup and PIP claim setup.

**Architecture:** Keep Waypoint as the portable folder-host runtime. Mission Control workflow YAML and recipe folders are source material; the standalone runtime state remains `.waypoint/firmvault/` YAML/JSONL. Quest plans use explicit `metadata.waypoint.node.type` plus explicit recipe/gate/wait metadata; `plan_ref` stays lifecycle/checkpoint identity.

**Tech Stack:** TypeScript, pnpm, Vitest, Waypoint Quest/Recipe YAML manifests, folder-host YAML state, temp-folder smoke tests, Mission Control FirmVault source workflows/recipes.

---

## Source Authority

Use these primary sources for this slice:

- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-bi-claim-setup.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-pip-claim-setup.yaml`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-insurance-bi-identify-carrier/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-insurance-bi-prepare-lor/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-insurance-bi-process-acknowledgment/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-insurance-pip-open-claim/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-pip-file-application/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-pip-confirm-approval/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-pip-track-exhaustion/{recipe.yaml,SOUL.md,REVIEW.md}`
- `docs/quests/firmvault-workflow-map.yaml`

## Scope

In scope:

1. Add the seven BI/PIP recipe manifests to `recipes/firmvault/`.
2. Add BI/PIP recipe slugs to `quests/firmvault.yaml`.
3. Replace the `treatment-monitoring` deferred checkpoint with explicit BI/PIP recipe, gate, and wait plans.
4. Add `insurance.yaml` to `.waypoint/firmvault/` state initialization.
5. Add deterministic BI/PIP landmark projection from explicit `insurance.yaml` statuses plus evidence paths.
6. Keep `pnpm smoke:firmvault-folder` green.

Out of scope:

- Actually sending BI LORs or PIP packets.
- Contacting carriers, providers, portals, mail, fax, email, or external systems.
- Demand, settlement, liens, records/bills beyond the specific PIP status check already present in the PIP workflow source.
- Mission Control cutover or bridge work.

## Task 1: Add RED tests for BI/PIP Quest and Recipe coverage

**Objective:** Capture the expected BI/PIP wave before adding manifests.

**Files:**

- Modify: `src/__tests__/firmvault-recipe-port.test.ts`
- Modify: `src/__tests__/firmvault-quest-skeleton.test.ts`

**Steps:**

1. Extend the expected FirmVault recipe slug list with:
   - `firmvault-insurance-bi-identify-carrier`
   - `firmvault-insurance-bi-prepare-lor`
   - `firmvault-insurance-bi-process-acknowledgment`
   - `firmvault-insurance-pip-open-claim`
   - `firmvault-pip-file-application`
   - `firmvault-pip-confirm-approval`
   - `firmvault-pip-track-exhaustion`
2. Add Quest skeleton assertions that `treatment-monitoring` contains BI/PIP recipe plans, human send gates, and wait plans.
3. Run:

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts
```

Expected RED: missing recipe manifests and/or missing Quest plan refs.

## Task 2: Port the seven source-backed BI/PIP recipes

**Objective:** Convert source Mission Control recipe metadata, SOUL, and REVIEW files into safe Waypoint Recipe manifests.

**Files:**

- Create: `recipes/firmvault/insurance-bi-identify-carrier.yaml`
- Create: `recipes/firmvault/insurance-bi-prepare-lor.yaml`
- Create: `recipes/firmvault/insurance-bi-process-acknowledgment.yaml`
- Create: `recipes/firmvault/insurance-pip-open-claim.yaml`
- Create: `recipes/firmvault/pip-file-application.yaml`
- Create: `recipes/firmvault/pip-confirm-approval.yaml`
- Create: `recipes/firmvault/pip-track-exhaustion.yaml`

**Rules:**

- Prompt must include the local Waypoint project folder boundary.
- Prompt must include the no-external-side-effects rule.
- Strip active `OPENROUTER_API_KEY` / model / image runtime settings from active manifest fields.
- Preserve source provenance in `metadata.source_port`.
- Preserve review criteria in `metadata.source_port.review_criteria`.

## Task 3: Expand `quests/firmvault.yaml` treatment-monitoring phase

**Objective:** Replace the Part One deferred treatment-monitoring checkpoint with source-backed BI/PIP plans.

**Files:**

- Modify: `quests/firmvault.yaml`

**BI plan refs:**

- `firmvault-insurance-bi-identify-carrier-task` — recipe
- `firmvault-insurance-bi-prepare-lor-handoff` — recipe
- `firmvault-insurance-bi-human-send-lor` — gate
- `firmvault-insurance-bi-wait-acknowledgment` — wait, 5 days
- `firmvault-insurance-bi-process-acknowledgment-task` — recipe

**PIP plan refs:**

- `firmvault-insurance-pip-open-claim-task` — recipe
- `firmvault-insurance-pip-prepare-packet` — recipe
- `firmvault-insurance-pip-human-send-packet` — gate
- `firmvault-insurance-pip-wait-acknowledgment` — wait, 10 days
- `firmvault-insurance-pip-confirm-approval-task` — recipe
- `firmvault-insurance-pip-wait-status-followup` — wait, 30 days
- `firmvault-insurance-pip-track-exhaustion-task` — recipe

## Task 4: Extend FirmVault state contract with insurance landmarks

**Objective:** Add explicit `insurance.yaml` state and deterministic landmark projection for BI/PIP wave output landmarks.

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Modify: `docs/waypoint-folder-host.md`

**Landmarks:**

- `at_fault_insurance_identified`
- `bi_lor_prepared`
- `bi_lor_sent`
- `bi_acknowledgment_checked`
- `pip_track_active`
- `pip_carrier_identified`
- `pip_application_prepared`
- `pip_lor_prepared`
- `pip_application_filed`
- `pip_lor_sent`
- `pip_acknowledgment_checked`
- `pip_approved`
- `pip_status_checked`
- `pip_benefits_exhausted`

**Rules:**

- Evidence paths must be relative, inside the case folder, and present on disk.
- Unsupported or missing evidence keeps landmarks unsatisfied and returns warnings.
- Do not scrape arbitrary folder shapes for truth.

## Task 5: Verify and commit

**Commands:**

```bash
pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts packages/waypoint-folder-host/src/firmvault/state.test.ts
pnpm smoke:firmvault-folder
pnpm test
pnpm typecheck
git diff --check
git status --short --branch
git log --oneline -5
```

Commit message:

```bash
git commit -m "feat(firmvault): port insurance wave"
```
