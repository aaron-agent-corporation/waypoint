# FirmVault Folder Workflows Port Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Port the Mission Control/FirmVault law-firm workflow catalog into standalone Waypoint so `waypoint init --quest firmvault` can be run inside any FirmVault case folder and manage case-specific workflow routes from local `.waypoint/` state.

**Architecture:** Treat Waypoint as the portable runtime and the FirmVault case folder as the host/project. The port lifts Mission Control workflow YAML and recipe cards into Waypoint Quest/Recipe manifests, adds folder-host support for FirmVault-specific case landmarks and canonical paths, and keeps all durable runtime state under the case folder's `.waypoint/` directory. Mission Control remains an optional rich UI/DB adapter later; it is not required for the folder-host MVP.

**Tech Stack:** TypeScript, pnpm, Waypoint Quest/Recipe manifests, folder-host YAML/JSONL state, temp-folder smoke tests, existing Mission Control workflow YAML and recipe sources.

---

## Source Evidence Checked Before Writing This Plan

- Standalone Waypoint repo: `/Users/aaronwhaley/Github/waypoint`, branch `main...origin/main`, recent commit `a45cc9d docs(package): define consumption strategy`.
- Mission Control repo: `/Users/aaronwhaley/Github/mission-control`, branch `feat/waypoint-runtime-slice`, recent commit `5585a59 feat(waypoint): add agent authorship + loop prevention to discussion messages (W1)`.
- Primary legacy workflow source file in current Mission Control: `workflows/firmvault-workflows.yaml`.
- Roadmap/live-test source in current Mission Control: `docs/superpowers/plans/2026-04-28-firmvault-workflow-build-roadmap.md`.
- Law-firm workflow adapter source in current Mission Control: `src/lib/law-firm-workflow.ts`.
- Test coverage source in current Mission Control: `src/lib/__tests__/firmvault-test-ladder-workflows.test.ts`.
- Prior V1 snapshot also exists at `/Users/aaronwhaley/Github/mission-control-workflow-engine-v1` with many FirmVault workflow YAML files and recipe sources.
- Separate FirmVault pipeline repo exists at `/Users/aaronwhaley/Github/firmvault-document-pipeline`.
- No repo was found at `/Users/aaronwhaley/Github/firmvault` or `/Users/aaronwhaley/Github/FirmVault` during the initial scan.

## North-Star Operator Journey

From inside a real case folder, the operator should be able to run:

```bash
waypoint init --quest firmvault
waypoint status
waypoint start --quest firmvault
waypoint routes
waypoint tasks --route-id route-001
waypoint auto --max-iterations 10
waypoint gate --route-id route-001 --node <human-gate> --approve --note "approved by Aaron"
waypoint route-events --route-id route-001
```

Expected local state:

```text
.case-folder/
  .waypoint/
    config.yaml
    quests/firmvault.yaml
    recipes/firmvault-*/...
    lifecycle/*.yaml
    routes/route-001.yaml
    events/route-001.jsonl
    tasks/tasks.yaml
    tasks/task-*-discussion.jsonl
  AGENTS.md
  Dashboard.md
  client/
  accident/
  insurance/
  medical-providers/
  liens/
  demand/
  negotiation/
  settlement/
  closing/
  workflow-log/
  activity/
```

## Design Decisions

1. **Quest slug:** use `firmvault`, not `gsd` and not Mission Control workflow ids as top-level product names.
2. **One main Quest first:** `quests/firmvault.yaml` models the canonical PI case journey and dependency waves. Later sub-Quests may break out provider-specific, lien-specific, or litigation-specific tracks only after the main folder-host port is proven.
3. **Preserve lifecycle identity:** `plan_ref` remains checkpoint/lifecycle identity. Executable nodes must use explicit `metadata.waypoint.node.type` and `metadata.waypoint.recipe.slug` / `metadata.waypoint.gate` / `metadata.waypoint.wait` metadata.
4. **No external side effects in MVP:** folder-host recipes may draft work product and record handoffs, but they must not send emails, submit forms, call insurers, or alter external systems without explicit human gates.
5. **FirmVault case folder is the subject:** the local folder is the project. Waypoint should not require Mission Control, SQLite, Forgejo, or a running server for MVP folder operation.
6. **Mission Control V1 is source material, not runtime substrate:** port workflow definitions, recipes, roadmap status, landmark semantics, and safety rules; do not copy the old engine wholesale into Waypoint.
7. **Use temp folders in tests:** never initialize `.waypoint/` in a real case folder or the user's home directory during automated verification.

## Acceptance Gates

- A bundled `firmvault` Quest appears in `waypoint quests` and can be installed with `waypoint init --quest firmvault`.
- `waypoint start --quest firmvault` scaffolds a useful case workflow skeleton into local `.waypoint/lifecycle`, `.waypoint/routes`, `.waypoint/events`, and `.waypoint/tasks`.
- The scaffold includes initial Wave 0/1 case setup, document collection, accident report, medical provider setup, and client check-in tasks before expanding to later waves.
- The ported Quest/Recipe manifests parse through existing Waypoint loaders and all recipe references resolve.
- Folder-host smoke runs in a temp FirmVault-style case folder and does not touch real case data.
- Full verification passes before any completion claim:
  - targeted FirmVault Quest/Recipe tests
  - `pnpm smoke:folder-host`
  - `pnpm smoke:install`
  - `pnpm test`
  - `pnpm typecheck`

## Explicit Out of Scope for First Port

- Replacing Mission Control UI.
- Live Forgejo PR publication/merge reconciliation from folder-host.
- External email/fax/portal submission.
- Running against unredacted real client data during automated tests.
- Full litigation branch modeling.
- Private npm/GitHub Packages publishing beyond the current pinned GitHub/tag consumption strategy.

---

## Phase FVP0: Inventory and Port Map

**Objective:** Build a machine-readable map of source workflows, recipes, landmarks, node kinds, and case-folder paths before generating manifests.

**Files:**
- Create: `docs/plans/firmvault-workflow-port-map.md`
- Create: `docs/quests/firmvault-workflow-map.yaml`
- Test: `src/__tests__/firmvault-workflow-port-map.test.ts`

**Steps:**
1. Read source workflow files from `/Users/aaronwhaley/Github/mission-control/workflows/firmvault*.yaml` and recipes under `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-*`.
2. Write a failing docs/map test asserting the map exists and includes at least these workflow ids: `firmvault-case-setup`, `firmvault-document-collection`, `firmvault-accident-report`, `firmvault-medical-provider-setup`, `firmvault-client-check-in-cadence`, `firmvault-request-medical-records`, `firmvault-demand-readiness`, `firmvault-draft-demand`, `firmvault-send-demand`, `firmvault-track-offers`, `firmvault-offer-evaluation`, `firmvault-negotiate-claim`, `firmvault-settlement-processing`, `firmvault-lien-resolution`, `firmvault-final-distribution`, `firmvault-close-case`.
3. Add map fields for `source_file`, `wave`, `status`, `trigger_landmarks`, `output_landmarks`, `canonical_paths`, `node_count`, `recipe_slugs`, and `human_gates`.
4. Verify the map against current source files, not hand-maintained counts.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/firmvault-workflow-port-map.test.ts
```

## Phase FVP1: FirmVault Quest Skeleton

**Objective:** Add `quests/firmvault.yaml` with Wave 0/1 scaffold only, using explicit node metadata and no runtime execution yet.

**Files:**
- Create: `quests/firmvault.yaml`
- Create/modify: relevant tests under `src/__tests__/` or `packages/**/__tests__/`

**Steps:**
1. Write a failing test that loads bundled catalog and expects Quest slug `firmvault`.
2. Add the Quest manifest with workstreams/milestones/phases for at least: onboarding, file setup, treatment monitoring, records/bills, demand, negotiation, settlement, close.
3. Add Wave 0/1 plans with metadata for recipe, gate, wait, and checkpoint nodes.
4. Assert every explicit `metadata.waypoint.recipe.slug` is present in the Quest `recipes:` list.
5. Assert no scaffold task falls back from `plan_ref` to a recipe slug.

**Verification:**

```bash
pnpm exec vitest run src/__tests__ packages/waypoint-folder-host/src
pnpm typecheck
```

## Phase FVP2: Port Initial FirmVault Recipes

**Objective:** Port the initial recipe cards needed by the Wave 0/1 Quest scaffold.

**Files:**
- Create: `recipes/firmvault-*/recipe.yaml` or current recipe manifest format paths
- Test: recipe reference resolution tests

**Initial recipe candidates:**
- `firmvault-document-collection-review-intake`
- `firmvault-document-collection-request-missing-documents`
- `firmvault-document-collection-send-signature-packets`
- `firmvault-case-setup-create-shell`
- `firmvault-accident-report-analyze`
- `firmvault-medical-provider-setup-case`
- `firmvault-client-check-in-start-cadence`
- `firmvault-client-check-in-prepare-handoff`

**Steps:**
1. Read each Mission Control recipe's `SOUL.md`, `REVIEW.md`, and references.
2. Preserve safety rules: no external sending, evidence-backed facts only, same-task human confirmation for external action evidence, append-only logs.
3. Convert source prompts into Waypoint Recipe manifests with source metadata.
4. Add tests that each recipe parses and exposes prompt/source metadata.

**Verification:**

```bash
pnpm exec vitest run <recipe-resolution-tests>
pnpm test
pnpm typecheck
```

## Phase FVP3: FirmVault Case Folder Template / Doctor

**Objective:** Let Waypoint recognize whether the current folder looks like a FirmVault case and report missing canonical paths without modifying user files unexpectedly.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/case-folder.ts`
- Create: `packages/waypoint-folder-host/src/firmvault/case-folder.test.ts`
- Modify: CLI status/doctor surface if needed

**Steps:**
1. Write tests for a temp folder with required starter paths.
2. Implement a read-only detector for FirmVault case folders.
3. Add missing-path diagnostics based on the starter path set from Mission Control tests.
4. Do not auto-create non-`.waypoint` case files in this phase.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault
```

## Phase FVP4: Case State Contract + Landmark Projection

**Objective:** Define Waypoint-owned FirmVault case state under `.waypoint/firmvault/` and project workflow landmarks from explicit YAML statuses plus evidence paths.

This phase supersedes the earlier passive-landmark-scraper framing. Mission Control's workflow contracts remain source material for what the milestones mean, but standalone Waypoint should not infer workflow truth by scraping arbitrary legacy case-folder shapes.

**Files:**
- Create: `docs/plans/firmvault-port-part-four-plan.md`
- Create: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Create: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Create: `packages/waypoint-cli/src/commands/firmvault.ts`
- Create: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`
- Modify: `packages/waypoint-cli/src/bin.ts`
- Modify: `docs/waypoint-folder-host.md`

**Steps:**
1. Initialize `.waypoint/firmvault/{case,client,accident,providers,demand,negotiation,settlement,documents,landmarks}.yaml` plus `events.jsonl`.
2. Start with a small landmark set: `case_setup_complete`, `full_intake_complete`, `accident_report_obtained`, `providers_setup`, `demand_sent`, `initial_offer_received`, `settlement_reached`, `final_distribution_complete`.
3. Project landmarks deterministically from explicit YAML state fields and evidence paths.
4. Require evidence paths to be relative, inside the case folder, and present on disk before a completed status can satisfy a landmark.
5. Keep unsupported/ambiguous landmarks unsatisfied and return warnings rather than guessing.
6. Expose `waypoint firmvault init-case` and `waypoint firmvault landmarks [--json]`.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts
```

## Phase FVP5: FirmVault Start Smoke

**Objective:** Prove `waypoint init --quest firmvault` and `waypoint start --quest firmvault` work from a temp FirmVault-style folder.

**Files:**
- Create: `docs/plans/firmvault-port-part-five-plan.md`
- Create/modify: `scripts/firmvault-folder-smoke.mjs`
- Create: `src/__tests__/firmvault-folder-smoke.test.ts`
- Modify: `package.json` scripts if adding `pnpm smoke:firmvault-folder`

**Steps:**
1. Create a temp case folder with minimal starter paths.
2. Run built/local CLI `init --quest firmvault`.
3. Run `start --quest firmvault`.
4. Assert generated `.waypoint` files exist and route/task counts are nonzero.
5. Assert no files outside the temp folder were touched.

**Verification:**

```bash
pnpm smoke:firmvault-folder
pnpm smoke:folder-host
pnpm test
pnpm typecheck
```

## Phase FVP6: Expand Through Live-Tested Waves

**Objective:** Port the rest of the live-tested non-litigation workflow catalog in dependency-wave order.

**Wave order:**
1. Wave 2 insurance: BI and PIP. Part Six-A plan: `docs/plans/firmvault-port-part-six-insurance-plan.md` and Part Six-B plan: `docs/plans/firmvault-port-part-six-treatment-liens-plan.md`.
2. Wave 3 treatment/lien discovery.
3. Wave 4 records/bills/chronology.
4. Wave 5 demand.
5. Wave 6 negotiation.
6. Wave 7 settlement/lien/final distribution.
7. Phase 8 close case.

**Steps per wave:**
1. Add RED test for missing workflow/recipe slugs.
2. Port Quest scaffold plans and Recipe manifests.
3. Add landmark resolver coverage for the wave's passive triggers.
4. Add temp-folder smoke fixture for one representative route path.
5. Run targeted tests, then full suite/typecheck at wave boundary.

**Verification per wave:**

```bash
pnpm exec vitest run <wave-targeted-tests>
pnpm smoke:firmvault-folder
pnpm test
pnpm typecheck
```

## Phase FVP7: Package/Install Readiness for FirmVault Quest

**Objective:** Confirm the FirmVault Quest is available through the same package install path already used for Waypoint RC consumption.

**Steps:**
1. Extend package install smoke to include `waypoint quests` containing `firmvault`.
2. Run `waypoint init --quest firmvault` in a temp consumer project.
3. Verify built package imports and tarball install smoke.

**Verification:**

```bash
pnpm clean && pnpm build && pnpm verify:built-imports && pnpm smoke:install && pnpm smoke:firmvault-folder && pnpm test && pnpm typecheck
```

## Phase FVP8: FirmVault Case Bootstrap + Agent Activation

**Objective:** After the folder-host FirmVault Quest works, make it consumable as the new-case operator flow: the agent creates a new PI case folder under a trusted cases root, installs/activates the `firmvault` Quest, initializes FirmVault state, starts the route, and leaves the case ready for document intake and gated lifecycle progress.

**Plan:** `docs/plans/firmvault-case-bootstrap-agent-plan.md`

**Steps:**
1. Add a safe FirmVault starter-folder writer that creates the canonical case folder layout and starter markdown files.
2. Compose existing folder-host primitives instead of inventing a new runtime: initialize Waypoint, install the FirmVault Quest/Recipes, initialize `.waypoint/firmvault/` state, and optionally start `route-001`.
3. Expose the flow through `waypoint firmvault bootstrap --cases-root <trusted-root> --case-name <name> --case-type personal-injury [--start] [--json]`.
4. Add a constrained Hermes/operator adapter for “new case” requests that resolves only trusted cases-root keys and invokes the bootstrap command with explicit args.
5. Add a local document-intake rail so the agent can add/copy case documents into `documents/inbox/` and record them in FirmVault state without marking substantive landmarks complete from file presence alone.

**Verification:**

```bash
pnpm smoke:firmvault-bootstrap
pnpm smoke:firmvault-folder
pnpm smoke:folder-host
pnpm test
pnpm typecheck
git diff --check
```

## Deferred: Harden / Mission Control Bridge

Mission Control cutover is explicitly cancelled for this track. Any future Mission Control consumption, bridge, or UI/database adapter work belongs to Harden, not the standalone FirmVault folder bootstrap path.

---

## Reporting Rule for This Track

Every completion report must include same-turn primary-source evidence:

- commits: `git log --oneline -5`
- file changes: write/patch output plus `git diff --stat` or file readback
- tests: terminal output from the exact command
- package/RC/push claims: remote refs or package smoke output

No claimed workflow count, recipe count, or test result should be reported from memory.
