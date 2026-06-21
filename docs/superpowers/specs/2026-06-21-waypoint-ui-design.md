# Waypoint UI (Slice 3, MVP) — Design

**Status:** Approved design (slice 3 of 3 — MVP scope)

**Builds on:** slice 1 (`@waypoint/engine-host`, shipped) + slice 2 (Pi agent
brain, shipped, HEAD `bf72874`). Consumes the engine's loopback HTTP+WS command
+ event contract.

**Goal:** A web UI for **observability + agent chat** — watch routes/tasks/gates
and a route DAG update live, and drive the Pi agent (author → run → propose)
from a chat panel — talking to a separately-started engine host over loopback
HTTP+WS through a Vite dev proxy.

**Tech stack:** React 18 + Vite + TypeScript (ESM), `@xyflow/react` (React Flow)
for the DAG, Zustand for the live store, Vitest + React Testing Library.

---

## Context: the three-slice plan

The larger Waypoint desktop app decomposes into: (1) engine host + local API
[shipped], (2) Pi agent brain [shipped], (3) **Tauri shell + web UI** [this
slice]. The original slice-3 vision is DAG/route/task/gate visualization, run
controls, agent chat, and the authoring/promotion experience.

This spec deliberately narrows slice 3 to an **MVP**: the **web UI** for
**observability + agent chat**, built **browser-first** against the existing
loopback transport. The Tauri desktop shell and the remaining capabilities
become follow-on specs.

## Scope

**In scope:**
- Connect to a running engine host and show engine + workspace status; open a
  workspace by path when none is open.
- Routes list + agent-sessions list.
- Route **DAG** (React Flow) for the selected route + task/gate detail.
- **Live** event streaming (routes + agent transcripts) over WebSocket.
- Agent **chat**: author (async), watch the streamed transcript, cancel; surface
  the terminal result's `proposalId` / `adhocRouteId` inline.

**Out of scope (explicitly deferred to later slices):**
- The **Tauri shell** (Rust shell, sidecar lifecycle, bundling) and the Tauri
  IPC transport.
- **Manual run controls** — `run.start`, `run.pause`, `run.resume`, gate
  approve/reject.
- **Proposal browser + approval UI** (`author.approveProposal`) and any
  authoring forms.
- Playwright/e2e and visual-regression testing.

**Non-goals:** no changes to the engine host or folder/beads cores. The MVP is
built entirely on the existing command + event surface. (One consequence: there
is no proposal-listing command, which is why proposals are surfaced only in the
chat — see Components → AgentChat.)

## Key decisions captured during brainstorming

- **MVP capability set:** observe + agent chat (not run controls, not
  authoring/promotion UI).
- **Shell sequencing:** **web UI first**; defer the Tauri shell to its own slice.
  The UI logic is shell-agnostic; the shell is mostly packaging.
- **UI stack:** React 18 + Vite + `@xyflow/react` + Vitest/RTL. React Flow is
  purpose-built for the route/DAG visualization.
- **UI↔engine link:** a **Vite dev proxy** reads the engine handshake file and
  forwards `/cmd` + `/ws` to the engine, **injecting the bearer token
  server-side**. No token in browser JS, no CORS, zero engine changes. The proxy
  seam mirrors how a future Tauri shell will inject credentials.
- **Proposals:** surfaced **in the chat only** (the agent result + transcript
  carry `proposalId` / `adhocRouteId`). No proposal browser, no approve button,
  no new engine commands. Ad-hoc routes still appear in the route list/DAG
  automatically because they materialize in the workspace.
- **Layout:** **three-pane console** — left: routes + sessions; center: DAG +
  task detail; right: agent chat. Both observability and chat are first-class.
- **State management:** **Zustand** (a small live store the WS patches) over
  React Query, because the dominant pattern is server-pushed events rather than
  request/response caching.

## Architecture & package layout

New workspace package `packages/waypoint-ui/` (Vite + React + TS). Depends on
`@waypoint/engine-host` for **types only** (envelope + event record types) and
on `@xyflow/react`.

```
packages/waypoint-ui/
  package.json
  vite.config.ts          # dev server + proxy plugin (handshake → token injection)
  index.html
  src/
    main.tsx
    App.tsx
    engine/
      client.ts           # browser EngineClient (fetch + native WebSocket)
      types.ts            # re-export EngineEnvelope / AgentEventRecord / WaypointFolderRoute|Task types
    store.ts              # Zustand store: connection, workspace, routes, tasks, sessions, transcripts, events
    graph/
      build-graph.ts      # tasks -> React Flow nodes+edges (wave/phase order; blockers when present)
    components/
      ConnectionGate.tsx
      RoutesPanel.tsx
      RouteGraph.tsx
      TaskDetail.tsx
      AgentChat.tsx
    test/
      fake-client.ts      # FakeEngineClient implementing the client interface for component tests
```

Each unit has one responsibility and a narrow interface: `engine/client.ts`
owns transport; `store.ts` owns state + event reduction; `graph/build-graph.ts`
is a pure transform (tasks → nodes/edges) testable in isolation; each component
renders one pane from the store and issues commands through the client.

## Data layer (the UI↔engine seam)

### Vite dev proxy + handshake

A Vite plugin in `vite.config.ts`, at dev-server start:
1. Reads the handshake file at the path given by `WAYPOINT_ENGINE_HANDSHAKE`
   (the same env var the engine host writes to — see `bin.ts`; the record
   carries `{ url, token, port, pid, ... }`). There is no magic default path:
   if `WAYPOINT_ENGINE_HANDSHAKE` is unset, the plugin logs setup guidance (set
   the var, start the engine host) and the proxy stays inert. The dev README
   documents the one-time setup (export the var, run the engine host).
2. Configures `server.proxy` so `/cmd` and `/ws` forward to the engine `url`,
   with `ws: true` for the socket and an `Authorization: Bearer <token>` header
   injected on proxied requests (and on the WS upgrade).
3. If the handshake is missing/unreadable or the engine is down, the dev server
   still starts; the UI shows a clear "engine not reachable — start the engine
   host first" state with the resolved target.

The browser therefore talks to **same-origin** `/cmd` and `/ws`; the token lives
only in the Vite process. No engine changes, no CORS.

### Browser EngineClient (`engine/client.ts`)

Mirrors the shape of the existing Node `createEngineClient` but browser-native:

```ts
export interface BrowserEngineClient {
  cmd(name: string, payload?: unknown): Promise<EngineEnvelope>
  subscribe(topics: string[], onEvent: (event: EngineEventMessage) => void): () => void
}
export function createBrowserEngineClient(opts?: { baseUrl?: string }): BrowserEngineClient
```

- `cmd` → `fetch('/cmd/' + name, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload ?? {}) })`, returns the parsed `EngineEnvelope`. No auth header (the proxy injects it).
- `subscribe` → `new WebSocket((location.origin.replace(/^http/,'ws')) + '/ws')`; on open, send `{ subscribe: { topics } }`; on message, parse and forward `type === 'event'` messages. Returns an unsubscribe that closes the socket. Reconnects with backoff; the store reflects connection status.

## Components (three-pane console)

```
┌──────────┬──────────────────────────┬────────────┐
│ Routes   │  Route DAG / Tasks       │ Agent Chat │
│ Sessions │  + task/gate detail      │            │
└──────────┴──────────────────────────┴────────────┘
```

- **ConnectionGate** — reads `meta.health` (brain pi|fake + version, seq,
  uptime) and `workspace.status`. If no workspace is open, shows a path input
  that calls `workspace.open { root, backend:'folder' }`. Wraps the app; the
  panes render once connected + a workspace is active.
- **RoutesPanel (left)** — routes from `routes.list` (id, quest, status dot) and
  agent sessions from `agent.list` (id, intent, status). Selecting a route
  drives the center; selecting/creating a session drives the chat.
- **RouteGraph (center-top)** — React Flow DAG of the selected route's tasks
  (`tasks.list { routeId }`). Nodes = tasks, colored/iconed by `kind`
  (recipe/gate/checkpoint/discussion/…) and `status`
  (open/in_progress/blocked/done/failed/cancelled). Edges from
  `graph/build-graph.ts`: ordered by `wave` within `phase` for the folder
  backend; from task `blockers` when present (beads). Clicking a node selects it.
- **TaskDetail (center-bottom)** — the selected task/gate: status, plan_ref,
  phase/wave, metadata, and autopilot output when present.
- **AgentChat (right)** — pick an existing session or start a new one. The input
  calls `agent.author { intent }` (async) and the store subscribes to that
  session's events. Renders the transcript: assistant messages
  (`agent.message`), tool calls (`agent.toolcall`) and results
  (`agent.tool_result`), and the terminal result (`agent.end`) including
  `proposalId` / `adhocRouteId`. A **Cancel** button calls
  `agent.cancel { sessionId }`. On first load it can replay via
  `agent.transcript`/`agent.watch` so a refresh restores history.

## Live event flow

On connect the store calls `subscribe(['*'])` (the hub matches all topics). The
event reducer routes by topic:
- `route.*` / route-runtime events → mark the affected route dirty and refetch
  its tasks (and `routes.list` for status changes). Simpler and correct vs.
  applying per-field deltas; route graphs are small.
- `agent:<sessionId>` events → append the `AgentEventRecord` to that session's
  transcript in the store; update the session's status on terminal events.

A monotonic `seq` (carried on every `EngineEvent`) guards ordering and dedupes
replays. A dropped socket → reconnect with capped backoff; on reconnect the
store refetches `routes.list` + `agent.list` and re-subscribes, so the UI
self-heals without a page reload.

## Error handling

- Command failures return the canonical envelope; `ok === false` surfaces an
  inline error built from `details.{code, path, message}` (e.g. a bad
  `workspace.open` path → `VALIDATION` with `path: 'root'`).
- A missing/unreachable engine (no handshake, refused connection) → a top-level
  "engine not reachable" state with the resolved proxy target and a retry.
- WS disconnect → a visible "reconnecting…" indicator in ConnectionGate.
- The UI uses the unrestricted token via the proxy, so scoped/FORBIDDEN errors
  do not arise; a `401` indicates a stale handshake/token and is reported as
  "engine token rejected — restart the engine host."

## Testing

- **Component tests (Vitest + RTL):** each component against a
  **`FakeEngineClient`** implementing the `BrowserEngineClient` interface, with a
  scripted event feed. Covers: routes/sessions render, DAG builds from tasks,
  task selection → detail, chat author → streamed transcript → terminal result
  with `proposalId`, cancel.
- **Pure-unit:** `graph/build-graph.ts` (tasks → nodes/edges) and the store's
  event reducer, tested directly with fixtures.
- **One integration test:** `engine/client.ts` against a **real in-process
  engine host** (Node `fetch` + `ws`, fake brain adapter) proving `cmd` and
  `subscribe` round-trip end-to-end (no browser/proxy needed — exercises the
  client logic against the real command/event contract).
- **Smoke:** `scripts/ui-smoke.mjs` (root `smoke:ui`) starts an engine host with
  the fake brain, drives the engine-client data layer headlessly
  (open workspace → run an agent session → assert routes/tasks/transcript), and
  exits — the slice's parity check, matching the other slices' smokes.
- Build-system wiring: `tsconfig.json` path + `vitest.config.ts` include for the
  new package; a root `dev:ui` script (`vite` in the package).

## File / responsibility summary

| File | Responsibility |
| ---- | -------------- |
| `vite.config.ts` (proxy plugin) | Read handshake, proxy `/cmd`+`/ws`, inject token |
| `engine/client.ts` | Browser transport: `cmd` + `subscribe` |
| `store.ts` | Live state + event reduction (Zustand) |
| `graph/build-graph.ts` | Pure tasks → React Flow nodes/edges |
| `components/ConnectionGate.tsx` | Engine/workspace status + open-workspace |
| `components/RoutesPanel.tsx` | Routes + sessions lists |
| `components/RouteGraph.tsx` | React Flow DAG of the selected route |
| `components/TaskDetail.tsx` | Selected task/gate detail |
| `components/AgentChat.tsx` | Author/watch/cancel + transcript rendering |
| `test/fake-client.ts` | Deterministic client for component tests |

## Open questions / risks

- **DAG edges for the folder backend** are derived (wave/phase ordering), not
  first-class dependencies; this is a presentation heuristic. Beads routes carry
  real `blockers`. The MVP renders both; richer dependency edges can come with
  run controls in a later slice.
- **Topic wildcard:** the MVP assumes `subscribe(['*'])` receives both route and
  `agent:*` events. If the hub requires explicit topic prefixes, the store will
  instead subscribe to route topics plus per-open-session `agent:<id>` topics.
  (To verify against the slice-1 hub during implementation.)
- The **Tauri shell** remains the obvious next slice; this MVP's proxy/handshake
  seam is intentionally shaped so the shell can replace the Vite proxy as the
  credential-injecting host with minimal UI change.
