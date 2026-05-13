# FirmVault Waypoint Case Export Plan

**Goal:** Create a repeatable local export that reads every existing FirmVault legacy case folder under `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases`, copies each case into `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/waypoint_cases`, and initializes/applies conservative Waypoint `.waypoint/firmvault` state in the copied folder.

**Why this matters:** New product users will not start from ideal Waypoint-native folders. The product needs a safe migration/adoption path that produces usable Waypoint folders for messy real case corpora without mutating the source folders.

## Constraints

- Do not mutate the source `cases/` folder.
- Write adopted output only under `waypoint_cases/`.
- Use the existing Waypoint adoption/state APIs via the CLI; do not hand-edit `.waypoint/firmvault/*.yaml`.
- Apply only safe evidence-backed adoption proposals.
- Preserve original case files in the copied output folder so evidence paths remain valid relative to the case root.
- Skip hidden/template/system directories.
- Do not delete `waypoint_cases/` by default unless an explicit clean/overwrite flag is used.
- No external side effects: no emails, faxes, webhooks, Forgejo operations, calls, or trust-account actions.

## Desired command surface

Add a script first, then optionally promote to CLI after behavior stabilizes:

```bash
pnpm smoke:firmvault-waypoint-case-export
```

Script defaults:

- source root: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases`
- output root: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/waypoint_cases`
- mode: copy each legacy case to output if absent, run `waypoint firmvault adopt init --apply-safe --json` inside copied folder, then run guidance.

Environment overrides:

- `FIRMVAULT_CASES_ROOT=/path/to/cases`
- `FIRMVAULT_WAYPOINT_CASES_ROOT=/path/to/waypoint_cases`
- `FIRMVAULT_EXPORT_LIMIT=N` for test/dev slicing
- `FIRMVAULT_EXPORT_OVERWRITE=1` to remove and recreate each copied output case before adoption

## TDD plan

1. Add test/smoke expectation against a temp source root with two synthetic legacy cases.
2. Verify RED: script missing or package script missing fails.
3. Implement `scripts/firmvault-waypoint-case-export.mjs`.
4. Add package script `smoke:firmvault-waypoint-case-export`.
5. Run smoke with temp source/output roots and verify:
   - output case folders created;
   - source folders have no `.waypoint/firmvault`;
   - each output folder has `.waypoint/firmvault/case.yaml`;
   - each output folder has `events.jsonl` with initialization and state update events where safe facts applied;
   - guidance no longer reports `needs_adoption` for output folders.
6. Run script against the real corpus into `waypoint_cases/`.
7. Verify counts and sample output folders.
8. Run targeted tests/full gates and commit.

## Real-corpus verification gates

After export, run:

```bash
find /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases -mindepth 1 -maxdepth 1 -type d | wc -l
find /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/waypoint_cases -mindepth 1 -maxdepth 1 -type d | wc -l
find /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/waypoint_cases -path '*/.waypoint/firmvault/case.yaml' | wc -l
```

Sample-check at least:

- `brandon-robinson-jr`
- `abigail-whaley`
- `amy-mills`
- `abby-sitgraves`
- `ashlee-williams`

For each sample:

```bash
node packages/waypoint-cli/src/bin.ts firmvault guidance --json
```

from inside the copied `waypoint_cases/<slug>` folder.

Expected: not `needs_adoption`; returns normal guidance with current landmark counts and next actions.
