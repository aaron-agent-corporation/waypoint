# Waypoint folder host

The Waypoint folder host runs a Quest against a normal project directory without Mission Control, a database, or a server. It stores project-local state in a human-readable `.waypoint/` folder and exposes the journey through the development CLI in `packages/waypoint-cli/src/bin.ts`.

This is a private development package and not a globally published CLI. The examples below use either `waypoint ...` as shorthand or the direct Node entrypoint when you are running from this repository.

## Current status

The folder host can currently:

- initialize a project-local `.waypoint/` directory;
- install bundled Quest and Recipe manifests into that project;
- start a live route for the bundled `waypoint` Quest;
- persist route YAML, event JSONL, task YAML, discussion JSONL, and autopilot run JSONL;
- pause/resume routes and approve/reject gates;
- run autopilot in the safe null runtime by default;
- run Recipes through an explicitly configured local command runtime;
- optionally delegate Beads-backed route work to Gas City for external agent
  execution;
- initialize product-owned FirmVault case state and project workflow landmarks from explicit YAML state plus evidence paths;
- add local FirmVault documents into `documents/inbox/`, index them in `.waypoint/firmvault/documents.yaml`, and append FirmVault document events without marking substantive landmarks complete.

It does not claim global installation, package publishing, cloud sync, or production packaging yet.

## Development invocation

From this repository, the safest smoke pattern is to run the CLI by absolute path from a temporary project directory:

```bash
repo=/Users/aaronwhaley/Github/waypoint
tmp=$(mktemp -d)
cd "$tmp"
node "$repo/packages/waypoint-cli/src/bin.ts" --help
```

If you have installed or aliased the development CLI yourself, the shorthand command is:

```bash
waypoint --help
```

The CLI help registry currently exposes these commands:

```text
waypoint --help
waypoint --version
waypoint init [--quest <slug>] [--backend folder|beads] [--init-beads]
waypoint status [--json]
waypoint doctor firmvault [--profile paralegal] [--workspace-root <path>] [--upgrade-plan] [--json]
waypoint firmvault bootstrap --cases-root <path> --case-name <name> [--case-type personal-injury] [--case-slug <slug>] [--backend folder|beads] [--init-beads] [--start] [--json]
waypoint firmvault add-document --source <path> --kind medical-records|bill|insurance|police-report|correspondence|unknown [--note <note>] [--json]
waypoint firmvault document-handoff --document-id <id> --status not-started|submitted|pr-opened|merged|deferred|failed [--pr-number <number>] [--pr-url <url>] [--branch <branch>] [--submitted-at <iso>] [--completed-at <iso>] [--json]
waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]
waypoint firmvault landmarks [--json]
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint quests
waypoint recipes [--quest <slug>]
waypoint start [--quest <slug>] [--gascity] [--gascity-target <rig/agent>] [--gascity-city <path>] [--gascity-rig <name>] [--gascity-provider <provider>] [--gascity-dry-run] [--gascity-no-nudge] [--gascity-repair-metadata]
waypoint gascity preflight [--city <path>] [--rig <name>] [--provider <provider>] [--json]
waypoint gascity diagnose --route-id <id> [--target <rig/agent>] [--city <path>] [--rig <name>] [--provider <provider>] [--json]
waypoint gascity sling --route-id <id> [--target <rig/agent>] [--city <path>] [--rig <name>] [--provider <provider>] [--dry-run] [--no-nudge] [--repair-metadata] [--json]
waypoint routes [--json]
waypoint route --route-id <id> [--json]
waypoint route-events --route-id <id> [--limit N] [--offset N] [--json]
waypoint tasks [--route-id <id>] [--json]
waypoint discuss --task-id <id> [--message <text>] [--author user|agent]
waypoint auto [--route-id <id>] [--max-iterations N] [--json]
waypoint auto status [--limit N] [--offset N] [--json]
waypoint runtime referral-package-builder
# Safety: local Recipe runtime executes configured commands only when .waypoint/config.yaml explicitly sets runtime.recipe: local.
waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
waypoint pause --route-id <id> [--reason <text>]
waypoint resume --route-id <id> [--resolve-blocker] [--note <text>]
# Use --resolve-blocker after the operator/paralegal resolves the missing artifact or other blocked Quest input; then run waypoint auto again.
waypoint lifecycle add workstream --key <key> --name <name>
waypoint lifecycle add milestone --workstream <key> --key <key> --title <title>
waypoint lifecycle add phase --milestone <key> --key <key> --lifecycle <name>
waypoint lifecycle add plan --phase <key> --ref <ref> --title <title>
waypoint lifecycle list
waypoint operators list [--json]
waypoint operators show <slug> [--json]
waypoint operators instructions <slug> [--json]
waypoint handoffs list [--quest <slug>] [--json]
waypoint handoffs show <slug> [--json]
waypoint tools list --operator <slug> [--json]
waypoint tools explain <tool-slug> [--json]
waypoint author brainstorm --kind quest|recipe|operator|handoff_graph [--domain <domain>] [--json]
waypoint author design --answers <path> --write-spec docs/plans/<file>.md [--json]
waypoint author plan --design docs/plans/<file>.md [--allow-unapproved-draft] [--json]
waypoint author recipe --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
waypoint author quest --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
waypoint author handoff --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
```

## Operator journey

Start from an empty project folder.

### 1. Initialize the folder

```bash
waypoint init --quest waypoint
```

This creates `.waypoint/config.yaml`, installs the bundled `waypoint` Quest manifest, installs the Recipes referenced by that Quest, and creates the local state directories.

Use `--backend beads` to select the Beads route backend for route/task graph
materialization:

```bash
waypoint init --quest waypoint --backend beads
```

Both backends install and read the same Quest and Recipe manifests. `folder`
keeps route/task state in `.waypoint/`; `beads` derives Beads issues and
dependencies from those manifests. Quest and Recipe YAML remain the source of
truth in both modes.

`--backend beads` records the backend selector. Use `--init-beads` when this
folder also needs Waypoint to run `bd init` non-interactively:

```bash
waypoint init --quest waypoint --backend beads --init-beads
```

When `--init-beads` is omitted, Waypoint does not create or repair `.beads/`.
This is deliberate: the operator may want to use an existing Beads workspace,
remote, or policy. `waypoint status --json` reports the readiness state, and
`waypoint start` fails before graph writes with an action hint if `bd` is
missing or no Beads workspace is active.

Backend behavior in normal CLI use:

| Backend | Runtime behavior |
|---|---|
| `folder` | Default mode. `waypoint start` writes route YAML, task YAML, and route events under `.waypoint/`. `waypoint routes`, `waypoint route`, `waypoint tasks`, `waypoint status`, `waypoint auto`, `waypoint gate`, and `waypoint resume` read and mutate that folder-local state. No Beads workspace is required. |
| `beads` | `waypoint init --backend beads` records `backend.route: beads` in `.waypoint/config.yaml`. `waypoint start` creates a compatibility route record and materializes the executable route graph as Beads issues with parent/child links, dependencies, and Waypoint metadata. `waypoint routes`, `waypoint route`, `waypoint tasks`, and `waypoint status` reconstruct their read model from Beads issue snapshots. `waypoint route-events` synthesizes route history from the route issue and Waypoint-tagged Beads comments. `waypoint discuss` stores task-scoped discussion as Beads comments on the task issue. `waypoint auto` advances ready Beads issues, stops at gates and waits, enforces Recipe side-effect policy and artifact verification, and records the autopilot run under `.waypoint/`. `waypoint gate` closes or blocks the Beads gate issue; `waypoint pause`/`waypoint resume` update the Beads route issue; `waypoint resume --resolve-blocker` can resolve supported waits or artifact blockers but does not bypass human gates. |

The Recipe runtime selector is independent of the route backend. Both backends
use the safe null Recipe runtime unless `.waypoint/config.yaml` explicitly sets
`runtime.recipe: local` and provides a command.

### Optional Gas City runtime over Beads

Gas City is an optional execution supervisor for Beads-backed Waypoint routes.
It does not replace the route backend. Waypoint still owns Quest/Recipe
manifests, route materialization, gates, policy checks, and Beads metadata.
Beads remains the durable work graph. Gas City owns city/rig registration,
session startup, nudges, and agent/provider supervision.

Prerequisites for the current local flow:

- `gc`, `dolt`, `flock`, and the selected provider CLI such as `codex` are on
  `PATH`.
- End-to-end completion requires a Gas City build that includes the post-claim
  completion reliability fix. On this machine, `gc` resolves to
  `/opt/homebrew/bin/gc` version `1.1.1`; the previous `1.1.0` binary is backed
  up at `/opt/homebrew/bin/gc.1.1.0.backup-20260529`. This is a fork-patched
  binary from `Whaleylaw/gascity` branch
  `codex/post-claim-completion-reliability` at commit `8cd2efb0`; upstream Gas
  City PR `https://github.com/gastownhall/gascity/pull/2737` can remain open
  without blocking Waypoint's local runtime path.
- A Gas City city exists, or the operator is ready to create one with `gc init`.
- The current project folder is registered as a Gas City rig. For the current
  live path, let Gas City initialize the Beads workspace when the rig is added,
  then initialize Waypoint against that Beads backend.

Current local setup path:

```bash
gc init --provider codex --skip-provider-readiness /path/to/gascity
gc --city /path/to/gascity rig add "$PWD" --name waypoint --prefix WPT --start-suspended

waypoint init --quest waypoint --backend beads

waypoint gascity preflight \
  --city /path/to/gascity \
  --rig waypoint \
  --provider codex

waypoint start --quest waypoint \
  --gascity \
  --gascity-city /path/to/gascity \
  --gascity-rig waypoint \
  --gascity-target waypoint/codex \
  --gascity-no-nudge
```

The earlier `waypoint init --backend beads --init-beads` followed by
`gc rig add --adopt` flow is not the recommended live path yet. On the tested
Gas City 1.1.0 local runtime, adoption can register the rig but leave the
inherited Beads store unavailable to the project. The Gas City-owned rig init
path above is the path that reaches Waypoint route materialization today.

`waypoint start --gascity` validates that `backend.route: beads` is configured,
preflights Gas City before writing a new route, starts the normal Waypoint
Beads route, and delegates the generated Beads work to the configured Gas City
target. In metadata-only no-nudge mode that work is the route root. In
nudge-enabled execution mode it is the current executable Beads task for the
route, because Gas City hook queries ignore epic issues.

Use `--gascity-no-nudge` when the operator wants durable routing metadata only:
Waypoint records `gc.routed_to=<target>` on the route root and verifies it, but
does not start or wake a Gas City worker.

Use the default nudge-enabled path only when intentional execution is desired.
With Gas City 1.1.0, Waypoint selects the current open, unblocked, non-gate,
non-wait Beads task, wraps that task in a Gas City-owned dispatch convoy, and
then slings the convoy:

```bash
gc --city <city> --rig <rig> convoy create waypoint-route-001 <current-task-bead-id>
gc --city <city> --rig <rig> sling <target> <convoy-id> --no-formula --nudge
```

`--no-formula` is intentional: Waypoint already created the route graph in
Beads, so Gas City should route the existing graph rather than generate a
separate formula graph. The dispatch convoy id and routed task id are runtime
metadata; the Waypoint route identity remains the route root Bead id. The CLI
prints both when they differ:

```text
gascity bead: <route-root-bead-id>
gascity routed bead: <current-task-bead-id>
gascity dispatch bead: <convoy-id>
```

When `--gascity-no-nudge` is set, Waypoint does not call `gc sling`. It writes
`gc.routed_to=<target>` directly onto the Beads route root with `bd update`,
then reads the root Bead back and verifies the metadata. This metadata-only path
is bounded by Beads update/read behavior and does not start, wake, or poke Gas
City sessions. If verification fails, `waypoint start --gascity` and `waypoint
gascity sling --no-nudge` return a failed result instead of claiming that the
route was delegated.

The same settings can be stored in `.waypoint/config.yaml` so the start command
only needs `--gascity`:

```yaml
backend:
  route: beads
runtime:
  recipe: null
  gascity:
    enabled: true
    city: /path/to/gascity
    rig: waypoint
    target: waypoint/codex
    provider: codex
    sling:
      mode: current-task
      no_formula: true
      nudge: true
    repair_policy:
      route_metadata: report-only
      stranded_assignment: report-only
```

After launch, inspect Waypoint and Gas City state separately:

```bash
waypoint route --route-id route-001 --json
waypoint tasks --route-id route-001 --json
waypoint route-events --route-id route-001 --json

waypoint gascity diagnose \
  --route-id route-001 \
  --target waypoint/codex \
  --city /path/to/gascity \
  --rig waypoint
```

For Beads-backed routes, `waypoint tasks --json` reports Waypoint-normalized
task status plus `metadata.beads.status` and `metadata.beads.assignee` when an
external worker has claimed or changed an issue. Closed Beads issues read back
as Waypoint `done` tasks while retaining the raw Beads status in metadata.
`waypoint route-events` reads Beads comments as route events and includes
`payload.task_status` for task comments, so worker notes remain visible without
giving Waypoint permission to bypass gates or waits.

If the route already exists and the initial Gas City handoff failed, retry the
handoff without creating a duplicate route:

```bash
waypoint gascity sling \
  --route-id route-001 \
  --target waypoint/codex \
  --city /path/to/gascity \
  --rig waypoint
```

By default, post-sling metadata verification is report-only. To explicitly
repair missing `gc.routed_to` metadata on the routed Bead, pass
`--repair-metadata` to `waypoint gascity sling` or `--gascity-repair-metadata`
to `waypoint start --gascity`. This repair flag is for nudge-enabled `gc sling`
or retry paths where Waypoint must repair metadata after an external delegation
attempt. It is not required for `--gascity-no-nudge`, because no-nudge
delegation is already a metadata-only Beads update. The equivalent config value
is:

```yaml
runtime:
  gascity:
    repair_policy:
      route_metadata: metadata-only
```

This repair only writes `gc.routed_to=<target>` to the routed Bead. Stranded
assignments and session cleanup remain manual.

`waypoint gascity diagnose` is read-only. It checks prerequisites, reads the
latest `route.runtime.delegated` event when one exists, chooses the appropriate
diagnostic Bead from that event, lists Gas City sessions, reads recent Gas City
events, and reports known blocker states with concrete Bead ids or next
commands. Metadata-only no-nudge delegation is diagnosed on the route root
because that is where Waypoint writes `gc.routed_to`; explicit dispatch is
diagnosed on the routed executable task while still reporting the route root
and dispatch convoy ids. Diagnose does not clear assignments, reopen Beads,
delete sessions, or repair Gas City state by default.

Live smoke verification:

```bash
pnpm smoke:gascity-runtime -- --json
pnpm smoke:gascity-runtime -- --live-preflight
pnpm smoke:gascity-runtime -- --live --json
pnpm smoke:gascity-runtime -- --live-execute --json
pnpm build
pnpm smoke:gascity-runtime -- --live-complete --json
```

The default smoke is fixture-backed and does not mutate this repo, start Gas
City, or touch provider sessions. `--live-preflight` only checks local `gc`,
`bd`, `dolt`, `flock`, and provider CLI availability. `--live` is opt-in
because it creates a temporary Gas City city, registers it with the local
supervisor, creates a temporary project/rig, initializes Waypoint with the
Beads backend, runs `waypoint start --gascity --gascity-no-nudge`, compares
Gas City session snapshots before and after the no-nudge handoff, and then runs
`waypoint gascity diagnose`.

`--live-execute` is a separate opt-in mode for intentional dispatch. It follows
the same temp project/city setup, but runs `waypoint start --gascity` without
`--gascity-no-nudge`, expects Waypoint to create a Gas City dispatch convoy, and
checks Gas City Beads provider health before dispatch. After dispatch it probes
Gas City hook output for the active session agent candidates, waits for a
bounded Beads claim or completion signal only if a Waypoint route issue is
hook-visible, records route and task readback, and runs `waypoint gascity
diagnose`. This proves dispatch-to-claim/readback and diagnostics, not
autonomous provider completion of every task. On failure it keeps the temp root
and reports a typed blocker such as
`gascity-hook-no-visible-dispatch-work`,
`gascity-live-session-creating-without-claim`,
`gascity-live-execution-no-claim`, or
`gascity-live-beads-dolt-unavailable`.

`--live-complete` is the strict end-to-end completion probe. Run `pnpm build`
first when validating local source changes because `packages/waypoint-cli/src`
imports workspace packages through package exports, which resolve to the
ignored built `dist/` output at runtime. Live modes now enforce this with a
machine-readable `live_build_freshness` guard; stale builds fail at
`stage: build-freshness` before temp runtime state is created. This mode
follows the explicit dispatch path, waits for the routed Beads task to close
within `WAYPOINT_GASCITY_LIVE_COMPLETION_WAIT_MS`, records Beads
close/notes/comment signals, verifies Waypoint route/task/event readbacks, and
then dry-runs the next Gas City dispatch. The dry-run must select a new
executable task, find the route complete, or stop at an explicit gate/wait. It
retains temp state and reports typed blockers when provider completion, route
advancement, or cleanup cannot be proven.

The live smoke passes only if:

- route creation and metadata-only delegation return successfully;
- the routed Bead has `gc.routed_to=<target>`;
- no new session id appears after no-nudge delegation starts;
- no existing inactive session becomes active after no-nudge delegation; and
- `waypoint gascity diagnose` completes.

The live execution smoke passes only if:

- route creation returns with both `root_bead_id` and `dispatch_bead_id`;
- Gas City hook output includes at least one Waypoint route issue id for an
  active session agent candidate;
- Waypoint route readback succeeds;
- Waypoint task readback succeeds and exposes `metadata.beads.status` plus
  `metadata.beads.assignee` when the routed task has been claimed;
- `waypoint gascity diagnose` completes for the routed work;
- some Beads issue in the temp route is claimed or completed within
  `WAYPOINT_GASCITY_LIVE_EXECUTION_WAIT_MS`; and
- failures are classified with retained temp paths instead of being treated as
  successful execution.

The live completion smoke passes only if:

- the routed Beads task closes and exposes a close, notes, or comment signal;
- `waypoint tasks --route-id route-001 --json` reads that task as Waypoint
  `done` with raw Beads status `closed`;
- `waypoint route --route-id route-001 --json` advances past the completed
  node, marks the route complete, or stops on an explicit gate/wait;
- `waypoint route-events --route-id route-001 --json` remains readable;
- `waypoint gascity sling --dry-run --json` selects the next executable task,
  reports route completion, or refuses to bypass a gate/wait; and
- cleanup stops the temp city, stops the isolated Gas City supervisor with
  `gc supervisor stop --wait --json`, confirms the isolated supervisor is no
  longer running, and finds no temp-root processes; and
- failures retain temp paths with a typed blocker.

Typed live execution blockers and warnings:

- Gas City/Beads/Dolt can become unavailable during temp-store writes. The smoke
  reports this as `gascity-live-beads-dolt-unavailable`; inspect the retained
  temp project with `bd dolt status --json` and `bd doctor`.
- Dispatch can become hook-visible while provider sessions remain in startup and
  no Beads claim appears before the execution wait expires. The smoke reports
  this as `gascity-live-session-creating-without-claim` or
  `gascity-live-execution-no-claim`; inspect Gas City sessions/events before
  retrying or clearing assignments.
- Completion can also become hook-visible and even started without closing
  before the completion wait expires. The completion smoke reports this as
  `gascity-work-claim-released-after-start`,
  `gascity-live-task-claimed-not-completed`,
  `gascity-live-session-creating-without-completion`, or
  `gascity-live-completion-not-observed`; inspect the retained Beads issue,
  comments, sessions, and recent Gas City events before recovery.
- If the routed issue closes but Waypoint readback or next-dispatch probing
  does not prove route advancement, the smoke reports
  `waypoint-live-completion-readback-mismatch` or
  `waypoint-live-next-dispatch-probe-failed`.
- If route proof passes but cleanup cannot prove the isolated supervisor and
  temp-root provider processes are stopped, the smoke reports
  `gascity-live-cleanup` and keeps the temp root for inspection.
- After a Beads claim exists, the Beads assignee is the source of truth for the
  claim. If the assignee does not appear in the current Gas City session-list
  snapshot, diagnose emits the warning
  `gascity-work-assignee-not-in-session-list` instead of failing the run.
- Config-drift events and drained background sessions are scoped to the routed
  work. They are warnings unless they match the expected target or the task
  assignee; a matching inactive assignee remains
  `gascity-work-stranded-on-drained-assignee`.

On success the harness stops the temp city, stops the isolated supervisor,
verifies no temp-root processes remain, and removes the temp root. On failure it
keeps the temp root and prints retained paths plus command output for diagnosis.

Latest local evidence from May 29, 2026:

- Repeated `--live-complete` runs with `/tmp/gc-patched-bin/gc` version `1.1.1`
  closed routed tasks `wpl-t4x.1`, `wpl-bc9.1`, and `wpl-96k.1`, and each
  next-dispatch dry-run selected the following executable task.
- A follow-up cleanup proof closed `wpl-oh8.1`, dry-ran next dispatch to
  `wpl-oh8.2`, stopped the isolated supervisor, confirmed `running: false`, saw
  `process_count: 0`, and removed the temp root. The proof file is
  `/tmp/waypoint-gascity-cleanup-proof.json`.
- After installing the patched binary as `/opt/homebrew/bin/gc`, a no-override
  `--live-complete` run passed with `gc` version `1.1.1` and global
  `waypoint` version `0.1.2`: routed task `wpl-y66.1` closed, next dry-run
  selected `wpl-y66.2`, cleanup removed the temp root, and no temp supervisor
  or Dolt process remained. Raw proof:
  `/tmp/waypoint-gascity-global-proof.json`; summary:
  `/tmp/waypoint-gascity-global-proof-summary.json`.

Useful live timeout knobs:

```bash
WAYPOINT_GASCITY_LIVE_GC_INIT_TIMEOUT_MS=360000
WAYPOINT_GASCITY_LIVE_GC_STOP_TIMEOUT_MS=90000
WAYPOINT_GASCITY_LIVE_STORE_READY_TIMEOUT_MS=90000
WAYPOINT_GASCITY_LIVE_WAYPOINT_START_TIMEOUT_MS=240000
WAYPOINT_GASCITY_LIVE_MAX_BUFFER_BYTES=16777216
WAYPOINT_GASCITY_COMMAND_TIMEOUT_MS=240000
```

Current limitations:

- Diagnostics are report-only. Missing `gc.routed_to` metadata and route-scoped
  stranded assignments include candidate inspection or repair commands, but
  Waypoint does not mutate them automatically.
- Provider login/trust prompts remain provider-specific. If Codex or another
  provider opens an interactive prompt, Gas City can start a session while work
  still remains blocked.
- Gas City config drift, drained sessions, and supervisor health are external
  runtime concerns. Waypoint reports route-scoped failures as runtime blockers
  rather than Quest failures, and treats unrelated background session drift as
  advisory diagnostic context.
- Non-waking delegation is metadata-only. It makes the route visible to Gas
  City's work queries, but execution still requires an explicit nudge-enabled
  dispatch or an active Gas City controller/reconciler policy outside Waypoint.
- The first nudge-enabled integration delegates the current executable task and
  proves the next dispatch with a dry-run. Automatically looping through every
  task in a route, Formula export, and release packaging remain future work.
- This remains a development install. The global `waypoint` command is a pnpm
  link to this workspace's CLI package; release packaging/publishing is still
  separate from the local runtime proof.

Check status:

```bash
waypoint status
waypoint status --json
```

For Beads projects, status includes the Beads workspace readiness:

```text
route backend: beads
beads workspace: ready
beads path: /path/to/project/.beads
beads root issues: waypoint-abc
```

If the workspace is missing, status still succeeds and reports `beads action:`
with the next command to run. Start remains fail-closed until readiness is
healthy.

### 2. Choose and inspect bundled catalog content

If the operator says "set up a Waypoint Quest for this folder", first run:

```bash
waypoint quests
```

Then present the starter choices as folder setup options instead of assuming every folder should use the same Quest.

## Choosing a starter Quest

- `firmvault` — FirmVault
  - Best for: legal case workflow with evidence-backed FirmVault state.
  - Use when the folder is a personal-injury case file, needs document intake, legal-state facts, landmarks, and safe Wizard/FirmVault apply behavior.
- `waypoint` — Project Delivery
  - Best for: general project planning and execution.
  - Use when the folder is a normal project that needs objective clarification, planning, execution, verification, and shipping gates.
- `agile-delivery` — Agile Delivery
  - Best for: structured software delivery from PRD through sprint execution.
  - Use when the folder is a software/product delivery effort that benefits from PRD, architecture, epics/stories, readiness, sprint planning, story creation, and development loops.
- `product-sprint` — Product Sprint
  - Best for: product ideation, review, QA, and ship cycles.
  - Use when the folder is a founder/product/software sprint that benefits from discovery, strategy review, engineering/design/devex review, QA, gated ship preparation, and retro loops.
- `agentic-delivery` — Agentic Delivery
  - Best for: disciplined AI-assisted software delivery from idea through verified branch finish.
  - Use when the folder is a software project that should follow Superpowers-derived discipline: brainstorm first, write plans, execute with TDD/subagents, review, verify, and finish the branch under human gates.

After choosing an installed Quest, inspect the referenced Recipes:

```bash
waypoint recipes --quest waypoint
```

`waypoint quests` lists available bundled Quests, with primary starter Quests first. `waypoint recipes --quest waypoint` lists Recipes referenced by the `waypoint` Project Delivery Quest.

### 3. Start a Quest route

```bash
waypoint start --quest waypoint
```

This creates a route such as `route-001`, appends a `route.started` event, scaffolds local workstream/milestone/phase/plan YAML, and materializes local tasks.

Inspect route state:

```bash
waypoint routes
waypoint route --route-id route-001
waypoint route-events --route-id route-001
waypoint tasks --route-id route-001
```

### 4. Use task discussion locally

```bash
waypoint discuss --task-id task-003 --message "Clarify the acceptance criteria before planning."
```

Task discussion is stored locally. Agent-authored messages are recorded as agent-authored and do not recursively request auto-response.

### 5. Run safe autopilot

```bash
waypoint auto --route-id route-001
waypoint auto status
```

By default, autopilot uses the null runtime. It simulates Recipe/discussion tasks, writes runtime metadata, appends events, and stops at the first human gate instead of executing external commands.

### 6. Decide a gate

When autopilot blocks on a gate, approve or reject it explicitly:

```bash
waypoint gate --route-id route-001 --node plan-approval-gate --approve --note "Plan accepted."
```

You can also pause and resume a route, or resolve a Quest blocker after the missing input/artifact is supplied and then run autopilot again:

```bash
waypoint pause --route-id route-001 --reason "Waiting for owner review."
waypoint resume --route-id route-001
waypoint resume --route-id route-001 --resolve-blocker --note "Paralegal completed the missing medical chronology artifact."
waypoint auto --route-id route-001
```

### FirmVault case-state contract

For FirmVault cases, Waypoint owns a simpler product runtime state model instead of scraping arbitrary legacy folder layouts for workflow truth.

To create and activate a new PI case folder from a trusted cases root:

```bash
waypoint firmvault bootstrap --cases-root /path/to/cases --case-name "Smith v. Acme" --case-type personal-injury --start
```

`bootstrap` creates the canonical case folder, initializes Waypoint with the bundled `firmvault` Quest, installs the Quest/Recipe manifests, initializes `.waypoint/firmvault/` state, and starts the route when `--start` is present. It uses the folder backend unless `--backend beads` is supplied:

```bash
waypoint firmvault bootstrap --cases-root /path/to/cases --case-name "Smith v. Acme" --case-type personal-injury --backend beads --init-beads --start --json
```

With `--backend beads`, the case folder still receives the local FirmVault state files and manifest copies, while the route/task runtime is materialized in Beads and read back through the same `status`, `routes`, `route`, `tasks`, `auto`, `gate`, `resume`, `discuss`, and `route-events` command surfaces. Use `--init-beads` when the new case should own its Beads workspace; without it, `--start` requires an existing healthy Beads workspace at the cases root and fails before case creation if readiness is missing. For agent-initiated bootstrap, use the Hermes operator adapter's trusted `cases_roots` registry and route FirmVault new-case requests through the `paralegal` profile; see `docs/firmvault-new-case-bootstrap.md`.

To add a local document after bootstrap or case-state initialization:

```bash
waypoint firmvault add-document --source /path/to/local/file.pdf --kind medical-records --note "uploaded by client" --json
```

`add-document` copies the source file into `documents/inbox/`, appends an entry to `.waypoint/firmvault/documents.yaml`, and records a `firmvault.document.added` event in `.waypoint/firmvault/events.jsonl`. It is local-only: it does not send email, fax, portal messages, API calls, or trust-account actions, and it does not mark workflow landmarks complete solely because a file exists.

To attach the external FirmVault document-pipeline review state to an indexed document:

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr-opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/aaron/FirmVault/pulls/123 \
  --branch ingest/2026-05-08-deadbeef \
  --submitted-at 2026-05-08T12:00:00.000Z \
  --json
```

`document-handoff` updates only the matching entry in `.waypoint/firmvault/documents.yaml` and appends a `firmvault.document.handoff_updated` event. It records pipeline handoff/review state for the Python/Forgejo ingestion pipeline; it still does not satisfy legal workflow landmarks by itself.

For an existing FirmVault-style folder, initialize only the case-state contract:

```bash
waypoint firmvault init-case --case-type personal-injury --case-slug smith-v-acme
waypoint firmvault landmarks
waypoint firmvault landmarks --json
```

`init-case` creates `.waypoint/firmvault/` state files. Initial landmarks are deliberately false until explicit state fields and evidence paths satisfy them.

The supported FirmVault landmark projection currently includes the core case, intake, accident, provider, BI/PIP insurance, demand, negotiation, settlement, and distribution landmarks:

```text
case_setup_complete
full_intake_complete
accident_report_obtained
providers_setup
at_fault_insurance_identified
bi_lor_prepared
bi_lor_sent
bi_acknowledgment_checked
pip_track_active
pip_carrier_identified
pip_application_prepared
pip_lor_prepared
pip_application_filed
pip_lor_sent
pip_acknowledgment_checked
pip_approved
pip_status_checked
pip_benefits_exhausted
demand_sent
initial_offer_received
settlement_reached
final_distribution_complete
```

Each landmark is derived from YAML status fields and relative evidence paths that exist inside the case folder. If a status is complete but its evidence path is missing or unsafe, the landmark remains unsatisfied and `landmarks --json` returns a warning.

The Part Three doctor remains a read-only legacy/template inspection helper when no profile is supplied:

```bash
waypoint doctor firmvault --json
```

The paralegal profile mode checks local operator readiness without network calls or external sends:

```bash
waypoint doctor firmvault --profile paralegal --json --upgrade-plan
```

It verifies the configured `waypoint_cases` root, optional source `cases` root, paralegal skill path, bundled `firmvault-paralegal` operator manifest, case export script, and local smoke scripts. Use the doctor to inspect whether a folder resembles the starter FirmVault shape or whether the paralegal operator workspace is ready. Use `.waypoint/firmvault/` as the runtime source of truth for workflow progress.

## Waypoint Wizard adoption bridge

Waypoint Wizard is the safe bridge for messy source folders that do not already look like Waypoint cases. Source files remain wherever they are and are treated as read-only inputs. The Wizard creates markdown shadows under `.waypoint/shadows`, records frontmatter source pointers and hashes, stores PII masking metadata, asks one-question-at-a-time clarifications, and writes a reviewable `.waypoint/wizard/adoption-plan.yaml`.

For FirmVault, shadows and filenames do not satisfy legal facts. Only approved proposed facts are applied, and apply uses the existing FirmVault safe state APIs rather than hand-editing `.waypoint/firmvault/*.yaml`.

Typical command flow:

```bash
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
```

Concrete FirmVault shorthand:

```bash
waypoint wizard scan --source <source> --domain firmvault --json
waypoint wizard shadow --source <source> --target <case-root> --domain firmvault --json
waypoint wizard questions --case <case-root> --json
waypoint wizard answer --case <case-root> --question <id> --answer <text> --json
waypoint wizard plan --case <case-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
waypoint wizard apply --case <case-root> --plan .waypoint/wizard/adoption-plan.yaml --json
```

See `docs/waypoint-wizard.md` for the full operator guide.

## `.waypoint/` folder layout

A project-local folder host state tree looks like this:

```text
.waypoint/
  config.yaml                 # project opt-in, selected Quest, runtime config
  quests/                     # copied Quest manifests, e.g. waypoint.yaml
  recipes/                    # copied Recipe manifests used by the Quest
  lifecycle/
    workstreams.yaml
    milestones.yaml
    phases.yaml
    plans.yaml
  routes/
    route-001.yaml            # live route state, or compatibility route record when backend.route is beads
  events/
    route-001.jsonl           # append-only route event log
  tasks/
    tasks.yaml                # materialized task records
    task-003-discussion.jsonl # task-scoped discussion messages
  autopilot/
    runs.jsonl                # append-only autopilot run history
  firmvault/
    case.yaml                 # canonical case setup/status state
    client.yaml               # intake, contract, and HIPAA status + evidence
    accident.yaml             # accident report/liability state
    providers.yaml            # provider setup state
    insurance.yaml            # BI/PIP carrier, packet, acknowledgment, and exhaustion state
    demand.yaml               # demand package state
    negotiation.yaml          # offers and negotiation state
    settlement.yaml           # settlement and distribution state
    documents.yaml            # optional document index
    landmarks.yaml            # generated landmark projection cache
    events.jsonl              # append-only FirmVault state event log
```

Key path prefixes are `.waypoint/routes/`, `.waypoint/events/`, `.waypoint/tasks/`, `.waypoint/autopilot/runs.jsonl`, and `.waypoint/firmvault/`.

These files are intended to be readable and inspectable. A project may choose to commit or ignore `.waypoint/` depending on whether the route state is part of the repo's audit trail.

When `backend.route: beads`, `.waypoint/config.yaml`, installed manifests,
FirmVault state, and autopilot run history remain local. Route/task truth lives
in Beads issues and dependencies, with route events and discussions recorded as
Waypoint-tagged Beads comments.

## Runtime modes

### null runtime

The null runtime is the default. It does not execute external commands. Autopilot marks eligible tasks as simulated/done and blocks at human gate tasks.

### opt-in local runtime

The local runtime executes local commands only when `.waypoint/config.yaml` explicitly sets `runtime.recipe: local` with a command and optional args:

```yaml
runtime:
  recipe: local
  command: node
  args:
    - ./capture-runtime.mjs
    - ./payload.json
```

Safety rule: `runtime.recipe: local` executes local commands. Only enable it in a project folder where you control the command, arguments, and input script. The runtime sends a stable JSON payload on stdin and captures stdout, stderr, exit code, and signal in task runtime metadata.

## Reset workflow

For temporary smoke folders, reset by deleting local state:

```bash
rm -rf .waypoint
```

Then re-run:

```bash
waypoint init --quest waypoint
waypoint start --quest waypoint
```

Do not run folder-host smokes from your home directory unless you intentionally want a home-level `.waypoint/` folder.

## Limitations

- This is a private development package, not a globally published CLI.
- The direct Node TypeScript CLI path is the verified development smoke path.
- The bundled `waypoint` Quest is the Project Delivery (GSD) starter workflow; it does not make Waypoint itself a GSD clone.
- The null runtime is safe by default but does not produce real external agent work.
- The local runtime is intentionally opt-in because it executes local commands.
- Packaging, release polish, and final readiness cleanup are tracked separately from this guide.

## Beads smoke coverage

The test suite carries two Beads backend smokes:

- `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts` has a deterministic fake-`bd` smoke for command-boundary behavior.
- The same file has a real-`bd` smoke that runs when the `bd` binary is available. It creates a temp Beads workspace through `waypoint init --backend beads --init-beads`, verifies `status --json`, starts a route, runs autopilot until the route blocks at a real Beads gate, approves the gate, resumes, and verifies Beads-backed route events.

Run just those smokes with:

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts
```

Gas City command and diagnostic coverage is split between a deterministic smoke
script and mocked command-runner unit tests:

- `pnpm smoke:gascity-runtime` exercises the expected Gas City command/state
  contract and the metadata-only no-nudge route without starting Gas City,
  Beads, tmux, Dolt, or Codex.
- `pnpm smoke:gascity-runtime -- --live-preflight` additionally checks local
  availability of `gc`, `bd`, `dolt`, `flock`, and `codex` without mutating the
  Waypoint repository.
- `pnpm smoke:gascity-runtime -- --live --json` is an opt-in live probe. It
  creates a temp Waypoint project and temp Gas City city, registers the project
  as a suspended Gas City rig with `--start-suspended`, waits for the Gas
  City-owned Beads store, then runs `waypoint init --backend beads`,
  `waypoint gascity preflight`, `waypoint start --gascity
  --gascity-no-nudge`, and `waypoint gascity diagnose` when start returns. The
  no-nudge delegation step updates Beads route metadata rather than invoking
  `gc sling`, so any session startup observed in this smoke belongs to Gas City
  initialization or later controller behavior, not the Waypoint handoff. The
  live probe never writes into this repository. On failure it stops the temp
  city best-effort, keeps the temp root, and prints the retained path plus
  captured command output for diagnosis.
  Skip this mode in CI, on machines without a local `gc` supervisor setup, or
  anywhere it is not acceptable for Gas City to register a temporary city and
  install/start its local supervisor service. Use `--live-preflight` for a
  non-mutating dependency check. The live `gc init` step uses a 360 second
  timeout to match Gas City's documented 5 minute city readiness budget plus a
  small buffer. Waypoint Gas City commands are bounded by
  `WAYPOINT_GASCITY_COMMAND_TIMEOUT_MS` and the live start wrapper is bounded
  by `WAYPOINT_GASCITY_LIVE_WAYPOINT_START_TIMEOUT_MS`; override these only
  when diagnosing startup or delegation behavior.
- `pnpm smoke:gascity-runtime -- --live-execute --json` is the intentional
  dispatch probe. It creates the same temp setup as `--live`, omits
  `--gascity-no-nudge`, verifies a dispatch convoy id, runs `waypoint route`
  and `waypoint tasks` readback, runs `waypoint gascity diagnose`, and waits
  for a Beads claim/completion signal within
  `WAYPOINT_GASCITY_LIVE_EXECUTION_WAIT_MS` (default 60000ms). It is expected to
  wake or reuse Gas City provider sessions. The passing live contract proves
  dispatch, hook visibility, claim observation, readback, and diagnostics; it
  does not require the provider to complete every task. On failure it retains
  temp state and reports a typed blocker.
- `pnpm smoke:gascity-runtime -- --live-complete --json` is the intentional
  completion probe. Run `pnpm build` first for source-tree validation. It waits
  for the routed Beads task to close, verifies notes/comments and Waypoint
  route/task/event readbacks, then dry-runs the next Gas City dispatch to prove
  the route advanced to another executable task, completed, or stopped at a
  gate/wait. On failure it retains temp state and reports the typed blocker.
- `packages/waypoint-folder-host/src/gascity/*.test.ts` and
  `packages/waypoint-cli/src/commands/gascity.test.ts` cover command
  construction, route delegation, diagnostics, and CLI output through injected
  runners/readers.

```bash
pnpm smoke:gascity-runtime
pnpm smoke:gascity-runtime -- --live-preflight
pnpm exec vitest run packages/waypoint-folder-host/src/gascity packages/waypoint-cli/src/commands/gascity.test.ts
```

## Reference example

See [`examples/folder-host-quest/README.md`](../examples/folder-host-quest/README.md) for a copy/paste walkthrough that can be run from scratch.
