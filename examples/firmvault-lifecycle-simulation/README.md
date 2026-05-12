# FirmVault Lifecycle Simulation

This fixture proves the standalone Waypoint FirmVault command surface can drive a brand-new personal-injury case from bootstrap through closeout in a deterministic local smoke run.

It is not a live legal test. It does not send mail, submit faxes, call Forgejo, run the external document pipeline, move trust funds, or perform any external side effect.

## What the smoke does

Run:

```bash
pnpm smoke:firmvault-lifecycle-simulation
```

The smoke runner:

1. Creates a temporary trusted cases root.
2. Runs `waypoint firmvault bootstrap --cases-root <tmp> --case-name <fixture case> --case-type personal-injury --start --json`.
3. Creates synthetic evidence files inside the bootstrapped case folder.
4. Runs `waypoint firmvault evidence check --path <relative evidence> --json` for every fixture evidence path.
5. Runs `waypoint firmvault state set --fact <fact> --status <status> --evidence <path> --json` for every fixture step.
6. Runs `waypoint firmvault landmarks --json` and asserts all 82 deterministic legal landmarks are satisfied.
7. Verifies `firmvault.state.updated` audit events were appended.
8. Verifies route/task artifacts still exist, proving the lifecycle simulation did not bypass the Waypoint folder-host materialization.

## Guardrails

- The runner does not edit `.waypoint/firmvault/*.yaml` directly.
- All legal progress goes through `waypoint firmvault state set`.
- Facts are mutable; landmarks are projected.
- Evidence paths are relative to the case folder and created inside the temporary case folder before mutation.
- Document intake and `firmvault-document-pipeline` handoff metadata remain separate from legal landmark completion.
- The fixture compresses a months-long PI lifecycle into one local command-surface simulation using prepared synthetic evidence.

## Fixture format

`fixture.yaml` contains:

```yaml
schema_version: 1
case:
  name: Lifecycle Smoke Client v. Acme Insurance
  type: personal_injury
steps:
  - fact: case.setup
    status: complete
    evidence: [evidence/case-setup.md]
```

Each step maps to a validated FirmVault fact exposed by `waypoint firmvault state set`. The smoke runner creates the evidence file, validates it through `waypoint firmvault evidence check`, then records the fact through the CLI.
