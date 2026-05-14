# WPO Closeout Integration Smoke Plan

## Goal

Add one executable smoke that proves the Waypoint OpenSwarm-pattern surfaces work together after WPO1-WPO9:

1. operator manifest discovery
2. operator instruction resolution
3. safe tool registry discovery/explain
4. handoff graph list/show bound to FirmVault quest
5. quest handoff manifest resolution through bundled core APIs
6. handoff authoring dry-run generation

## Scope

- Repo-only smoke script under `scripts/`.
- Package script entry in `package.json`.
- No external side effects.
- No writes outside a temporary directory.
- Authoring output must remain draft-only unless written to temp.

## Verification Gates

- RED: `pnpm smoke:wpo-integration` fails while script is absent.
- GREEN: `pnpm smoke:wpo-integration` passes and prints a concise JSON summary.
- Regression: focused CLI/core tests still pass.
- Build and built import verification still pass.

## Skill Update

Patch paralegal skill `firmvault-waypoint-case-operations` to include the WPO operator/tool/handoff/authoring commands and the new smoke command.
