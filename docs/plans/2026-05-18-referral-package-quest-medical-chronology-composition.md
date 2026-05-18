# Referral Package Quest Medical Chronology Composition

## Goal

Make `Create a referral package for <folder>` resolve to a complete Referral Package Quest path without requiring the operator to paste medical chronology instructions.

## Scope

- Compose the hardened FirmVault medical chronology Recipes into `quests/referral-package.yaml`.
- Add a medical chronology phase that runs when medical records are present.
- Keep original source folders read-only and keep external side effects forbidden.
- Ensure START_HERE and package QC Recipes treat medical chronology artifacts as required package components when medical records exist.
- Update operator docs so the short natural-language request is the supported UX.

## Verification gates

1. RED: `pnpm exec vitest run src/__tests__/referral-package-quest.test.ts` fails because the referral-package Quest does not yet include chronology Recipes/phase/docs.
2. GREEN: targeted referral-package Quest test passes.
3. Adjacent: FirmVault recipe/Quest tests pass.
4. Typecheck passes.
5. Commit and push with primary-source verification.
