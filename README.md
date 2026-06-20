# Waypoint

Host-agnostic lifecycle + workflow execution runtime. Waypoint is the unified system that combines lifecycle/intent modeling (workstreams, milestones, phases, plans) with executable DAG workflows (routes, nodes, recipes, review, gates, autopilot).

**Status:** extracted from [Mission Control](https://github.com/Whaleylaw/) as of the M5 portability milestone (May 2026). Mission Control is the first host/adapter — this repo contains the portable core and a reference minimal host.

## Layout

```
src/                          # @waypoint/core — portable runtime
  envelope/                   # error envelope + validation-details normalization
  commands/                   # command grammar parser
  contracts/                  # host interfaces (store, authz, event-bus, recipe-runtime)
  discussion/                 # task-scoped discussion metadata + auto-response contract
  routes/                     # route-key, scope primitives
  autopilot/                  # autopilot progress helpers
  boundaries.ts               # runtime guard — keeps core free of host-specific imports

examples/host-minimal/        # reference external host (no MC, no Next.js)
examples/folder-host-quest/   # runnable Local folder host walkthrough

docs/
  waypoint-runtime-design.md
  waypoint-envelope-parity-matrix.md
  waypoint-core-integration.md      # how to build a new host
  waypoint-operations-runbook.md
  plans/waypoint-modularization-plan.md
```

## Quick start

```bash
pnpm install
pnpm test             # runs vitest across core + example host
pnpm typecheck
pnpm smoke:folder-host # temp-folder CLI smoke for the local folder host
```

## Runtime modes

Waypoint can run the same Quest and Recipe catalog through multiple host
runtime paths:

- `folder` is the default route backend. It stores route/task state under the
  project-local `.waypoint/` directory.
- `beads` is an explicit route backend. It materializes route work as Beads
  issues and dependencies, with Dolt providing Beads' durable local database.
- Gas City is an optional execution supervisor over Beads-backed routes. It is
  not a third route backend and does not replace Waypoint's folder or Beads
  modes. Waypoint owns Quest/Recipe manifests, gates, route materialization,
  policy checks, and readback; Gas City owns city/rig/session/provider
  supervision.

The current local-main experiment keeps the Beads/Dolt remote configured in
`.beads/config.yaml` so new local Codex sessions can resume against the same
embedded Dolt-backed Beads graph. Treat that as local test configuration, not a
portable product requirement.

See [`docs/waypoint-folder-host.md`](docs/waypoint-folder-host.md) for the
folder, Beads, Gas City, and live-smoke command details.

## Engine host (resident run/watch/author API)

`@waypoint/engine-host` (`packages/waypoint-engine-host`) wraps `@waypoint/core`
+ `@waypoint/folder-host` as a resident process exposing the run + watch +
author command surface over a loopback HTTP + WebSocket API (the foundation for
the Waypoint desktop app and its Pi-powered orchestrator). Folder and Beads/Dolt
are both first-class. `pnpm smoke:engine-host` is the local check (run after
`pnpm build`).

Embed it in-process:

```ts
import { createEngineHost } from '@waypoint/engine-host'

const host = createEngineHost()
const { url, token } = await host.start() // loopback, ephemeral port, bearer token
await host.dispatch('workspace.open', { root: '/path/to/project', backend: 'folder' })
const run = await host.dispatch('run.start', { quest: 'waypoint' })
```

Or drive it over HTTP + WebSocket with the shipped client:

```ts
import { createEngineClient } from '@waypoint/engine-host'

const client = createEngineClient({ url, token })
await client.cmd('run.start', { quest: 'waypoint' })
const unsubscribe = await client.subscribe(['*'], (event) => console.log(event))
```

Raw HTTP (every request carries the bearer token):

```bash
curl -s -X POST "$URL/cmd/routes.list" -H "authorization: Bearer $TOKEN"
```


## Agent brain (Pi orchestrator)

The engine host can drive an LLM **agent brain** that authors Waypoint workflows
from natural language, runs them ad-hoc, and proposes promotion — all over the
same scoped command surface. The first brain is the
[`pi` coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
driven headless as a child process; a `FakeBrainAdapter` backs the tests and the
`pnpm smoke:agent-brain` check.

Runs are **asynchronous and watchable**. Author returns immediately; events
stream on an `agent:<sessionId>` topic:

```ts
const { sessionId } = await client.cmd('agent.author', { intent: 'Add a lint-fix recipe' })
const unsubscribe = await client.subscribe([`agent:${sessionId}`], (event) => console.log(event))
// or replay from a cursor: await client.cmd('agent.watch', { sessionId, sinceSeq: 0 })
```

One-call convenience (await the terminal result):

```ts
const result = await client.cmd('agent.run', { intent: 'Add a lint-fix recipe' })
// { sessionId, status: 'completed', summary, proposalId }
```

Commands: `agent.author` (async), `agent.run` (await), `agent.watch`,
`agent.list`, `agent.transcript`, `agent.cancel`. Cancel is **best-effort**:

```ts
await client.cmd('agent.cancel', { sessionId }) // SIGTERM→SIGKILL the run; cannot roll back committed side effects
```

### Environment

| Variable               | Who sets it                        | Default | Required when            |
| ---------------------- | ---------------------------------- | ------- | ------------------------ |
| `WAYPOINT_BRAIN`       | operator                           | `fake`  | set to `pi` for real Pi  |
| `WAYPOINT_PI_EXTENSION`| operator                           | —       | `WAYPOINT_BRAIN=pi`      |
| `WAYPOINT_HOST_URL`    | host → injected into the Pi child  | —       | always (auto)            |
| `WAYPOINT_HOST_TOKEN`  | host → injected into the Pi child  | —       | always (auto)            |

`WAYPOINT_HOST_URL`/`WAYPOINT_HOST_TOKEN` are injected by the host into the Pi
child; you do not set them. Selection is **fail-loud**: `WAYPOINT_BRAIN=pi` with
a missing or out-of-range `pi` CLI throws (problem+cause+fix) — it never silently
falls back to the fake. The active brain (`pi`|`fake` + version) is inspectable
via `meta.health` / `meta.version`.

### Real Pi

```bash
npm i -g @mariozechner/pi-coding-agent@0.55.x   # pinned range
pnpm build                                        # produces packages/waypoint-pi-extension/dist
export WAYPOINT_BRAIN=pi
export WAYPOINT_PI_EXTENSION="$PWD/packages/waypoint-pi-extension/dist/index.js"
```

### Scoped-token model

Each agent session gets a **per-session scoped token**; the host enforces its
grant at the command bus. The agent may author and propose, run ad-hoc, and read
routes/tasks — but it can **never** call `author.approveProposal` or
`workspace.open`, even via direct loopback. Landing a proposal stays a human
action (`author.approveProposal` with the unrestricted host token).

### Blast radius

Ad-hoc recipes execute as child processes **with the host process's privileges —
there is no sandbox or side-effect policy**. Execution is intentionally
*not* dry-run by default. Controls:

- `run.adhoc { dryRun: true }` materializes a route + tasks **without executing** — a preview.
- Recommended path: **author → inspect the proposal → run** (or dry-run first).
- `agent.watch` for live observability; `agent.cancel` to stop (best-effort, no rollback); the `agent:<id>` event log is the audit trail.
- Run the host as a low-privilege user, in a container, against a scratch workspace.

Disk footprint per session: the transcript at `.waypoint/agent/<id>.jsonl` and
the ad-hoc overlay catalog at `.waypoint/agent/<sessionId>/catalog/` (never the
live `.waypoint/quests|recipes`).

See [`packages/waypoint-pi-extension/src/README.md`](packages/waypoint-pi-extension/src/README.md)
for the extension + tool list.

## Quest and Recipe catalog

Waypoint includes a bundled GSD-inspired Quest and Recipe catalog as a portability example and batteries-included workflow library:

- Catalog: [`docs/waypoint-quest-catalog.md`](docs/waypoint-quest-catalog.md)
- Local folder host: [`docs/waypoint-folder-host.md`](docs/waypoint-folder-host.md) and [`examples/folder-host-quest/README.md`](examples/folder-host-quest/README.md)
- Operator guide: [`docs/quests/waypoint.md`](docs/quests/waypoint.md)
- Referral package Quest guide: [`docs/quests/referral-package.md`](docs/quests/referral-package.md)
- Human-readable command map: [`docs/quests/waypoint-command-map.md`](docs/quests/waypoint-command-map.md)
- Machine-readable command map: [`docs/quests/waypoint-command-map.yaml`](docs/quests/waypoint-command-map.yaml)

The `waypoint` Quest is the Project Delivery (GSD) starter Quest: it preserves the initialize → discuss → plan → execute → verify → ship loop as Waypoint manifests. It does not make GSD the runtime identity; Waypoint remains the unified runtime.

## Host contract

To embed Waypoint in a new system, implement these interfaces from `@waypoint/core`:

- `IWaypointStore` — persistence
- `IWaypointAuthz` — authn/authz
- `IEventBus` — event publish/subscribe
- `IRecipeRuntime` — recipe execution
- `IClock`, `IIdGenerator` — determinism + portability

See `docs/waypoint-core-integration.md` for the full integration guide and `examples/host-minimal/` for a working reference.

## Error envelope contract

Standard error shape across all Waypoint-hosted endpoints:

```json
{ "ok": false, "action": "error", "error": "...", "details": "optional" }
```

Zod-style validation `details` normalize to `{ code, path, message }` with `path` as dotted string (`$` for root).

## Relationship to GSD

Waypoint is the evolution of Mission Control's internal GSD lifecycle system. GSD is historical inspiration and compatibility naming in some legacy tables/paths — not the product name going forward. Waypoint is the unified runtime.

## License

MIT — see [LICENSE](./LICENSE).
