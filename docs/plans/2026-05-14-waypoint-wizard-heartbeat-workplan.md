# Waypoint Wizard Heartbeat Workplan

Created: 2026-05-14T00:38:18Z

## Purpose

This file is the autonomous heartbeat control surface for implementing Waypoint Wizard from:

- PRD: `docs/prds/waypoint-wizard-prd.md`
- Implementation plan: `docs/plans/2026-05-14-waypoint-wizard-implementation-plan.md`

The heartbeat runner should use this file to decide the next incomplete slice, execute exactly the next practical slice or contiguous sub-slice, verify it, commit it, push it, and then stop until the next scheduled heartbeat.

## Operating rules

1. Start every heartbeat by running:
   - `git log --oneline -5`
   - `git status --short --branch`
   - `git pull --ff-only`
2. Re-read this workplan plus the PRD and implementation plan before choosing work.
3. Use TDD for production code:
   - write the failing test first;
   - run it and capture the RED failure;
   - implement the minimum code;
   - run focused tests and relevant gates.
4. Never claim RED/GREEN, commits, pushes, or passing tests unless the command output is visible in that heartbeat run.
5. Commit only when relevant tests pass.
6. Push after each green commit.
7. Update this file in the same commit as the slice when a task status changes.
8. Do not mutate user source folders. Wizard source files are read-only inputs.
9. Do not mark FirmVault landmarks directly. Apply approved facts only through existing safe FirmVault state APIs.
10. If blocked, commit no partial broken production changes; report the blocker with real command output.

## Stop rule

Pause the heartbeat after WW9 is complete and all final gates pass:

- `pnpm smoke:waypoint-wizard-firmvault`
- full relevant Vitest suite
- `pnpm build`
- `pnpm verify:built-imports`
- branch pushed and clean/synced with `origin/main`

Final report title should be:

`Waypoint Wizard Complete`

## Task ledger

Statuses: `pending`, `in_progress`, `completed`, `blocked`.

### WW1 — Wizard core schemas and path safety

- [x] WW1.1 — Add Wizard shadow and scan types
  - Files: `src/wizard/types.ts`, `src/wizard/__tests__/types.test.ts`, `src/index.ts`
  - Focused gate: `pnpm exec vitest run src/wizard/__tests__/types.test.ts`
- [x] WW1.2 — Add source path and target path safety helpers
  - Files: `src/wizard/paths.ts`, `src/wizard/__tests__/paths.test.ts`, `src/index.ts`
  - Focused gate: `pnpm exec vitest run src/wizard/__tests__/paths.test.ts`
- [x] WW1.3 — Add Wizard frontmatter serialization contract
  - Files: `src/wizard/shadow-frontmatter.ts`, `src/wizard/__tests__/shadow-frontmatter.test.ts`
  - Focused gate: `pnpm exec vitest run src/wizard/__tests__/shadow-frontmatter.test.ts`
  - Completed: `pnpm exec vitest run src/wizard/__tests__/types.test.ts src/wizard/__tests__/paths.test.ts src/wizard/__tests__/shadow-frontmatter.test.ts` passed with 13 tests on 2026-05-14.

### WW2 — Read-only Wizard scan

- [x] WW2.1 — Implement recursive source inventory
  - Files: `src/wizard/scan.ts`, `src/wizard/__tests__/scan.test.ts`, `src/index.ts`
  - Focused gate: `pnpm exec vitest run src/wizard/__tests__/scan.test.ts`
  - Completed: read-only recursive inventory with deterministic ordering, sha256, size, extension, and media hints on 2026-05-14.
- [x] WW2.2 — Add file hashing and media-ish metadata
  - Completed: `src/wizard/scan.ts` records sha256, size, extension, `media_type`, and `media_hint`; `pnpm exec vitest run src/wizard/__tests__/scan.test.ts` passed with 1 test on 2026-05-14.
- [x] WW2.3 — Add `waypoint wizard scan --source <path> --domain <domain> --json`
  - Completed: repo already contained `packages/waypoint-cli/src/commands/wizard.ts` plus `bin.ts` dispatch/help; `pnpm exec vitest run packages/waypoint-cli/src/commands/wizard.test.ts` passed with 4 tests on 2026-05-14.

### WW3 — Markdown shadow generation

- [x] WW3.1 — Implement deterministic shadow markdown writer
  - Files: `src/wizard/shadows.ts`, `src/wizard/__tests__/shadows.test.ts`
  - Focused gate: `pnpm exec vitest run src/wizard/__tests__/shadows.test.ts`
  - Completed: 4/4 tests passing on 2026-05-14. Deterministic markdown shadows with frontmatter, safe paths, PII metadata, domain-aware rejection.
- [x] WW3.2 — Add basic PII metadata and safe extracted-text/stub body behavior
  - Completed: shadows now record raw-text exclusion, source-content policy, extraction stub metadata, and safe stub body text; `pnpm exec vitest run src/wizard/__tests__/shadows.test.ts src/wizard/__tests__/shadow-frontmatter.test.ts packages/waypoint-cli/src/commands/wizard.test.ts` passed with 11 tests on 2026-05-14.
- [x] WW3.3 — Add `waypoint wizard shadow --source <path> --target <case-root> --domain <domain> --json`
  - Completed: CLI `wizard shadow` now scans read-only input, writes markdown shadows under the target case `.waypoint/shadows`, returns JSON paths/records, and appears in help; `pnpm exec vitest run packages/waypoint-cli/src/commands/wizard.test.ts src/wizard/__tests__/shadows.test.ts` passed with 9 tests on 2026-05-14.

### WW4 — FirmVault classifier and proposed fact mappings

- [x] WW4.1 — Add FirmVault shadow categories and filename/path classifier
  - Completed: added canonical PRD category registry, deterministic filename/path classifier, and wired shadow generation to use classifier categories; `pnpm exec vitest run packages/waypoint-cli/src/commands/wizard.test.ts src/wizard/__tests__/firmvault-classifier.test.ts src/wizard/__tests__/shadows.test.ts` passed with 25 tests on 2026-05-14.
- [x] WW4.2 — Add proposed fact mapping generator
  - Completed: added deterministic review-only FirmVault proposed fact mapper for fee agreements, HIPAA authorizations, and police reports; unknown/unsupported categories propose no facts; `pnpm exec vitest run src/wizard/__tests__/firmvault-facts.test.ts src/wizard/__tests__/firmvault-classifier.test.ts src/wizard/__tests__/shadows.test.ts` passed with 22 tests on 2026-05-14. Full `pnpm typecheck` still has unrelated existing failures in `src/__tests__/firmvault-quest-skeleton.test.ts` and `src/operators/__tests__/instructions.test.ts`.
- [ ] WW4.3 — Add missing-doc checklist and ambiguity detection

### WW5 — Wizard Q&A loop

- [ ] WW5.1 — Add question model persistence under `.waypoint/wizard/questions.yaml`
- [ ] WW5.2 — Add `waypoint wizard questions --case <case-root> --json`
- [ ] WW5.3 — Add `waypoint wizard answer --case <case-root> --question <id> --answer <text> --json`

### WW6 — Adoption plan generation

- [ ] WW6.1 — Generate `.waypoint/wizard/adoption-plan.yaml`
- [ ] WW6.2 — Include source inventory, shadow map, classifications, Q&A, proposed facts, missing docs, warnings, and approvals
- [ ] WW6.3 — Add `waypoint wizard plan --case <case-root> --json`

### WW7 — Approved apply through FirmVault state APIs

- [ ] WW7.1 — Add plan approval/approved_fact handling
- [ ] WW7.2 — Add `waypoint wizard apply --case <case-root> --json`
- [ ] WW7.3 — Confirm unapproved proposed facts remain unapplied

### WW8 — Smoke, docs, and skill updates

- [ ] WW8.1 — Add messy fixture corpus generator
- [ ] WW8.2 — Add `pnpm smoke:waypoint-wizard-firmvault`
- [ ] WW8.3 — Update docs and paralegal skill with Wizard usage

### WW9 — Final verification and push

- [ ] WW9.1 — Run final smoke and full verification gates
- [ ] WW9.2 — Push clean synced main
- [ ] WW9.3 — Pause heartbeat with final report

## Next heartbeat instruction

Start with WW1.1 unless it is already completed in this ledger and verified by repo state. If WW1.1 is complete, proceed to the first unchecked task in order.
