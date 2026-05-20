# Track 1 — Standalone Folder Host + CLI closeout

**Status:** complete through F12.  
**Scope:** local filesystem-backed Waypoint host and development CLI.  
**Package posture:** publish-ready private-registry package shape; not a globally published CLI.

## What Track 1 delivers

Track 1 makes Waypoint usable against a normal project folder with no Mission Control database, HTTP server, or background worker.

A folder can now:

1. adopt the bundled `waypoint` Quest with `waypoint init --quest waypoint`;
2. copy Quest and Recipe manifests into project-local `.waypoint/` state;
3. start a route with `waypoint start --quest waypoint`;
4. inspect status, routes, route details, events, and materialized tasks;
5. append task-scoped discussion messages to local JSONL logs;
6. pause/resume routes and approve/reject gates;
7. run safe null-runtime autopilot by default;
8. opt into local Recipe command execution with `runtime.recipe: local`.

## Package shape decision

F12 introduces `pnpm-workspace.yaml` with the root package and `packages/*` as workspace members. This is the smallest package-manager cleanup that matches the existing package manifests, which already use `workspace:*` dependencies:

- root package: `@waypoint/core` with publish-ready metadata for private-registry release
- package: `@waypoint/folder-host` with publish-ready metadata for private-registry release
- package: `@waypoint/cli` with publish-ready metadata for private-registry release

The package manifests now allow private-registry publication while retaining source workspace links for development. The CLI is still run directly in development, through root scripts, or through packed/private-registry installs; there is no claim that `waypoint` is globally installed or published.

## Operator commands

Development CLI shorthand from the repo root:

```bash
pnpm cli --help
pnpm cli init --quest waypoint
```

Direct Node entrypoint from any project folder:

```bash
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts init --quest waypoint
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts start --quest waypoint
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts routes
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts tasks --route-id route-001
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts discuss --task-id task-003 --message "Clarify the objective"
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts auto --route-id route-001 --max-iterations 10
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts gate --route-id route-001 --node plan-approval-gate --approve --next-node execute
node /absolute/path/to/waypoint/packages/waypoint-cli/src/bin.ts auto status
```

Root smoke script:

```bash
pnpm smoke:folder-host
```

The smoke script creates a temporary project, runs the end-to-end folder-host journey, verifies required `.waypoint/` artifacts, and deletes the temp project unless `WAYPOINT_KEEP_SMOKE_PROJECT=1` is set.

## Verification commands

F12 closeout gate:

```bash
pnpm exec vitest run src/__tests__/folder-host-closeout.test.ts
pnpm smoke:folder-host
pnpm test
pnpm typecheck
```

Final pre-push source-of-truth checks:

```bash
git status --short --branch
git log --oneline -5
```

## Runtime safety

Default runtime remains the null runtime. It marks local materialized tasks complete or blocked without spawning external commands.

The local Recipe runtime executes local commands only when `.waypoint/config.yaml` explicitly opts in:

```yaml
runtime:
  recipe: local
  command: node
  args:
    - ./some-runtime-adapter.mjs
```

Because `runtime.recipe: local` executes local commands, project owners should treat `.waypoint/config.yaml` as executable configuration and review command/args before running autopilot in a cloned project.

## Current limitations

- This is a publish-ready private-registry package shape, not a globally published CLI.
- There is no network sync.
- There is no multi-user collaboration layer.
- There is no web UI.
- Mission Control cutover is not complete; Mission Control still needs a later track to consume the external package shape.
- Hermes gateway integration is not complete; local runtime is only a command adapter contract, not the final Hermes service.
- Local route execution is scaffold/task-driven; first-class sub-Quest schema and richer DAG execution remain future work.
- Optional `ns-*` GSD namespace commands remain deferred.

## Deferred follow-ups

1. **Track 2 — Mission Control cutover:** decide package publication/private install strategy, update MC imports/dependency, and run MC regression.
2. **Track 3 — Hermes gateway integration:** define signed Recipe/discussion execution transport, route Recipe slugs to agents, and post agent-authored replies with loop prevention.
3. **Packaging/release:** decide whether to publish private packages, add emitted JS build output, and test global/bin install before documenting global `waypoint` usage.
4. **Product layer:** network sync, collaboration, and UI once local folder host semantics stabilize.

## Closeout decision

**Decision:** Track 1 is complete through F12 when the F12 commit and follow-up docs-record commit are present, `pnpm smoke:folder-host`, `pnpm test`, and `pnpm typecheck` pass, and `git status --short --branch` shows a clean tree.
