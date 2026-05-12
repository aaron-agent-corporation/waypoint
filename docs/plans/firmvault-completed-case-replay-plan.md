# FVL5 — Completed-Case Replay Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after the plan commit lands. Use test-driven-development for code changes and grounding-claims-in-primary-sources before reporting commits, tests, or file writes.

**Goal:** Prove Waypoint can replay a completed personal-injury FirmVault-style case into a temporary sandbox case using local copied/redacted evidence and the validated `waypoint firmvault` state CLI.

**Architecture:** FVL5 extends the FVL4 lifecycle simulation from synthetic fixture evidence to source-backed replay mapping. A read-only source case is inspected and mapped into a committed template, then a smoke runner copies only safe evidence into a temporary sandbox case and records legal facts via `waypoint firmvault state set`. The replay never treats documents, Forgejo handoff, or pipeline status as legal truth; landmarks remain deterministic projections from explicit state.

**Tech Stack:** TypeScript/Vitest docs tests, Node `.mjs` smoke runner, Waypoint CLI, YAML fixtures, temp directories, append-only FirmVault audit events.

---

## Non-Negotiable Guardrails

- The source case is a **read-only source case**. The replay must not write into, rename, delete, normalize, or clean up the source folder.
- The destination is a **temporary sandbox case** created under a temp cases root by `waypoint firmvault bootstrap`.
- No external sends, faxes, API calls, Forgejo writes, or trust-account actions.
- No live document-pipeline execution in the normal replay smoke.
- Never commit copied case documents, source-case filenames, real client names, medical details, claim numbers, policy numbers, account numbers, credentials, tokens, passwords, or connection strings.
- If a fixture, sample, log, or mapping needs sensitive text, use `[REDACTED]`.
- The replay does not edit `.waypoint/firmvault/*.yaml` directly.
- All legal state changes must go through `waypoint firmvault state set` with evidence that already exists inside the sandbox case.
- The replay shortens elapsed time by using already-existing evidence, not by modifying the production `firmvault` Quest, route waits, or gates.
- Documents are evidence; YAML state is workflow truth; landmarks are projected.

---

## Authority Stack

1. Current repo state, CLI behavior, tests, and package scripts prove what can run.
2. Committed project plans and runbooks define accepted direction.
3. A real completed case folder may inform mapping shape, but its raw contents must not be committed or echoed in logs.

---

## Deliverables

- Create: `docs/plans/firmvault-completed-case-replay-plan.md` — this plan.
- Create: `examples/firmvault-lifecycle-simulation/completed-case-replay.template.yaml` — committed sanitized mapping template.
- Create: `examples/firmvault-lifecycle-simulation/completed-case-replay.example.yaml` — committed fully synthetic example mapping.
- Create: `scripts/firmvault-completed-case-replay.mjs` — replay smoke/runner.
- Modify: `package.json` — add `pnpm smoke:firmvault-completed-case-replay`.
- Modify: `src/__tests__/waypoint-docs.test.ts` — docs coverage for plan/template/smoke guardrails.
- Optional create: `examples/firmvault-lifecycle-simulation/.gitignore` — ignore local replay manifests and copied evidence if local artifacts are ever placed under the examples folder.

---

## Mapping Manifest Shape

The replay mapping manifest should be explicit and boring:

```yaml
schema_version: 1
source:
  description: "[REDACTED] completed PI source case"
  root: "/absolute/path/to/local/source-case" # local-only; do not commit real paths
case:
  name: "[REDACTED] Completed Case Replay"
  type: personal_injury
  slug: completed-case-replay
options:
  copy_mode: copy
  redact_log_output: true
steps:
  - fact: case.setup
    status: complete
    source: "Case Setup/[REDACTED].pdf"
    evidence: "evidence/case-setup.md"
    note: "Source case setup evidence mapped into sandbox."
```

Rules:

- `source.root` must be absolute and must exist.
- `steps[*].source` must be a relative path under `source.root`.
- `steps[*].source` must not contain `..`, absolute paths, null bytes, or shell metacharacter assumptions.
- `steps[*].evidence` must be relative and inside the sandbox case.
- `steps[*].fact` must be accepted by `waypoint firmvault state set`.
- `steps[*].status` must be accepted for that fact.
- `steps[*].note` must be safe to log and commit; use `[REDACTED]` when in doubt.

---

## Task FVL5.1: Plan and docs test

**Objective:** Lock FVL5 scope before inspecting or copying any completed case data.

**Files:**

- Modify: `src/__tests__/waypoint-docs.test.ts`
- Create: `docs/plans/firmvault-completed-case-replay-plan.md`

**Steps:**

1. Add a failing docs test that reads `docs/plans/firmvault-completed-case-replay-plan.md` and asserts the guardrails:
   - `read-only source case`
   - `temporary sandbox case`
   - `No external sends, faxes, API calls, Forgejo writes, or trust-account actions`
   - `Never commit copied case documents`
   - `[REDACTED]`
   - `mapping manifest`
   - `waypoint firmvault state set`
   - `does not edit `.waypoint/firmvault/*.yaml` directly`
   - `pnpm smoke:firmvault-completed-case-replay`
2. Run:
   ```bash
   pnpm exec vitest run src/__tests__/waypoint-docs.test.ts
   ```
   Expected RED: file missing or required phrase missing.
3. Write this plan.
4. Re-run the same docs test.
   Expected GREEN: docs test passes.
5. Commit the plan and docs test only if green:
   ```bash
   git add src/__tests__/waypoint-docs.test.ts docs/plans/firmvault-completed-case-replay-plan.md
   git commit -m "docs(firmvault): plan completed case replay"
   git push
   ```

---

## Task FVL5.2: Add sanitized replay manifest template

**Objective:** Define the local replay mapping format without committing real case paths or documents.

**Files:**

- Create: `examples/firmvault-lifecycle-simulation/completed-case-replay.template.yaml`
- Create: `examples/firmvault-lifecycle-simulation/completed-case-replay.example.yaml`
- Modify: `src/__tests__/waypoint-docs.test.ts`

**TDD:**

1. Add a failing test that reads both YAML files and asserts:
   - template contains `[REDACTED]`
   - template contains `source.root`
   - example uses synthetic names only
   - both include `steps:`
   - both include at least `fact: case.setup` and `fact: settlement.closing.case`
2. Run targeted docs test and confirm RED.
3. Create the template and synthetic example.
4. Run targeted docs test and confirm GREEN.

**Template policy:** The template may include placeholder examples, but no real source case folder names. The example should be entirely synthetic and runnable only if paired with synthetic source files created by a later test or script.

---

## Task FVL5.3: Build replay runner validation first

**Objective:** Reject unsafe manifests before touching source or sandbox folders.

**Files:**

- Create: `scripts/firmvault-completed-case-replay.mjs`
- Modify: `package.json`
- Test: add Vitest coverage if helper functions are factored into a testable module, or add docs/smoke coverage if kept as script-only.

**Behavior:**

The runner should:

1. Load a manifest path from `FIRMVAULT_COMPLETED_CASE_REPLAY_MANIFEST` or default to the synthetic example.
2. Validate schema version.
3. Validate `source.root` is absolute and exists.
4. Validate every source path is safe and stays under `source.root`.
5. Validate every evidence path is safe and relative.
6. Redact sensitive output before printing.
7. Fail closed on missing evidence or unsafe paths.

**Package script:**

```json
"smoke:firmvault-completed-case-replay": "node scripts/firmvault-completed-case-replay.mjs"
```

**TDD:**

Write a failing test or script-mode fixture that demonstrates traversal rejection before implementing copy/replay:

- `source: ../outside.pdf` must fail.
- `evidence: ../outside.md` must fail.
- absolute evidence paths must fail.

---

## Task FVL5.4: Implement sandbox replay copy and CLI state-set loop

**Objective:** Replay a mapped completed case into a temp sandbox case through the same safe CLI surface used by FVL4.

**Files:**

- Modify: `scripts/firmvault-completed-case-replay.mjs`
- Modify: `src/__tests__/waypoint-docs.test.ts` or add script-specific tests if helpers are factored.

**Runner behavior:**

1. Create temp cases root.
2. Bootstrap the sandbox case:
   ```bash
   waypoint firmvault bootstrap --cases-root <tmp> --case-name <manifest case name> --case-type personal-injury --case-slug <manifest slug> --start --json
   ```
3. For each mapping step:
   - copy the source evidence into the sandbox `evidence` path;
   - if the source is binary or sensitive, copying is local-only and never logged beyond basename/type/count;
   - run `waypoint firmvault evidence check --path <evidence> --json`;
   - run `waypoint firmvault state set --fact <fact> --status <status> --evidence <evidence> --note <redacted note> --json`.
4. Run `waypoint firmvault landmarks --json`.
5. Report satisfied/total landmarks.
6. Assert `.waypoint/firmvault/events.jsonl` contains `firmvault.state.updated`.
7. Assert route/task artifacts still exist.

**Default mode:** The committed default should run only against synthetic fixture data created in a temp source case by the script itself. Real completed-case replay requires setting an env var manifest path.

---

## Task FVL5.5: Source-case inspection workflow, local only

**Objective:** Inspect a real completed case structure enough to author a private local mapping manifest without leaking data.

**Files:**

- Optional create: `scripts/firmvault-completed-case-inspect.mjs`
- Optional create: local-only output ignored by git, e.g. `.waypoint-local/firmvault-replay-mapping.yaml`

**Inspection rules:**

- Do not print full client names, dates of birth, claim numbers, policy numbers, SSNs, account numbers, tokens, passwords, or connection strings.
- Print counts and sanitized extension/folder summaries only.
- If paths are displayed, redact sensitive path components as `[REDACTED]`.
- Do not copy files during inspection.
- Do not write into the source case.

**Decision gate:** After inspection, decide whether to build a private local mapping manifest manually or extend the inspector to suggest mapping candidates.

---

## Task FVL5.6: Verification and commit

**Objective:** Ship FVL5 only after local/synthetic replay is green.

Run:

```bash
pnpm exec vitest run src/__tests__/waypoint-docs.test.ts
pnpm smoke:firmvault-lifecycle-simulation
pnpm smoke:firmvault-completed-case-replay
pnpm typecheck
pnpm test
pnpm build
```

Before reporting commit:

```bash
git log --oneline -5
git status --short --branch
```

Commit message if all gates pass:

```bash
git commit -m "feat(firmvault): add completed case replay smoke"
git push
```

---

## Definition of Done

FVL5 is complete when:

1. The completed-case replay plan is committed.
2. The replay mapping template and synthetic example are committed.
3. The replay smoke can run without real case data and without external side effects.
4. A private manifest can point to a read-only source case and replay copied evidence into a temporary sandbox case.
5. All state changes go through `waypoint firmvault state set`.
6. The replay confirms landmark counts and audit events.
7. No source case data, copied documents, secrets, or real identifiers are committed.
8. The repo is green under the verification gates above.

---

## Out of Scope for FVL5

- Live Forgejo PR polling or webhook writes.
- Running the external Python document pipeline.
- Sending letters, faxes, emails, API calls, or trust-account transactions.
- Production backup/restore.
- Calendar/docketing/SOL workflows.
- Non-PI case types.
- Attorney-facing UI beyond CLI/runbook primitives.
