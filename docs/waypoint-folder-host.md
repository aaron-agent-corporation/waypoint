# Waypoint folder host

The Waypoint folder host runs a Quest against a normal project directory — the "folder" in the name is the project folder it operates on. Authored content (Quest/Recipe catalogs, lifecycle scaffold, task discussion, autopilot history) lives in a human-readable `.waypoint/` folder; route/task/event RUN STATE lives in the project's own schema on a local Postgres (each project gets an isolated schema by construction). The journey is exposed through the development CLI in `packages/waypoint-cli/src/bin.ts`.

This is a private development package and not a globally published CLI. The examples below use `runner ...` as shorthand for the direct Node entrypoint when you are running from this repository.

## What the folder host does

- initializes a project-local `.waypoint/` directory;
- installs Quest and Recipe manifests into the project — the bundled scaffold catalog, or your own;
- starts a live route for a quest and persists route/task/event run state to the project's postgres schema;
- compiles the quest's plan graph into a durable `pg_durable` SQL workflow (default), or runs plain (`--postgres-no-durable`) for a walkthrough without the extension;
- pauses/resumes routes and records human approve/reject decisions at gates;
- advances durable runs through the engine + dispatch bridge; `waypoint auto` survives only for plain (`--postgres-no-durable`) projects and tests;
- runs Recipes through an explicitly configured runtime — the safe null runtime by default, `--simulated` for walkthroughs, or a sandboxed worker runtime you provision.

It does not claim global installation, package publishing, cloud sync, or production packaging yet.

## Quickstart

From this repository, run the CLI by absolute path from a temporary project directory:

```bash
mkdir -p /tmp/my-project && cd /tmp/my-project
node /path/to/waypoint/packages/waypoint-cli/src/bin.ts init --quest runner
node /path/to/waypoint/packages/waypoint-cli/src/bin.ts start --quest runner
node /path/to/waypoint/packages/waypoint-cli/src/bin.ts tasks --route-id route-001
```

With the provisioned shim on PATH the same journey is shorthand: `waypoint init --quest runner`, `waypoint start --quest runner`, `waypoint tasks --route-id route-001`.

The bundled `runner` quest is the neutral lifecycle skeleton — initialize → discuss → plan → execute → verify → ship, with human gates at plan, verify and ship. It ships as infrastructure, not as a workflow anyone is offered: every plan is a checkpoint except the discuss step, which opens a task-scoped conversation with the operator.

## Choosing or authoring a Quest

The bundled catalog intentionally ships almost nothing: one scaffold quest and one discussion recipe. The catalog is an extension point, not a product surface.

- If the operator says "set up a Waypoint Quest for this folder", the honest answer is the `runner` scaffold — a lifecycle skeleton with human gates — unless the host embedding the runner has installed its own quest catalog into the project.
- Hosts author their own quests as YAML manifests (or in `.prose` compiled byte-for-byte by `tools/prose/compile.py`) and install them under `.waypoint/quests/` with their recipes under `.waypoint/recipes/`. `waypoint author quest` / `waypoint author recipe` scaffold drafts; `waypoint quests` and `waypoint recipes` list what a project actually has.

## Run state layout

- `.waypoint/config.yaml` — project config: selected quest, backend, runtime, sandbox policy.
- `.waypoint/quests/`, `.waypoint/recipes/` — installed authored manifests.
- `.waypoint/tasks/` — task discussion JSONL.
- `.waypoint/autopilot/runs.jsonl` — plain-mode autopilot history.
- `.waypoint/reports/<route-id>/` — run dossiers (`waypoint dossier`).
- Postgres, one schema per project — routes, tasks, events, gates, dispatch rows; durable runs also hold the `pg_durable` engine instance state.

## Runtime safety

Recipe dispatch is off unless the project opts in:

- the default is the null runtime: recipe plans park, nothing executes;
- `runtime.recipe: null` in `.waypoint/config.yaml` (written by `--simulated`) is the explicit walkthrough opt-in;
- `runtime.recipe: local` executes local commands — only when `.waypoint/config.yaml` explicitly says so;
- a production worker runtime runs recipes in a sandboxed, egress-denied worker with a file-based claim protocol — admission, provisioning, and egress policy are all checked before the first route row exists.

## Command surface

Every verb the CLI implements, copied from `--help` (the docs test diffs this list against the dispatch):

```text
waypoint --help
waypoint --version
waypoint init [--quest <slug>] [--postgres-url <url>] [--postgres-schema <schema>] [--postgres-no-durable]
waypoint migrate [--json]
waypoint provision     (write the version-matched CLI shim into ~/.waypoint/bin so workers spawned under
waypoint status [--json]
waypoint quests
waypoint recipes [--quest <slug>]
waypoint recipes refresh [--quest <slug>] [--adopt]
waypoint start [--quest <slug>] [--json]
waypoint adhoc --recipe <slug> [--produces <path>]... [--contract <name>] [--access <binding>:ro|rw]... [--title <text>] [--dry-run]
waypoint tier-report [--json]
waypoint providers [--json]
waypoint workers [--json]
waypoint dossier --route-id <id> [--session <conv-id>]... [--note <text>]... [--console-url <url>] [--json]
waypoint routes [--json]
waypoint route --route-id <id> [--json]
waypoint route cancel --route-id <id> [--reason <text>]
waypoint route reap [--stale-hours N] [--cancel] [--json]
waypoint route-events --route-id <id> [--limit N] [--offset N] [--json]
waypoint tasks [--route-id <id>] [--json]
waypoint tasks retry --task-id <id>
waypoint tasks show <task-id> [--json]
waypoint tasks report <task-id> --status finished|failed --summary <text> [--evidence key=value]...
waypoint discuss --task-id <id> [--message <text>] [--author user|agent]
waypoint auto [--route-id <id>] [--max-iterations N] [--json]
waypoint bridge [--once] [--json] [--concurrency <n>] [--idle-exit-s <n>]
waypoint auto status [--limit N] [--offset N] [--json]
waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
waypoint pause --route-id <id> [--reason <text>]
waypoint resume --route-id <id> [--resolve-blocker] [--note <text>]
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
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
```

`waypoint --help` prints the same list with per-verb notes.

## Reset

A project's runner state is disposable: `rm -rf .waypoint` (plus the project's postgres schema) resets it completely. The example project under `examples/folder-host-quest/` documents the same journey end to end.

## Limitations

- Development CLI only — not a globally published CLI; install from this repo (`waypoint provision` writes a shim into `~/.waypoint/bin`).
- Durable runs require Postgres with the `pg_durable` extension; plain mode (`--postgres-no-durable`) runs without it.
- The bundled catalog is a scaffold, not a workflow library — the runner is meant to be embedded by a host that authors its own quests.
