# FirmVault Case Bootstrap + Agent Activation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the folder-first new-case path: an operator can tell the agent “new PI case for Client v. Defendant,” and Waypoint creates a new FirmVault case folder, installs the PI case Quest, initializes FirmVault state, starts the route, and leaves the case ready for document intake and lifecycle execution.

**Architecture:** Keep Mission Control cutover out of this track. Mission Control/Harden is a separate downstream product concern. This track adds a safe bootstrap surface to standalone Waypoint: a constrained FirmVault case-folder creator plus a CLI/agent adapter path that runs only inside an approved cases root. The bootstrap should compose existing proven primitives (`init --quest firmvault`, `firmvault init-case`, `start --quest firmvault`) instead of inventing a second runtime.

**Tech Stack:** TypeScript, pnpm, Waypoint folder host, Waypoint CLI, YAML/JSONL local state, bundled FirmVault Quest/Recipe manifests, Hermes operator adapter tests, temp-folder smoke tests.

---

## Product North Star

The desired operator interaction is:

```text
Aaron: Gary, new PI case: Jane Smith v. Acme Trucking. Create the case and activate FirmVault.
Gary: Created FirmVault case folder, initialized Waypoint, started the PI lifecycle, and it is blocked/ready at the first human/document-intake step.
```

Local result:

```text
<FIRMVAULT_CASES_ROOT>/jane-smith-v-acme-trucking/
  AGENTS.md
  Dashboard.md
  jane-smith-v-acme-trucking.md
  client/
    intake.md
    contracts.md
    authorizations.md
    contactability.md
    check-ins.md
  accident/
    accident.md
    police-report.md
    liability.md
  contacts/
  insurance/
  medical-providers/
  liens/
  demand/
  negotiation/
  settlement/
  litigation/
  documents/
    inbox/
    processed/
  activity/
    index.md
  workflow-log/
    index.md
  .waypoint/
    config.yaml
    quests/firmvault.yaml
    recipes/*.yaml
    firmvault/*.yaml
    routes/route-001.yaml
    tasks/tasks.yaml
    events/route-001.jsonl
```

Then the agent can process incoming documents by placing/copying them into the case folder and using the active FirmVault route/tasks/landmarks to decide what to run next.

## Terminology Decision

- **FirmVault case bootstrap**: creates the physical case folder + starter documents + Waypoint state.
- **Activate FirmVault**: installs/starts the `firmvault` Quest inside the folder.
- **Run the case lifecycle**: progress the active route/tasks with recipes, discussion, gates, document evidence, and landmarks.
- **Harden/Mission Control cutover**: explicitly out of this plan.

## Safety Rules

1. The agent must not create folders at arbitrary paths. It may only create under a configured trusted `cases_root`.
2. Bootstrap must fail if the target case folder already exists unless an explicit `--if-exists reuse-empty|fail` option is provided. Default: `fail`.
3. Bootstrap must not send emails, faxes, portal messages, trust-account actions, or external API calls.
4. Document processing in this track means local file placement/indexing/extraction handoff only; any external communication remains a human gate.
5. Case names may contain PII, but generated test fixtures must use fake names only.
6. Every bootstrap action must write durable local evidence: starter files, `.waypoint/firmvault/events.jsonl`, route events, and a machine-readable bootstrap summary.

## Command Shape

Add a first-class CLI command:

```bash
waypoint firmvault bootstrap \
  --cases-root /trusted/FirmVault/Cases \
  --case-name "Jane Smith v. Acme Trucking" \
  --case-type personal-injury \
  [--case-slug jane-smith-v-acme-trucking] \
  [--start] \
  [--json]
```

Default behavior:

- creates the folder and starter files;
- runs the equivalent of `waypoint init --quest firmvault` in that folder;
- runs the equivalent of `waypoint firmvault init-case --case-type personal-injury --case-slug <slug>`;
- if `--start` is present, starts `waypoint start --quest firmvault` and materializes tasks;
- prints a concise human summary or JSON summary.

The agent-facing/Hermes path should call this command or the underlying API directly, not shell together arbitrary commands.

## Acceptance Gates

- `waypoint firmvault bootstrap ... --start --json` creates a complete fake PI case folder in a temp cases root.
- The created folder passes `waypoint doctor firmvault --json`.
- The created folder has `.waypoint/config.yaml`, installed `firmvault` Quest/Recipes, `.waypoint/firmvault/*.yaml`, `route-001.yaml`, `tasks.yaml`, and route/event logs.
- Running `waypoint firmvault landmarks --json` inside the folder reports the expected 82-landmark projection with all initial landmarks unsatisfied unless explicit starter evidence satisfies one.
- Hermes/operator adapter has a constrained new-case helper that maps structured intake to the bootstrap command without allowing arbitrary filesystem writes.
- Verification passes before commit:
  - targeted bootstrap tests;
  - FirmVault CLI tests;
  - Hermes operator adapter tests for bootstrap allowlisting;
  - `pnpm smoke:firmvault-folder`;
  - `pnpm test`;
  - `pnpm typecheck`;
  - `git diff --check`.

---

## Phase B0: Bootstrap Plan + Current-State Guard

**Objective:** Record the folder-first direction and explicitly remove Mission Control cutover from the immediate path.

**Files:**
- Create: `docs/plans/firmvault-case-bootstrap-agent-plan.md`
- Modify if needed: `WAYPOINT_RESUME_PLAN.md`
- Modify if needed: `docs/plans/waypoint-source-port-status.md`

**Steps:**
1. Verify repo state with `git log --oneline -20` and `git status --short --branch`.
2. Write this plan.
3. Do not implement code in B0.
4. Commit the plan if the working tree is otherwise clean.

**Verification:**

```bash
git diff --check
git status --short --branch
```

## Phase B1: Folder Template Writer

**Objective:** Add a reusable, tested FirmVault starter folder writer.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`
- Create: `packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

**TDD Steps:**
1. Write a failing test: `createFirmVaultCaseFolder(tempCasesRoot, { caseName: 'Jane Smith v. Acme Trucking', caseType: 'personal_injury' })` creates the expected slug folder and starter files.
2. Run the test and verify RED.
3. Implement slug generation and safe path validation.
4. Run the test and verify GREEN.
5. Add a failing test that rejects `../escape`, absolute case slugs, and existing folders.
6. Implement fail-closed validation.
7. Re-run targeted tests.

**Expected API sketch:**

```ts
export interface FirmVaultCaseBootstrapInput {
  readonly casesRoot: string
  readonly caseName: string
  readonly caseType: 'personal_injury'
  readonly caseSlug?: string
  readonly ifExists?: 'fail' | 'reuse_empty'
  readonly now?: Date
}

export interface FirmVaultCaseBootstrapFolderResult {
  readonly caseRoot: string
  readonly caseSlug: string
  readonly createdPaths: readonly string[]
}

export async function createFirmVaultCaseFolder(
  input: FirmVaultCaseBootstrapInput,
): Promise<FirmVaultCaseBootstrapFolderResult>
```

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts
```

## Phase B2: Compose Existing Waypoint Initialization Primitives

**Objective:** Extend bootstrap from “folder created” to “Waypoint/FirmVault state initialized.”

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts`
- Use existing APIs from project init/catalog/state/start modules.

**TDD Steps:**
1. Add a failing test for `bootstrapFirmVaultCase(...)` that expects `.waypoint/config.yaml`, `.waypoint/quests/firmvault.yaml`, `.waypoint/firmvault/case.yaml`, and `.waypoint/firmvault/events.jsonl`.
2. Run and verify RED.
3. Implement composition of:
   - `initWaypointProject(caseRoot, { quest: 'firmvault' })`
   - `installQuestCatalog(caseRoot, bundledCatalog, { quest: 'firmvault' })`
   - `initFirmVaultCaseState(caseRoot, { caseType: 'personal_injury', caseSlug })`
4. Re-run targeted tests.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts packages/waypoint-folder-host/src/firmvault/state.test.ts
```

## Phase B3: Optional Route Start During Bootstrap

**Objective:** Support `--start` so a new case is immediately running the PI lifecycle.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/bootstrap.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts`

**TDD Steps:**
1. Add a failing test with `start: true` that expects `.waypoint/routes/route-001.yaml`, `.waypoint/events/route-001.jsonl`, and `.waypoint/tasks/tasks.yaml`.
2. Run and verify RED.
3. Compose the existing route start function used by `waypoint start --quest firmvault`.
4. Assert route/task counts in the bootstrap result.
5. Re-run targeted tests.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/bootstrap.test.ts packages/waypoint-folder-host/src/routes/start.test.ts
```

## Phase B4: CLI Surface

**Objective:** Expose bootstrap through `waypoint firmvault bootstrap`.

**Files:**
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `packages/waypoint-cli/src/bin.ts`
- Modify: `docs/waypoint-folder-host.md`

**TDD Steps:**
1. Add a failing CLI test for text output.
2. Add a failing CLI test for `--json` output.
3. Add a failing CLI test for unsafe/unknown args.
4. Implement parser and output.
5. Update CLI help text.
6. Re-run targeted tests.

**CLI output fields for JSON:**

```json
{
  "case_root": "/tmp/cases/jane-smith-v-acme-trucking",
  "case_slug": "jane-smith-v-acme-trucking",
  "quest": "firmvault",
  "state_dir": "/tmp/cases/jane-smith-v-acme-trucking/.waypoint/firmvault",
  "route_id": "route-001",
  "task_count": 87,
  "landmark_count": 82
}
```

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/firmvault.test.ts
```

## Phase B5: Agent/Hermes Operator Adapter

**Objective:** Let the agent safely create a new case without arbitrary shell or arbitrary path writes.

**Files:**
- Modify: `examples/hermes-operator-adapter/src/project-registry.ts` or add a dedicated FirmVault cases registry module.
- Modify/create: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`
- Create/modify: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`
- Modify: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` only if the existing runner should allow this specific bootstrap command.

**Design:**

Use a structured request, not free-form path execution:

```ts
export interface FirmVaultNewCaseRequest {
  readonly casesRootKey: string
  readonly caseName: string
  readonly caseType: 'personal_injury'
  readonly start?: boolean
}
```

The adapter resolves `casesRootKey` from trusted config and invokes the CLI with explicit args:

```ts
[
  'firmvault', 'bootstrap',
  '--cases-root', trustedCasesRoot,
  '--case-name', request.caseName,
  '--case-type', 'personal-injury',
  '--start',
  '--json',
]
```

**TDD Steps:**
1. Add a failing injected-executor test that proves a valid new-case request invokes exactly the bootstrap arg array.
2. Add a failing test that an unknown cases root key is rejected.
3. Add a failing test that natural-language paths are rejected.
4. Implement the adapter.
5. Add one real temp-folder integration test using the actual CLI.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts examples/hermes-operator-adapter/src/project-registry.test.ts examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts
```

## Phase B6: Document Intake Hook

**Objective:** After bootstrap, give the agent a safe local document-ingestion entrypoint.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/documents.ts`
- Create: `packages/waypoint-folder-host/src/firmvault/documents.test.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `docs/waypoint-folder-host.md`

**Command Shape:**

```bash
waypoint firmvault add-document \
  --source /path/to/local/file.pdf \
  --kind medical-records|bill|insurance|police-report|correspondence|unknown \
  [--note "uploaded by client"] \
  [--json]
```

**Safety:**

- Copy or move only from local readable paths.
- Default should copy into `documents/inbox/`; no destructive move unless a later explicit option is added.
- Append a document event to `.waypoint/firmvault/events.jsonl`.
- Update `.waypoint/firmvault/documents.yaml` as an index.
- Do not mark substantive landmarks complete solely because a file exists. Recipes/state updates must still classify/process evidence.

**Verification:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/documents.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts
```

## Phase B7: End-to-End New Case Smoke

**Objective:** Prove the user journey from empty cases root to running FirmVault route.

**Files:**
- Create: `scripts/firmvault-case-bootstrap-smoke.mjs`
- Modify: `package.json` scripts: add `smoke:firmvault-bootstrap`
- Create: `src/__tests__/firmvault-case-bootstrap-smoke.test.ts`

**Smoke Flow:**

```bash
repo=/Users/aaronwhaley/Github/waypoint
cases_root=$(mktemp -d)
node "$repo/packages/waypoint-cli/src/bin.ts" firmvault bootstrap \
  --cases-root "$cases_root" \
  --case-name "Jane Smith v. Acme Trucking" \
  --case-type personal-injury \
  --start \
  --json
cd "$cases_root/jane-smith-v-acme-trucking"
node "$repo/packages/waypoint-cli/src/bin.ts" doctor firmvault --json
node "$repo/packages/waypoint-cli/src/bin.ts" routes --json
node "$repo/packages/waypoint-cli/src/bin.ts" tasks --route-id route-001 --json
node "$repo/packages/waypoint-cli/src/bin.ts" firmvault landmarks --json
```

**Assertions:**

- case folder exists under temp cases root;
- root starter files exist;
- `.waypoint/` state exists;
- `route-001` exists;
- task count equals current FirmVault scaffold count;
- landmark count equals current FirmVault projection count;
- no `.waypoint/` was created in repo root.

**Verification:**

```bash
pnpm smoke:firmvault-bootstrap
pnpm smoke:firmvault-folder
pnpm test
pnpm typecheck
git diff --check
```

## Phase B8: Commit + Operator Runbook

**Objective:** Commit the implementation only after gates pass and write the operator-facing “new case” instructions.

**Files:**
- Create: `docs/firmvault-new-case-bootstrap.md`
- Modify: `docs/waypoint-folder-host.md`
- Modify if needed: `WAYPOINT_RESUME_PLAN.md`

**Runbook Must Include:**

- how to configure a trusted cases root;
- exact CLI bootstrap command;
- exact agent phrase examples;
- where documents should be added;
- how to inspect routes/tasks/landmarks;
- what the system does not do automatically.

**Final Verification:**

```bash
pnpm smoke:firmvault-bootstrap
pnpm smoke:firmvault-folder
pnpm smoke:folder-host
pnpm test
pnpm typecheck
git diff --check
git status --short --branch
```

Commit message suggestion:

```bash
git commit -m "feat(firmvault): add new case bootstrap"
```

## Out of Scope

- Mission Control cutover.
- Harden integration details.
- Cloud sync or multi-user case registry.
- Real external document retrieval, email/fax/portal sends, or trust-account actions.
- Auto-classifying every document type on first add. This plan creates the intake rail; richer classification can be the next track.
