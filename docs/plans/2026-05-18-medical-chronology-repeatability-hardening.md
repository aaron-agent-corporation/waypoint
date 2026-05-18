# Medical Chronology Repeatability Hardening Plan

Date: 2026-05-18
Repo: Waypoint standalone
Scope: FirmVault Quest/Recipe/templates and Hermes skill guidance so future agents can reproduce the Douglas Livers-quality chronology output without bespoke iteration.

## Goal

Make the medical chronology Quest repeatable for future cases by encoding the accepted production rules into:

1. FirmVault chronology Recipe instructions;
2. independent adversarial QC Recipe instructions;
3. Quest review metadata/checks;
4. reusable operator templates/checklists; and
5. the `medical-chronology-binder-generation` Hermes skill.

## Required production rules

- Source records are visually inspected and grouped by true date of service, provider/facility, and encounter.
- Duplicate/repeated provider productions are consolidated; source buttons should not enumerate repeated copies of the same record.
- Each chronology row/independent visit gets one standalone extracted visit PDF named for the date/provider/visit.
- Binder structure is chronology first, then extracted visit PDFs in chronology order.
- Attorney-facing chronology output must not contain build-process/meta commentary such as restart pass, fresh start pass, inventory counts, or notes about prior output.
- Internal QC and reports may contain build/audit notes, but visible chronology and dashboard remain clean and case-facing.

## Phases

### R1 — Contract tests

Add failing tests to `src/__tests__/firmvault-recipe-port.test.ts` requiring the Recipe/QC/Quest to encode the accepted production rules and template references.

Gate: targeted test fails for missing new repeatability phrases before manifest/template patches.

### R2 — Templates and manifests

Add reusable templates under `docs/templates/firmvault/medical-chronology/` and patch the chronology/QC Recipes plus Quest metadata to reference them and enforce the rules.

Gate: targeted test passes.

### R3 — Skill update

Patch the `medical-chronology-binder-generation` skill so future non-Waypoint agents follow the same visit-PDF/source-button/binder/no-meta workflow.

Gate: read back skill/template presence and run targeted repo tests.

## Verification

- `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts`
- `pnpm typecheck`
- `git status --short --branch`
