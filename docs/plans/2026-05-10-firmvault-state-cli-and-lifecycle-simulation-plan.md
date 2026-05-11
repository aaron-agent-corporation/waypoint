# FirmVault State CLI + Lifecycle Simulation Implementation Plan

> **For Gary/Hermes:** Use `test-driven-development` for implementation slices. Use `grounding-claims-in-primary-sources` before reporting commits/tests. Use subagent-driven-development only for isolated review/implementation work after this plan is committed.

**Goal:** Add an agent-safe FirmVault legal-state command layer, wire it into the Hermes `paralegal` operator adapter, then build toward live shortened full-lifecycle case simulations using documents/evidence from an already-completed case.

**Architecture:** Waypoint remains the deterministic workflow/state backbone. The agent must not edit `.waypoint/firmvault/*.yaml` directly and must not set landmarks directly. Instead, it mutates allowlisted state facts through validated CLI commands that write explicit YAML state, append audit events, recompute landmark projections, and return before/after landmark impact in JSON. Hermes/paralegal then uses the same command surface through trusted `casesRootKey` + safe `caseSlug` adapters.

**Tech Stack:** TypeScript, Node, YAML, Vitest, existing `@waypoint/folder-host`, `@waypoint/cli`, and `examples/hermes-operator-adapter` reference adapter.

---

## Verified Current Context

Primary-source check at plan time:

```text
eae6abe docs(firmvault): add document ingestion runbook
ac4a757 feat(firmvault): sync document PR handoff status
9150ca3 feat(firmvault): add document pipeline review tasks
55a9912 feat(firmvault): compose document pipeline handoff flow
06e0153 feat(firmvault): add document pipeline adapter
## main...origin/main
```

Current FirmVault CLI surface in `packages/waypoint-cli/src/commands/firmvault.ts`:

- `waypoint firmvault bootstrap ...`
- `waypoint firmvault add-document ...`
- `waypoint firmvault document-handoff ...`
- `waypoint firmvault init-case ...`
- `waypoint firmvault landmarks [--json]`

Current state files from `packages/waypoint-folder-host/src/firmvault/state.ts`:

- `case.yaml`
- `client.yaml`
- `accident.yaml`
- `providers.yaml`
- `insurance.yaml`
- `liens.yaml`
- `records.yaml`
- `demand.yaml`
- `negotiation.yaml`
- `settlement.yaml`
- `documents.yaml`
- `landmarks.yaml`
- `events.jsonl`

Current legal landmark count: 82, defined by `FIRMVAULT_LANDMARK_SLUGS`.

Current gap: there is no safe CLI for setting explicit legal state facts. Advancing a case still requires direct YAML edits or new code. That is not acceptable for an autonomous legal agent.

---

## Design Principles

1. **Facts are mutable; landmarks are projected.**
   - Add commands for setting facts like `demand.send`.
   - Do **not** add commands like `mark-landmark demand_sent`.

2. **Evidence is required for legal progress.**
   - Evidence paths must be relative.
   - Evidence paths must remain inside the case folder.
   - Evidence files must exist before a satisfying status can satisfy a landmark.

3. **Every mutation is audited.**
   - Append `firmvault.state.updated` to `.waypoint/firmvault/events.jsonl`.
   - Return before/after landmark counts and newly satisfied landmarks.

4. **Hermes/paralegal gets a contract, not filesystem freedom.**
   - Use trusted case roots and safe case slugs.
   - Do not let the profile edit YAML directly.
   - Add safe-runner allowlist entries for the new commands.

5. **Lifecycle simulation should be testable before live.**
   - First run with generated fixture evidence.
   - Then run with an already-completed real case copy.
   - Shorten waits to immediate/gated updates only in a simulation mode; never rewrite the production Quest semantics to pretend months passed.

---

## Proposed Command Surface

### Read explicit state

```bash
waypoint firmvault state show --json
waypoint firmvault state show --section demand --json
```

Output shape:

```json
{
  "schema_version": 1,
  "section": "demand",
  "state": { },
  "landmarks": {
    "satisfied": 0,
    "total": 82
  },
  "warnings": []
}
```

### Check evidence

```bash
waypoint firmvault evidence check --path documents/sent/demand.pdf --json
```

Output shape:

```json
{
  "ok": true,
  "path": "documents/sent/demand.pdf",
  "exists": true,
  "safe": true
}
```

### Set legal state fact

```bash
waypoint firmvault state set \
  --fact demand.send \
  --status sent \
  --evidence documents/sent/demand-package-sent.md \
  --note "Sent after attorney approval" \
  --json
```

Output shape:

```json
{
  "ok": true,
  "fact": "demand.send",
  "section": "demand",
  "status": "sent",
  "evidence": ["documents/sent/demand-package-sent.md"],
  "landmarks_before": { "satisfied": 12, "total": 82 },
  "landmarks_after": { "satisfied": 13, "total": 82 },
  "newly_satisfied": ["demand_sent"],
  "newly_unsatisfied": [],
  "warnings": [],
  "legal_landmarks_updated": true
}
```

---

## Fact Registry Model

Create a registry that maps public fact slugs to exact YAML locations and allowed statuses.

File:

```text
packages/waypoint-folder-host/src/firmvault/facts.ts
```

Core types:

```ts
export interface FirmVaultFactDefinition {
  readonly fact: string
  readonly file: FirmVaultStateSection
  readonly path: readonly string[]
  readonly allowedStatuses: readonly string[]
  readonly evidenceRequiredFor: readonly string[]
  readonly projectedLandmarks: readonly FirmVaultLandmarkSlug[]
  readonly description: string
}
```

Initial registry should cover every currently projected landmark input, not only a small demo subset. It is acceptable to land it in phases if the test plan clearly tracks coverage, but the end state must support full lifecycle simulation.

Important aggregate examples:

- `full_intake_complete` depends on:
  - `client.intake`
  - `client.contracts.fee_agreement`
  - `client.authorizations.hipaa`
- `records_and_bills_processed` and `all_records_received` currently project from records state.
- Close-case landmarks live under `settlement.closing.*`.

Do not invent new state sections until the current `.waypoint/firmvault/*.yaml` model cannot represent a needed fact.

---

## Milestone FVL1 — Folder-host state operation API

**Objective:** Add the core TypeScript API that reads, validates, mutates, audits, and projects explicit legal state facts.

### Task FVL1.1: Add RED tests for fact registry coverage

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Create: `packages/waypoint-folder-host/src/firmvault/facts.ts`

**Test intent:**

- Registry contains core start-to-close facts:
  - `case.setup`
  - `client.intake`
  - `client.contracts.fee_agreement`
  - `client.authorizations.hipaa`
  - `accident.police_report`
  - `providers.setup`
  - `insurance.bi.carrier_identified`
  - `insurance.bi.lor.sent`
  - `records.authorization`
  - `records.processing`
  - `demand.send`
  - `negotiation.client_decision`
  - `settlement.release`
  - `settlement.funds`
  - `settlement.distribution.completion`
  - `settlement.closing.case`
- Every `projectedLandmarks` value exists in `FIRMVAULT_LANDMARK_SLUGS`.
- Every fact points at an existing known state file.

**RED command:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts
```

Expected RED: import failure or missing fact registry.

### Task FVL1.2: Implement fact registry

**Files:**

- Create: `packages/waypoint-folder-host/src/firmvault/facts.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

**Implementation notes:**

- Export `FIRMVAULT_FACT_DEFINITIONS`.
- Export `getFirmVaultFactDefinition(fact: string)`.
- Keep fact slugs stable and human-readable.
- Use existing state path names from `initial*State()` in `state.ts`.

**GREEN command:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts
```

### Task FVL1.3: Add RED tests for `checkFirmVaultEvidencePath(...)`

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Test cases:**

- Accepts existing relative path inside the case folder.
- Rejects absolute paths.
- Rejects `../escape.pdf`.
- Returns `exists: false` for safe but missing path.

Expected API:

```ts
checkFirmVaultEvidencePath(projectRoot, { path: 'documents/sent/foo.pdf' })
```

Expected output:

```ts
{
  ok: true,
  path: 'documents/sent/foo.pdf',
  safe: true,
  exists: true,
}
```

### Task FVL1.4: Implement evidence check API

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

**Implementation notes:**

- Reuse or extract `isSafeRelativePath` and `pathExists` logic.
- Do not require the path to already be in a fact's evidence array.

### Task FVL1.5: Add RED tests for `readFirmVaultCaseState(...)`

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

Expected API:

```ts
readFirmVaultCaseState(projectRoot, { section: 'demand' })
readFirmVaultCaseState(projectRoot)
```

Test cases:

- Full state returns known sections.
- Section state returns only the requested section.
- Unknown section rejects.
- Returned payload includes current landmark count/warnings.

### Task FVL1.6: Implement state read API

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

### Task FVL1.7: Add RED tests for `setFirmVaultCaseFact(...)`

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`

Test cases:

1. Setting `demand.send` to `sent` with existing evidence satisfies `demand_sent`.
2. Setting the same status with missing evidence writes the fact but does not satisfy the landmark and returns warnings.
3. Invalid fact rejects.
4. Invalid status rejects.
5. Path traversal evidence rejects before mutation.
6. Audit event appended with `firmvault.state.updated`.
7. `landmarks.yaml` is refreshed after mutation.

Expected API:

```ts
setFirmVaultCaseFact(projectRoot, {
  fact: 'demand.send',
  status: 'sent',
  evidence: ['documents/sent/demand-sent.md'],
  note: 'Human sent after attorney approval',
  now: new Date('2026-05-10T12:00:00.000Z'),
})
```

### Task FVL1.8: Implement state mutation API

**Files:**

- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts`

Implementation details:

- Read projection before mutation.
- Load target YAML file.
- Navigate to fact definition path; fail if missing/non-object.
- Validate status against allowed statuses.
- Validate each evidence path as safe before writing.
- Write `{ status, evidence, note?, updated_at }` into the fact object while preserving other keys like `amount` or `decision` if present.
- Write YAML file.
- Recompute projection.
- Write `.waypoint/firmvault/landmarks.yaml`.
- Append event:

```json
{
  "type": "firmvault.state.updated",
  "created_at": "...",
  "payload": {
    "fact": "demand.send",
    "status": "sent",
    "evidence": ["documents/sent/demand-sent.md"],
    "newly_satisfied": ["demand_sent"],
    "newly_unsatisfied": []
  }
}
```

---

## Milestone FVL2 — CLI state/evidence commands

**Objective:** Expose the folder-host state operation API through `waypoint firmvault ...` with stable JSON output.

### Task FVL2.1: Add RED CLI tests

**Files:**

- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`

Test cases:

- `firmvault state show --json` returns full state and landmark count.
- `firmvault state show --section demand --json` returns demand state only.
- `firmvault evidence check --path <relative> --json` returns safe/existing status.
- `firmvault state set --fact demand.send --status sent --evidence documents/sent/demand.md --json` updates YAML and returns `newly_satisfied: ['demand_sent']`.
- Invalid fact/status/evidence path returns exit `1` with clear stderr.

Expected RED command:

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/firmvault.test.ts
```

### Task FVL2.2: Implement CLI parsing and dispatch

**Files:**

- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-cli/src/bin.ts` if global help text needs update
- Modify: `docs/waypoint-folder-host.md`

Command grammar:

```text
waypoint firmvault state show [--section <section>] [--json]
waypoint firmvault state set --fact <fact> --status <status> [--evidence <path>]... [--note <note>] [--json]
waypoint firmvault evidence check --path <path> [--json]
```

Parsing rules:

- `--evidence` may repeat.
- `--json` should be available for all three commands.
- Non-JSON output should be concise and include landmark count impact for mutations.

### Task FVL2.3: Add direct Node smoke

**Files:**

- Create or modify: `scripts/firmvault-state-cli-smoke.mjs`
- Modify: `package.json`

Script name:

```json
"smoke:firmvault-state-cli": "node scripts/firmvault-state-cli-smoke.mjs"
```

Smoke should:

1. Create temp case.
2. Run `waypoint firmvault init-case`.
3. Create evidence file.
4. Run `waypoint firmvault state set --fact demand.send ... --json`.
5. Run `waypoint firmvault landmarks --json`.
6. Assert `demand_sent.satisfied === true`.
7. Assert event log contains `firmvault.state.updated`.

---

## Milestone FVL3 — Hermes/paralegal state adapter wiring

**Objective:** Let Hermes/paralegal operate the legal state command surface safely through trusted case roots.

### Task FVL3.1: Extend safe Waypoint command runner allowlist

**Files:**

- Modify: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Modify: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`

Allowlist:

```text
firmvault state show
firmvault state set
firmvault evidence check
firmvault landmarks
```

Validation:

- `state show`: allow `--section`, `--json`.
- `state set`: require `--fact`, `--status`; allow repeated `--evidence`, `--note`, `--json`; reject positional args.
- `evidence check`: require `--path`; reject absolute paths and traversal at safe-runner layer too.

### Task FVL3.2: Add typed Hermes adapter helpers

**Files:**

- Modify: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`
- Modify: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`

New helpers:

```ts
showFirmVaultStateWithHermesOperator(...)
checkFirmVaultEvidenceWithHermesOperator(...)
setFirmVaultCaseFactWithHermesOperator(...)
```

Typed request examples:

```ts
interface FirmVaultStateSetRequest {
  readonly casesRootKey: string
  readonly caseSlug: string
  readonly fact: string
  readonly status: string
  readonly evidence?: readonly string[]
  readonly note?: string
}
```

Safety:

- Use `resolveCaseRoot(...)` with existing safe slug validation.
- Evidence paths must be relative and non-traversing before invoking CLI.
- Preserve stdout/stderr.
- Return parsed JSON and a human summary.

### Task FVL3.3: Add paralegal operator runbook

**Files:**

- Create: `docs/firmvault-paralegal-state-operator-runbook.md`
- Modify: `src/__tests__/waypoint-docs.test.ts`

Runbook must say:

- Never edit `.waypoint/firmvault/*.yaml` directly.
- Always inspect state/landmarks before mutation.
- Use `evidence check` before `state set` when possible.
- Use document handoff only for pipeline/Forgejo state; it does not satisfy legal landmarks.
- For legal facts, use `state set` and report the returned `newly_satisfied` list.

---

## Milestone FVL4 — Full lifecycle simulation harness, fixture-first

**Objective:** Prove an agent can drive a brand-new PI case from open to close through CLI commands using prepared evidence, without waiting months.

### Task FVL4.1: Create simulation fixture manifest format

**Files:**

- Create: `examples/firmvault-lifecycle-simulation/fixture.yaml`
- Create: `examples/firmvault-lifecycle-simulation/README.md`

Fixture shape:

```yaml
schema_version: 1
case:
  name: Jane Smith v. Acme Trucking
  type: personal_injury
steps:
  - fact: case.setup
    status: complete
    evidence: [case/setup.md]
  - fact: client.intake
    status: complete
    evidence: [client/intake.md]
  - fact: client.contracts.fee_agreement
    status: signed
    evidence: [documents/signed/fee-agreement.pdf]
  # ... through settlement.closing.case
```

### Task FVL4.2: Add fixture runner script

**Files:**

- Create: `scripts/firmvault-lifecycle-simulation-smoke.mjs`
- Modify: `package.json`

Script name:

```json
"smoke:firmvault-lifecycle-simulation": "node scripts/firmvault-lifecycle-simulation-smoke.mjs"
```

Behavior:

1. Temp trusted cases root.
2. Bootstrap new case with `--start`.
3. Create fixture evidence files in the case folder.
4. For each fixture step, call `waypoint firmvault state set ... --json`.
5. At the end, call `waypoint firmvault landmarks --json`.
6. Assert all 82 landmarks are satisfied.
7. Assert event log contains state update events.
8. Assert route/task artifacts still exist.

This is not a live legal test. It is a deterministic command-surface simulation.

### Task FVL4.3: Add Hermes adapter simulation smoke

**Files:**

- Create: `examples/hermes-operator-adapter/src/firmvault-lifecycle-simulation.test.ts`

Use injected executor first. It should prove the paralegal adapter chains:

- `firmvault bootstrap`
- `firmvault state show`
- `firmvault evidence check`
- many `firmvault state set`
- `firmvault landmarks`

No shell strings, no arbitrary paths.

---

## Milestone FVL5 — Completed-case replay, local copy only

**Objective:** Use documents/evidence from an already-completed case to replay a shortened case lifecycle in a temp copy.

This milestone should not start until FVL1–FVL4 are committed and green.

### Task FVL5.1: Add replay manifest plan

**Files:**

- Create: `docs/plans/firmvault-completed-case-replay-plan.md`

Plan requirements:

- Source case must be copied to a temp/sandbox location.
- No secrets/credentials preserved in docs or logs.
- No external sends/faxes/API/trust actions.
- The replay maps existing documents into evidence paths, then uses `state set` to record the facts.
- The replay shortens wait tasks by recording already-existing evidence, not by modifying the Quest.

### Task FVL5.2: Build replay mapper after inspecting actual completed case structure

Do not implement blindly. First inspect the real completed case folder structure and write a mapping manifest. Then build a mapper that copies or references only safe evidence into a sandbox case.

Potential files:

- `scripts/firmvault-completed-case-replay.mjs`
- `examples/firmvault-lifecycle-simulation/completed-case-replay.template.yaml`

---

## Milestone FVL6 — Optional live document-pipeline dry-run

**Objective:** Confirm the Waypoint adapter contract still matches the actual `/Users/aaronwhaley/Github/firmvault-document-pipeline` CLI in gated dry-run mode.

This remains optional and explicitly gated.

Potential command:

```bash
FIRMVAULT_PIPELINE_REPO=/Users/aaronwhaley/Github/firmvault-document-pipeline \
RUN_FIRMVAULT_PIPELINE_LIVE_DRY_RUN=1 \
pnpm smoke:firmvault-document-pipeline-live-dry-run
```

Default script behavior must skip unless the env opt-in is present.

---

## Verification Gates

For every implementation slice:

```bash
pnpm exec vitest run <targeted-tests>
pnpm typecheck
```

At milestone boundaries:

```bash
pnpm test
pnpm build
```

For FVL2+:

```bash
pnpm smoke:firmvault-state-cli
```

For FVL4+:

```bash
pnpm smoke:firmvault-lifecycle-simulation
```

Before any commit report:

```bash
git log --oneline -5
git status --short --branch
```

Do not claim RED-first TDD unless the failing test output is visible from the relevant turn.

---

## Risks and Decisions

### Risk: Fact registry is large

The lifecycle has 82 landmarks and many state facts. The registry is not conceptually hard, but it is broad. Keep it data-driven and test coverage-focused.

### Risk: Generic `state set` becomes arbitrary YAML write

Mitigation: only allow facts present in `FIRMVAULT_FACT_DEFINITIONS`. Do not accept raw file/path arguments from the CLI.

### Risk: Evidence exists but is legally wrong

Waypoint can validate path safety/existence, not legal sufficiency. Human gates and attorney/paralegal review remain required.

### Risk: Completed-case replay leaks sensitive data

Mitigation: run only in local sandbox, do not commit copied case data, redact secrets in logs, and add `.gitignore`/temp cleanup safeguards.

### Decision: simulation does not change Quest wait semantics

The replay shortens time by using already-existing evidence and immediate state updates. It should not mutate the production `firmvault` Quest to remove waits/gates.

---

## Implementation Order

1. Commit this plan.
2. FVL1: folder-host fact registry + evidence/state/set APIs.
3. FVL2: CLI state/evidence commands + smoke.
4. FVL3: Hermes/paralegal adapter allowlist + helpers + runbook.
5. FVL4: fixture-based full lifecycle simulation harness.
6. FVL5: completed-case replay plan and mapper.
7. FVL6: optional live document-pipeline dry-run.

## Definition of Done for the CLI Layer

The CLI layer is done when an agent can, using only allowlisted commands:

1. Bootstrap a new PI case.
2. Add and hand off scanned documents.
3. Inspect route/tasks/events/state/landmarks.
4. Validate evidence paths.
5. Set every legal state fact needed to satisfy all 82 landmarks.
6. Produce audit events for every mutation.
7. Run a fixture-based open-to-close lifecycle simulation with all landmarks satisfied.
8. Do the same path through Hermes/paralegal adapter helpers without arbitrary filesystem writes.
