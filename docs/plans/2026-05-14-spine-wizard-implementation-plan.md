# Spine Wizard Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build Spine Wizard: a generic folder-to-shadow adoption layer that scans arbitrary user files, creates canonical markdown shadows with source pointers and PII metadata, asks one-question-at-a-time clarifications, generates a durable adoption plan, and applies approved FirmVault facts through existing safe state APIs.

**Architecture:** Implement generic Wizard core first, then add the FirmVault adapter. The Wizard must treat source files as immutable evidence, create Spine-owned markdown shadows under `.runner/shadows`, persist Q&A/adoption artifacts under `.runner/wizard`, and use existing FirmVault state/guidance APIs for legal progress.

**Tech Stack:** TypeScript, `yaml`, Node fs/path/crypto APIs, Vitest, Spine CLI in `packages/spine-cli`, folder-host/FirmVault state APIs in `packages/spine-folder-host`, local smoke scripts.

---

## Reference documents

- PRD: `docs/prds/spine-wizard-prd.md`
- Existing adoption plan context: `docs/plans/2026-05-12-firmvault-existing-case-adoption-plan.md`
- Existing staged guidance context: `docs/plans/2026-05-12-firmvault-staged-case-guidance-plan.md`
- Existing authoring wizard context: `docs/plans/2026-05-13-wpo9-handoff-authoring-plan.md`
- Paralegal skill context: `/Users/aaronwhaley/.hermes/profiles/paralegal/skills/case-management/firmvault-runner-case-operations/SKILL.md`

## Non-negotiable rules

1. **No source mutation by default.** User files are read-only inputs.
2. **Markdown shadows are the Spine working layer.** Spine organizes shadows, not the user's original tree.
3. **Shadows do not satisfy legal facts.** They only support proposed evidence mappings.
4. **Apply uses safe state APIs.** No raw `.runner/firmvault/*.yaml` edits for legal state.
5. **Ambiguity becomes questions.** Do not guess when a mapping affects legal/workflow state.
6. **TDD per slice.** Write the failing test, run it, implement, rerun.
7. **Commit only after gates pass.** Each milestone should land as a small commit.

## Final acceptance gate

The full Wizard is complete when this smoke passes:

```bash
pnpm smoke:spine-wizard-firmvault
```

Expected behavior:

1. Creates a temp messy source corpus.
2. Runs `runner wizard scan` without mutating source files.
3. Runs `runner wizard shadow` into a temp Spine case.
4. Confirms shadows exist under `.runner/shadows/firmvault/...` with source pointers and hashes.
5. Runs `runner wizard questions` and sees pending clarification.
6. Runs `runner wizard answer` for fixture clarifications.
7. Runs `runner wizard plan` and sees proposed FirmVault facts.
8. Marks a small subset of facts approved in the fixture plan.
9. Runs `runner wizard apply`.
10. Confirms state changed only through existing FirmVault APIs.
11. Runs `runner firmvault guidance --json` and confirms updated landmarks/next actions.
12. Confirms unapproved proposed facts remain unapplied.

---

# Milestone WW1 — Wizard core schemas and path safety

## Task WW1.1: Add Wizard shadow and scan types

**Objective:** Define the generic TypeScript contracts for Wizard scan records, shadow documents, source pointers, classifications, questions, answers, and adoption plans.

**Files:**
- Create: `src/wizard/types.ts`
- Create: `src/wizard/__tests__/types.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing test**

Test expectations:

- `isWizardDomain('firmvault')` is true.
- `isWizardDomain('bad domain')` is false.
- `createWizardSourcePointer`-style type helpers preserve source path/hash fields if implemented.
- Exported types are importable from `src/index.ts` if runtime helpers exist.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/types.test.ts
```

Expected: FAIL because files do not exist.

**Step 2: Implement minimal types**

Add type definitions for:

- `WizardDomain`
- `WizardSourceFile`
- `WizardSourcePointer`
- `WizardShadowDocumentFrontmatter`
- `WizardClassification`
- `WizardQuestion`
- `WizardAnswer`
- `WizardProposedFact`
- `WizardAdoptionPlan`

Include small runtime guards:

- `isWizardDomain(value: unknown): value is WizardDomain`
- `isSafeWizardRelativePath(value: string): boolean`

**Step 3: Run focused test**

```bash
pnpm exec vitest run src/wizard/__tests__/types.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard src/index.ts
git commit -m "feat(wizard): add core shadow schemas"
```

## Task WW1.2: Add source path and target path safety helpers

**Objective:** Prevent source traversal, target escapes, and unsafe Wizard output paths.

**Files:**
- Create: `src/wizard/paths.ts`
- Create: `src/wizard/__tests__/paths.test.ts`

**Step 1: Write failing tests**

Cover:

- absolute source paths are allowed as source pointers;
- shadow output paths must stay under `.runner/shadows/<domain>/`;
- wizard artifact paths must stay under `.runner/wizard/`;
- `..` escapes are rejected;
- backslash escapes are rejected;
- empty names are rejected.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/paths.test.ts
```

Expected: FAIL.

**Step 2: Implement helpers**

Functions:

- `safeShadowRelativePath(domain, category, basename): string`
- `safeWizardArtifactPath(name): string`
- `assertWithinRoot(root, candidate): void`
- `slugifyWizardPathSegment(value): string`

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/paths.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/paths.ts src/wizard/__tests__/paths.test.ts
git commit -m "feat(wizard): guard shadow output paths"
```

---

# Milestone WW2 — Read-only scan

## Task WW2.1: Implement recursive file inventory

**Objective:** Scan a source folder and produce a deterministic read-only inventory of files, sizes, extensions, media hints, and hashes.

**Files:**
- Create: `src/wizard/scan.ts`
- Create: `src/wizard/__tests__/scan.test.ts`

**Step 1: Write failing test**

Create a temp source tree with:

```text
Intake Docs.pdf
Medical/Dr Smith Records.pdf
Photos/image.jpg
nested/duplicate-name.pdf
```

Assert:

- scan returns file count;
- each file has absolute path, source-root-relative path, sha256, size;
- directories are ignored;
- output order is stable;
- no files are written to source.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/scan.test.ts
```

Expected: FAIL.

**Step 2: Implement scanner**

Function:

```ts
scanWizardSource(input: { sourceRoot: string; domain: WizardDomain }): Promise<WizardScanResult>
```

Use `fs/promises`, `createHash('sha256')`, and deterministic sorting.

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/scan.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/scan.ts src/wizard/__tests__/scan.test.ts
git commit -m "feat(wizard): scan source folders read-only"
```

## Task WW2.2: Add `runner wizard scan` CLI

**Objective:** Expose read-only scan through CLI.

**Files:**
- Create: `packages/spine-cli/src/commands/wizard.ts`
- Create/modify: `packages/spine-cli/src/commands/wizard.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Step 1: Write failing CLI test**

Test:

```ts
await runSpineCli(['wizard', 'scan', '--source', tempSource, '--domain', 'firmvault', '--json'], io)
```

Assert JSON includes:

- `domain: firmvault`
- `source_root`
- `files_found`
- `files[]`

Run:

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts
```

Expected: FAIL unknown command.

**Step 2: Implement command**

Wire `wizard scan` in `runSpineCli` and top-level help.

**Step 3: Verify**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/spine-cli/src/commands/wizard.ts packages/spine-cli/src/commands/wizard.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(wizard): add scan CLI"
```

---

# Milestone WW3 — Markdown shadow generation

## Task WW3.1: Add shadow markdown writer

**Objective:** Convert scanned source files into canonical markdown shadows with YAML frontmatter.

**Files:**
- Create: `src/wizard/shadows.ts`
- Create: `src/wizard/__tests__/shadows.test.ts`

**Step 1: Write failing test**

Given two source files and a target case root, assert:

- shadows are written under `.runner/shadows/firmvault/...`;
- frontmatter includes `schema_version`, `shadow_type`, `domain`, `source.path`, `source.sha256`, `pii.masked`, `classification`, `review.status`;
- source files remain unchanged;
- unknown classifications go under `unknown/`.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/shadows.test.ts
```

Expected: FAIL.

**Step 2: Implement shadow writer**

Function:

```ts
createWizardShadows(input: {
  scan: WizardScanResult
  targetRoot: string
  domain: WizardDomain
}): Promise<WizardShadowResult>
```

Initial content can be deterministic stub text:

```markdown
# Shadow for <filename>

This is a Spine Wizard shadow for the source file recorded in frontmatter.
```

Do not implement OCR yet.

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/shadows.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/shadows.ts src/wizard/__tests__/shadows.test.ts
git commit -m "feat(wizard): create markdown shadows"
```

## Task WW3.2: Add `runner wizard shadow` CLI

**Objective:** Expose shadow generation through CLI.

**Files:**
- Modify: `packages/spine-cli/src/commands/wizard.ts`
- Modify: `packages/spine-cli/src/commands/wizard.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Step 1: Write failing test**

Run:

```bash
runner wizard shadow --source <temp-source> --target <temp-case> --domain firmvault --json
```

Assert JSON includes:

- `shadows_created`
- `target_root`
- `shadow_paths[]`

Assert files exist.

**Step 2: Implement command**

Use scan + shadow writer.

**Step 3: Verify**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts src/wizard/__tests__/shadows.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/spine-cli/src/commands/wizard.ts packages/spine-cli/src/commands/wizard.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(wizard): add shadow CLI"
```

---

# Milestone WW4 — FirmVault classification adapter

## Task WW4.1: Add FirmVault shadow classifier

**Objective:** Classify source files/shadows into initial FirmVault categories using deterministic rules.

**Files:**
- Create: `src/wizard/firmvault-classifier.ts`
- Create: `src/wizard/__tests__/firmvault-classifier.test.ts`

**Step 1: Write failing tests**

Examples:

- `Intake Docs.pdf` -> `intake`
- `Fee Agreement.pdf` -> `contracts`
- `HIPAA Authorization.pdf` -> `authorizations`
- `Police Report.pdf` -> `accident`
- `Medical Bills.pdf` -> `bills`
- `Settlement Check.pdf` -> `settlement`
- unknown -> `unknown`

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-classifier.test.ts
```

Expected: FAIL.

**Step 2: Implement classifier**

Function:

```ts
classifyFirmVaultSourceFile(file: WizardSourceFile): WizardClassification
```

Keep rules simple and auditable. Do not use LLM inference.

**Step 3: Wire classifier into shadow writer for `domain: firmvault`**

Shadows should land in category folders based on classifier output.

**Step 4: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-classifier.test.ts src/wizard/__tests__/shadows.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/wizard/firmvault-classifier.ts src/wizard/__tests__/firmvault-classifier.test.ts src/wizard/shadows.ts src/wizard/__tests__/shadows.test.ts
git commit -m "feat(wizard): classify FirmVault shadows"
```

## Task WW4.2: Add proposed FirmVault fact mapping

**Objective:** Generate proposed facts from classified FirmVault shadows without applying them.

**Files:**
- Create: `src/wizard/firmvault-facts.ts`
- Create: `src/wizard/__tests__/firmvault-facts.test.ts`

**Step 1: Write failing tests**

Assert:

- contracts/fee agreement shadow proposes `client.contracts.fee_agreement` with `review_required: true` and `approved: false`;
- HIPAA shadow proposes `client.authorizations.hipaa`;
- police report shadow proposes `accident.police_report`;
- unknown shadow proposes no facts;
- generated facts include both `evidence_shadow` and `source_path`.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-facts.test.ts
```

Expected: FAIL.

**Step 2: Implement mapper**

Function:

```ts
proposeFirmVaultFactsFromShadows(shadows: WizardShadowRecord[]): WizardProposedFact[]
```

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-facts.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/firmvault-facts.ts src/wizard/__tests__/firmvault-facts.test.ts
git commit -m "feat(wizard): propose FirmVault facts from shadows"
```

---

# Milestone WW5 — Questions and answers

## Task WW5.1: Generate clarification questions

**Objective:** Persist one-question-at-a-time clarification prompts for ambiguous shadows/proposed facts.

**Files:**
- Create: `src/wizard/questions.ts`
- Create: `src/wizard/__tests__/questions.test.ts`

**Step 1: Write failing tests**

Cases:

- multiple candidate fee agreements creates one question;
- unknown files create classification questions;
- questions have stable IDs;
- questions are ordered and one-at-a-time;
- resolved answers suppress duplicate questions.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/questions.test.ts
```

Expected: FAIL.

**Step 2: Implement question model**

Functions:

- `generateWizardQuestions(plan): WizardQuestion[]`
- `nextWizardQuestion(questions, answers): WizardQuestion | undefined`

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/questions.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/questions.ts src/wizard/__tests__/questions.test.ts
git commit -m "feat(wizard): generate clarification questions"
```

## Task WW5.2: Add questions/answer CLI

**Objective:** Let agents retrieve the next Wizard question and persist an answer.

**Files:**
- Modify: `packages/spine-cli/src/commands/wizard.ts`
- Modify: `packages/spine-cli/src/commands/wizard.test.ts`

**Step 1: Write failing tests**

Commands:

```bash
runner wizard questions --case <case-root> --json
runner wizard answer --case <case-root> --question <id> --answer <text> --json
```

Assert answers are written under:

```text
.runner/wizard/answers.yaml
```

**Step 2: Implement CLI**

Use YAML persistence and safe case-root paths.

**Step 3: Verify**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts src/wizard/__tests__/questions.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/spine-cli/src/commands/wizard.ts packages/spine-cli/src/commands/wizard.test.ts src/wizard/questions.ts
git commit -m "feat(wizard): add clarification CLI"
```

---

# Milestone WW6 — Adoption plan generation

## Task WW6.1: Build adoption plan from shadows, facts, and answers

**Objective:** Generate `.runner/wizard/adoption-plan.yaml` with source map, shadow records, proposed facts, questions/answers, warnings, and missing expected FirmVault docs.

**Files:**
- Create: `src/wizard/plan.ts`
- Create: `src/wizard/__tests__/plan.test.ts`

**Step 1: Write failing tests**

Assert plan includes:

- `schema_version: 1`
- `domain: firmvault`
- `source_root`
- `target_case_root`
- `shadows[]`
- `proposed_facts[]`
- `questions[]`
- `answers[]`
- `missing_expected_documents[]`
- `safety.external_side_effects: forbidden`
- `safety.source_mutation: forbidden`
- all proposed facts default `approved: false`

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/plan.test.ts
```

Expected: FAIL.

**Step 2: Implement plan builder**

Function:

```ts
buildWizardAdoptionPlan(input: WizardPlanInput): WizardAdoptionPlan
```

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/plan.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/plan.ts src/wizard/__tests__/plan.test.ts
git commit -m "feat(wizard): build adoption plans"
```

## Task WW6.2: Add `runner wizard plan` CLI

**Objective:** Generate and optionally write the adoption plan from a case root.

**Files:**
- Modify: `packages/spine-cli/src/commands/wizard.ts`
- Modify: `packages/spine-cli/src/commands/wizard.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Step 1: Write failing CLI test**

Run after `wizard shadow`:

```bash
runner wizard plan --case <case-root> --json
```

Assert JSON includes proposed facts and plan path.

Also test:

```bash
runner wizard plan --case <case-root> --write-plan .runner/wizard/adoption-plan.yaml --json
```

Assert file exists.

**Step 2: Implement CLI**

Read shadows, questions, answers, build plan, write YAML when requested.

**Step 3: Verify**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts src/wizard/__tests__/plan.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/spine-cli/src/commands/wizard.ts packages/spine-cli/src/commands/wizard.test.ts src/wizard/plan.ts
git commit -m "feat(wizard): add adoption plan CLI"
```

---

# Milestone WW7 — Approved apply through FirmVault state APIs

## Task WW7.1: Add plan approval helper for tests and fixtures

**Objective:** Support marking proposed facts approved in a plan artifact without making apply guess.

**Files:**
- Modify: `src/wizard/plan.ts`
- Modify: `src/wizard/__tests__/plan.test.ts`

**Step 1: Write failing test**

Given a plan and fact IDs, helper marks only those facts approved and preserves others unapproved.

Potential function:

```ts
approveWizardProposedFacts(plan, factRefs): WizardAdoptionPlan
```

**Step 2: Implement helper**

No CLI required unless useful later.

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/plan.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/plan.ts src/wizard/__tests__/plan.test.ts
git commit -m "feat(wizard): support approved fact plans"
```

## Task WW7.2: Implement FirmVault apply engine

**Objective:** Apply only approved proposed facts through existing FirmVault state APIs and run guidance after apply.

**Files:**
- Create: `src/wizard/firmvault-apply.ts`
- Create: `src/wizard/__tests__/firmvault-apply.test.ts`

**Step 1: Write failing tests**

Set up temp case root with FirmVault initialized. Plan includes one approved and one unapproved proposed fact.

Assert:

- approved fact is applied;
- unapproved fact is not applied;
- result lists applied/skipped facts;
- source shadow evidence path is used;
- landmarks only change after apply;
- no raw landmark writes occur.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-apply.test.ts
```

Expected: FAIL.

**Step 2: Implement apply**

Function:

```ts
applyFirmVaultWizardPlan(input: { caseRoot: string; plan: WizardAdoptionPlan }): Promise<WizardApplyResult>
```

Internally call existing FirmVault state mutation functions, not CLI shellouts if direct APIs exist.

**Step 3: Verify**

```bash
pnpm exec vitest run src/wizard/__tests__/firmvault-apply.test.ts packages/spine-folder-host/src/firmvault/state.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/wizard/firmvault-apply.ts src/wizard/__tests__/firmvault-apply.test.ts
git commit -m "feat(wizard): apply approved FirmVault facts"
```

## Task WW7.3: Add `runner wizard apply` CLI

**Objective:** Expose approved apply through CLI and include post-apply guidance.

**Files:**
- Modify: `packages/spine-cli/src/commands/wizard.ts`
- Modify: `packages/spine-cli/src/commands/wizard.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Step 1: Write failing CLI test**

Run:

```bash
runner wizard apply --case <case-root> --plan .runner/wizard/adoption-plan.yaml --json
```

Assert:

- `applied_facts[]` includes approved fact;
- `skipped_facts[]` includes unapproved fact;
- `guidance.stage` exists;
- command exits nonzero if no plan exists.

**Step 2: Implement command**

Wire to apply engine.

**Step 3: Verify**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/wizard.test.ts src/wizard/__tests__/firmvault-apply.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/spine-cli/src/commands/wizard.ts packages/spine-cli/src/commands/wizard.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(wizard): add apply CLI"
```

---

# Milestone WW8 — End-to-end smoke and docs

## Task WW8.1: Add messy FirmVault fixture

**Objective:** Create a small intentionally messy source corpus for tests/smoke.

**Files:**
- Create directory: `examples/spine-wizard/firmvault-messy-source/`
- Create: `examples/spine-wizard/firmvault-messy-source/Intake Docs.pdf.txt`
- Create: `examples/spine-wizard/firmvault-messy-source/random/DocuSign Complete.pdf.txt`
- Create: `examples/spine-wizard/firmvault-messy-source/medical/Smith Records.pdf.txt`
- Create: `examples/spine-wizard/firmvault-messy-source/unknown/scan001.txt`
- Create: `examples/spine-wizard/README.md`

Use text fixture files with messy names; do not add real PII.

**Step 1: Add fixture files**

**Step 2: Add docs explaining synthetic/no-PII fixture**

**Step 3: Commit**

```bash
git add examples/spine-wizard
git commit -m "test(wizard): add messy FirmVault fixture"
```

## Task WW8.2: Add end-to-end smoke script

**Objective:** Prove the full Wizard path from messy folder to shadows to plan to approved apply to guidance.

**Files:**
- Create: `scripts/spine-wizard-firmvault-smoke.mjs`
- Modify: `package.json`

**Step 1: Add script entry first and run RED**

Add:

```json
"smoke:spine-wizard-firmvault": "node scripts/spine-wizard-firmvault-smoke.mjs"
```

Run:

```bash
pnpm smoke:spine-wizard-firmvault
```

Expected: FAIL because script missing.

**Step 2: Implement smoke script**

The script should:

1. Copy fixture into temp source.
2. Hash source files before scan.
3. Run CLI scan.
4. Run CLI shadow.
5. Run CLI questions.
6. Answer fixture question(s).
7. Run CLI plan with write.
8. Patch plan in temp case to approve one safe fact.
9. Run CLI apply.
10. Run guidance.
11. Hash source files after and assert unchanged.
12. Print JSON summary.

**Step 3: Run smoke**

```bash
pnpm smoke:spine-wizard-firmvault
```

Expected: PASS with summary.

**Step 4: Commit**

```bash
git add scripts/spine-wizard-firmvault-smoke.mjs package.json
git commit -m "test(wizard): add FirmVault wizard smoke"
```

## Task WW8.3: Update docs and paralegal skill

**Objective:** Teach users and the paralegal profile how to use Spine Wizard.

**Files:**
- Create: `docs/spine-wizard.md`
- Modify: `docs/spine-folder-host.md` if command list is maintained there
- Modify: `/Users/aaronwhaley/.hermes/profiles/paralegal/skills/case-management/firmvault-runner-case-operations/SKILL.md`

**Step 1: Write docs**

Include:

- source files remain wherever they are;
- shadows are markdown copies/representations;
- frontmatter points to real files;
- PII masking purpose;
- Q&A flow;
- apply requires approval;
- FirmVault state remains explicit.

**Step 2: Patch paralegal skill**

Add Wizard commands:

```bash
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard scan --source <source> --domain firmvault --json
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard shadow --source <source> --target <case-root> --domain firmvault --json
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard questions --case <case-root> --json
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard answer --case <case-root> --question <id> --answer <text> --json
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard plan --case <case-root> --write-plan .runner/wizard/adoption-plan.yaml --json
node /Users/aaronwhaley/Github/runner/packages/spine-cli/src/bin.ts wizard apply --case <case-root> --plan .runner/wizard/adoption-plan.yaml --json
```

**Step 3: Verify docs smoke/tests**

```bash
pnpm exec vitest run src/__tests__/runner-docs.test.ts packages/spine-cli/src/commands/wizard.test.ts
pnpm smoke:spine-wizard-firmvault
```

Expected: PASS.

**Step 4: Commit**

```bash
git add docs/spine-wizard.md docs/spine-folder-host.md
git commit -m "docs(wizard): document Spine Wizard workflow"
```

Note: commit the in-repo docs. The paralegal skill is outside this repo and should be reported separately after patching.

---

# Milestone WW9 — Final verification and release-ready closeout

## Task WW9.1: Run focused and full gates

**Objective:** Verify the complete Wizard implementation.

Run:

```bash
pnpm exec vitest run src/wizard/__tests__/*.test.ts packages/spine-cli/src/commands/wizard.test.ts
pnpm smoke:spine-wizard-firmvault
pnpm build
pnpm verify:built-imports
pnpm test
```

Expected:

- Wizard tests pass.
- Smoke passes.
- Build passes.
- Built imports pass.
- Full suite passes.

## Task WW9.2: Commit any final cleanup

If final docs/test drift exists, patch it and rerun the affected gates.

Commit:

```bash
git add <files>
git commit -m "chore(wizard): finalize Spine Wizard gates"
```

## Task WW9.3: Push and read back remote

Run:

```bash
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --branch
```

Expected:

- local HEAD matches remote `main`;
- branch is clean;
- no divergence.

---

## Implementation order summary

1. WW1: schemas/path safety
2. WW2: scan core + CLI
3. WW3: shadow writer + CLI
4. WW4: FirmVault classifier + proposed facts
5. WW5: Q&A core + CLI
6. WW6: adoption plan core + CLI
7. WW7: approved apply core + CLI
8. WW8: smoke/docs/skill
9. WW9: final verification/push

## How to answer "what is next?"

Do not improvise the next slice. Use this roadmap:

- If no Wizard code exists, start WW1.
- If scan exists but shadows do not, do WW3.
- If shadows exist but no FirmVault adapter, do WW4.
- If proposed facts exist but no Q&A, do WW5.
- If Q&A exists but no durable plan, do WW6.
- If plan exists but cannot apply approved facts, do WW7.
- If apply exists but no smoke/docs, do WW8.
- If all exist, run WW9 gates and push.
