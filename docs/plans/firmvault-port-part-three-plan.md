# FirmVault Port Part Three Plan — Case Folder Doctor

## Goal

Implement FVP3 from `docs/plans/firmvault-folder-workflows-port-plan.md`: add a read-only FirmVault case-folder detector and doctor diagnostics to standalone Waypoint so a user can run the local folder host inside a candidate FirmVault case folder and see whether required canonical case paths are present.

## Source evidence checked

- `docs/plans/firmvault-folder-workflows-port-plan.md` lines 178-197 define FVP3 as a read-only detector/doctor, with `packages/waypoint-folder-host/src/firmvault/case-folder.ts`, `case-folder.test.ts`, and optional CLI status/doctor surface.
- Mission Control `skills.tools.workflows/DATA_CONTRACT.md` says the FirmVault native case structure includes a case folder containing `<case-slug>.md`, `Dashboard.md`, `AGENTS.md`, and canonical directories such as `client/`, `accident/`, `contacts/`, `insurance/`, `medical-providers/`, `liens/`, `demand/`, `negotiation/`, `settlement/`, `litigation/`, `documents/`, `activity/`, and `workflow-log/`.
- Mission Control `DATA_CONTRACT.md` also identifies required starter files including `client/intake.md`, `client/contracts.md`, `client/authorizations.md`, `client/contactability.md`, `client/check-ins.md`, `accident/accident.md`, `accident/police-report.md`, and `accident/liability.md`.
- Mission Control blank PI case template under `.data/runner/worktrees/task-2094/skills.tools.workflows/case_template/blank-personal-injury-case/` contains 54 paths, including `AGENTS.md`, `Dashboard.md`, `_case-slug.md`, the required starter ledgers, `activity/index.md`, and `workflow-log/index.md`.
- Current Waypoint CLI has `status` but no `doctor` command in `packages/waypoint-cli/src/bin.ts`; current folder-host exports are centralized in `packages/waypoint-folder-host/src/index.ts`.

## Scope

### In scope

1. Add a folder-host FirmVault module with canonical required/starter path definitions.
2. Add a read-only detector that reports:
   - inspected folder path;
   - inferred case slug, if a single plausible case markdown file exists;
   - whether the folder looks like a FirmVault case folder;
   - present required paths;
   - missing required paths;
   - warnings for ambiguous/missing case index files.
3. Add tests using temp folders only.
4. Export the detector from `@waypoint/folder-host`.
5. Add a CLI doctor surface if it can be done without expanding runtime scope. Preferred command: `waypoint doctor firmvault [--json]`.

### Out of scope

- Auto-creating any non-`.waypoint` case files or folders.
- Reading real FirmVault case data in tests.
- Landmark satisfaction/resolution. That is FVP4.
- External communications, portals, email, faxes, or Mission Control integration.
- New Quest/Recipe schema fields.

## Implementation phases

### Phase 1 — RED tests for folder-host detector

Create `packages/waypoint-folder-host/src/firmvault/case-folder.test.ts` with temp-folder tests that assert:

1. A complete minimal FirmVault-style case folder is recognized.
2. Missing starter paths are reported by relative path.
3. An empty folder is not recognized and does not get mutated.
4. A folder with multiple plausible case index markdown files reports an ambiguity warning rather than guessing.

Gate:

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/case-folder.test.ts
```

Expected RED: test fails because `case-folder.ts` does not exist yet.

### Phase 2 — Implement read-only detector

Create `packages/waypoint-folder-host/src/firmvault/case-folder.ts` with:

- `FIRMVAULT_REQUIRED_CASE_PATHS`
- `FIRMVAULT_STARTER_CASE_PATHS`
- `inspectFirmVaultCaseFolder(root: string)`

The implementation must use filesystem reads/stats only. It must not call `mkdir`, write files, initialize Waypoint state, or mutate the inspected folder.

Gate:

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/case-folder.test.ts
```

### Phase 3 — CLI doctor surface

Add `waypoint doctor firmvault [--json]`:

- Text output should list inspected folder, result, case slug, missing paths, and warnings.
- JSON output should expose the raw detector result.
- The command must remain read-only.

Files expected:

- `packages/waypoint-cli/src/commands/doctor.ts`
- `packages/waypoint-cli/src/commands/doctor.test.ts`
- update `packages/waypoint-cli/src/bin.ts`

Gate:

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/doctor.test.ts packages/waypoint-folder-host/src/firmvault/case-folder.test.ts
```

### Phase 4 — Verification and commit

Run:

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/case-folder.test.ts packages/waypoint-cli/src/commands/doctor.test.ts
pnpm smoke:folder-host
pnpm smoke:install
pnpm test
pnpm typecheck
```

Commit only after the gates pass. Completion claims must include the commit hash from `git log` and the verification output from the same turn.
