# FirmVault Port Part Five — Folder Smoke Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a repeatable temp-folder smoke gate proving the bundled `firmvault` Quest, FirmVault case-state contract, and folder-host route/task machinery work together from the CLI.

**Architecture:** Keep this as an end-to-end smoke harness, not new runtime behavior. The script creates a disposable FirmVault-style folder, runs the source CLI against that folder, asserts required `.waypoint/` artifacts, verifies route/task output is non-empty, reads the generated FirmVault landmark projection, and removes the temp folder unless explicitly preserved.

**Tech Stack:** TypeScript/Vitest for metadata tests, Node ESM smoke script, pnpm package scripts, Waypoint CLI/folder-host packages.

---

## Task 1: Add smoke declaration test

**Objective:** Prove the root package declares a `smoke:firmvault-folder` script and that the smoke script documents the critical FirmVault CLI journey.

**Files:**
- Create: `src/__tests__/firmvault-folder-smoke.test.ts`
- Modify later: `package.json`
- Create later: `scripts/firmvault-folder-smoke.mjs`

**Steps:**
1. Write a failing Vitest test asserting:
   - `package.json` has `scripts['smoke:firmvault-folder'] === 'node scripts/firmvault-folder-smoke.mjs'`
   - `scripts/firmvault-folder-smoke.mjs` exists
   - the script contains `init --quest firmvault`, `firmvault init-case`, `start --quest firmvault`, `tasks --route-id route-001`, and `firmvault landmarks --json`
2. Run:
   ```bash
   pnpm exec vitest run src/__tests__/firmvault-folder-smoke.test.ts
   ```
   Expected: FAIL because the script and package entry do not exist yet.

## Task 2: Add FirmVault folder smoke script

**Objective:** Add a source-run smoke script that operates only inside a temp case folder.

**Files:**
- Create: `scripts/firmvault-folder-smoke.mjs`

**Steps:**
1. Create a temp folder with the starter FirmVault case shape required by `FIRMVAULT_REQUIRED_CASE_PATHS`.
2. Run the real source CLI with `process.execPath` and absolute `packages/waypoint-cli/src/bin.ts`:
   - `waypoint init --quest firmvault`
   - `waypoint doctor firmvault --json`
   - `waypoint firmvault init-case --case-type personal-injury --case-slug smith-v-acme`
   - `waypoint start --quest firmvault`
   - `waypoint routes`
   - `waypoint tasks --route-id route-001`
   - `waypoint firmvault landmarks --json`
3. Assert required artifacts exist and are non-empty:
   - `.waypoint/config.yaml`
   - `.waypoint/quests/firmvault.yaml`
   - `.waypoint/routes/route-001.yaml`
   - `.waypoint/events/route-001.jsonl`
   - `.waypoint/tasks/tasks.yaml`
   - `.waypoint/firmvault/case.yaml`
   - `.waypoint/firmvault/client.yaml`
   - `.waypoint/firmvault/landmarks.yaml`
   - `.waypoint/firmvault/events.jsonl`
4. Assert outputs prove non-empty routes/tasks and a landmark projection with 8 landmarks.
5. Remove the temp folder unless `WAYPOINT_KEEP_SMOKE_PROJECT=1`.

## Task 3: Add package script and verify targeted smoke

**Objective:** Wire the root pnpm command and prove the smoke passes.

**Files:**
- Modify: `package.json`

**Steps:**
1. Add `"smoke:firmvault-folder": "node scripts/firmvault-folder-smoke.mjs"`.
2. Run targeted test:
   ```bash
   pnpm exec vitest run src/__tests__/firmvault-folder-smoke.test.ts
   ```
3. Run smoke:
   ```bash
   pnpm smoke:firmvault-folder
   ```

## Task 4: Full verification and commit

**Objective:** Close FVP5 with the required track gates.

**Verification:**
```bash
pnpm smoke:firmvault-folder
pnpm smoke:folder-host
pnpm test
pnpm typecheck
git diff --check
```

**Commit:**
```bash
git add package.json scripts/firmvault-folder-smoke.mjs src/__tests__/firmvault-folder-smoke.test.ts docs/plans/firmvault-port-part-five-plan.md
git commit -m "test(firmvault): add folder smoke"
```
