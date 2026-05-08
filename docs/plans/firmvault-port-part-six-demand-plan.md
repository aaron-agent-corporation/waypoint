# FirmVault Port Part Six D — Demand Wave

## Goal

Port the Mission Control FirmVault demand workflows into Waypoint as source-backed recipe manifests, explicit Quest scaffold plans, and deterministic FirmVault case-state landmarks.

## Source grounding

Primary source workflows:

- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-demand-readiness.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-draft-demand.yaml`
- `/Users/aaronwhaley/Github/mission-control/workflows/firmvault-send-demand.yaml`
- `docs/quests/firmvault-workflow-map.yaml`

Source recipe directories:

- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-demand-gather-materials/`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-demand-check-final-lien-process/`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-demand-draft-letter/`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-demand-identify-recipients/`
- `/Users/aaronwhaley/Github/mission-control/recipes/firmvault-demand-send-package/`

## Deliverables

1. Replace the deferred demand checkpoint in `quests/firmvault.yaml` with explicit demand phase plans for readiness, drafting, attorney/human gates, send handoff, and response wait.
2. Add five source-backed Waypoint recipe manifests under `recipes/firmvault/` for the demand wave.
3. Extend `.waypoint/firmvault/demand.yaml` initial state and landmark projection with demand readiness, materials, damages, lien-process check, drafting, attorney review, recipient identification, and sent-demand state.
4. Update loader-backed tests/docs for the new recipe count, scaffold count, and landmark count.
5. Verify with focused FirmVault tests, full repo tests, typecheck, build, and temp-folder smoke.

## Safety constraints

- No external side effects: demand packages are local drafts/handoffs only; no email, fax, portal submission, mail, or phone call is performed by the runtime.
- Demand letters/packages must not include lien information or even notes that lien information was excluded.
- Landmark satisfaction must come from explicit `.waypoint/firmvault/demand.yaml` statuses plus existing local evidence paths, not from arbitrary folder scraping.
- Attorney approval remains a human gate; do not model an automatic merge/send.

## Verification gates

- `pnpm test -- --run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/firmvault-quest-skeleton.test.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts`
- `pnpm test -- --run`
- `pnpm typecheck`
- `pnpm build`
- `pnpm smoke:firmvault-folder`
