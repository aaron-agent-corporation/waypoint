# Waypoint

Waypoint is a host-agnostic, Postgres-backed durable workflow runtime for
TypeScript — in the family of Temporal or DBOS, but built around three
opinions:

1. **The workflow graph is SQL.** A Quest manifest compiles byte-for-byte into
   a pg_durable graph that runs inside your Postgres. No separate workflow
   server, no Kafka, no new infra: if you have Postgres 17 + the pg_durable
   extension, you have a durable engine.
2. **Workflows are authored as data.** Quests (DAGs of nodes, gates, deadline
   waits, repeats) and Recipes (the unit of agent/deterministic work) are YAML
   manifests in a catalog — diffable, reviewable, versionable in git. A prose
   compiler (`tools/prose/`) lets you write them in Markdown and compile to the
   same manifests.
3. **Humans are first-class nodes.** Review gates park a route until a person
   approves or rejects through the CLI; deadline waits arm a clock and a
   condition and take whichever resolves first; every decision is recorded as
   an event in the project's own schema.

## What a run looks like

```bash
waypoint init --quest runner          # project-local .waypoint/ + its own Postgres schema
waypoint start --quest runner         # compiles the quest into a pg_durable graph and starts it
waypoint bridge                       # the dispatcher: claims dispatches, runs recipes, signals outcomes
waypoint tasks --route-id route-001   # live task state
waypoint gate --route-id route-001 --node plan-approval-gate --approve
```

Each project gets an isolated schema (`waypoint_<slug>_<hash>`) by
construction — many projects share one Postgres without seeing each other.

## Layout

```
src/                          # @waypoint-engine/core — portable runtime contracts + catalogs
  envelope/                   # error envelope + validation-details normalization
  commands/                   # command grammar parser (/waypoint ... slash grammar)
  contracts/                  # host interfaces (event bus, clock/id, store)
  discussion/                 # task-scoped discussion metadata + auto-response contract
  authoring/                  # quest/recipe/handoff draft generators
  operators/, quests/, handoffs/, tools/  # manifest parsing + registries

packages/
  waypoint-cli/               # the `waypoint` CLI (@waypoint-engine/cli)
  waypoint-folder-host/       # the local folder host (@waypoint-engine/folder-host):
                              #   postgres stores, pg_durable compiler + bridge,
                              #   worker runtimes (pi, cordis, deterministic), sandboxing
  waypoint-kernel/            # sandboxed worker kernel (@waypoint-engine/kernel)
  waypoint-worker-tools/      # MCP tool surface for workers (@waypoint-engine/worker-tools)

quests/ recipes/ operators/ handoffs/   # bundled catalog content
tools/prose/                  # markdown → quest manifest compiler (+ lint, gate)
tools/safe-evidence/          # credential-masking pre-commit guard
examples/folder-host-quest/   # runnable Local folder host walkthrough
```

## Quick start

```bash
pnpm install
pnpm test             # vitest across core, CLI, folder host
pnpm typecheck
pnpm smoke:folder-host # temp-folder CLI smoke for the local folder host
```

Tests that exercise the durable engine need Postgres 17 with pg_durable —
point the suite at one with `WAYPOINT_POSTGRES_TEST_URL` /
`WAYPOINT_PGDURABLE_TEST_URL` (see `packages/waypoint-folder-host/src/testing/postgres.ts`).

See [`docs/waypoint-folder-host.md`](docs/waypoint-folder-host.md) for the
operator journey and the full command surface, and
[`examples/folder-host-quest/README.md`](examples/folder-host-quest/README.md)
for a runnable walkthrough.

## Runtime model

- `postgres` is the only route backend: route/task/event run state lives in
  the project's derived schema. The pg_durable engine drives execution by
  default; `--postgres-no-durable` opts into the plain autopilot-driven mode.
  Authored content (catalogs, lifecycle scaffold, discussion) stays in the
  project-local `.waypoint/` directory. Legacy folder projects move over with
  `waypoint migrate`.
- The **bridge** is the execution dispatcher: it LISTENs for dispatch inserts,
  claims them under leases, runs the recipe in the configured runtime (a
  sandboxed worker, a deterministic entrypoint, or the simulated/null runtime
  for walkthroughs), and signals the outcome back into the graph.
- Recipe work runs in **sandboxed workers** (microsandbox or sprites
  providers) with declared access roots, credential brokering, and egress
  policy — the guest never holds a real credential, only a placeholder.

## Extending Waypoint

The core ships extension points rather than domain content:

- **Artifact contracts** — `registerArtifactContract` declares the artifacts a
  recipe produces and how they're validated.
- **Deterministic entrypoints** — `registerDeterministicEntrypoint` runs
  fixed TypeScript steps with no agent in the loop.
- **Tool registry** — `registerWaypointTool` (src/tools/registry.ts) declares
  the MCP tools an operator may use, with side-effect classes and safety
  notes.
- **Quests and recipes** — author YAML (or prose) manifests and install them
  into a project with `waypoint author quest` / `waypoint author recipe`.

## Catalog docs

- Catalog: [`docs/runner-quest-catalog.md`](docs/runner-quest-catalog.md)
- Local folder host: [`docs/waypoint-folder-host.md`](docs/waypoint-folder-host.md) and [`examples/folder-host-quest/README.md`](examples/folder-host-quest/README.md)
- Operator guide: [`docs/quests/runner.md`](docs/quests/runner.md)
- Human-readable command map: [`docs/quests/runner-command-map.md`](docs/quests/runner-command-map.md)
- Machine-readable command map: [`docs/quests/runner-command-map.yaml`](docs/quests/runner-command-map.yaml)

The bundled `runner` Quest is the project-delivery starter: initialize →
discuss → plan → execute → verify → ship, with human gates at plan, verify,
and ship.

## Error envelope contract

Standard error shape across all Waypoint-hosted surfaces:

```json
{ "ok": false, "action": "error", "error": "...", "details": "optional" }
```

Validation `details` normalize to `{ code, path, message }` with `path` as a
dotted string (`$` for root).

## Compared to Temporal / DBOS

- **Temporal** runs a separate orchestration service cluster; Waypoint's
  execution graph is compiled SQL inside your Postgres via pg_durable.
- **DBOS** instruments your application process; Waypoint separates the host
  (your app) from the bridge (the dispatcher), so workers can be sandboxed
  agents, deterministic functions, or remote processes behind the same
  claim/lease protocol.
- Both are durable; Waypoint adds human gates, deadline waits, and
  discussion-thread state as first-class graph nodes rather than
  application-level signals.

## License

MIT — see [LICENSE](./LICENSE). Copyright (c) 2026 Aaron Whaley.
