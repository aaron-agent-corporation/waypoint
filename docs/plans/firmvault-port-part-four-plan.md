# FirmVault Port Part Four — Case State Contract + Landmark Projection Plan

> **For Hermes:** Use subagent-driven-development skill only after this plan is committed. Implement task-by-task with TDD and primary-source verification.

**Goal:** Replace the legacy passive-landmark-scraper direction with a product-owned FirmVault case state contract that lives inside each Waypoint folder and projects workflow landmarks from explicit YAML state plus auditable evidence paths.

**Architecture:** Waypoint owns canonical machine-readable FirmVault state under `.waypoint/firmvault/`. Domain YAML files store operational facts and evidence references. Landmark status is derived deterministically from those facts and written/read as a generated projection, while JSONL records state events. Actual PDFs, contracts, HIPAA forms, demands, and notes are evidence artifacts referenced by state; they are not parsed as the workflow database.

**Tech Stack:** TypeScript, Node fs/promises, `yaml`, Vitest, existing `@waypoint/folder-host` package, existing `waypoint` CLI command dispatcher.

---

## Product decision

The existing Mission Control/FirmVault workflow contracts remain the authority for **what must happen** in a law-firm case workflow: intake, contracts, HIPAA, accident report, providers, demand, negotiation, settlement, distribution, and related handoffs.

They are not the authority for **how standalone Waypoint must store state**. Standalone Waypoint can define a cleaner folder contract.

Part Four therefore does **not** attempt to infer progress by scraping arbitrary legacy FirmVault folders or parsing legal documents. It defines explicit operational YAML state with evidence references and projects landmarks from that state.

## Canonical folder state

Create this product-owned state tree inside initialized case folders:

```text
.waypoint/
  firmvault/
    case.yaml
    client.yaml
    accident.yaml
    providers.yaml
    demand.yaml
    negotiation.yaml
    settlement.yaml
    documents.yaml
    landmarks.yaml
    events.jsonl
```

Rules:

- YAML files are the durable editable state contract.
- `events.jsonl` is append-only audit history for state initialization and future state mutations.
- Markdown and legal documents are human work product / evidence, not the primary workflow database.
- Evidence paths must be relative paths inside the case folder.
- Landmark projection must be deterministic and conservative.

## Initial landmarks

Part Four owns the first eight product landmarks:

- `case_setup_complete`
- `full_intake_complete`
- `accident_report_obtained`
- `providers_setup`
- `demand_sent`
- `initial_offer_received`
- `settlement_reached`
- `final_distribution_complete`

Initial `init-case` state should project every landmark as `satisfied: false` until explicit state fields and evidence references satisfy it.

## Landmark rule table

- `case_setup_complete`
  - Source: `.waypoint/firmvault/case.yaml`
  - Rule: `case.setup.status == complete` and at least one setup evidence path exists.
- `full_intake_complete`
  - Source: `.waypoint/firmvault/client.yaml`
  - Rule: client intake is `complete`, fee agreement is `signed`, HIPAA authorization is `signed`, and each fact has existing evidence.
- `accident_report_obtained`
  - Source: `.waypoint/firmvault/accident.yaml`
  - Rule: `accident.police_report.status == received` and evidence exists.
- `providers_setup`
  - Source: `.waypoint/firmvault/providers.yaml`
  - Rule: `providers_setup.status == complete` and evidence exists.
- `demand_sent`
  - Source: `.waypoint/firmvault/demand.yaml`
  - Rule: `demand.status in [sent, delivered]` and sent evidence exists.
- `initial_offer_received`
  - Source: `.waypoint/firmvault/negotiation.yaml`
  - Rule: `negotiation.initial_offer.status == received` and evidence exists.
- `settlement_reached`
  - Source: `.waypoint/firmvault/settlement.yaml`
  - Rule: `settlement.status in [reached, signed, funded, distributed]` and settlement evidence exists.
- `final_distribution_complete`
  - Source: `.waypoint/firmvault/settlement.yaml`
  - Rule: `settlement.distribution.status == complete` and distribution evidence exists.

If a state field is ambiguous, missing, invalid, or lacks required evidence, the landmark is unsatisfied and the resolver returns warnings rather than guessing.

## CLI journey

Add a FirmVault namespace command:

```bash
waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]
waypoint firmvault landmarks [--json]
```

Expected product smoke:

```bash
tmp=$(mktemp -d)
cd "$tmp"
waypoint init --quest firmvault
waypoint firmvault init-case --case-type personal-injury --case-slug smith-v-acme
waypoint firmvault landmarks
```

Initial output should show all eight landmarks as `false`. Tests can then modify state YAML and create evidence files to prove projection turns selected landmarks true.

## Tasks

### Task 1: RED tests for case state initialization

**Objective:** Prove a new state initializer creates the `.waypoint/firmvault/` contract and starts all landmarks false.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Create later: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Steps:**
1. Write a Vitest test that calls `initFirmVaultCaseState(tempRoot, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })`.
2. Assert the ten canonical files exist.
3. Assert `readFirmVaultLandmarkProjection(tempRoot)` returns eight landmarks and every `satisfied` value is false.
4. Run targeted Vitest and verify RED failure because the module/export does not exist.

### Task 2: Implement YAML state initialization

**Objective:** Create product-owned initial YAML files and append an initialization event.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

**Steps:**
1. Implement `initFirmVaultCaseState(projectRoot, options)`.
2. Write `.waypoint/firmvault/{case,client,accident,providers,demand,negotiation,settlement,documents,landmarks}.yaml`.
3. Append `.waypoint/firmvault/events.jsonl` with `firmvault.case_state.initialized`.
4. Export the initializer and related types from folder-host index.
5. Re-run targeted tests and verify GREEN.

### Task 3: RED tests for explicit-state landmark projection

**Objective:** Prove landmarks are computed from explicit statuses plus evidence paths, not scraped document contents.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

**Steps:**
1. Add tests that create evidence files and patch YAML state for:
   - `full_intake_complete`
   - `demand_sent`
   - `final_distribution_complete`
2. Assert each projected landmark returns `satisfied: true` with evidence paths.
3. Add a negative test where status is true but evidence file is missing; expect `satisfied: false` and warnings.
4. Run targeted Vitest and verify RED failure.

### Task 4: Implement landmark projection

**Objective:** Implement conservative deterministic projection over YAML state.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Steps:**
1. Implement `readFirmVaultLandmarkProjection(projectRoot)`.
2. Parse YAML state defensively.
3. Validate evidence paths are relative, stay inside project root, and exist.
4. Return warnings for missing/unsafe evidence.
5. Write `landmarks.yaml` projection as a generated cache when initialization runs.
6. Re-run targeted tests and verify GREEN.

### Task 5: CLI namespace

**Objective:** Add operator commands for initializing and reading FirmVault state.

**Files:**
- Create: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Create: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-cli/src/bin.ts`

**Steps:**
1. RED test `runWaypointCli(['firmvault', 'init-case', ...])` creates state and prints summary.
2. RED test `runWaypointCli(['firmvault', 'landmarks', '--json'])` prints JSON projection.
3. Implement `runFirmVaultCommand` using dynamic import from `@waypoint/folder-host` to preserve built-package smoke behavior.
4. Wire help text and command dispatch.
5. Re-run targeted CLI + folder-host tests and verify GREEN.

### Task 6: Docs and existing doctor reframing

**Objective:** Document the product-owned state contract and avoid implying Waypoint must conform to arbitrary legacy folders.

**Files:**
- Modify: `docs/plans/firmvault-folder-workflows-port-plan.md`
- Modify: `docs/waypoint-folder-host.md`
- Modify as needed: folder-host docs tests

**Steps:**
1. Add a note that FVP4 supersedes the passive legacy landmark resolver direction.
2. Document `.waypoint/firmvault/` state files and the two new CLI commands.
3. Keep Part Three doctor as a useful read-only template/check, but identify the new state contract as the product runtime path.
4. Re-run docs tests.

### Task 7: Verification and commit

**Objective:** Land Part Four with objective proof.

**Commands:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts
pnpm smoke:folder-host
pnpm smoke:install
pnpm test
pnpm typecheck
git diff --check
git status --short --branch
git add docs/plans/firmvault-port-part-four-plan.md packages/waypoint-folder-host/src/firmvault/state.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-folder-host/src/index.ts packages/waypoint-cli/src/commands/firmvault.ts packages/waypoint-cli/src/commands/firmvault.test.ts packages/waypoint-cli/src/bin.ts docs/waypoint-folder-host.md docs/plans/firmvault-folder-workflows-port-plan.md
git commit -m "feat(firmvault): add case state landmarks"
git log --oneline -1
```

Do not claim test success, commit, or file changes unless primary-source tool output is visible in the same turn.
