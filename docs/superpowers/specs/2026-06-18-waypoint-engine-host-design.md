# Waypoint Engine Host + Local API — Design Spec

**Date:** 2026-06-18
**Status:** Approved design (slice 1 of 3)
**Author:** Brainstormed with Aaron Whaley

---

## Context

Waypoint is a host-agnostic TypeScript runtime — a "spine" for lifecycle +
workflow execution — currently exposed as `@waypoint/core` (portable engine),
`packages/waypoint-cli` (operator surface), and `examples/host-minimal` (a
reference host). It is deliberately a library/plugin: **no resident service, no
LLM-driven brain, and no UI.** Backends are folder / Beads-Dolt / Gas City.

The larger goal is a **Waypoint desktop app** with:

1. An **Orchestrator** — a deterministic execution engine for static/promoted
   workflows, plus an **LLM agent brain** (powered by **Pi / pi.dev**) that
   authors ad-hoc workflows which can be **promoted to static** workflows.
2. A **frontend** — a **Tauri** desktop app (Rust shell + Node sidecar + web UI
   in the webview).

This is too large for one spec, so it is decomposed into three sub-projects,
each with its own spec → plan → implementation cycle:

1. **Engine host + local API** *(this spec)* — the resident sidecar that wraps
   `@waypoint/core` and exposes the full run/watch/author contract with live
   state streaming. Foundation the other two consume.
2. **Pi agent brain** — Pi SDK loop in the sidecar, Waypoint authoring +
   runtime exposed as Pi tools; ad-hoc authoring → run → propose promotion.
3. **Tauri shell + web UI** — DAG/route/task/gate visualization, run controls,
   agent chat, authoring/promotion experience.

This spec covers **slice 1 only**.

### Key decisions captured during brainstorming

- **Orchestrator nature:** hybrid — deterministic engine runs static/promoted
  workflows; Pi-powered LLM brain authors ad-hoc workflows that can be promoted.
- **System shape:** desktop app.
- **Desktop shell:** **Tauri** (Rust shell, Node engine + agent as a bundled
  sidecar over IPC/stdio).
- **Agent brain:** **Pi (pi.dev)** via its **SDK / library**, run in-process in
  the Node sidecar. *(Assumption to verify — see Open Questions.)*
- **API transport:** **loopback HTTP + WebSocket now**, with a designed
  migration path to **Tauri IPC** later.
- **First slice:** engine host + local API, **full run + watch + author**
  contract.
- **Backends:** both **folder** and **Beads/Dolt** are **first-class, fully
  tested** in slice 1. Beads gives the simple issue/dependency graph; Dolt makes
  it Git-backed, versioned, branchable SQL. Folder remains the zero-setup
  default; the full lifecycle suite runs against **both**.

---

## Purpose, goals, non-goals

**Purpose.** Create a resident process (`@waypoint/engine-host`) that
instantiates a Waypoint host (folder or Beads backend) and exposes the full
**run + watch + author** contract over a transport-agnostic command/event core,
with a **loopback HTTP + WebSocket** adapter as the first transport.

### Goals

- One long-running process that owns a Waypoint workspace and its backend
  lifecycle.
- A typed **command bus** (request → envelope response) + **event stream** (live
  route/task/gate state) defined independently of transport.
- HTTP+WS adapter on `127.0.0.1` (free/random port, token-guarded).
- Endpoints covering catalog (quests/recipes), run (start/resume/route/task/
  gate), watch (live events), and author (wrapping existing `authoring/`
  generators).
- Fully testable headless (no Tauri, no Pi) via fetch/WS in vitest.
- Reuse `@waypoint/core` contracts + `@waypoint/folder-host`; no host-specific
  logic leaks into core (respect `src/boundaries.ts`).

### Non-goals (this slice)

- No Pi/LLM intelligence (slice 2). Author endpoints expose deterministic
  generators only.
- No Tauri shell or web UI (slice 3) — but the command/event core is designed so
  Tauri IPC becomes a drop-in second adapter.
- No new backend type beyond what core already provides. Folder and Beads/Dolt
  are both in scope and first-class; Gas City supervision is out of scope here.

---

## Architecture & process model

```
┌─────────────────────── engine-host (Node sidecar) ───────────────────────┐
│                                                                            │
│   Transport adapters          Command/Event core           Waypoint host  │
│  ┌──────────────────┐        ┌────────────────────┐      ┌──────────────┐ │
│  │ HTTP+WS (slice 1)│ <────> │  CommandBus        │ ───> │ @waypoint/   │ │
│  │ Tauri IPC (later)│        │  (run/watch/author)│      │ folder-host  │ │
│  └──────────────────┘        │  EventHub          │ <─── │  + core      │ │
│                              └────────────────────┘  IEventBus           │ │
│                                                          IWaypointStore   │ │
│                                                          IRecipeRuntime   │ │
└────────────────────────────────────────────────────────────────────────┘
```

- **Command/Event core** is pure: a `CommandBus` (named commands → `{ok,...}`
  envelopes, reusing the existing error-envelope contract) and an `EventHub`
  that fans out `WaypointEventRecord`s from the host's `IEventBus`. It knows
  nothing about HTTP.
- **Transport adapters** translate wire ↔ core. HTTP+WS is the only one in this
  slice; the boundary is what makes the later Tauri IPC migration mechanical.
- **Workspace session** binds to one active workspace (folder root / Beads
  workspace) and can be re-pointed (`workspace.open`) without restarting the
  process.
- Lives as a new workspace package: `packages/waypoint-engine-host` (sibling to
  `waypoint-cli`, `waypoint-folder-host`).

---

## Command / endpoint surface

Every command is transport-agnostic (`name + payload → envelope`). The HTTP+WS
adapter maps each to `POST /cmd/<name>` (the watch family uses the WS channel).
All responses use the existing envelope shape `{ ok, action, ... }` /
`{ ok:false, action:"error", error, details }` with Zod-style validation details
normalized to `{ code, path, message }`. Commands map onto operations the CLI
already performs, so the engine reuses that logic rather than reinventing it.

### Workspace / lifecycle

- `workspace.open` `{ root, backend: "folder"|"beads", initBeads? }` —
  bind/initialize the active workspace
- `workspace.status` — current workspace, backend, health (mirrors
  `waypoint status` / `doctor`)

### Catalog (read)

- `catalog.quests` — list quest manifests
- `catalog.recipes` `{ quest? }` — list recipe manifests

### Run / watch

- `run.start` `{ quest, backend? }` — start a quest (≈ `waypoint start`)
- `routes.list` / `route.get` `{ routeId }` / `route.events`
  `{ routeId, limit?, offset? }`
- `tasks.list` `{ routeId? }`
- `run.resume` `{ routeId }` / `run.pause` `{ routeId }`
- `gate.decide` `{ routeId, gateId, decision, note? }` (≈ `waypoint gate`)
- `discuss.post` `{ taskId, message, author }` (task-scoped discussion already in
  core)

### Author (deterministic generators, no LLM)

- `author.quest` `{ spec }` → `quest-generator`
- `author.recipe` `{ spec }` → `recipe-generator`
- `author.designSpec` `{ input }` → `design-spec-generator`
- `author.handoff` `{ input }` → `handoff-generator`
- `author.draft` `{ ... }` → `draft` (questionnaire-driven scaffolding)
- `author.promote` `{ draftId | adhocRef }` — **stub in this slice**: validates +
  writes an ad-hoc draft into the static `quests/`·`recipes/` catalog location
  and returns the manifest path. The Pi brain that *decides* what to promote
  arrives in slice 2; the deterministic write path lands here so promotion is
  testable from day one.

---

## Event / streaming model

- The host's `IEventBus` is the single source of live truth. `EventHub`
  subscribes once and re-broadcasts `WaypointEventRecord`s to all connected
  clients.
- **WS protocol**: client sends `{ subscribe: { topics: ["routes","tasks",
  "gates","route:<id>"] } }`; server pushes `{ type:"event", topic, record }`. A
  `{ type:"snapshot" }` is sent on subscribe so a fresh client gets current
  state before deltas (no missed-event races).
- **Resumable**: each event carries a monotonic seq; a reconnecting client sends
  `lastSeq` to replay the gap from the store's event log (`route.events` already
  paginates).
- **Backpressure**: per-client bounded queue; on overflow the client is told to
  re-snapshot rather than the host blocking.
- This same EventHub feeds the in-process Pi agent later (it subscribes
  directly, bypassing the wire).

---

## Module boundaries & files

New package `packages/waypoint-engine-host/`:

```
src/
  core/
    command-bus.ts        # name → handler registry, envelope wrapping
    event-hub.ts          # IEventBus fan-out, seq, snapshot, backpressure
    workspace-session.ts  # active host binding (folder/beads), open/close
    commands/             # one file per command group: catalog, run, author, gate...
  transport/
    http-ws/
      server.ts           # 127.0.0.1 listener, token guard, route → command-bus
      ws.ts               # subscribe protocol, snapshot/delta push
    transport.ts          # adapter interface (the seam Tauri IPC implements later)
  index.ts                # createEngineHost(config) → { start, stop, bus }
  bin.ts                  # standalone launcher (runs headless / as sidecar)
__tests__/                # vitest: command bus, event hub, http+ws e2e
```

- Each command group is a thin, independently testable mapper: wire payload →
  existing core/folder-host/authoring call → envelope. No business logic
  duplicated from core.
- `transport.ts` defines the single interface (`registerCommand`, `pushEvent`)
  both HTTP+WS and the future Tauri IPC implement — the explicit migration seam.
- Respects `src/boundaries.ts`: this package depends on core + folder-host; core
  gains nothing host-specific.

---

## Security

- Listener bound to `127.0.0.1` only.
- A per-process bearer token (generated at start, written to a known local path
  for the sidecar/UI to read) required on every HTTP request and the WS
  handshake. Prevents other local processes / browsers from driving the engine.
- No remote exposure in this slice.

---

## Testing strategy

- **Unit**: command-bus envelope behavior (success + error normalization),
  event-hub seq/snapshot/backpressure, workspace-session open/switch.
- **Integration (headless)**: boot `createEngineHost` on an ephemeral port and
  drive the full lifecycle over real HTTP+WS — `workspace.open → run.start →
  routes.list → watch deltas → gate.decide → author.recipe → author.promote` —
  asserting envelopes and streamed events. **Run the full suite against both a
  temp folder workspace and a temp Beads/Dolt workspace** (parameterized
  backend), so the resident-process Beads path is proven equal to folder. Needs
  no Tauri/Pi.
- **Beads/Dolt resident-process check**: explicit assertions that a long-running
  host holds the Beads/Dolt workspace without lock contention across many
  sequential commands and concurrent reads (the concern formerly tracked as open
  question #2).
- **Smoke**: `scripts/engine-host-smoke.mjs` mirroring the existing `smoke:*`
  pattern, wired into `package.json`.
- **Parity**: assert engine-host commands produce envelopes consistent with the
  CLI for the same operations (reuse the envelope parity-matrix discipline in
  `docs/waypoint-envelope-parity-matrix.md`).

---

## Acceptance criteria

- [ ] `packages/waypoint-engine-host` exists as a workspace package depending on
      `@waypoint/core` + `@waypoint/folder-host`, passing `pnpm typecheck`.
- [ ] `createEngineHost(config).start()` boots an HTTP+WS listener on
      `127.0.0.1` with a free port and a bearer token.
- [ ] All commands in the surface above are registered and return correct
      envelopes (success + normalized error) for **both folder and Beads/Dolt**
      workspaces.
- [ ] WS clients receive a snapshot on subscribe, live deltas thereafter, and
      can resume from `lastSeq`.
- [ ] `author.promote` deterministically writes a draft into the static catalog
      and returns its manifest path.
- [ ] Headless integration test drives the full lifecycle and passes in
      `vitest run` **against both folder and Beads/Dolt backends**.
- [ ] Beads/Dolt resident-process test confirms no lock contention under many
      sequential commands + concurrent reads.
- [ ] `pnpm smoke:engine-host` runs green.
- [ ] `src/boundaries.ts` guard still passes (no host leakage into core).

---

## Resolved decisions

- **Beads/Dolt is first-class in slice 1** (not optional). The full lifecycle
  test suite runs against both folder and Beads/Dolt, and a dedicated test
  confirms the resident-process path holds the Dolt-backed workspace without lock
  contention. This closes the former "Beads backend in-process" open question.

## Open questions / assumptions to verify

1. **Pi SDK availability.** This design (and slice 2) assumes pi.dev ships a
   programmatic **SDK/library** usable in a Node process. If Pi is only a CLI or
   hosted API, slice 2 adapts (spawn CLI / call hosted API); **slice 1 is
   unaffected** since it contains no Pi code. Verify before slice 2 planning.
2. **Workspace switching semantics.** Whether `workspace.open` on an
   already-bound host should drain in-flight runs or hard-switch. Default: reject
   switch while runs are active unless `force` is set.

---

## Out of scope (future slices)

- Pi agent brain / ad-hoc authoring intelligence (slice 2).
- Tauri shell, web UI, DAG visualization (slice 3).
- Gas City supervision integration.
- Remote/multi-user access.
