# Referral Package Alma Cristobal Hardening Plan

## Trigger

The Alma Cristobal referral-package output contained medical records but no chronology/binder artifacts, malformed START_HERE HTML, duplicate date prefixes, category misplacements, and buried needs-review items.

## Goal

Harden the Referral Package Quest/Recipes so a short operator request like `Create a referral package for <folder>` encodes the correct gates and agent instructions without requiring a long prompt.

## Phases

1. **RED: regression expectations**
   - Add tests asserting the referral-package Quest/recipes require:
     - medical-records-present chronology + adversarial QC gate proof before handoff;
     - START_HERE links chronology artifacts or blocks if missing;
     - HTML dashboard rejects raw markdown leakage and markdown tables in `<pre>`;
     - duplicate date prefixes are naming-QC blockers;
     - large `needs_review` counts surface in dashboard/gate output;
     - real Waypoint Quest route/recipe-chain evidence is expected, not a direct-builder output.

2. **GREEN: recipe/Quest prompt hardening**
   - Patch `recipes/referral-package/start-here-builder.yaml`.
   - Patch `recipes/referral-package/package-qc.yaml`.
   - Patch `recipes/referral-package/filename-placement-reviewer.yaml` if needed.
   - Patch `quests/referral-package.yaml` metadata/checks if needed.

3. **Verify**
   - Targeted referral package quest tests.
   - Adjacent FirmVault recipe/quest tests.
   - Typecheck.

## Non-goals

- Do not regenerate Alma Cristobal in this slice.
- Do not mutate the case folder or any `.waypoint/firmvault` legal-state YAML.
- Do not add external side effects.
