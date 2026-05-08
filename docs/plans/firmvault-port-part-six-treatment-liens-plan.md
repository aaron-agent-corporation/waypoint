# FirmVault Port Part Six-B — Treatment Status and Early Lien Discovery

## Goal

Port the next Wave 2 FirmVault slice after BI/PIP insurance: provider treatment-status review and early lien/payor-clue discovery.

## Primary sources

- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-medical-provider-status.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-early-lien-identification.yaml`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-medical-provider-review-status/{recipe.yaml,SOUL.md,REVIEW.md}`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-lien-identify-potential/{recipe.yaml,SOUL.md,REVIEW.md}`
- `docs/quests/firmvault-workflow-map.yaml`

## Scope

1. Add source-backed Waypoint Recipe manifests for:
   - `firmvault-medical-provider-review-status`
   - `firmvault-lien-identify-potential`
2. Expand `quests/firmvault.yaml` with explicit recipe/gate/wait plans from the two source workflows.
3. Extend the explicit FirmVault state contract under `.waypoint/firmvault/`:
   - provider treatment-status landmarks remain projected from `providers.yaml`
   - early lien/payor-clue landmarks project from a new `liens.yaml`
4. Keep all state deterministic and evidence-backed. No arbitrary legal-folder scraping.
5. Update smoke/test expectations for the expanded recipe/task/landmark counts.

## Verification gates

- Focused FirmVault recipe/quest/state/CLI tests pass.
- `pnpm smoke:firmvault-folder` passes in a temp folder.
- `pnpm test` passes.
- `pnpm typecheck` passes.
- Commit and push only after proof.
