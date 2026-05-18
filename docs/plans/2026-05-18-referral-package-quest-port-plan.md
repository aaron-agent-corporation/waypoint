# Referral Package Quest Port Plan

Status: accepted for implementation
Date: 2026-05-18
Source: `/Users/aaronwhaley/Github/llm-lawyer/docs/referrals`

## Goal

Port the referral package / document naming SOP into Waypoint as a reusable **Referral Package** Quest with source-attributed Recipes and documentation. This Quest is for building attorney referral handoff packages; it is not a FirmVault legal-state mutation mechanism.

## Product boundaries

- `referral-package` is a Quest, not a Waypoint runtime rename.
- Source files stay read-only unless a later explicit copy/build command is invoked.
- Organization, renaming, splitting, dashboard generation, and QC do not satisfy FirmVault legal facts by themselves.
- FirmVault legal state changes remain behind approved FirmVault state APIs.
- No external side effects: no email, faxes, filings, payments, calls, API sends, trust actions, or PR writes.
- Unknown or low-confidence documents go to review/quarantine instead of being forced into attorney-facing folders.

## Source materials

- SOP: `docs/referrals/referral-package-and-document-naming-sop.md`
- Document reviewer prompt: `docs/referrals/prompts/document-reviewer.md`
- Document review schema: `docs/referrals/schemas/document-review.schema.json`
- Package QC schema: `docs/referrals/schemas/package-qc.schema.json`

## Phase RP1 — Catalog port

Deliverables:

- `quests/referral-package.yaml`
- `recipes/referral-package/document-reviewer.yaml`
- `recipes/referral-package/packet-segmenter.yaml`
- `recipes/referral-package/filename-placement-reviewer.yaml`
- `recipes/referral-package/start-here-builder.yaml`
- `recipes/referral-package/package-qc.yaml`
- `docs/quests/referral-package.md`
- Catalog/README references updated.

Verification gates:

- RED: a focused test fails because `referral-package` Quest/Recipes are absent.
- GREEN: the Quest loads, resolves all Recipes, preserves source attribution, and exposes phases matching the SOP.
- Catalog docs contain the loader-backed updated Quest/Recipe counts and all new slugs.
- `pnpm exec vitest run src/__tests__/referral-package-quest.test.ts packages/waypoint-cli/src/commands/catalog.test.ts src/__tests__/waypoint-docs.test.ts`
- `pnpm typecheck`

## Phase RP2 — Deterministic naming helpers

Deliverables:

- A referral package module for deterministic filename/folder validation.
- Tests for junk-name rejection, date/entity/type formatting, duplicate disambiguation, and quarantine behavior.

Verification gates:

- RED/GREEN helper tests.
- Adjacent Wizard/referral tests if wired to CLI.

## Phase RP3 — Operator CLI / Hermes bridge

Deliverables:

- Safe command surface for plan/review/apply/qc or a scoped Wizard referral mode.
- Hermes safe-runner allowlist entries only after command contracts exist.

Verification gates:

- CLI tests.
- Safe-runner tests proving explicit argv only.
- No external side effects.

## Current implementation slice

Implement RP1 only. Do not build AI execution, PDF splitting, OCR, or external package sending in this slice.
