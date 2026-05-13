# FirmVault Staged Case Guidance Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a deterministic Waypoint/FirmVault harness that can create or inspect case folders at different lifecycle stages and return operator-facing guidance for what to do next.

**Architecture:** Use existing FirmVault primitives as the source of truth: `bootstrap`, `state set`, `landmarks`, fact registry definitions, and safe evidence checks. Add a read-only guidance layer that compares satisfied/unsatisfied landmarks to fact definitions and returns next actions; add a staged simulation smoke that builds empty, intake-only, demand-ready, settlement-ready, and close-ready sandbox cases and verifies each returns the expected guidance.

**Tech Stack:** TypeScript folder-host APIs, Waypoint CLI, Node smoke scripts, Vitest, YAML fixtures.

---

## Non-negotiable constraints

- Documents alone never satisfy legal landmarks.
- Legal progress is only explicit `waypoint firmvault state set` or underlying `setFirmVaultCaseFact`.
- Guidance must be read-only: no state mutation, no YAML edits, no external side effects.
- Evidence paths in simulation stages must be relative, safe, inside the sandbox case, and existing before state updates.
- The output must be useful for incomplete cases, not only completed replays.
- TDD must be literal: write failing tests first, run them red, then implement.

---

## Desired user-facing behavior

### Empty/bootstrap-only case

Expected summary:
- `0/82` landmarks satisfied.
- Stage label: `intake_not_started` or equivalent.
- Next actions should point to initial setup/intake work:
  - complete case setup evidence;
  - collect/review client intake;
  - obtain signed fee agreement;
  - obtain signed HIPAA/medical authorization;
  - obtain accident/police report;
  - set up provider ledger.

### Initial documents ingested, no legal state set

Expected summary:
- Still `0/82` landmarks satisfied.
- Guidance should explicitly say uploaded/ingested documents are evidence candidates only.
- Next actions should tell the operator/paralegal to review documents and apply explicit state facts with evidence paths.

### Intake complete

Expected summary:
- `case_setup_complete`, `full_intake_complete`, and maybe `accident_report_obtained` satisfied depending on fixture.
- Next actions should move into provider setup, insurance BI/PIP setup, lien discovery, and records authorization/request prep.

### Demand-ready / demand-incomplete case

Expected summary:
- Intake, treatment, records, liens, and demand-prep landmarks satisfied up to the stage fixture.
- Next actions should target missing demand send/attorney review/recipient/send steps, depending on exact stage.

### Settlement-ready / close-incomplete case

Expected summary:
- Settlement and distribution landmarks mostly satisfied.
- Next actions should target close-case readiness, final letter prepared/sent, archive confirmation, and case closed approval.

### Completed case replay

Expected summary:
- `82/82` landmarks satisfied.
- Stage label: `closed`.
- Next actions should say no required FirmVault lifecycle actions remain; only human audit/export/archive policies may apply.

---

## Implementation phases

### Task 1: Add failing guidance API tests

**Objective:** Define the read-only guidance result shape and prove empty/incomplete/completed cases produce different next actions.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/state.test.ts`
- Later modify: `packages/waypoint-folder-host/src/firmvault/state.ts`

**Test cases:**
1. `getFirmVaultCaseGuidance` on initialized empty case returns:
   - `landmarks.satisfied === 0`
   - first actions include `case.setup`, `client.intake`, `client.contracts.fee_agreement`, `client.authorizations.hipaa`
   - `mutates_state === false`
2. After setting intake facts, guidance no longer lists intake facts as required and moves to insurance/provider/records next actions.
3. After setting all replay facts, guidance returns `stage: closed` and `next_actions.required.length === 0`.

**RED command:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts -t "FirmVault case guidance"
```

Expected RED: import/function missing or assertions fail because guidance is not implemented.

---

### Task 2: Implement read-only guidance API

**Objective:** Add a deterministic guidance function that maps unsatisfied landmarks back to fact definitions and operator actions.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Possibly modify: `packages/waypoint-folder-host/src/firmvault/facts.ts` if reverse lookup helper is needed.

**API sketch:**

```ts
export interface FirmVaultCaseGuidanceAction {
  readonly fact: string
  readonly description: string
  readonly allowed_statuses: readonly string[]
  readonly projected_landmarks: readonly FirmVaultLandmarkSlug[]
  readonly command_hint: string
}

export interface FirmVaultCaseGuidanceResult {
  readonly schema_version: 1
  readonly mutates_state: false
  readonly stage: string
  readonly landmarks: FirmVaultLandmarkCounts
  readonly next_actions: {
    readonly required: readonly FirmVaultCaseGuidanceAction[]
    readonly blocked_by_evidence: readonly FirmVaultCaseGuidanceAction[]
  }
  readonly warnings: readonly string[]
}

export async function getFirmVaultCaseGuidance(projectRoot: string): Promise<FirmVaultCaseGuidanceResult>
```

**GREEN command:** same targeted Vitest command from Task 1.

---

### Task 3: Add CLI command `waypoint firmvault guidance --json`

**Objective:** Expose read-only next-action guidance to agents/operators.

**Files:**
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.test.ts`

**Behavior:**

```bash
waypoint firmvault guidance
waypoint firmvault guidance --json
```

Non-JSON output should be short and actionable:

```text
FirmVault guidance
stage: intake_not_started
landmarks satisfied: 0/82
next required actions:
- case.setup: Case shell and required starter paths are complete.
  command: waypoint firmvault state set --fact case.setup --status complete --evidence <relative-path> --note <note>
```

**RED command:**

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/firmvault.test.ts -t "guidance"
```

---

### Task 4: Add staged-case simulation smoke

**Objective:** Create a smoke harness that builds multiple sandbox folders and verifies guidance across incomplete states.

**Files:**
- Create: `scripts/firmvault-staged-case-guidance-smoke.mjs`
- Modify: `package.json`
- Create or modify: `examples/firmvault-lifecycle-simulation/staged-guidance.example.yaml` if a manifest is useful.

**Stages to generate:**
1. `empty` — bootstrap only.
2. `documents-only` — add source docs with `firmvault add-document`, no state set.
3. `intake-complete` — set setup/intake/client/accident facts only.
4. `demand-ready` — set all facts through demand readiness but omit demand send.
5. `settlement-close-needed` — set settlement/distribution facts but omit close-case facts.
6. `closed` — completed replay.

**Output should include:**

```text
stage empty: 0/82, next=case.setup,client.intake,...
stage documents-only: 0/82, next=case.setup,client.intake,...
stage intake-complete: N/82, next=providers.setup,insurance.bi.carrier_identified,...
stage settlement-close-needed: N/82, next=settlement.closing.readiness,...
stage closed: 82/82, next=none
Waypoint FirmVault staged guidance smoke passed
```

**RED command:**

```bash
pnpm smoke:firmvault-staged-guidance
```

Expected RED before implementation: missing script/package command.

---

### Task 5: Documentation and final gates

**Objective:** Document how to use the guidance harness for real incomplete cases.

**Files:**
- Modify: `docs/waypoint-folder-host.md`
- Modify: `docs/firmvault-paralegal-state-operator-runbook.md`
- Modify: `src/__tests__/waypoint-docs.test.ts` if docs assertions are needed.

**Required gates:**

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts src/__tests__/waypoint-docs.test.ts
pnpm smoke:firmvault-staged-guidance
pnpm smoke:firmvault-completed-case-replay
pnpm typecheck
```

---

## Completion criteria

- Empty and incomplete cases return useful next required actions.
- Documents-only cases explicitly remain at `0/82` legal landmarks unless explicit state facts are set.
- Completed replay returns `82/82` and no required next lifecycle actions.
- CLI output is suitable for an agent/paralegal to decide what to do next.
- All gates above pass.
- Commit the plan and implementation only after verified green output.
