# Waypoint Wizard Organize Mode Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a user-requested Waypoint Wizard mode that turns a messy source folder into a clean, organized Waypoint case workspace while preserving source-file read-only safety and legal-state boundaries.

**Architecture:** Keep the current shadow/adoption flow as the safe default, then add an explicit organize mode that can create a canonical Waypoint-facing case package: clean document tree, markdown indexes/summaries, source manifest, missing-document checklist, Wizard questions, and an adoption plan. Source files remain read-only unless the user explicitly opts into copying files into a new Waypoint-owned target folder. FirmVault legal facts are still changed only through approved safe state APIs.

**Tech Stack:** TypeScript, Node fs/path/crypto APIs, YAML frontmatter, existing `src/wizard/*` modules, `packages/waypoint-cli`, `packages/waypoint-folder-host`, Vitest, direct Node CLI smokes.

---

## Product framing

The current Wizard answers:

> "Here are messy user files. Create Waypoint shadows and map them safely."

Organize mode answers:

> "Here are messy user files. Fix them into a clean Waypoint system I can actually use."

This is less interview-first and more concierge onboarding. The Wizard should still ask questions when needed, but the first visible product outcome is a useful organized workspace, not just a list of ambiguities.

## Non-negotiable rules

1. **Default source safety:** never mutate the user source tree.
2. **Explicit copy mode:** if real files are copied, they are copied into a new Waypoint-owned target, never moved in place.
3. **Shadow-first auditability:** every copied/organized document must have a markdown shadow or manifest entry with source path, sha256, and source-root-relative path.
4. **No legal truth by organization:** canonical folders, clean filenames, shadows, summaries, and copied packets do not satisfy FirmVault legal facts by themselves.
5. **Questions remain one-at-a-time:** ambiguity becomes persisted Wizard questions, but organize mode should still produce a useful partial organized package before all questions are answered.
6. **Apply remains safe:** approved legal-state changes call existing FirmVault safe state APIs; never hand-edit `.waypoint/firmvault/*.yaml` or landmarks.
7. **No external side effects:** no emails, faxes, filings, payments, calls, API actions, or trust actions.

## Desired user journey

```bash
waypoint wizard organize \
  --source /path/to/messy-files \
  --target /path/to/new-waypoint-case \
  --domain firmvault \
  --copy-files \
  --json

waypoint wizard questions --case /path/to/new-waypoint-case --json
waypoint wizard answer --case /path/to/new-waypoint-case --question <id> --answer <text> --json
waypoint wizard plan --case /path/to/new-waypoint-case --json
waypoint wizard apply --case /path/to/new-waypoint-case --plan .waypoint/wizard/adoption-plan.yaml --json
waypoint firmvault guidance --json
```

Expected artifacts:

```text
<target>/
  README.md
  documents/
    intake/
    contracts/
    authorizations/
    accident/
    insurance/
    providers/
    medical-records/
    bills/
    liens/
    demand/
    settlement/
    closing/
    unknown/
  .waypoint/
    shadows/firmvault/**.md
    wizard/
      source-manifest.yaml
      organization-plan.yaml
      adoption-plan.yaml
      questions.yaml
      missing-documents-checklist.md
      organize-report.md
    firmvault/*.yaml
```

## Mode semantics

### Existing `shadow` mode

- Creates markdown shadows under `.waypoint/shadows`.
- Does not copy source contents by default.
- Good for agent-safe analysis and auditability.

### New `organize` mode

- Runs scan + classification + shadow creation.
- Creates a human-usable case folder skeleton.
- Optionally copies source files into canonical document folders with safe, deterministic names.
- Writes indexes/checklists/readmes so the case looks organized immediately.
- Leaves uncertain files in `documents/unknown/` plus Wizard questions.
- Produces an adoption plan but does not auto-apply legal state unless the user separately approves/apply runs.

## Milestone O1 — Organize contracts and plan artifact

### Task O1.1: Add organize-mode types

**Objective:** Define the durable contracts for organized document entries, source manifests, copy decisions, and organize reports.

**Files:**
- Create: `src/wizard/organize.ts`
- Create: `src/wizard/__tests__/organize.test.ts`
- Modify: `src/wizard/types.ts`

**TDD:**
1. Write a failing test asserting an organize plan can represent:
   - copied file destination,
   - shadow path,
   - source pointer,
   - classification,
   - review status,
   - legal-state boundary flags.
2. Run `pnpm exec vitest run src/wizard/__tests__/organize.test.ts` and confirm RED.
3. Implement only types/helpers needed for the test.
4. Re-run focused GREEN.

**Commit:** `feat(wizard): add organize mode contracts`

### Task O1.2: Generate an organization plan without copying files

**Objective:** Convert scan + shadow classification output into a deterministic `.waypoint/wizard/organization-plan.yaml`.

**Files:**
- Modify: `src/wizard/organize.ts`
- Modify: `src/wizard/__tests__/organize.test.ts`

**Acceptance:**
- Plan groups files into canonical FirmVault categories.
- Unknown/ambiguous files are assigned `documents/unknown/` and question IDs.
- Plan records `source_files_read_only: true` and `legal_facts_from_organization: forbidden`.

**Commit:** `feat(wizard): plan organized case layout`

## Milestone O2 — Canonical case package writer

### Task O2.1: Create folder skeleton and indexes

**Objective:** Write the clean Waypoint/FirmVault folder layout plus useful markdown navigation files.

**Files:**
- Modify: `src/wizard/organize.ts`
- Modify: `src/wizard/__tests__/organize.test.ts`

**Artifacts:**
- `README.md`
- `documents/<category>/README.md`
- `.waypoint/wizard/source-manifest.yaml`
- `.waypoint/wizard/organization-plan.yaml`
- `.waypoint/wizard/organize-report.md`
- `.waypoint/wizard/missing-documents-checklist.md`

**Commit:** `feat(wizard): write organized case package`

### Task O2.2: Add explicit copy mode

**Objective:** Copy source files into canonical document folders only when requested.

**Files:**
- Modify: `src/wizard/organize.ts`
- Modify: `src/wizard/__tests__/organize.test.ts`

**Acceptance:**
- `copyFiles: false` writes manifests/shadows only.
- `copyFiles: true` copies files into the target case.
- Copied names are deterministic and collision-safe.
- Source file hashes before/after match.
- Test asserts source tree file list and hashes are unchanged.

**Commit:** `feat(wizard): copy messy files into canonical package on request`

## Milestone O3 — CLI surface

### Task O3.1: Add `waypoint wizard organize`

**Objective:** Expose organize mode through the CLI.

**Files:**
- Modify: `packages/waypoint-cli/src/commands/wizard.ts`
- Modify: `packages/waypoint-cli/src/commands/wizard.test.ts`
- Modify: `packages/waypoint-cli/src/bin.ts`
- Modify: `docs/waypoint-folder-host.md`
- Modify: `docs/waypoint-wizard.md`

**CLI:**

```bash
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
```

**Acceptance:**
- Without `--copy-files`, report says no source files copied.
- With `--copy-files`, report lists copied count and canonical target paths.
- CLI help registry and docs stay aligned.

**Commit:** `feat(wizard): add organize command`

## Milestone O4 — FirmVault-specific organization behavior

### Task O4.1: Use FirmVault document categories and missing-doc checklist

**Objective:** Make organized output useful for a personal-injury FirmVault case.

**Files:**
- Modify: `src/wizard/firmvault-classifier.ts`
- Modify: `src/wizard/organize.ts`
- Modify: `src/wizard/__tests__/organize.test.ts`
- Modify: `docs/waypoint-wizard.md`

**Acceptance:**
- Intake/contract/insurance/provider/bill/lien/demand/settlement/closing files land in matching folders when confidently classified.
- Missing checklist is derived from FirmVault fact definitions/guidance categories, not a hand-maintained disconnected list.
- Ambiguous legal mappings produce questions rather than applying state.

**Commit:** `feat(wizard): organize FirmVault case packets`

### Task O4.2: Integrate with existing adoption plan

**Objective:** Ensure organized packages feed the already-built Wizard adoption/apply flow.

**Files:**
- Modify: `src/wizard/plan.ts`
- Modify: `src/wizard/firmvault-facts.ts`
- Modify: `src/wizard/__tests__/plan.test.ts`
- Modify: `src/wizard/__tests__/firmvault-facts.test.ts`

**Acceptance:**
- Adoption plan can reference both shadow paths and canonical copied evidence paths.
- Proposed facts remain `pending_review` until approved.
- Apply continues to use existing safe FirmVault state APIs.

**Commit:** `feat(wizard): connect organized package to adoption plan`

## Milestone O5 — End-to-end smoke

### Task O5.1: Add messy-folder-to-organized-case smoke

**Objective:** Prove the new user story end to end.

**Files:**
- Create: `scripts/waypoint-wizard-organize-smoke.mjs`
- Modify: `package.json`
- Modify: `docs/waypoint-wizard.md`

**Smoke command:**

```bash
pnpm smoke:waypoint-wizard-organize
```

**Smoke must prove:**
1. Temp messy corpus is created.
2. `waypoint wizard organize --copy-files` creates a clean target case.
3. Source tree hash manifest is unchanged.
4. Target has canonical folders, copied docs, shadows, source manifest, questions, missing checklist, and organization report.
5. `waypoint wizard plan` works on the organized case.
6. No FirmVault landmarks are satisfied merely by organizing/copying.
7. Approved apply still changes state only through safe APIs.

**Commit:** `test(wizard): smoke messy files into organized case`

## Final verification gate

Before calling this complete, run:

```bash
pnpm exec vitest run src/wizard/__tests__ packages/waypoint-cli/src/commands/wizard.test.ts
pnpm smoke:waypoint-wizard-organize
pnpm smoke:waypoint-wizard-firmvault
pnpm test
pnpm build
pnpm verify:built-imports
git diff --check
```

Expected final state:
- Working tree clean.
- One or more commits on `main` pushed to `origin/main`.
- `waypoint wizard organize` documented in CLI help and docs.
- Existing shadow/adoption/apply behavior remains intact.

## Out of scope for this track

- In-place reorganization of user files.
- Automatic external actions.
- LLM/OCR-heavy content extraction beyond current safe stubs.
- Treating organized copied files as legal truth.
- Auto-approving legal facts without review.
