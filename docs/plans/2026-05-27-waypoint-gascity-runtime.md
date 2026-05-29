# Waypoint Gas City Runtime Contract

**Status:** implemented no-nudge handoff, explicit dispatch, stale-build guards,
typed completion diagnostics, repeated live-completion proof, deterministic
temp-runtime cleanup, and global/default `gc` rollout on this machine. `gc` on
PATH resolves to `/opt/homebrew/bin/gc` version `1.1.1`; the previous
`1.1.0` binary is backed up at
`/opt/homebrew/bin/gc.1.1.0.backup-20260529`.
**Date:** 2026-05-27 local / updated 2026-05-29 local

## Goal

Use Gas City as the optional runtime/supervisor for Waypoint routes that are
already materialized into Beads.

Waypoint remains the portable Quest and Recipe runtime. Beads remains the
durable work graph. Gas City owns orchestration around that graph: cities,
rigs, session templates, `gc sling`, agent session startup, nudges, formulas,
molecules, convoys, and supervisor reconciliation.

This is an adapter/runtime target. It must not move Gas City assumptions into
`@waypoint/core`, and it must not replace the existing `folder` and `beads`
route backends. The intended shape is:

```text
Waypoint Quest catalog
  -> Waypoint Beads compiler/materializer
  -> Beads issues, dependencies, and Waypoint metadata
  -> Gas City city/rig/target routing
  -> agent sessions consume Beads work
  -> Waypoint reads status back from Beads plus runtime diagnostics
```

## Boundary

| Layer | Owns | Does not own |
|---|---|---|
| `@waypoint/core` | Quest and Recipe manifest semantics, route concepts, gates, waits, artifact and side-effect policy | `gc` CLI calls, tmux/session lifecycle, Dolt server management, Gas City config |
| Waypoint folder host / CLI adapter | Optional Gas City runtime selection, command construction, preflight, sling delegation, diagnostic readback | Agent process supervision, Gas City pack internals, destructive session cleanup |
| Beads | Durable work graph, issue status, dependencies, metadata, comments, ready queue | Quest validation, recipe policy interpretation, process execution |
| Gas City | City/rig registration, session templates, `gc sling`, formulas/molecules/convoys, agent session start/wake/drain | Waypoint catalog semantics, bypassing Waypoint gates, rewriting Waypoint metadata without adapter consent |
| Agent provider | Codex/Claude/Gemini execution | Durable route source of truth |

Gas City integration belongs in host/CLI code, likely under
`packages/waypoint-folder-host` and `packages/waypoint-cli`, behind injected
command runners and tests that do not require a live agent.

## Expected Runtime Lifecycle

The supported end-to-end path should be explicit:

1. User initializes a project folder with Beads route state. The Beads
   workspace may be created by Waypoint for ordinary Beads use:

   ```bash
   waypoint init --quest waypoint --backend beads --init-beads
   ```

   For the current Gas City live path, the rig can also be registered first so
   Gas City initializes Beads, then Waypoint can run `waypoint init --backend
   beads` without `--init-beads`.

2. User enables or selects a Gas City runtime target. The eventual command
   shape is still design work, but the runtime contract needs these fields:

   - city path or discoverable city
   - rig name/path for the current project
   - Gas City target such as `waypoint-smoke/codex`
   - whether Waypoint may create the city/rig or only use existing config
   - whether Waypoint may run safe repair steps

3. `waypoint start --quest <slug>` materializes the route graph into Beads as
   it does today for `backend.route: beads`.

4. The Gas City adapter delegates runnable work to a target:

   ```bash
   gc --city <city> sling <target> <bead-id-or-text>
   ```

   For Waypoint-generated work, the preferred target is an existing Beads issue
   ID, not free-form text, so the durable work identity stays in Waypoint's
   graph.

5. Gas City must preserve route metadata that lets its hook find the work:

   ```json
   {
     "gc.routed_to": "<rig>/<agent-or-provider>",
     "molecule_id": "<optional-gas-city-molecule>"
   }
   ```

   Waypoint metadata remains under the `waypoint` namespace and must survive.

6. Gas City starts or wakes a worker session for the target. The worker runs
   `gc hook` or the configured work query, claims a routed Bead, executes it,
   closes work or step issues, and runs `gc runtime drain-ack`.

7. Waypoint reports state from Beads, with optional Gas City diagnostics for
   runtime/session health.

## Minimum Adapter Contract

The first Waypoint-side adapter should expose a small typed boundary around
`gc` rather than shelling out directly from command handlers:

| Method | Purpose |
|---|---|
| `version()` | Verify `gc` is installed and report its version. |
| `preflight()` | Check `gc`, `bd`, `dolt`, `flock`, and selected provider availability. |
| `initCity()` | Optionally create a city with a provider, preferably non-interactively. |
| `addRig()` | Register a project folder as a Gas City rig with name/prefix. |
| `sling()` | Route an existing Bead or text task to a target. |
| `sessionList()` | Read session state for diagnostics. |
| `events()` | Read recent Gas City events for route/session diagnostics. |
| `diagnose()` | Convert observed states into actionable Waypoint messages. |

All methods should be built on an injected command runner so tests can assert
commands and parse fixtures without starting tmux, Dolt, or an AI provider.

## Adapter Surface Design

The first implementation should live in `packages/waypoint-folder-host`, under
an adapter package boundary such as `src/gascity/`. The CLI surface belongs in
`packages/waypoint-cli` as a host command family. No `gc`, tmux, Dolt, or
provider concepts should be imported into `src/` core.

### Configuration

Keep `backend.route: beads` as the durable graph switch. Gas City is an optional
execution supervisor layered on top of that Beads graph, not a third route
backend.

Use an additive host config block under `.waypoint/config.yaml`:

```yaml
backend:
  route: beads
runtime:
  recipe: null
  gascity:
    enabled: true
    city: /path/to/city
    rig: waypoint
    target: waypoint/codex
    provider: codex
    auto_start: false
    sling:
      mode: current-task
      no_formula: true
      nudge: true
    repair_policy:
      route_metadata: report-only
      stranded_assignment: report-only
```

The existing `runtime.recipe` contract remains the recipe execution contract.
`runtime.gascity` is host runtime orchestration metadata. Its parser should be
permissive when absent and strict about known values when present.

### CLI Commands

Add an explicit command family rather than overloading `init` with too much
runtime behavior:

```bash
waypoint gascity configure --city <path> --target <rig/agent> [--rig <name>] [--provider codex] [--json]
waypoint gascity preflight [--json]
waypoint gascity init-city --city <path> --provider codex [--skip-provider-readiness] [--json]
waypoint gascity rig add [--path <project-root>] --city <path> --name <rig> --prefix <prefix> [--adopt] [--start-suspended] [--include <pack>] [--json]
waypoint gascity sling --route-id <id> [--target <rig/agent>] [--root|--ready] [--dry-run] [--json]
waypoint gascity status [--route-id <id>] [--json]
```

`waypoint init --backend beads --init-beads` stays focused on Waypoint and
Beads setup. `waypoint gascity rig add --adopt` remains the intended command
when an existing Waypoint Beads workspace should become a Gas City rig without
reinitializing `.beads/`, but the 2026-05-28 live probe found that the tested
Gas City runtime can leave the adopted inherited store unavailable. Until that
path is fixed upstream or wrapped by Waypoint, use Gas City-owned rig
initialization for live end-to-end checks.

For one-command startup, add a narrow opt-in to the existing start command:

```bash
waypoint start --quest <slug> --gascity
waypoint start --quest <slug> --gascity --gascity-target <rig/agent>
```

Without `--gascity`, `waypoint start` remains unchanged. With `--gascity`, the
CLI should:

1. require `backend.route: beads`;
2. run the normal Beads materialization path;
3. preflight the configured Gas City target;
4. route the Waypoint root in no-nudge mode or the current executable Beads task
   in nudge-enabled mode; and
5. print the route root, routed task, dispatch convoy, and diagnostics when
   applicable.

### Command Contract

Use `gc` argv arrays, not shell strings. The installed `gc sling --help`
documents this route-existing-bead contract:

```bash
gc sling <target> <bead-id>
```

Earlier planning expected Waypoint to call Gas City in direct-Bead mode when
explicit dispatch was desired:

```bash
gc --city <city> --rig <rig> sling <target> <bead-id> --no-formula --nudge
```

That remains useful as historical context, but the live execution probes below
supersede it for Gas City 1.1.0. Waypoint now uses the explicit convoy wrapper
contract because direct sling rejects the current standard Beads route root.

Rationale that still applies:

- Waypoint already materializes the Quest graph into Beads, so `--no-formula`
  avoids adding a default Gas City formula or replacing Waypoint's graph shape.
- `--nudge` is the explicit handoff from durable graph creation to worker
  execution.
- `--gascity-no-nudge` is a separate metadata-only contract. With current Gas
  City CLI/API surfaces, Waypoint writes `gc.routed_to=<target>` with `bd
  update`, verifies the Bead, and does not call `gc sling` because the sling
  path can still poke controller reconciliation.
- `--force` must stay opt-in and operator-visible because it can allow
  cross-rig routing or dispatch unresolved Beads.
- `--dry-run` should be exposed for previews and tests.

The adapter should verify success by reading the Bead after delegation and
checking for `gc.routed_to`, plus any returned or discovered `molecule_id` from
explicit dispatch paths. If the Bead is not resolvable or Gas City creates a
different task, Waypoint should report an integration failure rather than
pretending the route was delegated.

### Explicit Execution Contract

The 2026-05-28 nudge-enabled live probes found an additional Gas City boundary:
`gc sling <target> <waypoint-route-root>` rejects Waypoint's current standard
Beads `epic` route root, with or without `--no-formula`, because this Gas City
version reports first-class sling support for `convoy` roots only.

The proven dispatch shape is a Gas City-owned convoy wrapper around the current
executable Waypoint task, not the route root:

```bash
gc --city <city> --rig <rig> convoy create waypoint-route-001 <current-task-bead-id>
gc --city <city> --rig <rig> sling <target> <convoy-id> --no-formula --nudge
```

Observed behavior:

- Gas City's hook-side default work query looks for ready non-epic work with
  `gc.routed_to=<target>`, so routing the Waypoint route root alone is
  insufficient: the root is an epic and is excluded from the hook-ready set.
- Waypoint reconstructs the Beads route and selects the current open,
  unblocked, non-gate, non-wait task as the routed Bead.
- `gc convoy create` creates a `convoy` Bead and makes the selected Waypoint
  task a child of that convoy.
- `gc sling <convoy-id> --no-formula --nudge` expands the convoy, attaches Gas
  City's default execution wisp to the selected task, writes
  `gc.routed_to=<target>` to that task, and wakes the configured target when no
  matching session is running.
- The Waypoint route root remains a standard Beads `epic`, preserving
  compatibility with stock Beads CLI validation and Waypoint read models.
- The Gas City convoy id and selected task id are runtime dispatch metadata, not
  the Waypoint route identity. Waypoint records both in route runtime events and
  CLI output.

Implementation implication: nudge-enabled Waypoint dispatch should use an
explicit Gas City convoy wrapper around the current executable task unless Gas
City later exposes a proven route-root execution primitive for standard Beads
`epic` roots. Metadata-only `--gascity-no-nudge` must remain unchanged and must
not create or sling a convoy.

### Folder Host API

Add a small injected adapter boundary:

```ts
interface WaypointGasCityRuntime {
  version(): Promise<WaypointGasCityVersion>
  preflight(input: WaypointGasCityPreflightInput): Promise<WaypointGasCityPreflight>
  initCity(input: WaypointGasCityInitCityInput): Promise<WaypointGasCityCommandResult>
  addRig(input: WaypointGasCityAddRigInput): Promise<WaypointGasCityCommandResult>
  slingBead(input: WaypointGasCitySlingBeadInput): Promise<WaypointGasCitySlingResult>
  listSessions(input: WaypointGasCitySessionListInput): Promise<WaypointGasCitySessionList>
  readEvents(input: WaypointGasCityEventsInput): Promise<WaypointGasCityEventPage>
  diagnose(input: WaypointGasCityDiagnosticInput): Promise<readonly WaypointGasCityDiagnostic[]>
}
```

Implementation notes:

- Use an injected command runner modeled after the Beads CLI client pattern.
- Keep process spawning and JSON parsing in the folder-host adapter package.
- Expose pure diagnostic functions so fixture tests can cover missing metadata,
  empty hook, stuck creating sessions, config drift drains, and stranded
  assignments without live Gas City.
- Add an orchestration helper such as `delegateWaypointRouteToGasCity(...)`
  instead of putting Gas City calls directly inside the existing
  `startQuestRoute(...)` materialization function.

### Composition With Existing Beads Behavior

Existing Beads behavior remains canonical:

- `waypoint start` continues to create the root route issue, child node issues,
  and dependencies through `instantiateWaypointRouteInBeads`.
- `routes`, `route`, `tasks`, `auto`, `gate`, `resume`, and `route-events`
  continue to reconstruct status from Beads snapshots and Waypoint metadata.
- Gas City only receives Bead IDs to route and session-health commands to
  inspect. It does not own Quest parsing, gate approval, side-effect policy, or
  artifact verification.
- The first repair policy is report-only. The adapter may print candidate
  commands for missing route metadata or stranded work, but it must not clear
  assignments, reopen work, or rewrite metadata unless an explicit later policy
  enables that.

## Smoke Test Evidence

A disposable local probe used:

```bash
gc init --provider codex --skip-provider-readiness /tmp/waypoint-gascity-city-k32d2C
gc --city /tmp/waypoint-gascity-city-k32d2C rig add /tmp/waypoint-gascity-rig-1U3N1Q --name waypoint-smoke --prefix WPG
gc --city /tmp/waypoint-gascity-city-k32d2C sling waypoint-smoke/codex "Create SMOKE.md with one sentence saying Waypoint Gas City smoke test passed. Do not modify any other files."
```

The probe confirmed these working pieces:

- `gc 1.1.0` can be installed from the published Darwin arm64 release.
- `gc rig add` initializes a rig-scoped Beads workspace.
- `gc sling waypoint-smoke/codex ...` creates a root task, an auto-convoy, and
  a default `mol-do-work` wisp.
- Gas City can start a Codex worker session for an implicit rig target.
- With correct metadata, `gc hook` can find routed Beads work.

## Deterministic Smoke Harness

The Gas City runtime smoke harness covers the command and diagnostic
contract:

```bash
pnpm smoke:gascity-runtime
pnpm smoke:gascity-runtime -- --json
pnpm smoke:gascity-runtime -- --live-preflight
pnpm smoke:gascity-runtime -- --live --json
pnpm smoke:gascity-runtime -- --live-execute --json
pnpm smoke:gascity-runtime -- --live-complete --json
```

The default harness is fixture-backed and does not start Gas City, Beads, tmux,
Dolt, Codex, or write into the Waypoint repository. It exercises the expected
command construction for city init, rig add, metadata-only no-nudge delegation,
hook, and session list; then it asserts the healthy state observations Waypoint
depends on:

- No-nudge delegation records `gc.routed_to` on the routed Bead with `bd
  update`; nudge-enabled `gc sling` may also record formula/molecule metadata.
- No-nudge delegation does not introduce a new session id after the Waypoint
  handoff starts.
- No-nudge delegation does not move an inactive pre-existing session into an
  active state.
- `gc hook` can see the routed Bead.
- `gc session list --json` reports a running worker for the selected target.
- The healthy state produces no runtime diagnostics.

The same harness also runs deterministic diagnostic fixtures for the known Gas
City failure modes from the manual probe:

- route metadata missing after sling
- hook returning no work while Waypoint tasks remain open
- worker stuck in `creating`
- worker drained by `config-drift`
- Beads work stranded on a drained assignee
- routed work with `started_at` evidence that was reopened and unassigned
  before completion

`--live-preflight` only checks local tool availability for `gc`, `bd`, `dolt`,
`flock`, and `codex`; it still does not mutate this repository.

Live modes are explicitly opt-in. Before `--live`, `--live-execute`, or
`--live-complete` can start temp runtime work, the harness emits
`live_build_freshness` and verifies that local `dist/` artifacts for
`@waypoint/core` and `@waypoint/folder-host` are at least as new as their
non-test source files. This matters because `packages/waypoint-cli/src` imports
workspace packages through package exports, which resolve to ignored built
artifacts at runtime. If the guard fails, the smoke stops at
`stage: build-freshness`, reports `waypoint-live-build-artifacts-stale`, and
does not create temp runtime state. Run `pnpm build` before live execution
checks after source changes.

`--live` creates a temp Waypoint project and temp Gas City city, isolates
`GC_HOME` under that temp root, initializes the city, registers the temp project
as a suspended rig so Gas City owns Beads initialization, waits for the Beads
store to answer, then runs `waypoint init --backend beads` plus Waypoint's Gas
City preflight/start/diagnose commands if each prior step succeeds. Live mode
uses `--gascity-no-nudge` without `--gascity-repair-metadata`, so the probe
verifies the metadata-only handoff itself. It captures Gas City session
snapshots immediately before and after the no-nudge handoff and fails if a new
session id appears or an inactive session becomes active. Cleanup stops the
temp city, runs `gc supervisor stop --wait --json` against the isolated
`GC_HOME`, confirms `gc supervisor status --json` reports `running: false`, and
checks that no process command still references the temp root. On success it
removes the temp root; on failure it keeps the temp root and prints the
retained paths plus captured stdout/stderr for diagnosis.
Skip `--live` in CI, on machines without a local `gc` supervisor setup, or
anywhere registering a temporary Gas City city and installing/starting the local
supervisor service is not acceptable. Use `--live-preflight` when only tool
availability should be checked. The live harness gives `gc init` 360 seconds,
matching Gas City's documented 5 minute `start_ready_timeout` budget plus a
small buffer. For diagnostics only, override that with
`WAYPOINT_GASCITY_LIVE_GC_INIT_TIMEOUT_MS`. Waypoint's Gas City CLI adapter is
also bounded by `WAYPOINT_GASCITY_COMMAND_TIMEOUT_MS`, and the live start
wrapper is bounded by `WAYPOINT_GASCITY_LIVE_WAYPOINT_START_TIMEOUT_MS`. The
live harness raises child-process output capacity with
`WAYPOINT_GASCITY_LIVE_MAX_BUFFER_BYTES` so large `gc events` or diagnose
payloads do not fail with output-buffer errors before Waypoint can report the
actual runtime state.

Live runs on 2026-05-28 narrowed the blocker in stages:

- Increasing the city-init budget to 360 seconds let `gc init --provider codex
  --skip-provider-readiness <city>` complete.
- The `waypoint init --backend beads --init-beads` followed by `gc rig add
  --adopt` path exposed two compatibility issues: Gas City expected the legacy
  `issue_prefix` config key, and the adopted inherited store was not available
  to the temp project. Waypoint now writes `issue_prefix` for compatibility,
  but the live harness uses Gas City-owned rig initialization.
- The Gas City-owned rig path reaches Beads store readiness, reads the actual
  Beads prefix, initializes Waypoint against `backend.route: beads`, and passes
  `waypoint gascity preflight`.
- Waypoint route materialization now creates a standard Beads `epic` route root,
  plus the expected route issues and dependencies. No-nudge Gas City delegation
  routes that root by metadata instead of relying on Gas City container
  expansion.
- The no-nudge contract is now metadata-only in Waypoint. `waypoint start
  --gascity --gascity-no-nudge` should return after Beads metadata verification.
- The live no-nudge smoke now reaches `waypoint gascity diagnose` and verifies
  no session start/wake delta across the no-nudge handoff. Diagnose uses the
  latest `route.runtime.delegated` event to inspect the route root for
  metadata-only no-nudge delegation, because that is where Waypoint writes
  `gc.routed_to`. Gas City may still start its own city/supervisor sessions
  during city initialization; those are outside the Waypoint no-nudge delegation
  window and are captured in the session baseline.
- Nudge-enabled live smoke now routes the current executable task instead of the
  route root. Hook probes can see the routed task, and the smoke now passes
  through dispatch, hook visibility, Beads claim observation, route/task
  readback, and `waypoint gascity diagnose`. This proves
  dispatch-to-claim/readback, not autonomous completion of every task.
- `waypoint gascity diagnose` uses the same `route.runtime.delegated` event to
  inspect the routed executable task for explicit dispatch while still reporting
  the route root and dispatch convoy ids.
- After a Beads claim exists, the Beads assignee is the source of truth. If the
  assignee is absent from the current session-list snapshot, diagnose records a
  warning instead of failing the route. Matching inactive sessions still report
  `gascity-work-stranded-on-drained-assignee`, and unrelated config-drift
  events/background drained sessions are advisory warnings.

Latest passing explicit live evidence from 2026-05-28:

- Command: `pnpm smoke:gascity-runtime -- --live-execute --json`.
- Result: `ok: true`, `liveStatus: passed`, `stage: complete`,
  `executionMode: explicit-dispatch`.
- Observed ids: route root `wpl-hex`, routed executable task `wpl-hex.1`, and
  dispatch convoy `wpl-8gs`.
- Assertions: hook visibility true, claim observed with Beads status
  `in_progress`, route readback true, task readback true, diagnose true, and no
  route-scoped diagnostic failures.

Completion-loop live evidence from 2026-05-28 and 2026-05-29:

- Command sequence: `pnpm build`, then
  `pnpm smoke:gascity-runtime -- --live-complete --json`.
- One rebuilt run proved provider completion and route advancement before a
  harness parsing fix: route root `wpl-y0r`, routed task `wpl-y0r.1`, dispatch
  convoy `wpl-hpi`; the routed task closed with Beads notes and assignee
  `codex-ci-bh0`; Waypoint task readback showed `done` with Beads status
  `closed`; route readback advanced `current_node` to `initialize-roadmap` with
  progress `done: 1`.
- The harness now preserves raw command stdout internally for JSON parsing while
  keeping report output trimmed, so large `waypoint tasks --json` payloads do
  not produce false `waypoint-live-completion-readback-mismatch` failures.
- A later 2026-05-28 completion run retained a real provider/session blocker at
  `/var/folders/0m/6rps8nhn6p9180d8gzj40m1c0000gn/T/waypoint-gascity-live-UyP4EK`:
  route root `wpl-5jz`, routed task `wpl-5jz.1`, dispatch convoy `wpl-07r`,
  molecule `wpl-47s`, and session `codex-ci-sa9`. Build freshness and hook
  visibility passed, and the routed task was claimed with `started_at`, but it
  did not close before the 300000 ms completion wait. The retained project
  interaction log later showed both wrapper work and routed task reset from
  `in_progress` with that assignee back to open/unassigned. Source review
  classified this as Gas City/provider session completion behavior after
  post-claim start, not as a Waypoint read-model failure.
- A Gas City runtime patch for post-claim drain cancellation was built locally
  as `/tmp/gc-patched-bin/gc` version `1.1.1`. Repeated
  `pnpm smoke:gascity-runtime -- --live-complete --json` runs with
  `GC_BIN=/tmp/gc-patched-bin/gc PATH="/tmp/gc-patched-bin:$PATH"` passed:
  `wpl-t4x.1 -> closed` with next dry-run `wpl-t4x.2`, `wpl-bc9.1 -> closed`
  with next dry-run `wpl-bc9.2`, and `wpl-96k.1 -> closed` with next dry-run
  `wpl-96k.2`.
- The next-dispatch dry-run exposed a Waypoint diagnostic false positive:
  `waypoint gascity diagnose` was selecting the dry-run
  `route.runtime.delegated` event instead of the last real dispatch. Diagnose
  now ignores `dry_run: true` delegated events when selecting the active
  diagnostic issue.
- A follow-up cleanup proof on 2026-05-29 routed `wpl-oh8.1`, closed it,
  dry-ran next dispatch to `wpl-oh8.2`, stopped the isolated supervisor with
  `gc supervisor stop --wait --json`, confirmed status `running: false`, found
  `process_count: 0` for the temp root, and removed the temp root. That proof
  is saved at `/tmp/waypoint-gascity-cleanup-proof.json`.
- The patched Gas City binary was then installed as the default
  `/opt/homebrew/bin/gc` with the old `1.1.0` binary backed up. A no-override
  run of `pnpm smoke:gascity-runtime -- --live-complete --json` passed using
  `gc=/opt/homebrew/bin/gc` version `1.1.1` and
  `waypoint=/Users/aaronwhaley/Library/pnpm/waypoint` version `0.1.2`: route
  root `wpl-y66`, routed task `wpl-y66.1`, dispatch convoy `wpl-583`, and next
  dry-run `wpl-y66.2`. Cleanup stopped the isolated supervisor, confirmed
  `running: false`, found `process_count: 0`, and removed the temp root. Raw
  proof is saved at `/tmp/waypoint-gascity-global-proof.json`; summary at
  `/tmp/waypoint-gascity-global-proof-summary.json`.

## Live Diagnosis Runbook

Use the live smoke JSON as the first diagnostic artifact:

```bash
pnpm smoke:gascity-runtime -- --live --json
```

The live smoke reports `live_smoke.stage`, retained temp paths, per-command
stdout/stderr, cleanup status, and a `live_smoke.diagnostics[]` array. Interpret
failures by the first failed stage:

| Stage | Classification | `waypoint gascity diagnose` mapping | Operator commands |
|---|---|---|---|
| `gascity-init-city` with timeout at supervisor/adoption | Gas City supervisor/provider blocker. Waypoint has only initialized the temp project; no route exists. | Not available yet. `waypoint gascity diagnose --route-id route-001 ...` should return `Waypoint route not found: route-001`, which confirms the failure happened before Waypoint route materialization. | `gc --city <city> status --json`; `gc --city <city> session list --state all --json`; `gc --city <city> events --since 1h`; `gc --city <city> stop`; `rm -rf <temp-root>` after inspection. |
| `gascity-add-suspended-rig` | Gas City rig adoption or Beads workspace handoff blocker. | Not available yet unless route creation somehow already happened, which the live smoke does not do before rig adoption. | `cd <project> && bd where --json`; `gc --city <city> status --json`; inspect the failed command output. |
| `beads-store-ready` | Gas City rig initialized but its Beads store is not yet queryable from the project. | Not available yet because Waypoint has not initialized the route. | `cd <project> && bd list --json`; `cd <project> && bd where --json`; `gc --city <city> status --json`. |
| `gascity-beads-provider-ready` | Gas City Beads provider health failed before explicit dispatch. The harness runs `gc beads health` and then verifies the project with `bd list --json`. | Not available yet because Waypoint has not initialized the route. | `gc --city <city> --rig <rig> beads health`; `cd <project> && bd list --json`; `cd <project> && bd doctor`. |
| `waypoint-start-gascity` | Waypoint route materialization, Beads metadata delegation, or explicit Gas City convoy/dependency write failure. No-nudge delegation should now fail only at Beads update/read verification, not by timing out inside `gc sling`. Explicit dispatch failures with Dolt/store errors map to `gascity-live-beads-dolt-unavailable`. | If `route-001` exists, run `waypoint gascity diagnose --route-id route-001 --target <target> --city <city> --rig <rig> --json`. If it does not exist, inspect start output before retrying to avoid duplicate route materialization. | `waypoint route --route-id route-001 --json`; `waypoint gascity diagnose ...`; `cd <project> && bd dolt status --json`; `gc --city <city> events --since 1h`; inspect retained live-smoke temp root before removing it. |
| `gascity-no-nudge-session-check` | Waypoint completed metadata-only delegation, but the before/after Gas City session snapshots show a new session or an inactive-to-active session transition after no-nudge started. | Diagnose inspects the route root from the latest `route.runtime.delegated` event because metadata-only no-nudge writes `gc.routed_to` there. The no-nudge runtime contract still failed first if the session delta is unexplained. | Compare the `gascity-session-list-before-no-nudge` and `gascity-session-list-after-no-nudge` steps in the live-smoke JSON; inspect `gc --city <city> events --since 1h`; do not treat the run as non-waking until the session delta is explained. |
| `gascity-hook-visibility` | Explicit dispatch returned, but Gas City hook output for active session agent candidates did not include any Waypoint route issue id. If hook exits 1 for all candidates this maps to `gascity-hook-no-work-after-dispatch`; if hook returns other work but no Waypoint issue ids this maps to `gascity-hook-no-visible-dispatch-work`. | The harness records `waypoint route --route-id route-001 --json`, `waypoint tasks --route-id route-001 --json`, and then runs `waypoint gascity diagnose`; diagnose can still pass because route metadata exists even when hook/work-query visibility is wrong. | Inspect `hook_visibility.agent_candidates`, `hook_visibility.hook_results`, `bd list --all --limit 0 --json`, and `gc --city <city> events --since 1h`. Do not clear assignments or re-sling until hook/work-query visibility is understood. |
| `gascity-execution-observation` | Explicit `--live-execute` dispatch returned with a dispatch convoy id, but no Beads issue was claimed or completed inside `WAYPOINT_GASCITY_LIVE_EXECUTION_WAIT_MS`. This maps to `gascity-live-execution-no-claim`, or to a more specific session startup/drain code such as `gascity-live-session-creating-without-claim` when the session snapshot exposes one. | The harness records `waypoint route --route-id route-001 --json`, `waypoint tasks --route-id route-001 --json`, and `waypoint gascity diagnose`. Passing live execution currently means hook visibility, claim/completion observation, readback, and diagnostics succeeded; it does not require provider completion. | Inspect `root_bead_id`, `routed_bead_id`, `dispatch_bead_id`, `bd show <routed_bead_id> --json`, `bd list --all --limit 0 --json`, `gc --city <city> session list --state all --json`, and `gc --city <city> events --since 1h`. |
| `gascity-completion-observation` | Explicit `--live-complete` dispatch returned and hook visibility succeeded, but the routed Beads task did not close inside `WAYPOINT_GASCITY_LIVE_COMPLETION_WAIT_MS`. If the issue is open/unassigned but has `started_at`, classify it as `gascity-work-claim-released-after-start`; if it remains assigned or `in_progress`, classify it as `gascity-live-task-claimed-not-completed`; otherwise use `gascity-live-completion-not-observed` or a session startup/drain subtype. | The harness still records route/task/event readback and diagnose after the timeout. Diagnose can pass if route metadata is healthy even while provider completion is still blocked. | Inspect `bd show <routed_bead_id> --json`, `bd comments <routed_bead_id> --json`, `gc --city <city> session list --state all --json`, and `gc --city <city> events --since 1h`. Do not re-sling without an explicit recovery decision. |
| `waypoint-completion-readback-check` | The routed Beads task closed, but Waypoint route/task/event readback did not prove the task as `done`, raw Beads status `closed`, and route advancement/completion/gate-stop. | Diagnose may still pass because it checks runtime metadata and session health, not the completion-readback assertion. | Inspect `waypoint route --route-id route-001 --json`, `waypoint tasks --route-id route-001 --json`, and `waypoint route-events --route-id route-001 --json`; compare the completed Bead id to `current_node`. |
| `waypoint-gascity-next-dispatch-dry-run` | Completion readback passed, but `waypoint gascity sling --dry-run --json` could not prove the next dispatch would select a new executable task, mark the route complete, or stop at a gate/wait. | Diagnose can pass because this is a next-dispatch contract failure. | Run the dry-run command from the retained path, inspect task blockers/kinds, and verify gates/waits are not being bypassed. |
| `gascity-live-cleanup` | The live route proof passed, but cleanup could not prove the isolated supervisor stopped or that temp-root processes exited. | Not applicable after cleanup. | Inspect `live_smoke.cleanup`, run `GC_HOME=<temp-root>/gc-home gc supervisor status --json`, inspect the retained temp root, and stop only temp processes that reference `waypoint-gascity-live-*` paths before removing retained state. |
| `waypoint-gascity-diagnose` | Waypoint reached route creation and delegation, then the read-only diagnostic command found a route-scoped blocker or failed to inspect state. | Already run. Use the command's JSON error/diagnostics as the operator-facing blocker. Missing session-list entries for a claimed Beads assignee and unscoped config-drift events are warnings unless they match the routed work target or assignee. | `gc --city <city> session list --state all --json`; `gc --city <city> events --since 1h`; inspect the routed Bead with `bd show <routedBeadId> --json`. |

Additional live states from the earlier manual probe map to existing
`waypoint gascity diagnose` codes once `waypoint start --gascity` has created
`route-001`:

| Runtime state | Waypoint diagnostic code | Owner |
|---|---|---|
| Routed Bead lacks `gc.routed_to` | `gascity-route-metadata-missing` | Gas City metadata persistence or explicit repair policy |
| Hook sees no routed work while Beads has open Waypoint work | `gascity-hook-no-work` | Gas City routing/hook visibility |
| Worker remains in `creating` for too long | `gascity-worker-stuck-creating` | Provider trust/login or Gas City session startup |
| Session for the routed target or assignee drains on `config-drift` | `gascity-worker-drained-config-drift` | Gas City runtime/session config |
| Bead is assigned to an inactive matching session | `gascity-work-stranded-on-drained-assignee` | Operator recovery policy; do not clear assignment automatically |
| Bead is assigned, but the assignee is not present in the current session-list snapshot | `gascity-work-assignee-not-in-session-list` warning | Treat Beads assignment as the claim source of truth; inspect events before recovery. |
| Bead is open/unassigned but still has `started_at` and no `closed_at` | `gascity-work-claim-released-after-start` | Treat as a released provider/session claim; inspect Beads history and Gas City events before retrying. |
| Unrelated drained sessions or unscoped config-drift events appear in recent Gas City history | Warning diagnostics only | Preserve context without failing an otherwise valid route. |

Cleanup rule: the harness stops the temp city, stops the isolated supervisor
with `--wait`, verifies no temp-root processes remain, and removes the temp root
on success. It keeps the temp root on failure or when `--keep-live` is set.
After inspection, remove retained state with:

```bash
rm -rf <temp-root>
```

The probe also exposed these blockers.

### 1. Route metadata did not persist as expected

Event stream showed the root task receiving:

```json
{
  "metadata": {
    "gc.routed_to": "waypoint-smoke/codex"
  }
}
```

Later `bd show wpg-2u6 --json` returned the task without that metadata, so the
worker's `gc hook` returned `[]`.

Manual repair:

```bash
bd update wpg-2u6 \
  --set-metadata gc.routed_to=waypoint-smoke/codex \
  --set-metadata molecule_id=wpg-9ay
```

After repair, both direct `bd ready --metadata-field ...` and `gc hook` could
see the work.

### 2. Codex worker startup reached the provider but stalled on runtime UX

The tmux worker pane showed a running Codex session, including the pool worker
prompt, but also surfaced provider/UI friction:

- Codex trust prompt for the temp rig directory.
- A generic prompt line: `Implement {feature}`.
- Initial `gc hook` returned no work because the route metadata was missing at
  that time.

This means the integration must separate two concerns: whether Gas City can
start the provider, and whether the worker can see routable Beads work.

### 3. Config drift drained the worker

Supervisor logs showed Gas City successfully started the worker, then drained
it because generated `CopyFiles` changed:

```text
config-drift codex-adhoc-20f62702ff: stored=0d9090cf3de2 current=1701e27ef3d8
  config-drift-diag codex-adhoc-20f62702ff: drifted fields: CopyFiles
Draining session 'codex-adhoc-20f62702ff': config-drift
Stopped drain-acked session 'codex-adhoc-20f62702ff'
```

This is probably a Gas City runtime issue, but Waypoint must diagnose it clearly
instead of reporting a generic quest failure.

### 4. Claimed work was stranded on a drained session

After metadata repair, the worker claimed the Bead:

```json
{
  "id": "wpg-2u6",
  "status": "in_progress",
  "assignee": "codex-adhoc-20f62702ff",
  "metadata": {
    "gc.routed_to": "waypoint-smoke/codex",
    "molecule_id": "wpg-9ay"
  }
}
```

Then the session drained before writing `SMOKE.md`. Replacement sessions could
not see the work because it was already assigned to the old drained session.

Safe recovery is not yet part of the contract. The adapter may detect this
state and suggest reassignment/reopen commands, but it must not silently steal
or close work until the recovery policy is explicit.

## Diagnostic States Waypoint Should Recognize

The first diagnostics pass should identify these states:

| State | Detection signal | User-facing guidance |
|---|---|---|
| Missing Gas City binary | `gc version` fails | Install Gas City or disable Gas City runtime. |
| Missing dependency | preflight for `bd`, `dolt`, `flock`, provider fails | Install missing dependency; do not start route execution. |
| Missing route metadata | routed Bead lacks `gc.routed_to` | Re-run sling or apply explicit safe repair if allowed. |
| Hook sees no work | `gc hook` returns `[]` while Beads has open Waypoint tasks | Compare assignment, route metadata, and blockers. |
| Worker stuck creating | `gc session list --json` has long-lived `creating` session | Inspect supervisor logs and provider trust/login state. |
| Worker drained on config drift | supervisor events/logs mention `config-drift` and `Draining session` for the routed target or assignee | Treat as runtime blocker; do not claim integration success. |
| Work stranded on drained assignee | Bead `in_progress` assignee maps to an inactive matching session | Report Bead ID, assignee, and safe recovery options. |
| Claimed work whose assignee is absent from the session-list snapshot | Bead `in_progress` assignee has no matching current session-list entry | Warn and keep Beads assignment as the source of truth; inspect events before recovery. |
| Claimed work released after start | Bead is open/unassigned but still has `started_at` and no `closed_at` | Treat as a released provider/session claim; inspect Beads history and Gas City events before retrying. |

## Deferred Decisions

1. Whether to split the Gas City adapter into a separate package after the
   folder-host implementation stabilizes.
2. Whether CI should ever run a real `gc` smoke, or keep real Gas City checks
   behind an opt-in local flag.
3. Which recovery steps are safe to automate beyond report-only diagnostics.
4. Whether a future Formula export should let Gas City instantiate Waypoint
   Quest templates directly. The first integration should route existing Beads
   issues only.

## Build Order For Epic `waypoint-3h6`

1. Capture this contract and smoke failure.
2. Add a deterministic smoke harness around the Gas City command/state
   contract.
3. Design the Waypoint CLI/host adapter surface.
4. Implement the injected command adapter with unit tests.
5. Wire quest launch to optional Gas City runtime delegation.
6. Add diagnostics and safe recovery guidance.
7. Document end-to-end usage.
8. Review the result and create/start the next epic if integration is not done.
