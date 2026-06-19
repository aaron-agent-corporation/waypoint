<!-- /autoplan restore point: /Users/aaronwhaley/.gstack/projects/aaron-agent-corporation-waypoint/main-autoplan-restore-20260618-222531.md -->
# Waypoint Pi Agent Brain (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **This plan has been through /autoplan (CEO + Eng + DX dual-voice review).** The decisions from that review are integrated into the tasks below. The full audit trail + consensus tables are in the appendix ("/autoplan Review Record"). Run `/mar` on this integrated plan next.

**Goal:** Add an LLM "agent brain" to the engine host that turns natural-language intent into an authored Waypoint workflow, runs it ad-hoc as an ephemeral route, and proposes promotion — behind a provider-neutral adapter, surfaced as engine-host commands that stream over the event hub, with host-enforced per-session tool scoping and watchable/cancellable async runs.

**Architecture:** A provider-neutral `BrainAdapter` lives in `packages/waypoint-engine-host/src/brain/`. The first impl, `PiCliBrainAdapter`, drives Pi as a headless child (`pi -p --mode json`) and normalizes its JSON stream into `BrainEvent`s through a buffered decoder. `agent.author` is **async**: it mints a session, mints a **per-session scoped token** (whose allowed-command set the CommandBus enforces on every dispatch), starts the run in the background, and returns `{ sessionId }` immediately. A human (or the slice-3 UI) observes via `agent.watch` (live `agent:<sessionId>` stream + transcript replay) and stops via `agent.cancel`. The agent acts only through a **Waypoint Pi extension** that calls the engine-host loopback HTTP API with the *scoped* token — so `author.approveProposal` / `workspace.open` are blocked host-side, not just omitted from the tool list. Ad-hoc execution instantiates an authored recipe/quest draft as an ephemeral route from a **session-scoped overlay catalog** (`.waypoint/agent/<sessionId>/catalog/`, never the live `.waypoint/quests|recipes`), runs it via `runWaypointAutopilot` with an `AbortSignal` threaded through to `LocalRecipeRuntime`, and is unrestricted-by-default (a `dryRun` flag materializes-without-executing). Promotion-to-static stays human-gated.

**Tech Stack:** TypeScript (ESM, `.ts`-extension imports, `moduleResolution: bundler`), Node 24 (type-stripping — **no parameter properties, no enums**), Vitest, `@waypoint/core`, `@waypoint/folder-host`, `@waypoint/engine-host` (slice 1), `ws`, Pi CLI (`pi -p --mode json`, version-pinned), bd/Dolt.

## Global Constraints

- **ESM only**, `type: module`; explicit `.ts` extension on local imports; no CommonJS.
- **Node type-stripping:** no parameter properties (`constructor(private x)`), no `enum`. Explicit field declarations + assignment. (Slice-1 Task 15 regression.)
- **No in-process Pi SDK.** Pi is a child process via `pi -p --mode json` only. The npm `pi-sdk` is unrelated; never add it.
- **Pi version is pinned.** A single `PI_PINNED_RANGE` constant gates compatibility; `WAYPOINT_BRAIN=pi` with a missing/wrong-version `pi` **fails loud** (never silent-falls-back to the fake). Active brain (`pi`|`fake` + version) is reported in `meta.health` / `meta.version`.
- **Host-enforced tool scoping.** The agent's grant is enforced at `CommandBus.dispatch` via a per-session scoped token, not by which tools Pi is told about. The agent must NEVER be able to call `author.approveProposal` or `workspace.open`, even via a direct loopback call.
- **Run model = ad-hoc, unrestricted-by-default** (user-held after review). Side-effecting recipes run with no policy gate. Mitigations: per-session scoping, async + watchable, kill-switch, audit log, optional `dryRun`. `agent.cancel` is **best-effort** — it signals abort and SIGKILLs the recipe process group, but cannot roll back side effects already committed. Promotion-to-static stays human-gated.
- **Backends:** folder + beads/Dolt are first-class for slice-1 commands. **Ad-hoc execution is folder-backend only in slice 2 (declared experimental);** Beads ad-hoc parity is a tracked follow-up. `run.adhoc` on a beads workspace returns `VALIDATION`.
- **Error envelopes — one canonical shape.** Handlers `throw new EngineError(msg, { code, field?, issues? })`; the CommandBus maps to `{ ok:false, action:'error', error, details: { code, path, message } }`. `EngineError.field` maps to the documented `details.path`. README, handlers, and tests all use this shape. Scoped-token rejection → `code: 'FORBIDDEN'`.
- **Determinism in tests:** unit tests use `FakeBrainAdapter`. Real-Pi and real-bd tests are gated (`piAvailable()` / `realBdAvailable()`), skipped without the binary, required in CI.
- **Loopback + token only:** `127.0.0.1` + bearer token; never a non-loopback bind.

---

## File Structure

New code under `packages/waypoint-engine-host/src/`:

```
brain/
  brain-adapter.ts        # BrainAdapter interface + BrainEvent/BrainResult/BrainRunInput
  fake-adapter.ts         # FakeBrainAdapter (deterministic; supports a blocking gate for cancel tests)
  pi-stream-decoder.ts    # PiStreamDecoder: buffered chunk→line→BrainEvent (split/multi/no-newline safe)
  pi-cli-adapter.ts       # PiCliBrainAdapter: spawn pi, decode stream, SIGTERM→SIGKILL, stderr capture
  pi-version.ts           # PI_PINNED_RANGE, piAvailable(), piVersionOk()
  agent-session.ts        # AgentSession: sessionId, EventHub republish, transcript, cancel, terminal callback
  agent-registry.ts       # AgentRegistry: live sessions, kill-switch, list
  __fixtures__/pi-stream/  # captured Pi JSON lines + normalized snapshot (from Task 0)
core/
  token-registry.ts       # TokenRegistry: per-session scoped tokens (allow-set, revoke)
  command-bus.ts          # + DispatchContext (scope) on dispatch; FORBIDDEN deny-before-handler
  event-hub.ts            # publishAgent + per-topic ring budget so agent chatter can't starve route replay
  commands/agent.ts       # agent.author (async) / agent.run / agent.watch / agent.cancel / agent.list / agent.transcript
  commands/run.ts         # + run.adhoc (session overlay, executes via autopilot, dryRun, AbortSignal)
core/adhoc/
  start-adhoc-route.ts    # startAdhocRoute(): session-overlay catalog, materialize + run, abortable
```

`packages/waypoint-folder-host/src/` changes (ad-hoc execution seam — pinned by Task 0 Spike 2):
```
routes/start-adhoc.ts     # overlay-resolving route start (no writes to .waypoint/quests|recipes)
autopilot/run.ts          # runWaypointAutopilot accepts { signal?, catalogDir? } (overlay + abort)
runtime/local-runtime.ts  # LocalRecipeRuntime.runRecipe accepts an AbortSignal; SIGTERM→SIGKILL child group
```

New sibling package: `packages/waypoint-pi-extension/` (entry + tools + host-client + README).

Modified: `engine-host.ts` (owns `AgentRegistry` + `TokenRegistry`; async-aware), transport `server.ts`/`ws.ts` (token→scope resolution), `bin.ts` (Pi selection, fail-loud), `index.ts` (exports), `commands/meta.ts` (active brain), `scripts/stage-package-builds.mjs`, `tsconfig.json`, `vitest.config.ts`, root `package.json`, `README.md`.

---

## Task 0: Spikes (GATE — throwaway, document findings)

**Files:** Create `docs/superpowers/spikes/2026-06-18-pi-agent-brain-spikes.md`; capture fixtures under `packages/waypoint-engine-host/src/brain/__fixtures__/pi-stream/`.

**Produces:** findings pinning (1) Pi extension/tool-registration API + the exact JSON event lines + the working `pi` version; (2) the **session-overlay** ad-hoc execution seam — how `runWaypointAutopilot` can resolve recipes from a session-scoped dir and whether an `AbortSignal` can thread through to `LocalRecipeRuntime`.

- [ ] **Step 1: Spike 1 — Pi extension API + version + fixtures.** Against installed `pi`, confirm: an extension can register a named tool with a JSON-schema input; the handler receives parsed args; it can read env (`WAYPOINT_HOST_URL`/`WAYPOINT_HOST_TOKEN`); it returns a result the agent sees. Record `pi --version` (this becomes `PI_PINNED_RANGE`). Capture verbatim JSON event lines (session/message/toolcall/tool_execution/turn_end/agent_end) into `__fixtures__/pi-stream/basic-session.jsonl`, plus a **split-chunk** sample (a record broken across two reads) and a **multi-record-in-one-chunk** sample. If custom-tool registration is not cleanly supported: **do not silently fall back to bash+CLI** (it widens blast radius for an unrestricted agent — Eng/CEO finding). Stop and surface; the bash fallback requires its own explicit decision.
- [ ] **Step 2: Spike 2 — session-overlay execution seam.** Verified facts: `startQuestRoute` resolves recipes via `loadBundledWaypointCatalog().resolveQuestRecipes` (`routes/start.ts:45`) and reads `.waypoint/quests/<slug>.yaml` (`:60,:135`); `runWaypointAutopilot` reads recipes from disk (`autopilot/run.ts`); `LocalRecipeRuntime.runRecipe` has **no** `AbortSignal` today. Prototype in `/tmp`: write a draft quest+recipe under a **session dir** `.waypoint/agent/<sid>/catalog/{quests,recipes}/`, then start + autopilot a route that resolves from that dir (NOT the bundle, NOT the live catalog). Confirm the minimal change to (a) point recipe resolution at the overlay dir, (b) thread an `AbortSignal` through `runWaypointAutopilot` → `LocalRecipeRuntime` so cancel kills the in-flight child. Record the exact functions/signatures to change. If abort threading needs deep runtime surgery, scope it explicitly.
- [ ] **Step 3: Write findings + commit fixtures.**

```bash
git add docs/superpowers/spikes/2026-06-18-pi-agent-brain-spikes.md \
        packages/waypoint-engine-host/src/brain/__fixtures__/pi-stream/
git commit -m "spike(agent-brain): pin Pi extension API/version + session-overlay execution+abort seam"
```

---

## Task 1: EventHub carries agent events (per-topic ring budget)

**Files:** Modify `src/types.ts`, `src/core/event-hub.ts`; Test `src/core/event-hub.agent.test.ts`.

**Produces:** `AgentEventRecord = { id, sessionId, kind, at, data? }`; `EngineEvent.record: WaypointFolderRouteEvent | AgentEventRecord`; `EventHub.publishAgent(topic, record)`. **Agent events get a separate ring budget** so a chatty agent run can't evict `route:*` events a reconnecting WS subscriber needs (Eng decision 15).

- [ ] **Step 1: Failing test** — agent publish gets a monotonic shared seq, delivers only to matching subscribers, and (overflow test) ≥1000 agent events do NOT evict route events from replay:

```ts
// src/core/event-hub.agent.test.ts
import { describe, expect, it } from 'vitest'
import { EventHub } from './event-hub.ts'
import type { AgentEventRecord, EngineEvent } from '../types.ts'

const arec = (o: Partial<AgentEventRecord> = {}): AgentEventRecord =>
  ({ id: 'e1', sessionId: 's1', kind: 'agent.message', at: '2026-06-18T00:00:00Z', ...o })

describe('EventHub agent events', () => {
  it('publishes agent records on an agent topic with monotonic seq', () => {
    const hub = new EventHub()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['agent:s1']), deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    const ev = hub.publishAgent('agent:s1', arec())
    expect(ev.seq).toBe(1)
    expect((seen[0].record as AgentEventRecord).kind).toBe('agent.message')
  })

  it('agent chatter does not evict route events from reconnect replay', () => {
    const hub = new EventHub({ ringSize: 8, agentRingSize: 8 })
    const routeEv = hub.publish('route:r1', { id: 'r-evt', kind: 'route.started', created_at: '2026-01-01T00:00:00Z', payload: {} } as never)
    for (let i = 0; i < 50; i++) hub.publishAgent('agent:s1', arec({ id: `a${i}` }))
    const replayed: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['route:r1']), deliver: (e) => replayed.push(e), requestResnapshot: () => { replayed.push({ seq: -1, topic: 'RESNAP', record: {} as never }) } }, routeEv.seq - 1)
    // route event still replayable, not resnapshot-forced by agent flooding
    expect(replayed.some((e) => (e.record as { id?: string }).id === 'r-evt')).toBe(true)
  })
})
```

- [ ] **Step 2: Run → FAIL** (`publishAgent`/`agentRingSize` absent). `pnpm vitest run src/core/event-hub.agent.test.ts`
- [ ] **Step 3: Implement.** Add `AgentEventRecord` to `types.ts` and widen `EngineEvent.record`. In `EventHub`, keep the shared `seq` but maintain **two rings** (route ring + agent ring) with independent budgets; `subscribe(...,lastSeq)` replays from whichever ring(s) match the subscriber's topics. Constructor: `{ ringSize?: number; agentRingSize?: number }`. `publish` → route ring; `publishAgent` → agent ring. Resnapshot logic unchanged per-ring.
- [ ] **Step 4: Run → PASS**, then `pnpm vitest run src/core/event-hub.test.ts` (existing) + `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(engine-host): agent events on the hub with a separate ring budget`

---

## Task 2: BrainAdapter interface + FakeBrainAdapter

**Files:** Create `src/brain/brain-adapter.ts`, `src/brain/fake-adapter.ts`; Test `src/brain/fake-adapter.test.ts`.

**Produces:** `BrainEvent { kind, at, data? }`; `BrainRunInput { intent, tools, systemPrompt, signal?, onEvent }`; `BrainResult { status: 'completed'|'cancelled'|'error', summary?, proposalId?, adhocRouteId?, error? }`; `BrainAdapter { runSession(input): Promise<BrainResult> }`; `FakeBrainAdapter` supporting a **blocking gate** (a `gate?: Promise<void>` the run awaits before its terminal event) so cancel tests can interrupt a still-running session (Eng decision 14).

- [ ] **Step 1: Failing test** — scripted events+result; abort→cancelled; and a gated run that stays running until released:

```ts
// src/brain/fake-adapter.test.ts
import { describe, expect, it } from 'vitest'
import { FakeBrainAdapter } from './fake-adapter.ts'

describe('FakeBrainAdapter', () => {
  it('emits scripted events then returns the scripted result', async () => {
    const a = new FakeBrainAdapter({ events: [{ kind: 'agent.start', at: 't' }], result: { status: 'completed', proposalId: 'recipe/x' } })
    const seen: string[] = []
    const r = await a.runSession({ intent: 'i', tools: [], systemPrompt: '', onEvent: (e) => seen.push(e.kind) })
    expect(seen).toEqual(['agent.start'])
    expect(r.proposalId).toBe('recipe/x')
  })

  it('a gated run stays running until released and reports cancelled if aborted first', async () => {
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    const ctrl = new AbortController()
    const a = new FakeBrainAdapter({ events: [{ kind: 'agent.message', at: 't' }], result: { status: 'completed' }, gate })
    const p = a.runSession({ intent: 'i', tools: [], systemPrompt: '', signal: ctrl.signal, onEvent: () => {} })
    ctrl.abort(); release()
    expect((await p).status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the interface (exact types above) and `FakeBrainAdapter`:

```ts
// src/brain/fake-adapter.ts
import type { BrainAdapter, BrainEvent, BrainResult, BrainRunInput } from './brain-adapter.ts'
export interface FakeBrainScript {
  readonly events: readonly BrainEvent[]
  readonly result: BrainResult
  readonly gate?: Promise<void>        // run awaits this before the terminal result (cancel tests)
  readonly onBeforeEmit?: () => void
}
export class FakeBrainAdapter implements BrainAdapter {
  private readonly s: FakeBrainScript
  constructor(s: FakeBrainScript) { this.s = s }
  async runSession(input: BrainRunInput): Promise<BrainResult> {
    for (const e of this.s.events) {
      this.s.onBeforeEmit?.()
      if (input.signal?.aborted) return { status: 'cancelled' }
      input.onEvent(e)
    }
    if (this.s.gate) await this.s.gate
    if (input.signal?.aborted) return { status: 'cancelled' }
    return this.s.result
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(engine-host): BrainAdapter interface + FakeBrainAdapter (with cancel gate)`

---

## Task 3: AgentSession + AgentRegistry (transcript, cancel, terminal callback)

**Files:** Create `src/brain/agent-session.ts`, `src/brain/agent-registry.ts`; Test `src/brain/agent-session.test.ts`.

**Produces:** `AgentSession` with `id`, `startedAt`, `run(): Promise<BrainResult>`, `cancel()`, `status()`, `transcript()`; `AgentSessionDeps { id, intent, tools, systemPrompt, adapter, hub, root, onTerminal?: (r: BrainResult) => void, now? }`. `AgentRegistry { create, get, list, cancel }`. The session republishes each `BrainEvent` to `agent:<id>` as an `AgentEventRecord`, appends to `.waypoint/agent/<id>.jsonl` via an **awaited write chain**, and on completion invokes `onTerminal` (used by Task 5 to release the lease + revoke the scoped token). **`root` is captured at construction** (pins the session to its origin workspace). A transcript-write failure must NOT mask a completed run — it degrades to logged + status set (Eng decision 16, C6).

- [ ] **Step 1: Failing test** — republish + transcript file + cancel→cancelled + `onTerminal` fires + transcript-write failure still resolves with the run's status:

```ts
// src/brain/agent-session.test.ts (essentials)
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'; import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventHub } from '../core/event-hub.ts'
import { FakeBrainAdapter } from './fake-adapter.ts'
import { AgentRegistry } from './agent-registry.ts'

const root = async () => { const r = await mkdtemp(join(tmpdir(), 'wp-as-')); await mkdir(join(r, '.waypoint'), { recursive: true }); return r }

describe('AgentSession', () => {
  it('republishes on agent:<id>, writes transcript, and fires onTerminal', async () => {
    const hub = new EventHub(); const r = await root(); let term = ''
    const reg = new AgentRegistry()
    const s = reg.create({ id: 's1', intent: 'i', tools: [], systemPrompt: '', hub, root: r,
      adapter: new FakeBrainAdapter({ events: [{ kind: 'agent.message', at: 't' }], result: { status: 'completed', summary: 'ok' } }),
      onTerminal: (res) => { term = res.status }, now: () => 't' })
    const res = await s.run()
    expect(res.status).toBe('completed'); expect(term).toBe('completed')
    expect(await readFile(join(r, '.waypoint', 'agent', 's1.jsonl'), 'utf8')).toContain('agent.message')
    expect(s.transcript().map((e) => e.kind)).toEqual(['agent.message'])
  })

  it('cancel() aborts and reports cancelled in the registry', async () => {
    const hub = new EventHub(); const r = await root(); const reg = new AgentRegistry()
    let release!: () => void; const gate = new Promise<void>((res) => { release = res })
    const s = reg.create({ id: 's2', intent: 'i', tools: [], systemPrompt: '', hub, root: r,
      adapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' }, gate }) })
    const p = s.run(); s.cancel(); release()
    expect((await p).status).toBe('cancelled')
    expect(reg.list().find((x) => x.id === 's2')?.status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `AgentSession`** — `AbortController` for cancel; `onEvent` pushes to in-memory transcript, `publishAgent` to `agent:<id>`, and chains `appendFile` on a `writeChain`; after the adapter resolves, `try { await this.writeChain } catch { /* log; do not override run status */ }`; set `statusValue`; call `deps.onTerminal?.(result)`. Use the captured `deps.root` for the transcript path (never `requireActive()`).
- [ ] **Step 4: Implement `AgentRegistry`** (`create/get/list/cancel`; `list()` → `{ id, intent, status, startedAt }`).
- [ ] **Step 5: Run → PASS**, `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(engine-host): AgentSession + AgentRegistry (transcript audit, cancel, terminal callback)`

---

## Task 4: Per-session scoped token (host-enforced grant)

**Files:** Create `src/core/token-registry.ts`; Modify `src/core/command-bus.ts`, `src/transport/http-ws/server.ts`, `src/transport/http-ws/ws.ts`, `src/core/engine-host.ts`, `src/types.ts`; Test `src/core/token-registry.test.ts`, `src/core/command-bus.scope.test.ts`, `src/transport/http-ws/scope.test.ts`.

**Why (CEO+Eng CRITICAL):** today `CommandBus.dispatch(name,payload)` has no caller identity and the transport validates one global token. The Pi child would hold that global token and could call `author.approveProposal`/`workspace.open` directly. This task makes the grant a host-enforced boundary.

**Produces:**
- `TokenRegistry` — `mint(scope: ReadonlySet<string>): string` (random token), `resolve(token): { scope: ReadonlySet<string> } | null` (global host token resolves to `null` scope = unrestricted), `revoke(token)`.
- `CommandBus.dispatch(name, payload, ctx?: DispatchContext)` where `DispatchContext = { allow?: ReadonlySet<string> }`; if `ctx.allow` is set and `!ctx.allow.has(name)` → return `fail('Command not in session grant: '+name, { code: 'FORBIDDEN', field: 'command' })` **before** handler lookup.
- `EngineErrorCode` gains `'FORBIDDEN'`.
- Transport: resolve the bearer token → scope; pass `{ allow: scope.scope }` (or nothing for the global token) into `dispatch`. WS upgrade enforces the same.

- [ ] **Step 1: Failing test — TokenRegistry + bus scope:**

```ts
// src/core/command-bus.scope.test.ts
import { describe, expect, it } from 'vitest'
import { CommandBus } from './command-bus.ts'
describe('CommandBus scope', () => {
  it('rejects out-of-scope commands with FORBIDDEN before the handler runs', async () => {
    const bus = new CommandBus(); let ran = false
    bus.register('author.approveProposal', () => { ran = true; return { ok: true, action: 'x' } })
    const res = await bus.dispatch('author.approveProposal', {}, { allow: new Set(['author.recipe']) })
    expect(res.ok).toBe(false)
    expect((res as { details: { code: string } }).details.code).toBe('FORBIDDEN')
    expect(ran).toBe(false)
  })
  it('allows in-scope commands and is unrestricted when no allow-set is given', async () => {
    const bus = new CommandBus()
    bus.register('author.recipe', () => ({ ok: true, action: 'author.recipe' }))
    expect((await bus.dispatch('author.recipe', {}, { allow: new Set(['author.recipe']) })).ok).toBe(true)
    expect((await bus.dispatch('author.recipe', {})).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Failing test — transport rejects an agent-scoped token calling a forbidden command** (`src/transport/http-ws/scope.test.ts`): start a host, mint a scoped token allowing only `author.recipe`, POST `/cmd/author.approveProposal` with that token → `FORBIDDEN`; POST `/cmd/workspace.open` → `FORBIDDEN`; the global host token still succeeds.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** `TokenRegistry` (Map token→scope; `mint` uses `crypto.randomUUID()`/`randomBytes`); add `DispatchContext` + FORBIDDEN path to `CommandBus.dispatch`; in the HTTP server, after `timingSafeEqual` accepts a token, look it up in the registry (global token → unrestricted; scoped → its allow-set; unknown → 401) and pass `{ allow }` to `engineHost.dispatch`. Mirror in `ws.ts` upgrade. `engine-host.ts` constructs and owns the `TokenRegistry`; `EngineHost.dispatch` gains an optional `ctx` passthrough; the global token is registered at `start()`.
- [ ] **Step 5: Run → PASS**, `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(engine-host): per-session scoped tokens enforced at the command bus + transport`

---

## Task 5: agent.* commands (async author, watch, run convenience, cancel, list, transcript)

**Files:** Create `src/core/commands/agent.ts`; Modify `src/core/engine-host.ts`, `src/core/workspace-session.ts`; Test `src/core/commands/agent.test.ts`.

**Produces (all async-aware):**
- `AGENT_TOOL_GRANT` (frozen) — excludes `author.approveProposal`, `workspace.open`; includes `run.adhoc`.
- `agent.author { intent, kind?, tools? }` → **returns `{ sessionId, status:'running' }` immediately**; starts `void session.run()` in the background. Mints a per-session scoped token (allow-set = resolved grant) and passes it to the adapter (so the Pi child calls back with the *scoped* token). On terminal: release the in-flight lease, revoke the token, update registry.
- `agent.run { intent, kind?, tools? }` → **convenience**: same as author but awaits the terminal state and returns the full result (`{ sessionId, status, summary?, proposalId?, adhocRouteId? }`). Progressive disclosure: simple one-call path.
- `agent.watch { sessionId, sinceSeq? }` → returns a **replayable snapshot** (`{ sessionId, status, events }` from the transcript) and is the documented live-tail entry (over WS, subscribe to `agent:<sessionId>`; this command is the non-WS/replay path).
- `agent.cancel { sessionId }` → `{ sessionId, cancelled }`.
- `agent.list` → `{ sessions }`. `agent.transcript { sessionId }` → `{ sessionId, events }` (NOT_FOUND if unknown).
- `WorkspaceSession` gains a **lease** API: `acquireLease(): () => void` (increments `inFlight`, returns a release fn) so an async agent run keeps `workspace.open` blocked for its duration without the synchronous `runGuard` wrapper. `workspace.open` while sessions are active rejects unless `force` (which cancels running sessions — see Task 9/decision 16).
- `EngineContext` gains `agents: AgentRegistry`, `tokens: TokenRegistry`, `nextAgentId()`, and `brainAdapter` (a holder `{ current }` so the adapter can be set post-`start()` — Task 9).

- [ ] **Step 1: Failing tests:**

```ts
// src/core/commands/agent.test.ts (essentials)
it('agent.author returns sessionId immediately with running status', async () => {
  const { host } = await openHost(blockingFake())  // fake gated open until released
  const res = await host.dispatch('agent.author', { intent: 'build x' })
  expect(res.ok).toBe(true); expect(res.status).toBe('running'); expect(typeof res.sessionId).toBe('string')
})
it('agent.run awaits and returns the full result', async () => {
  const { host } = await openHost(new FakeBrainAdapter({ events: [], result: { status: 'completed', proposalId: 'recipe/x' } }))
  const res = await host.dispatch('agent.run', { intent: 'build x' })
  expect(res.status).toBe('completed'); expect(res.proposalId).toBe('recipe/x')
})
it('the grant never includes approveProposal/workspace.open and the session token enforces it', async () => {
  expect(AGENT_TOOL_GRANT).not.toContain('author.approveProposal')
  expect(AGENT_TOOL_GRANT).not.toContain('workspace.open')
  expect(AGENT_TOOL_GRANT).toContain('run.adhoc')
  // the minted session token's scope == resolved grant (assert via tokens registry)
})
it('agent.cancel halts a running session before completion', async () => { /* blocking fake + cancel → cancelled */ })
it('agent.watch/transcript return replay; transcript NOT_FOUND for unknown id', async () => { /* ... */ })
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `agent.ts`.** `resolveTools(requested)` validates against `AGENT_TOOL_GRANT` (early UX rejection, VALIDATION). `agent.author`: `requireActive()`, validate intent, `tools = resolveTools(input.tools)`, `id = ctx.nextAgentId()`, `token = ctx.tokens.mint(new Set(tools))`, `lease = ctx.session.acquireLease()`, create session with `onTerminal: () => { lease(); ctx.tokens.revoke(token) }`, pass the **scoped token + url** into the adapter holder's run, `void session.run()`, return `{ sessionId: id, status: 'running' }`. `agent.run`: same but `await session.run()` and return the full result. `agent.watch`/`transcript`/`cancel`/`list` per signatures.
- [ ] **Step 4: Wire into `engine-host.ts`** — build `AgentRegistry`, `TokenRegistry`, `brainAdapter` holder, `nextAgentId` (`agent-NNN`), register `registerAgentCommands`.
- [ ] **Step 5: Run → PASS**, `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(engine-host): async agent.author + agent.run/watch/cancel/list/transcript with host-enforced grant`

---

## Task 6: run.adhoc — session overlay + real execution + abort + dryRun

**Files:** Create `packages/waypoint-folder-host/src/routes/start-adhoc.ts`; Modify `packages/waypoint-folder-host/src/autopilot/run.ts`, `packages/waypoint-folder-host/src/runtime/local-runtime.ts`, `packages/waypoint-folder-host/src/index.ts`, `packages/waypoint-engine-host/src/core/commands/run.ts`; Tests `start-adhoc.test.ts`, `run.adhoc.test.ts`, plus an autopilot-abort test.

> Implement exactly per Task 0 Spike 2's pinned seam. Signatures below are the contract; adjust bodies to the real `parseRecipeManifest` / autopilot API.

**Produces:**
- `startAdhocRoute(projectRoot, opts: { sessionId, questYaml, recipeYamls, dryRun?, signal?, now? }): Promise<StartedQuestRoute>` — writes drafts to the **session overlay** `.waypoint/agent/<sessionId>/catalog/{quests,recipes}/` (never `.waypoint/quests|recipes`); materializes the route + tasks resolving recipes from the overlay; metadata `{ adhoc: true, sessionId, overlay: '<dir>' }`. If `!dryRun`, runs `runWaypointAutopilot(projectRoot, { routeId, catalogDir: overlayDir, signal })`.
- `runWaypointAutopilot` gains `{ signal?: AbortSignal; catalogDir?: string }`; passes `signal` to the runtime and resolves recipes from `catalogDir` when given.
- `LocalRecipeRuntime.runRecipe` gains an `AbortSignal`; on abort, SIGTERM then SIGKILL the child process group after a timeout; surfaces a cancelled outcome.
- Engine `run.adhoc { questYaml, recipeYamls?, sessionId?, dryRun? }` → `{ route }`. Beads backend → `VALIDATION` ("folder backend only in slice 2"). Threads the active agent session's `AbortSignal` when invoked by the agent.

- [ ] **Step 1: Failing folder-host test** — `startAdhocRoute` starts a route from a workspace-absent draft, writes NOTHING under `.waypoint/quests|recipes`, materializes tasks, and (dryRun:false) executes:

```ts
it('starts + executes from a session overlay without touching the live catalog', async () => {
  const root = await initFolder()
  const r = await startAdhocRoute(root, { sessionId: 's1', questYaml: QUEST, recipeYamls: [RECIPE], dryRun: true })
  expect(r.quest).toBe('adhoc-demo'); expect((r.metadata as any).adhoc).toBe(true)
  expect(existsSync(join(root, '.waypoint', 'quests', 'adhoc-demo.yaml'))).toBe(false)   // no catalog write
  expect(existsSync(join(root, '.waypoint', 'agent', 's1', 'catalog', 'quests', 'adhoc-demo.yaml'))).toBe(true)
  const tasks = await listWaypointRuntimeTasks(root, { routeId: r.id })
  expect(tasks.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Failing abort test** — an autopilot run with a recipe that spawns a long child is cancelled via `signal.abort()`; assert the route/task ends `cancelled` and the child is killed (no orphan).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** the overlay resolver + `AbortSignal` threading per Spike 2. Export `startAdhocRoute` + `StartAdhocRouteOptions` from folder-host. Validate manifests with `parseRecipeManifest`; invalid → throw a typed error carrying the failing field (mapped to `EngineError VALIDATION` at the engine boundary — Task 10).
- [ ] **Step 5: Engine `run.adhoc`** in `commands/run.ts` — beads-guard first; `ctx.session.mutate(() => startAdhocRoute(...))` for the short materialize step, then run autopilot **outside** the mutex (Eng decision 16, perf); `broadcaster.emit(route.id)`; return `{ route }`. Failing test for `questYaml` required + beads→VALIDATION + dryRun returns a non-executed route.
- [ ] **Step 6: Run → PASS**, `pnpm typecheck`.
- [ ] **Step 7: Commit** `feat: ad-hoc execution via session overlay with autopilot + AbortSignal (folder-only, experimental)`

---

## Task 7: PiCliBrainAdapter + buffered decoder + lifecycle hardening

**Files:** Create `src/brain/pi-stream-decoder.ts`, `src/brain/pi-cli-adapter.ts`, `src/brain/pi-version.ts`; Tests `pi-stream-decoder.test.ts`, `pi-cli-adapter.test.ts`; Fixtures from Task 0.

**Produces:**
- `PI_PINNED_RANGE` + `piAvailable()` + `piVersionOk(): { ok, version }` in `pi-version.ts`.
- `PiStreamDecoder` — `push(chunk: string): BrainEvent[]` + `flush(): BrainEvent[]`; buffers partial lines across chunks, handles multiple records per chunk and trailing no-newline JSON; maps Pi event `type`→`BrainEvent.kind` via the fixture-derived map; unknown types pass through as `agent.<type>`.
- `extractBrainResult(events)` — derives terminal result (from `agent.end` or, if absent, the last `agent.tool_result` carrying `proposalId`/`adhocRouteId`).
- `PiCliBrainAdapter` — spawns `pi -p --mode json --tools <grant> -e <ext> <intent>` with env `WAYPOINT_HOST_URL`/`WAYPOINT_HOST_TOKEN` (the **scoped** token) + system prompt; pipes stdout through `PiStreamDecoder`; captures stderr (tail in error); on abort SIGTERM then **SIGKILL after a timeout**; on close maps exit/condition → `BrainResult`.

- [ ] **Step 1: Failing decoder tests against captured fixtures** — whole-line, split-chunk, multi-record-per-chunk, trailing-no-newline, malformed→skipped; **snapshot test**: decoded normalized events match a committed snapshot (fails loud on Pi drift — Eng decision 12).
- [ ] **Step 2: Failing adapter test (injected fake spawn)** — streams events, returns result; abort → SIGTERM then SIGKILL after timeout → `cancelled`; non-zero exit WITH events → defined branch; spawn ENOENT → `error` with stderr tail.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** decoder (line buffer + `JSON.parse` per line), `pi-version.ts` (parse `pi --version`, compare to `PI_PINNED_RANGE`), and the adapter (inject `spawnFn` for tests; `setTimeout`-based SIGKILL escalation; `signal` removal on close).
- [ ] **Step 5: Run → PASS**, `pnpm typecheck`.
- [ ] **Step 6: Commit** `feat(engine-host): PiCliBrainAdapter + buffered stream decoder + SIGKILL escalation + version pin`

---

## Task 8: Waypoint Pi extension package

**Files:** `packages/waypoint-pi-extension/` (`package.json`, `src/host-client.ts`, `src/tools.ts`, `src/index.ts`, `src/README.md`, tests); Modify `tsconfig.json`, `vitest.config.ts`, `scripts/stage-package-builds.mjs`.

**Produces:** `createHostClient({ url, token, fetchImpl? })` (loopback `POST /cmd/<name>` with bearer; maps 401/403 to actionable errors — Task 10/decision 19); `buildWaypointTools(client)` → granted tools only (snake_case command names; excludes `approveProposal`); `src/index.ts` registers them with Pi per Spike 1; a package README (install, the two env vars it reads, the tool list).

- [ ] **Step 1–4** Scaffold package + path/alias/staging; failing host-client test (POST shape + bearer; missing url/token throws; 403 → "tool not in grant" error) → implement → PASS.
- [ ] **Step 5–7** Failing tools test (granted tools present, `approveProposal` absent, call routed to command) → implement `tools.ts` → PASS.
- [ ] **Step 8** Implement `src/index.ts` against Spike 1's registration API; add a focused test that the adapter passes each tool's name+schema+handler through.
- [ ] **Step 9: Commit** `feat(pi-extension): Waypoint tools over the engine-host HTTP API (scoped token)`

---

## Task 9: Pi adapter selection (fail-loud) + active-brain reporting + gated integration

**Files:** Modify `src/bin.ts`, `src/core/engine-host.ts`, `src/core/commands/meta.ts`, `src/index.ts`, `src/core/workspace-session.ts`; Tests `src/brain/integration.pi.test.ts`, `src/core/commands/meta.brain.test.ts`.

**Produces:**
- `bin.ts`/`engine-host.ts`: when `WAYPOINT_BRAIN=pi`, require `piVersionOk()`; if `pi` missing or version-mismatched → **fail loud** (throw a clear `problem+cause+fix` error), never silently use the fake. Otherwise default to `FakeBrainAdapter`. Adapter set via the holder after `start()` yields `{ url, token }`.
- `meta.health`/`meta.version`: report `brain: 'pi'|'fake'` (+ Pi version when pi). Test asserts it.
- `workspace.open` with `force` cancels running agent sessions (decision 16); `host.stop()` cancels all sessions. Tests: workspace-switch-mid-run cancels; host.stop cleans up.
- Gated real-Pi e2e (`piAvailable()`), structural assertions only, build-first.

- [ ] **Step 1** Implement fail-loud selection + active-brain in meta; failing tests → PASS.
- [ ] **Step 2** Implement workspace-switch/host.stop session cancellation; failing tests → PASS.
- [ ] **Step 3** Gated integration test (skipped without `pi`).
- [ ] **Step 4** Export public types in `index.ts` (`BrainAdapter`/`BrainEvent`/`BrainResult`, `FakeBrainAdapter`, `PiCliBrainAdapter`, `AGENT_TOOL_GRANT`, `AgentEventRecord`).
- [ ] **Step 5: Commit** `feat(engine-host): fail-loud Pi selection + active-brain in meta + session lifecycle on switch/stop`

---

## Task 10: Canonical error envelope + actionable auth/scope errors

**Files:** Modify `src/envelope.ts`/`src/types.ts` (confirm `details: { code, path, message }`, `field`→`path` mapping), `src/transport/http-ws/server.ts` (status mapping), `packages/waypoint-pi-extension/src/host-client.ts`; align any tests reading `details`; Test `src/envelope.shape.test.ts`.

**Why (DX decision 18/19):** README documents `details.{code,path,message}` but plan tests read `details.code` and handlers throw `{code,field,issues}`. Pin one shape so consumers (and an AI agent) can parse errors.

- [ ] **Step 1: Failing test** — `makeErrorEnvelope`/`fail` produce `{ ok:false, action:'error', error, details: { code, path, message, issues? } }`; `EngineError({code, field})` surfaces `details.path === field`; FORBIDDEN/VALIDATION/NOT_FOUND all conform.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the normalization; host-client maps HTTP 401→"authorization failed: WAYPOINT_HOST_TOKEN missing/invalid", 403→"tool not in session grant; allowed: [...]" (read allowed list from the FORBIDDEN envelope).
- [ ] **Step 4: Run → PASS**; fix any slice-1/earlier-task tests that asserted the old shape; full `pnpm vitest run` + `pnpm typecheck`.
- [ ] **Step 5: Commit** `fix(engine-host): one canonical error-envelope shape + actionable auth/scope errors`

---

## Task 11: Smoke + docs (async flow, blast radius, env table, extension install)

**Files:** Create `scripts/agent-brain-smoke.mjs`; Modify root `package.json` (`smoke:agent-brain`), `README.md`, ensure `packages/waypoint-pi-extension/README.md`.

- [ ] **Step 1** Smoke: drive `agent.run` (one-call convenience) with the fake adapter against a temp folder workspace; assert `completed` + `proposalId`; assert `agent.list`/`agent.transcript`; assert a forbidden direct call (`author.approveProposal` with a scoped token) is rejected. Build-first.
- [ ] **Step 2** `smoke:agent-brain` script entry.
- [ ] **Step 3** `pnpm build && pnpm smoke:agent-brain` → OK.
- [ ] **Step 4** README agent section rewritten to the **adopted** surface:
  - canonical **async** example: `const { sessionId } = await client.cmd('agent.author', { intent }); const unsub = await client.subscribe(['agent:'+sessionId], onEvent)`, plus the `agent.run` one-call convenience.
  - **Environment** table: `WAYPOINT_BRAIN`, `WAYPOINT_HOST_URL`, `WAYPOINT_HOST_TOKEN`, `WAYPOINT_PI_EXTENSION` (var / who-sets / default / required-when), noting URL+TOKEN are injected by the host into the Pi child.
  - **Real Pi** recipe: install pi (pinned version), `pnpm build` (produces the extension dist), set env, run.
  - per-session scoped-token model (agent can't call approveProposal/workspace.open even directly).
  - **Blast radius** subsection: recipes execute with host-process privileges, no sandbox/side-effect policy; controls = `agent.watch` + `agent.cancel` (best-effort, no rollback) + audit log; recommend low-priv user / container / scratch workspace. Document the intentional no-dry-run-default + `run.adhoc { dryRun:true }` preview + "author → inspect proposal → run" path.
  - disk footprint: `.waypoint/agent/<id>.jsonl` + `.waypoint/agent/<sessionId>/catalog/`.
  - `agent.cancel` example; commands list (`agent.author/run/watch/cancel/list/transcript`).
  - active brain (`pi`|`fake` + version) is inspectable via `meta.health`.
- [ ] **Step 5** Final verification: `pnpm vitest run && pnpm typecheck && pnpm build && pnpm smoke:engine-host && pnpm smoke:agent-brain` (pre-existing `firmvault-recipe-port.test.ts` path-drift failure tracked separately).
- [ ] **Step 6: Commit** `docs+smoke(agent-brain): async surface, blast-radius docs, env table, scoped-token smoke`

---

## Self-Review

**Spec coverage:** decisions 1 (author→propose, additive) → Tasks 2–5; 2 (Pi extension) → Task 8; 3 (BrainAdapter + agent:<id>) → Tasks 1–3,5; 4 (grant excl. approveProposal) → Tasks 4,5; 5 (ad-hoc unrestricted, promotion human-gated) → Task 6 (+ no approveProposal in grant); 6 (PiCliBrainAdapter) → Task 7. autoplan adopted decisions 7–22 → Tasks 4 (token), 5 (async author/run/watch + lease), 6 (execution+overlay+abort+dryRun), 7 (decoder+SIGKILL+version), 9 (fail-loud+active brain+lifecycle), 10 (error shape), 11 (docs/blast-radius). Spikes → Task 0 (gate).

**Type consistency:** `BrainEvent/BrainResult/BrainRunInput/BrainAdapter` (Task 2) consumed unchanged by 3,5,7. `AgentEventRecord` (Task 1) produced by 3. `DispatchContext`/`TokenRegistry` (Task 4) consumed by 5,9. `AGENT_TOOL_GRANT` (Task 5) asserted in 5, exported in 9. `startAdhocRoute` signature (Task 6) stable across folder-host + engine `run.adhoc`. Canonical envelope (Task 10) — earlier tasks' tests written against `details.code`/`details.path` from the start to avoid churn.

**Placeholder scan:** the only deferred specifics are the two Task-0 spike unknowns (Pi event kinds → decoder map; the exact overlay/abort seam), gated with captured fixtures, mirroring slice-1.

---

# /autoplan Review Record

Reviewed via /autoplan on 2026-06-18 (CEO + Eng dual-voice with Codex + Claude subagent; DX Claude-subagent-only, Codex DX degraded/stalled). Design review skipped (no UI scope).

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO | Premise: run-model posture | User Challenge | user decides | Both voices rejected "unrestricted + audit/killswitch only". **User chose Partial: security + observability** — adopt host-side per-session token + async/watchable; HOLD unrestricted-by-default execution (no dry-run default). |
| 2 | CEO | Host-side per-session token scoping | Mechanical | P1 | Closes the human-gate bypass. → Task 4. |
| 3 | CEO | agent.author async + agent.watch | Mechanical | P1 | Makes the kill-switch real pre-UI. → Task 5. |
| 4 | CEO | Pi version pin + parser snapshot test | Mechanical | P5 | Orchestrator core screen-scrapes an unconfirmed stream. → Tasks 0,7. |
| 5 | CEO | Ad-hoc drafts session-scoped, not catalog writes | Taste | P2 | Prevents collision/shadowing. → Task 6. |
| 6 | CEO | Ad-hoc folder-only (experimental); Beads parity deferred | Mechanical | P3 | Resolves "Beads first-class" contradiction explicitly. → Global Constraints + Task 6. |
| 7 | Eng | Scoped token threaded through CommandBus.dispatch + transport + TokenRegistry | Mechanical | P1 | Both CRITICAL — mechanism behind decision 2. → Task 4. |
| 8 | Eng | Rewrite author async: lease (not runGuard-await) + terminal callback (release+revoke) | Mechanical | P1 | Both CRITICAL. → Task 5. |
| 9 | Eng | Define agent.watch contract (stream + transcript replay) | Mechanical | P5 | Named but unimplemented. → Task 5. |
| 10 | Eng | run.adhoc ACTUALLY executes (autopilot) + AbortSignal through runtime; SIGTERM→SIGKILL | Scope expansion (in blast radius, user-approved) | P1/P2 | Without it run.adhoc is a no-op and cancel can't stop side effects. → Task 6. |
| 11 | Eng | Session-scoped overlay catalog + overlay-aware resolver; slug-collision safe | Mechanical | P1 | Implements decision 5. → Tasks 0,6. |
| 12 | Eng | Buffered PiStreamDecoder (split/multi/no-newline) + snapshot test + stderr capture | Mechanical | P1 | Parser drift would pass current tests. → Task 7. |
| 13 | Eng | Enforce Pi version pin; surface in meta.health | Mechanical | P5 | piAvailable() only checked existence. → Tasks 7,9. |
| 14 | Eng | agent.cancel test actually cancels (blocking fake) | Mechanical | P1 | → Tasks 2,3,5. |
| 15 | Eng | Per-topic event-ring budget (agent vs route) | Mechanical | P1 | Agent chatter starved route replay. → Task 1. |
| 16 | Eng | mutate() short; autopilot outside mutex; workspace-switch/host.stop cancels sessions; transcript-write failure degrades gracefully | Mechanical | P1/P5 | Concurrency + lifecycle correctness. → Tasks 3,5,6,9. |
| 17 | DX | Never silent fake↔pi fallback; fail loud; report active brain in meta.* | Mechanical | P5 | DX trap + safety-legibility hole. → Task 9. |
| 18 | DX | One canonical error-envelope shape (details.{code,path,message}) | Mechanical | P5 | README/tests/handlers disagreed. → Task 10. |
| 19 | DX | Auth/scope errors carry fix-text + allowed list; invalid manifest → EngineError VALIDATION | Mechanical | P1 | Enables AI self-correction. → Tasks 8,10. |
| 20 | DX | README rewritten to adopted surface (async, scoped token, env table, real-Pi recipe, HTTP/WS variant, disk footprint) | Mechanical | P1 | Section predated decisions. → Task 11. |
| 21 | DX | Blast-radius subsection + documented no-dry-run-default + optional run.adhoc {dryRun:true} | Mechanical (doc) + taste (flag, user approved) | P5/P1 | Make unrestricted execution legible. → Tasks 6,11. |
| 22 | DX | agent.run convenience (one-call author→result) alongside async author+watch | Taste (user approved) | P3 | Progressive disclosure for the simple path. → Task 5. |

## Consensus tables

**CEO (Codex + Claude subagent):** premises NO/NO; right-problem PARTIAL/PARTIAL; scope NO/NO; alternatives NO/NO; Pi/market PARTIAL/HIGH; trajectory NO/NO. Premise resolved by user (Partial). 

**Eng (Codex + Claude subagent):** architecture NO/PARTIAL; tests NO/NO; perf PARTIAL/PARTIAL; security NO/NO; errors PARTIAL/PARTIAL; deploy PARTIAL/PARTIAL. 10 must-fixes adopted (decisions 7–16).

**DX (Claude subagent; Codex DX degraded/stalled — [subagent-only]):** getting-started 7, ergonomics 8, errors 6, docs 6, safety-legibility 5. TTHW fake ~5 min / real Pi ~20–40 min. Fixes adopted (decisions 17–22).

**Cross-phase themes:** per-session token + real execution/abort (CEO+Eng); Pi dependency hardening (CEO+Eng); silent fallback + observability (CEO+DX).

**VERDICT:** Approved with decisions 2–22 integrated (premise held by user: unrestricted-by-default, now watchable + host-enforced scoping). Test-plan artifact: `~/.gstack/projects/aaron-agent-corporation-waypoint/aaron-main-test-plan-*.md`. Next: `/mar`.
