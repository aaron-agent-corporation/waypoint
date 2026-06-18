<!--
  Canonical implementation plan for the Waypoint Engine Host (slice 1).
  Provenance: original plan (writing-plans) → /autoplan adversarial review (CEO/Eng/DX, Claude+Codex)
  → /mar multi-vendor review (Claude+Codex+Gemini, 6-phase). This is the MAR-integrated result
  (run 20260618-ki6NW_, unanimous convergence on the claude-1 base + folded corrections).
  Full audit trail: runs/20260618-ki6NW_/ (drafts, reviews, responses, evaluations, resolved-decisions.md).
  User gate decisions: UC1 spike-first, UC2 keep HTTP+WS, UC3 Beads real-bd, UC4 promote=proposal.
-->

# Waypoint Engine Host + Local API — Implementation Plan (slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **Task 0 is a hard gate: do not start Task 1 until both spikes are documented.**

**Goal:** Build `@waypoint/engine-host`, a resident Node process wrapping `@waypoint/core` + `@waypoint/folder-host`, exposing the full run + watch + author contract over a transport-agnostic command/event core with a loopback HTTP + WebSocket adapter.

**Architecture:** A pure command/event core — `CommandBus` (named command → envelope) and `EventHub` (seq'd live event fan-out) — sits over a `WorkspaceSession` that binds one Waypoint workspace and delegates every operation to existing backend-agnostic folder-host functions. A thin HTTP+WS adapter translates wire ↔ core; `transport.ts` is the seam where Tauri IPC later drops in.

**Live-events design (corrected — see Task 7):** folder-host's `IEventBus` is publish-only, so there is no live subscription to tap. **The durable route-event log (`readWaypointRuntimeRouteEvents`) is the single source of truth** for what gets broadcast; live deltas are produced by **event-ID set-diffing that durable log** (publish only events whose stable event ID has not been broadcast before), serialized per route. A mutating command's returned delta is used **only as a low-latency hint** that triggers an immediate broadcaster read of the durable log — never as the broadcast payload itself — which eliminates polling delay without inventing a second event source (resolved: response-gemini-1-issue-1). Integer-offset paging is **rejected** — Beads re-sorts events with positional IDs, so offsets drop/dupe. A periodic poll tick remains as the fallback that surfaces out-of-band writes (autopilot / Gas City / external) for which no command hint fires.

**Tech Stack:** TypeScript (ESM, `type: module`), Node 22, `@waypoint/core` (`workspace:*`), `@waypoint/folder-host` (`workspace:*`), `ws`, Vitest. Beads path uses the `bd`-spawning client folder-host already constructs.

## Global Constraints

- **Module system:** ESM only, `"type": "module"`, `.ts` extension in relative imports (`allowImportingTsExtensions`, `moduleResolution: bundler`).
- **No host leakage into core:** engine-host depends on core + folder-host; never import engine-host from `src/` (core). `src/boundaries.ts` must still pass.
- **Error envelope:** failures return `makeErrorEnvelope(message, details?)` → `{ ok:false, action:'error', error, details? }`, with `details` carrying structured `{ code, field?, issues? }` (see Correction K). Success: `{ ok:true, action:'<command>', ...data }`.
- **Networking:** HTTP/WS binds `127.0.0.1` only, ephemeral port (`listen(0)`), guarded by a per-process bearer token compared with `crypto.timingSafeEqual`; request body capped at 1 MB.
- **Backends:** both `folder` and `beads` are first-class. Engine-host calls backend-agnostic folder-host functions; never branch on backend inside handlers.
- **Workspace path:** every folder-host call takes `WorkspaceSession.requireActive().root`. Never read `process.cwd()` inside handlers.
- **Beads concurrency — two distinct layers (resolved: response-claude-1-issue-1):**
  - **(a) Ordering** is enforced at the engine-host boundary: every *mutating* command path runs its folder-host call inside `session.mutate()`, a real per-workspace async mutex (not the `inFlight` counter). This holds regardless of how folder-host builds its `bd` client — the await-chain through the mutex is what serializes, not client identity. Concretely the mutating paths are: `run.start`, `run.pause`, `run.resume` (T7); `gate.decide`, `discuss.post` (T8); `author.promote` and `author.approveProposal` writes (T9).
  - **(b) Single-client reuse** is **not asserted up front — it is a Task-5 verification gate.** It requires folder-host to accept an *injected* client. Task 5 must confirm whether the relevant folder-host APIs expose an `issueClient`/`beadsClient` injection seam; if the seam exists, `WorkspaceSession` passes its one session-owned `WaypointBeadsCliIssueClient` into every call (reads included); if it does not, Task 5 *adds* that injection parameter to folder-host and commits it, rather than silently constructing fresh per-call clients. The "single reused client" claim is made only after Spike B + the injection seam are confirmed.
- **TDD:** failing test first → watch fail → minimal implementation → watch pass → commit. One logical change per commit.
- **Verify before done:** `pnpm --filter @waypoint/engine-host test` and `pnpm typecheck` before claiming any task complete.

---

## File Structure

```
packages/waypoint-engine-host/
  package.json
  src/
    types.ts            # EngineEnvelope, EngineBackend, EngineEvent, error codes
    envelope.ts         # ok() + structured error helper
    core/
      command-bus.ts
      event-hub.ts
      workspace-session.ts        # active binding, run guard, per-ws bd mutation queue, client-injection seam
      route-broadcaster.ts        # per-route event-ID diff over durable log + serialization (Task 7)
      engine-host.ts              # createEngineHost: wires session+hub+bus, start/stop
      commands/
        workspace.ts  catalog.ts  run.ts  gate.ts  author.ts  meta.ts
    transport/
      transport.ts                # Transport interface (the Tauri-IPC seam)
      http-ws/ server.ts  ws.ts
    client.ts                     # createEngineClient (shipped, promoted from test helper)
    index.ts
    bin.ts
    __tests__/
      command-bus.test.ts  event-hub.test.ts  workspace-session.test.ts
      commands.folder.test.ts  author.test.ts  meta.test.ts  http-ws.test.ts
      integration.lifecycle.test.ts   # parameterized folder + (real-bd-gated) beads
      integration.beads.test.ts       # real-bd resident-process contention
      helpers/ workspace.ts  client.ts  quest-fixture.ts
scripts/ engine-host-smoke.mjs
docs/superpowers/spikes/2026-06-18-engine-host-spikes.md   # Task 0 output
```

Reference signatures (verified against source; `> confirm` notes name the file to check while implementing):

- `makeErrorEnvelope(error, details?) → { ok:false, action:'error', error, details? }` — `@waypoint/core`.
- `initWaypointProject(root, { quest, backend?, now? })` — folder-host (does **not** install the bundled catalog — see Task 6/Correction A).
- `readWaypointStatus(root, options?) → { initialized, quest, backend, routes, beads, ... }`.
- `loadBundledWaypointCatalog() → { quests, recipes, resolveQuestRecipes(quest) }` — `quests`/`recipes` are **registries**; use `.list()` (Correction B).
- `startQuestRoute(root, { quest }) → StartedQuestRoute` — reads `.waypoint/quests/<quest>.yaml`, so the catalog must be installed first.
- `listWaypointRuntimeRoutes/getWaypointRuntimeRoute/listWaypointRuntimeTasks`, `readWaypointRuntimeRouteEvents(root, routeId, { limit?, offset? }) → { items: WaypointFolderRouteEvent[]; total; limit; offset }`, `WaypointFolderRouteEvent = { id, route_id, kind, created_at, payload? }`.
- `approveRouteGate/rejectRouteGate(root, { routeId, node, note?, nextNode?, now? })`, `pauseWaypointRoute/resumeWaypointRoute`.
- `appendTaskDiscussionMessage(root, taskId, { content, author })` — **arity (root, taskId, opts)**, not one object (Correction C); `readTaskDiscussionMessages`.
- `generateAuthoringRecipeDraft/QuestDraft(input) → { kind, path, yaml, validation:{ok,errors}, warnings }` (+ design-spec/handoff equivalents) — return YAML + path, **do not write**.
- **Client-injection seam (Task-5 gate, resolved: response-claude-1-issue-1):** confirm whether `startQuestRoute`/`approveRouteGate`/`rejectRouteGate`/`pauseWaypointRoute`/`resumeWaypointRoute`/`appendTaskDiscussionMessage` and the read APIs accept an options bag exposing an `issueClient`/`beadsClient`. `> confirm against waypoint-folder-host/src/**; if absent, add the injection parameter in Task 5.`

---

### Task 0: De-risk spikes (GATE — before any slice-1 task) — UC1

Two throwaway spikes; slice-1 build is gated on both. Commit findings to `docs/superpowers/spikes/2026-06-18-engine-host-spikes.md`. **Do not keep spike code.**

- [ ] **Spike A — Pi SDK reachability.** Scratch Node script: authenticate to pi.dev, run ONE tool-calling agent loop (register a trivial tool, have the agent call it, capture the result). Record: is there a programmatic Node SDK? auth model? streaming? tool-loop ergonomics? **Stop-condition scope (resolved: response-codex-1-issue-4): a NO/unusable-SDK result blocks only Pi-*dependent* integration — it does NOT block the transport-agnostic engine-host core.** Slice 1 may proceed with HTTP + WebSocket and an **explicit Pi deferral** (flag the spec's "in-process Pi" rationale as unvalidated and defer the provider-neutral `BrainAdapter` work to slice 2). Only Pi-coupled work waits on a usable SDK.
- [ ] **Spike B — real bd/Dolt resident-process contention.** With real `bd` + Dolt: boot a long-lived Node process, `init --backend beads`, start a route, fire 25 sequential + 12 concurrent mixed read/write `bd` operations (routes.list, gate, pause/resume, route-events). Record any `database is locked` / timeout. **If contention appears → the per-workspace serialized bd mutation queue (Correction E / Global Constraint (a)) is a hard requirement, not optional.** Also record whether folder-host exposes a client-injection seam (input to the Global Constraint (b) Task-5 gate).
- [ ] **Gate:** both spikes documented before Task 1. The contention finding and the injection-seam finding are explicit inputs to Task 5/7.

---

### Task 1: Scaffold `@waypoint/engine-host`

**Files:** `package.json`, `src/index.ts`, `__tests__/package.test.ts`; modify root `tsconfig.json` (path mapping) + root `package.json` (`ws` dep + smoke placeholder).

- [ ] **Test (fails — cannot resolve `../index.ts`):**
```ts
import { describe, expect, it } from 'vitest'
import { getEngineHostInfo } from '../index.ts'
describe('engine-host package', () => {
  it('reports its package identity', () => {
    expect(getEngineHostInfo()).toEqual({ packageName: '@waypoint/engine-host', corePackage: 'waypoint-core' })
  })
})
```
- [ ] **Manifest** (`name:"@waypoint/engine-host"`, `type:"module"`, `bin:{ "waypoint-engine-host":"./dist/bin.js" }`, deps: `@waypoint/core`/`@waypoint/folder-host` `workspace:*`, `ws ^8.18`, dev `@types/ws`).
- [ ] **Entry export** `getEngineHostInfo(): { packageName, corePackage }`.
- [ ] **Path mapping** in `tsconfig.json`: `"@waypoint/engine-host": ["./packages/waypoint-engine-host/src/index.ts"]`.
- [ ] **Deps:** `pnpm add ws --filter @waypoint/engine-host && pnpm add -D @types/ws --filter @waypoint/engine-host`.
- [ ] **Verify** `pnpm vitest run packages/waypoint-engine-host && pnpm typecheck`; commit `feat(engine-host): scaffold package`.

---

### Task 2: Engine envelope + shared types (incl. structured error codes — Correction K)

**Files:** `src/types.ts`, `src/envelope.ts`, `__tests__/envelope.test.ts`.

- [ ] **Test (fails):**
```ts
import { describe, expect, it } from 'vitest'
import { ok, fail } from '../envelope.ts'
describe('engine envelopes', () => {
  it('builds a success envelope', () => {
    expect(ok('routes.list', { routes: [] })).toEqual({ ok: true, action: 'routes.list', routes: [] })
  })
  it('carries a structured error code in details', () => {
    expect(fail('No workspace open', { code: 'NO_WORKSPACE' }))
      .toMatchObject({ ok: false, action: 'error', error: 'No workspace open', details: { code: 'NO_WORKSPACE' } })
  })
})
```
- [ ] **`types.ts`:**
```ts
import type { WaypointErrorEnvelope } from '@waypoint/core'
import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'
export type EngineBackend = 'folder' | 'beads'
export type EngineErrorCode =
  | 'UNKNOWN_COMMAND' | 'NO_WORKSPACE' | 'VALIDATION' | 'NOT_FOUND' | 'BACKEND_ERROR' | 'CONFLICT'
export interface EngineErrorDetails { readonly code: EngineErrorCode; readonly field?: string; readonly issues?: readonly string[] }
export interface EngineSuccessEnvelope { readonly ok: true; readonly action: string; readonly [k: string]: unknown }
export type EngineEnvelope = EngineSuccessEnvelope | WaypointErrorEnvelope
export interface EngineEvent { readonly seq: number; readonly topic: string; readonly record: WaypointFolderRouteEvent }
```
> If `WaypointFolderRouteEvent` is not re-exported, add `export type { WaypointFolderRouteEvent } from './events/types.ts'` to folder-host's `index.ts` and commit it here.
- [ ] **`envelope.ts`:** `ok(action, data={})`; `fail(message, details: EngineErrorDetails)` wrapping `makeErrorEnvelope(message, details)`; re-export `makeErrorEnvelope`. **An `EngineError` class** carrying a `code` is thrown inside handlers; the CommandBus maps it to `fail()` (Task 3).
- [ ] Verify + commit `feat(engine-host): envelope + structured error codes`.

---

### Task 3: CommandBus (maps `EngineError` → coded envelope)

**Files:** `src/core/command-bus.ts`, `__tests__/command-bus.test.ts`.

- [ ] **Tests (fail):** dispatch registered command; unknown command → `{ ok:false, action:'error', error:'Unknown command: nope', details:{ code:'UNKNOWN_COMMAND' } }`; thrown `Error('kaboom')` → coded `BACKEND_ERROR` envelope; thrown `EngineError('bad', {code:'VALIDATION', field:'quest'})` → preserves code+field; duplicate registration throws.
- [ ] **Implementation:** `register/has/names/dispatch`. `dispatch` catches: if `error instanceof EngineError`, `fail(error.message, error.details)`; else `fail(message, { code: 'BACKEND_ERROR' })`. Unknown command → `fail('Unknown command: ' + name, { code:'UNKNOWN_COMMAND' })`.
- [ ] Verify + commit `feat(engine-host): CommandBus with coded-error normalization`.

---

### Task 4: EventHub (seq, ring replay, race-free subscribe, restart resnapshot — Correction F)

**Files:** `src/core/event-hub.ts`, `__tests__/event-hub.test.ts`.

- [ ] **Tests (fail):** monotonic seq + fan-out to matching topics; non-matching topics not delivered, `'*'` receives all; replay buffered events with `seq > lastSeq`; `lastSeq` predating the ring → `requestResnapshot()` once, no deliveries; **`lastSeq > currentSeq` (process restarted, seq reset) → `requestResnapshot()`, never silent no-op**; unsubscribe stops delivery; **`deliver` that throws does not abort fan-out to other subscribers**.
- [ ] **Implementation** (key corrections vs original):
```ts
subscribe(sub: EventSubscriber, lastSeq?: number): () => void {
  if (lastSeq !== undefined) {
    if (lastSeq > this.seq) { sub.requestResnapshot() }            // restart / seq reset
    else {
      const oldest = this.ring[0]?.seq
      if (oldest !== undefined && lastSeq < oldest - 1) sub.requestResnapshot()
      else for (const e of this.ring) if (e.seq > lastSeq && matches(sub, e.topic)) this.safeDeliver(sub, e)
    }
  }
  this.subscribers.add(sub)
  return () => { this.subscribers.delete(sub) }
}
private safeDeliver(sub: EventSubscriber, e: EngineEvent) { try { sub.deliver(e) } catch { /* one bad subscriber can't abort fan-out */ } }
```
`publish` uses `safeDeliver` in its fan-out loop. The **subscribe→snapshot→flush ordering** that closes the missed-delta race lives in the WS layer (Task 11), which registers a queueing subscriber *before* taking the snapshot.
- [ ] Verify + commit `feat(engine-host): EventHub with safe fan-out + restart resnapshot`.

---

### Task 5: WorkspaceSession (init mirrors CLI, run guard, per-ws bd mutation queue, client-injection seam — Corrections A, E; resolved: response-claude-1-issue-1)

**Files:** `src/core/workspace-session.ts`, `__tests__/workspace-session.test.ts`, `__tests__/helpers/workspace.ts`.

**Produces:** `open(input)` that, on a fresh root, runs the **same sequence as `waypoint-cli/src/commands/init.ts`**: optional Beads init (when `initBeads` or `backend:'beads'`) → `initWaypointProject` → **install bundled catalog** (`installQuestCatalog` or the init helper — `> confirm the exact export against init.ts`) → readiness check. For an existing workspace, derive backend from `readWaypointStatus` and **reject a conflicting `backend` argument** (`CONFLICT`). Plus:
- `requireActive()` throws `EngineError('No workspace open; call workspace.open first', { code:'NO_WORKSPACE' })`.
- `runGuard<T>(fn)` — in-flight counter for the workspace-switch guard.
- `mutate<T>(fn)` — a real per-workspace async mutex serializing `bd`-backed mutations (the Spike-B remedy). This is layer (a): **ordering is enforced here, by the await-chain through the mutex, independent of client identity.**
- **Client-injection seam — Task-5 verification gate (layer (b)):** confirm whether `startQuestRoute`/`approveRouteGate`/`rejectRouteGate`/`pauseWaypointRoute`/`resumeWaypointRoute`/`appendTaskDiscussionMessage` and the read APIs accept an injected `issueClient`/`beadsClient`. **If the seam exists**, construct exactly one `WaypointBeadsCliIssueClient` per workspace and pass it into every folder-host call (reads included). **If it does not exist**, add that injection parameter to folder-host and commit it as part of this task — do **not** let handlers silently construct fresh per-call clients. The "single reused client" guarantee is claimed only after this gate passes (it is not asserted in Global Constraints up front).

- [ ] **Tests (fail):** `requireActive` throws before open; opening a fresh folder root yields `{ root, backend:'folder', initialized:true }` and `status.initialized === true`; **`run.start`-equivalent precondition: after open, the bundled catalog is on disk so `startQuestRoute` can read `.waypoint/quests/<quest>.yaml`** (this is the bug that made every fresh-workspace test fail); switching workspace while a run is in flight rejects (`/runs are active/`) unless `force`; opening with a `backend` that conflicts with an existing workspace rejects (`CONFLICT`); `mutate` serializes — two overlapping mutations never interleave (assert ordering via a shared counter); **injection-seam test: after open, every folder-host mutation observed in the test receives the session-owned client instance** (when the seam exists) — or, if folder-host had to be extended, a test asserting the new injection parameter is honored.
- [ ] Verify + commit `feat(engine-host): WorkspaceSession with CLI-parity init + bd mutation queue + client-injection seam`.

---

### Task 6: EngineHost shell + workspace / catalog / meta commands (Corrections B, I)

**Files:** `src/core/engine-host.ts`, `commands/workspace.ts`, `commands/catalog.ts`, `commands/meta.ts`, `__tests__/commands.folder.test.ts`, `__tests__/meta.test.ts`.

- [ ] **Tests (fail):**
  - `workspace.open` → `{ ok:true, action:'workspace.open', workspace:{ backend:'folder' } }`; `workspace.status` → `{ status:{ initialized:true } }`.
  - `catalog.quests` returns an **array** (`catalog.quests.list()`), length > 0; `catalog.recipes` (and `catalog.recipes` filtered by `quest` via `resolveQuestRecipes(quest).recipes`).
  - `catalog.quests` with no workspace → `{ ok:false, action:'error', error:'No workspace open; call workspace.open first', details:{ code:'NO_WORKSPACE' } }`.
  - `meta.commands` → `{ commands: bus.names() }`; `meta.health` → `{ ok, uptime, workspaceOpen, seq }`; `meta.version` → `{ apiVersion:'1', pkg }`.
- [ ] **`commands/catalog.ts`** returns `.list()` arrays; for `resolveQuestRecipes`, `if (resolved.ok === false) throw new EngineError(resolved.message, { code:'NOT_FOUND', field:'quest' })`. `> confirm registry/`.list()`/resolve result shape against waypoint-folder-host/src/catalog/bundled.ts.`
- [ ] **`commands/meta.ts`** registers the three meta commands; `meta.health` reads `session.current() != null` and `hub.currentSeq()`.
- [ ] **EngineHost shell** wires `session`, `hub`, `bus`, a `RouteBroadcaster` (Task 7), registers workspace/catalog/meta now and run/gate/author in later tasks; exposes `dispatch`, `snapshot()` (`Promise.all([listWaypointRuntimeRoutes, listWaypointRuntimeTasks])`), `start/stop` (Task 10).
- [ ] Verify + commit `feat(engine-host): shell + workspace/catalog/meta commands`.

---

### Task 7: Run/watch commands + RouteBroadcaster (event-ID diff over the durable log, serialized — Correction D; resolved: response-gemini-1-issue-1, response-claude-1-issue-1)

**Files:** `src/core/route-broadcaster.ts`, `commands/run.ts`, modify `engine-host.ts`, append to `commands.folder.test.ts`.

**RouteBroadcaster** (replaces the integer-offset pump; **the durable route-event log is the sole broadcast source**):
- Maintains `Map<routeId, Set<string>>` of already-broadcast **event IDs**.
- `emit(routeId)`: under a per-route async mutex, **read the durable log** `readWaypointRuntimeRouteEvents(root, routeId, { limit: <large> })`, publish every item whose `id` is not yet in the set, then add it. **Idempotent under interleaving; correct for both backends** (no positional-offset assumption).
- **Command-returned deltas are hints, not payloads (resolved: response-gemini-1-issue-1):** when a mutating command returns its own event delta, that delta is used **only to trigger an immediate `emit(routeId)` read of the durable log** (low-latency, eliminating the poll-tick delay). The bytes actually broadcast always come from the durable-log read and the ID-diff — never from the command return value — so a command hint and the poll tick can never double-publish or disagree.
- Each `hub.publish` flows through `EventHub.safeDeliver`.
- **Out-of-band writes:** a poll tick (~3s) runs the same ID-diff `emit` for every route that currently has subscribers, surfacing autopilot / Gas City / external events for which **no command hint fired**. `> open decision: ship the tick in slice 1 or defer — default: ship, gated behind "has subscribers" so idle workspaces don't poll.`

**Run commands** (each mutating path runs inside `session.mutate` — layer (a) of the concurrency model):
`run.start` (requires `quest`; runs `startQuestRoute` inside `session.mutate`, then `broadcaster.emit(route.id)` triggered as the command hint), `routes.list`, `route.get` (404 → `EngineError(..., { code:'NOT_FOUND' })`), `tasks.list`, `route.events` (returns `{ events, total, limit, offset }` — **flattened, no `{ page }` wrapper**, Correction L), `run.pause`, `run.resume` (both via `session.mutate` + `broadcaster.emit`).

- [ ] **Tests (fail then pass):** start a route → `{ route:{ quest:'waypoint', status:'active' } }`; a `'*'` subscriber receives ≥1 event after `run.start` (broadcaster fed the hub *from the durable log*); `routes.list` length 1; `tasks.list` ok; `route.events` → `events.length > 0` (assert the flattened shape, not `page.items`); pause → `status:'paused'`, resume → `status:'active'`; **interleaving test: two concurrent mutating commands produce no duplicate broadcast event IDs**; **hint-vs-poll test: an event surfaced by a command hint and the same event re-read by a later poll tick is broadcast exactly once (ID-diff dedupes).**
- [ ] Verify + commit `feat(engine-host): run/watch commands + serialized durable-log event-ID broadcaster`.

---

### Task 8: Gate + discussion commands (Correction C, L; resolved: response-claude-1-issue-1)

**Files:** `commands/gate.ts`, modify `engine-host.ts`, append to `commands.folder.test.ts`.

- [ ] **Tests (fail then pass):** approve a gate at the route's current node → `{ action:'gate.decide', route:{ status:'active' } }`; invalid `decision:'maybe'` → `{ ok:false, action:'error', details:{ code:'VALIDATION', field:'decision' } }`; `discuss.post` then `discuss.list` round-trips a message.
- [ ] **`gate.decide`** payload uses **`node`** (renamed from `gateId` — Correction L) to match `current_node`/folder-host. Validates `decision ∈ {approve,reject}` (else `EngineError VALIDATION`), runs `approveRouteGate`/`rejectRouteGate(root, { routeId, node, note?, nextNode? })` **inside `session.mutate`** (layer (a)), then `broadcaster.emit` as the command hint.
- [ ] **`discuss.post`** uses the real arity: `appendTaskDiscussionMessage(root, input.taskId, { content: input.message, author: input.author ?? 'user' })`, run **inside `session.mutate`** (layer (a)). Add **`discuss.list`** wrapping `readTaskDiscussionMessages` (read counterpart). `> confirm field names against waypoint-folder-host/src/discussion/store.ts.`
- [ ] Verify + commit `feat(engine-host): gate.decide (node) + discuss.post/list`.

---

### Task 9: Author commands — proposal model with opaque proposal IDs (Corrections G, K; resolved: response-claude-1-issue-2, response-claude-1-issue-1) — UC4

**Files:** `commands/author.ts`, modify `engine-host.ts`, `__tests__/author.test.ts`.

`author.promote` **no longer writes the catalog directly, and never exposes a filesystem path to the caller.** Flow:
- `author.recipe` / `author.quest` — run the generator, `assertValid` (invalid → `EngineError('Authoring draft invalid', { code:'VALIDATION', issues: draft.validation.errors })` — **pass `validation.errors` through as `details.issues`, don't stringify**), return `{ draft }`. (Plus `author.designSpec` / `author.handoff` wired to the real exports — `> confirm names generateAuthoringDesignSpec/HandoffDraft against src/authoring/*.ts; do not invent.`)
- **`author.promote`** — validate+parse the manifest (reject if `slug !== basename`), write a **pending proposal** to `.waypoint/proposals/<kind>/<slug>.yaml` plus the sidecar `.waypoint/proposals/<kind>/<slug>.proposal.json` (`{ sourceDraft, targetCatalogPath, diffVsExisting, status:'pending' }`). **Returns a server-minted opaque `proposalId` of the form `<kind>/<slug>` (e.g. `recipe/demo-recipe`) — NOT a path** (resolved: response-claude-1-issue-2). Catalog is **unchanged**.
- **`author.approveProposal { id }`** (human/gate-driven) — accepts **only** an `id` matching `^(quest|recipe)/[a-z0-9-]+$`. Any value containing additional path separators, `..`, or extensions is rejected with `EngineError VALIDATION` **before touching disk**. The id deterministically resolves to `.waypoint/proposals/<kind>/<slug>.proposal.json`; the catalog write target is read from that sidecar's recorded `targetCatalogPath` (itself re-validated against `^(quests|recipes)/[a-z0-9-]+\.ya?ml$`), **never from caller input**. The write itself is **temp-file + `rename`** into the location the runtime actually reads, run **inside `session.mutate`** (layer (a)).

- [ ] **Tests (fail then pass):** recipe draft → `{ draft:{ kind:'recipe', path:'recipes/demo-recipe.yaml' } }`, yaml contains `slug: demo-recipe`; invalid spec → `VALIDATION` with `details.issues` non-empty; **`author.promote` returns `{ proposalId:'recipe/demo-recipe' }` (opaque, not a path), creates a `pending` proposal, and leaves the catalog unchanged** (assert `resolveQuestRecipes`/disk has no new recipe); **`author.approveProposal { id:'recipe/demo-recipe' }` lands it and a subsequent `run.start` / `resolveQuestRecipes` can find it** (proves reachability, not just bytes on disk); **path-escape attempts `author.approveProposal { id:'recipe/../config' }` and `{ id:'recipe/demo-recipe/../../x' }` both return `VALIDATION` and write nothing** (resolved: response-claude-1-issue-2).
- [ ] Verify + commit `feat(engine-host): author proposals + opaque-id approveProposal (reachable, path-safe catalog write)`.

---

### Task 10: Transport interface + loopback HTTP server (Correction H)

**Files:** `transport/transport.ts`, `transport/http-ws/server.ts`, modify `engine-host.ts` (`start`/`stop`), `__tests__/http-ws.test.ts`.

- [ ] **Tests (fail then pass):** binds loopback on ephemeral port with a hex token; missing/incorrect bearer → 401; valid token dispatches `workspace.open` → 200 `{ ok:true }`; unknown command → envelope `{ ok:false, details:{ code:'UNKNOWN_COMMAND' } }`; **body over 1 MB → 413**.
- [ ] **`Transport` interface:** `start(): Promise<{ port, token, url }>`, `stop(): Promise<void>`.
- [ ] **HTTP server:** bind `127.0.0.1`, token via `Authorization: Bearer` compared with **`crypto.timingSafeEqual`** (length-guarded), `POST /cmd/<name>` → `host.dispatch(decodeURIComponent(name), body)`; `readBody` **caps at 1 MB** (abort + 413); JSON parse failure → `VALIDATION` 400; success and command-error envelopes both return HTTP 200 with the envelope as body.
- [ ] **EngineHost.start/stop** lazily create one transport and delegate.
- [ ] Verify + commit `feat(engine-host): transport seam + hardened loopback HTTP server`.

---

### Task 11: WebSocket subscribe / snapshot / delta (race-free, header token — Correction F)

**Files:** `transport/http-ws/ws.ts`, modify `server.ts` (attach upgrade), append to `http-ws.test.ts`.

- [ ] **Tests (fail then pass):** snapshot-then-deltas — open workspace, connect, `{ subscribe:{ topics:['*'] } }`, receive `{ type:'snapshot', apiVersion:'1', ... }` first, then a `run.start` produces a `{ type:'event' }`; handshake with a wrong token is rejected (socket CLOSED); **no missed-delta race: an event published between snapshot and flush is still delivered exactly once.**
- [ ] **Implementation (corrected ordering):** on `subscribe`, **register a queueing subscriber first** (`asOf = hub.currentSeq()`), then take `host.snapshot()`, then flush queued events with `seq > asOf` and switch the subscriber to direct delivery — eliminating the snapshot/subscribe gap. Backpressure (`ws.bufferedAmount > 1 MB`) → send `{ type:'resnapshot' }`. **Token travels in the `Authorization` / `Sec-WebSocket-Protocol` upgrade header, not the query string.** `snapshot` message includes `apiVersion` (Correction I).
- [ ] Verify + commit `feat(engine-host): WS snapshot+delta, race-free subscribe, header token`.

---

### Task 12: Public exports + shipped client + launcher (Corrections H, J)

**Files:** modify `src/index.ts`, create `src/client.ts`, `src/bin.ts`, `__tests__/bin.test.ts`.

- [ ] **`src/client.ts` (shipped, not a test helper):** `createEngineClient({ url, token })` → `.cmd(name, payload)` (HTTP `Authorization: Bearer`) and `.subscribe(topics, onEvent)` (WS). Promote the former test helper here.
- [ ] **`bin.ts` — `startEngineHostFromEnv(argv, env)`:** boot host, open `WAYPOINT_ENGINE_ROOT` (backend from `WAYPOINT_ENGINE_BACKEND`), write an **atomic handshake**: write `*.tmp`, `chmod 0600`, `rename`; record `{ schemaVersion, pid, url, token, createdAt, workspaceRoot }`; delete a stale file at startup; unlink on clean shutdown. Direct-run stdout prints the **full record (incl. token) or nothing** — never a token-less line that disagrees with the file.
- [ ] **Exports:** `createEngineHost`, `createEngineClient`, `startEngineHostFromEnv`, and the public types.
- [ ] **Tests (fail then pass):** launcher boots, opens the configured root, writes a `0600` handshake with `pid`; a `workspace.status` over HTTP using the handshake token → `{ initialized:true }`; the shipped `createEngineClient` round-trips a command and receives a WS event.
- [ ] Verify (`+ pnpm typecheck`) + commit `feat(engine-host): public exports + shipped client + atomic-handshake launcher`.

---

### Task 13: Headless full-lifecycle integration (folder) — deterministic gate (Correction M)

**Files:** `__tests__/integration.lifecycle.test.ts`, `__tests__/helpers/client.ts`, `__tests__/helpers/quest-fixture.ts`.

- [ ] **`quest-fixture.ts`:** a known fixture quest whose **first gate node is fixed and asserted**. No self-adjusting "if the gate step fails, adjust the test" escape hatch.
- [ ] **Lifecycle over HTTP+WS (folder):** `workspace.open → run.start → routes.list (len 1) → route.events (events>0) → gate.decide { node: <fixture first gate> } → author.recipe → author.promote (returns opaque proposalId, pending) → author.approveProposal { id: <that proposalId> } → run can resolve the landed recipe`. Every step asserts `ok:true`; the gate step asserts against the fixture's known node; the approve step passes back the **opaque `proposalId`** returned by `promote` (not a path).
- [ ] Verify + commit `test(engine-host): deterministic full-lifecycle over HTTP+WS (folder)`.

---

### Task 14: Beads/Dolt first-class via REAL bd (Correction E) — UC3

**Files:** parameterize `integration.lifecycle.test.ts`; create `integration.beads.test.ts`. **No `fake-bd`.**

- [ ] **Real-bd gate:** reuse the `realBdAvailable()` pattern from `waypoint-cli/src/commands/beads-backend-smoke.test.ts`. The Beads lane **skips locally without bd** but is **required in CI** (bd + Dolt installed). `> confirm realBdAvailable() export/location.`
- [ ] **Parameterized lifecycle:** run the Task-13 assertions for `['folder','beads']`; the `beads` case opens with `backend:'beads'` against real `bd`.
- [ ] **Resident-process contention (real bd/Dolt):** 25 sequential + 12 concurrent mixed read/write commands (routes.list, gate, pause/resume, route-events) against one long-lived host; **assert zero `database is locked` / timeout** — this is the only thing that actually validates the "no lock contention" claim (fake-bd proved nothing). The per-workspace `session.mutate` queue (Task 5, layer (a)) is what makes this pass; the single-client reuse from the Task-5 injection gate (layer (b)) is exercised here under real `bd`.
- [ ] **Acceptance:** "Beads first-class" is claimed **only once the real-bd CI lane is green.**
- [ ] Verify (`pnpm vitest run packages/waypoint-engine-host && pnpm typecheck`) + commit `test(engine-host): real-bd-gated parameterized lifecycle + contention`.

---

### Task 15: Smoke script, package wiring, boundaries

**Files:** `scripts/engine-host-smoke.mjs`, modify root `package.json` (`smoke:engine-host`), `README.md`.

- [ ] **Mirror `scripts/folder-host-smoke.mjs`** exactly (temp-dir setup, dist-vs-ts import strategy, exit codes, console conventions — read it first).
- [ ] **Smoke:** `createEngineHost` → `start` → `workspace.open` → `run.start` → `routes.list` (len 1) → print `engine-host smoke OK on <url> (route <id>)`; cleanup in `finally`.
- [ ] **README:** under "Runtime modes", note the engine-host exposes run/watch/author over loopback HTTP+WS, with `pnpm smoke:engine-host` as the local check, **plus a copy-paste hello-world for both shapes** (embed `createEngineHost`; drive over HTTP with `createEngineClient` + `Authorization: Bearer`) (Correction J).
- [ ] **Verify:** `pnpm build && pnpm smoke:engine-host` (exit 0), then `pnpm test && pnpm typecheck` — including `src/boundaries.ts` (core imports unchanged).
- [ ] Commit `chore(engine-host): smoke script + package wiring + docs`.

---

## Resolved decisions (settled this run — do not relitigate)

- **(response-claude-1-issue-1)** Beads concurrency is two layers: **(a)** ordering via `session.mutate()` at the engine-host boundary on every mutating path (run.start/pause/resume T7; gate.decide/discuss.post T8; author.promote/approveProposal writes T9), independent of client identity; **(b)** single-client reuse is a **Task-5 verification gate** — confirm/add the folder-host injection seam, then reuse one `WaypointBeadsCliIssueClient` per workspace. Not asserted up front.
- **(response-claude-1-issue-2)** `author.promote` returns a server-minted **opaque `proposalId` = `<kind>/<slug>`**, never a path. `approveProposal` accepts only `id` matching `^(quest|recipe)/[a-z0-9-]+$`; the write target comes from the sidecar's `targetCatalogPath` (re-validated `^(quests|recipes)/[a-z0-9-]+\.ya?ml$`), never caller input. Task 9 asserts `recipe/../config` and `recipe/demo-recipe/../../x` both → `VALIDATION`, write nothing.
- **(response-codex-1-issue-4)** The Pi spike stop-condition blocks only Pi-*dependent* integration, not the transport-agnostic engine-host core; slice 1 proceeds with HTTP + WebSocket plus an explicit Pi deferral if no usable programmatic Node SDK exists.
- **(response-gemini-1-issue-1)** The `RouteBroadcaster` is grounded in the **durable event log** (`readWaypointRuntimeRouteEvents`); command-returned deltas are **low-latency hints** that trigger an immediate broadcaster read, eliminating polling delay — they are never the broadcast payload, so hints and the poll tick can't double-publish (ID-diff dedupes).

## Open decisions (explicitly unsettled — for the executing session)

- Exact bundled-catalog install entrypoint name (`installQuestCatalog` vs an `init.ts` helper) — confirm against `waypoint-cli/src/commands/init.ts`.
- Whether the ~3s out-of-band poll tick ships in slice 1 or defers to slice 2 (default: ship, subscriber-gated so idle workspaces don't poll).
- Whether the folder-host client-injection seam already exists or must be added in Task 5 (input from Spike B).

## Self-Review

**1. Spec coverage:** resident process (T1/6/12) ✓; transport-agnostic CommandBus+EventHub (T3/4) ✓; hardened loopback HTTP+WS (T10/11) ✓; catalog/run/watch/author/gate/discuss/meta surface (T6–9) ✓; **proposal-based promote with opaque IDs + approveProposal** (T9) ✓; race-free snapshot+delta+lastSeq-resume+restart-resnapshot+backpressure (T4/11) ✓; Tauri seam (`transport.ts`, T10) ✓; deterministic headless integration (T13) ✓; **Beads first-class via real bd + contention** (T14) ✓; smoke+boundaries (T15) ✓.

**2. Blocking bugs folded in (not appended as errata):** catalog-not-installed → T5/6 ✓; `catalog.*` registry-not-array → T6 ✓; `discuss.post` arity → T8 ✓; integer-offset pump → T7 durable-log RouteBroadcaster ✓; EventHub restart wedge + subscribe race → T4/T11 ✓; `author.promote` path-safety + opaque-id reachability → T9 proposal model ✓; security hardening (timingSafeEqual, body cap, atomic 0600 handshake, header token) → T10/11/12 ✓; DX (meta, shipped client, structured errors, `node` rename, flattened list envelopes) → T6/8/9/12 ✓.

**3. Integrated additions (this round):** concurrency two-layer split + Task-5 injection gate (T5 + Global Constraints + T7/8/9) ✓; opaque proposalId + tightened approveProposal validation + path-escape tests (T9/T13) ✓; Pi-spike stop-condition scoped to Pi-dependent work only (T0) ✓; durable-log-grounded broadcaster with command deltas as hints (T7) ✓.

**4. Type consistency:** `EngineEnvelope`/`ok`/`fail`/`EngineError` consistent across command files; `EngineContext` (`session`, `hub`, `broadcaster`) consistent T6–9; `EngineHost` gains `start`/`stop` (T10); `route.events` returns `{ events, total, limit, offset }` everywhere (no `{ page }`); event shape `{ seq, topic, record }` consistent T4/7/11; `author.promote` returns `{ proposalId: '<kind>/<slug>' }` consumed by `approveProposal { id }` T9/T13.

**5. Open decisions surfaced (not silently chosen):** bundled-catalog install export name; whether the ~3s out-of-band poll tick ships in slice 1; whether the folder-host client-injection seam pre-exists or is added in Task 5 — all flagged for the executing session, not buried.
