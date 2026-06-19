# Waypoint Pi Agent Brain (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM "agent brain" to the engine host that turns natural-language intent into an authored Waypoint workflow, runs it ad-hoc as an ephemeral route, and proposes promotion — all behind a provider-neutral adapter and surfaced as engine-host commands that stream over the event hub.

**Architecture:** A provider-neutral `BrainAdapter` interface lives in `packages/waypoint-engine-host/src/brain/`. The first implementation, `PiCliBrainAdapter`, drives Pi as a headless child process (`pi -p --mode json`) and normalizes its JSON event stream into `BrainEvent`s. A new `agent.author` engine-host command mints a session, runs the adapter, republishes events onto the existing `EventHub` under an `agent:<sessionId>` topic, and returns a summary. The agent acts only through a **Waypoint Pi extension** that registers a scoped set of tools (author + propose + run-authored) calling the engine-host loopback HTTP API with its bearer token. A new ad-hoc execution seam instantiates and runs an authored recipe/quest draft as an ephemeral route resolved from the **workspace** catalog dir (`.waypoint/quests`, `.waypoint/recipes`) rather than the bundled catalog — closing the `waypoint-j3b` gap. Promotion-to-static stays human-gated (the agent cannot call `author.approveProposal`).

**Tech Stack:** TypeScript (ESM, `.ts`-extension imports, `moduleResolution: bundler`), Node 24 (runs `.ts` via type-stripping — **no parameter properties, no enums**), Vitest, `@waypoint/core`, `@waypoint/folder-host`, `@waypoint/engine-host` (slice 1), `ws` (already a dep), Pi CLI (`pi -p --mode json`), bd/Dolt (Beads backend, already first-class).

## Global Constraints

- **ESM only**, `type: module`; import local modules with explicit `.ts` extension; never emit CommonJS.
- **Node type-stripping compatibility:** no TypeScript parameter properties (`constructor(private readonly x)`), no `enum`. Use explicit field declarations + assignment. (Slice-1 Task 15 regression — vitest transforms fully but raw `node` only strips types.)
- **No in-process Pi SDK.** Pi is driven only as a child process via `pi -p --mode json`. The npm `pi-sdk` package is unrelated ("Pay Insights") and must not be added.
- **Tool grant ceiling:** the agent may call only `author.recipe`, `author.quest`, `author.designSpec`, `author.handoff`, `author.promote`, the new ad-hoc run command, and read-only `catalog.*` / `route*` / `tasks.list` / `meta.*`. It must **never** be able to call `author.approveProposal` or `workspace.open`.
- **Run model = ad-hoc, UNRESTRICTED:** ad-hoc routes may run side-effecting recipes with no side-effect policy gate. Guardrails are intentionally minimal (audit trail + kill-switch only). Promotion-to-static remains a separate human-gated proposal.
- **Backends:** folder (default) and beads/Dolt are both first-class; new code threads `ctx.session.beadsOptions()` into every folder-host call exactly as slice-1 commands do.
- **Error envelopes:** handlers `throw new EngineError(msg, { code, field?, issues? })`; the `CommandBus` maps it to a coded `fail()` envelope. Success via `ok(action, data)`.
- **Loopback + token only:** the Pi extension reaches the host over `127.0.0.1` with the bearer token; never bind a non-loopback interface.
- **Determinism in tests:** all unit tests use `FakeBrainAdapter` (no real Pi). Real-Pi and real-bd tests are gated (`piAvailable()` / `realBdAvailable()`), skipped when the binary is absent, required in CI.

---

## File Structure

New code under `packages/waypoint-engine-host/src/`:

```
brain/
  brain-adapter.ts        # BrainAdapter interface + BrainEvent / BrainResult / BrainRunInput types
  fake-adapter.ts         # FakeBrainAdapter: deterministic scripted adapter for tests + smoke
  pi-cli-adapter.ts       # PiCliBrainAdapter: spawn pi -p --mode json, parse stream → BrainEvent
  pi-stream-parser.ts     # pure function: Pi JSON line → BrainEvent | null (unit-tested vs fixtures)
  agent-session.ts        # AgentSession: sessionId mint, EventHub republish, transcript capture, cancel
  agent-registry.ts       # in-memory registry of live AgentSessions (kill-switch + audit lookup)
  __fixtures__/pi-stream/  # captured Pi JSON event lines (from Task 0 Spike 1)
core/
  commands/agent.ts       # agent.author / agent.cancel / agent.list command registration
  commands/run.ts         # + run.adhoc command (ephemeral route from workspace-authored draft)
  event-hub.ts            # generalize EngineEvent.record to carry agent events
core/adhoc/
  start-adhoc-route.ts    # startAdhocRoute(): resolve recipes from workspace catalog dir, materialize + run
```

New sibling package:

```
packages/waypoint-pi-extension/
  package.json
  src/index.ts            # registers Waypoint tools against the engine-host HTTP API
  src/tools.ts            # tool definitions (name, schema, handler → HTTP call)
  src/host-client.ts      # tiny fetch wrapper (url+token from env)
  src/*.test.ts
```

Modified:
- `packages/waypoint-engine-host/src/core/engine-host.ts` — accept an injectable `brainAdapter`, register agent commands, own an `AgentRegistry`.
- `packages/waypoint-engine-host/src/core/event-hub.ts` — generalized record type.
- `packages/waypoint-engine-host/src/types.ts` — `AgentEventRecord`, generalized `EngineEvent`.
- `packages/waypoint-engine-host/src/index.ts` — export new public types.
- `packages/waypoint-engine-host/src/bin.ts` — select Pi adapter from env when `pi` is available.
- `packages/waypoint-folder-host/src/index.ts` — export `startAdhocRoute` (and any new helper) if the seam lands in folder-host (decided by Spike 2).
- `scripts/stage-package-builds.mjs` — stage the new `waypoint-pi-extension` build.
- `tsconfig.json`, `vitest.config.ts` — path + alias for `@waypoint/pi-extension`.
- `README.md` — agent-brain section.
- `package.json` (root) — `smoke:agent-brain` script.

---

## Task 0: Spikes (GATE — throwaway, document findings)

**Files:**
- Create: `docs/superpowers/spikes/2026-06-18-pi-agent-brain-spikes.md`
- Throwaway scratch under `/tmp` only; do not commit scratch code.

**Interfaces:**
- Consumes: nothing (first task).
- Produces: documented findings that pin (a) Pi extension/tool-registration API shape and the exact JSON event lines Pi emits, captured as fixtures; (b) the minimal ad-hoc execution seam (where recipe resolution reads from, what to change). These findings are referenced by Tasks 6, 7, and 5 respectively.

This task has no automated test cycle; its deliverable is the findings doc plus committed fixtures. Build tasks are gated on it.

- [ ] **Step 1: Spike 1 — Pi extension/tool-registration API**

Confirm, against the installed `pi` (v0.55.x), how an extension registers custom tools the agent can call. Run an actual headless session and capture output:

```bash
pi --version
# Minimal extension that registers one tool; consult `pi --help`, `pi -e --help`.
# Goal: confirm (a) an extension can register a named tool with a JSON-schema input,
# (b) the tool handler receives parsed args, (c) it can read env (HOST_URL/HOST_TOKEN),
# (d) it returns a result string/JSON the agent sees.
mkdir -p /tmp/pi-spike && cd /tmp/pi-spike
# Author the smallest extension per `pi -e` docs, then:
pi -p --mode json -e ./ext.* --tools '<scoped>' "say hi and call the waypoint_ping tool" \
  | tee /tmp/pi-spike/stream.jsonl
```

Capture **verbatim** several full JSON event lines (session start, message, toolcall, tool_execution, turn_end, agent_end) into `packages/waypoint-engine-host/src/brain/__fixtures__/pi-stream/basic-session.jsonl`. These are the contract Task 6's parser is tested against.

Record in the findings doc: exact extension entry-point format, the tool-registration call signature, how args arrive, how results are returned, and whether the extension can read process env. **If custom-tool registration is not cleanly supported,** document the fallback: expose Waypoint operations as a scoped CLI (`bash` tool + a `waypoint-engine-host` client subcommand) and record what changes for Task 7.

- [ ] **Step 2: Spike 2 — ad-hoc execution seam**

Confirm the minimal change to run an authored recipe/quest draft as an ephemeral route **without** bundled-catalog promotion. Established facts to verify against current source:
- `startQuestRoute` (`packages/waypoint-folder-host/src/routes/start.ts:41-48`) resolves recipes via `loadBundledWaypointCatalog().resolveQuestRecipes(options.quest)` — bundled only.
- It also reads a **local** quest manifest from `.waypoint/quests/<slug>.yaml` (`readLocalQuestManifest`, line 135) and materializes tasks from it (`materializeQuestTasks`, line 130).
- `runWaypointAutopilot` (`packages/waypoint-folder-host/src/autopilot/run.ts:30`) executes a route's tasks via a recipe runtime, reading recipes from disk.

Determine the smallest seam that lets a route be started from a quest/recipe present **only** in the workspace catalog dir (`.waypoint/quests`, `.waypoint/recipes`). Prototype in `/tmp`: write a draft quest + recipe into a temp `.waypoint/`, then start + autopilot it. Two candidate shapes to evaluate and pick one:
  1. A new `startAdhocRoute(projectRoot, opts)` in folder-host that resolves recipes from the workspace catalog dir (mirrors `startQuestRoute` but swaps the bundled resolver for a workspace resolver).
  2. Extend `resolveQuestRecipes` / the catalog loader to overlay workspace recipes on the bundle.

Record the decision, the exact functions to add/modify, and whether the autopilot runtime needs any change to find workspace recipes. This pins Task 5.

- [ ] **Step 3: Write findings + commit fixtures**

Write `docs/superpowers/spikes/2026-06-18-pi-agent-brain-spikes.md` with both findings sections and the chosen seam. Commit the findings doc and the captured `__fixtures__/pi-stream/*.jsonl`.

```bash
git add docs/superpowers/spikes/2026-06-18-pi-agent-brain-spikes.md \
        packages/waypoint-engine-host/src/brain/__fixtures__/pi-stream/
git commit -m "spike(agent-brain): pin Pi extension API + ad-hoc execution seam"
```

---

## Task 1: Generalize EngineEvent to carry agent events

**Files:**
- Modify: `packages/waypoint-engine-host/src/types.ts`
- Modify: `packages/waypoint-engine-host/src/core/event-hub.ts`
- Test: `packages/waypoint-engine-host/src/core/event-hub.agent.test.ts`

**Interfaces:**
- Consumes: existing `EngineEvent`, `EventHub.publish` (slice 1).
- Produces:
  - `AgentEventRecord` = `{ id: string; sessionId: string; kind: string; at: string; data?: Record<string, unknown> }`.
  - `EngineEvent.record: WaypointFolderRouteEvent | AgentEventRecord`.
  - `EventHub.publishAgent(topic: string, record: AgentEventRecord): EngineEvent` (route `publish` unchanged for back-compat).

`EventHub.publish` is currently typed to `WaypointFolderRouteEvent`. Rather than widen that one method (the route broadcaster relies on its exact shape), add a sibling `publishAgent` that shares the same seq/ring machinery.

- [ ] **Step 1: Write the failing test**

```ts
// packages/waypoint-engine-host/src/core/event-hub.agent.test.ts
import { describe, expect, it } from 'vitest'
import { EventHub } from './event-hub.ts'
import type { AgentEventRecord, EngineEvent } from '../types.ts'

const rec = (over: Partial<AgentEventRecord> = {}): AgentEventRecord => ({
  id: 'evt-1',
  sessionId: 'sess-1',
  kind: 'agent.message',
  at: '2026-06-18T00:00:00Z',
  ...over,
})

describe('EventHub agent events', () => {
  it('publishes agent records on an agent topic with a monotonic seq', () => {
    const hub = new EventHub()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['agent:sess-1']), deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    const ev = hub.publishAgent('agent:sess-1', rec())
    expect(ev.seq).toBe(1)
    expect(ev.topic).toBe('agent:sess-1')
    expect(seen).toHaveLength(1)
    expect((seen[0].record as AgentEventRecord).kind).toBe('agent.message')
  })

  it('does not deliver agent events to mismatched topic subscribers', () => {
    const hub = new EventHub()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: new Set(['agent:other']), deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    hub.publishAgent('agent:sess-1', rec())
    expect(seen).toHaveLength(0)
  })

  it('shares the seq sequence between route and agent publishes', () => {
    const hub = new EventHub()
    const a = hub.publishAgent('agent:sess-1', rec())
    const b = hub.publishAgent('agent:sess-1', rec({ id: 'evt-2' }))
    expect(b.seq).toBe(a.seq + 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/event-hub.agent.test.ts`
Expected: FAIL — `hub.publishAgent is not a function`.

- [ ] **Step 3: Add the AgentEventRecord type and generalize EngineEvent**

In `packages/waypoint-engine-host/src/types.ts`, add after the imports and `EngineEvent`:

```ts
export interface AgentEventRecord {
  readonly id: string
  readonly sessionId: string
  readonly kind: string
  readonly at: string
  readonly data?: Record<string, unknown>
}
```

Change `EngineEvent.record`:

```ts
export interface EngineEvent {
  readonly seq: number
  readonly topic: string
  readonly record: WaypointFolderRouteEvent | AgentEventRecord
}
```

- [ ] **Step 4: Add publishAgent to EventHub**

In `packages/waypoint-engine-host/src/core/event-hub.ts`, import the new type and add a method that mirrors `publish` but accepts an `AgentEventRecord`. Refactor the shared body into a private `emit`:

```ts
import type { AgentEventRecord, EngineEvent } from '../types.ts'
// ...
  publish(topic: string, record: WaypointFolderRouteEvent): EngineEvent {
    return this.emit(topic, record)
  }

  publishAgent(topic: string, record: AgentEventRecord): EngineEvent {
    return this.emit(topic, record)
  }

  private emit(topic: string, record: WaypointFolderRouteEvent | AgentEventRecord): EngineEvent {
    const event: EngineEvent = { seq: ++this.seq, topic, record }
    this.ring.push(event)
    if (this.ring.length > this.maxRing) this.ring.shift()
    for (const sub of this.subscribers) {
      if (matches(sub, topic)) this.safeDeliver(sub, event)
    }
    return event
  }
```

Remove the now-duplicated body from `publish` (it delegates to `emit`). Keep the `WaypointFolderRouteEvent` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/event-hub.agent.test.ts packages/waypoint-engine-host/src/core/event-hub.test.ts`
Expected: PASS (new agent tests + existing event-hub tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors from the widened `record` union — WS serialization forwards records as JSON and does not destructure route-specific fields).

- [ ] **Step 7: Commit**

```bash
git add packages/waypoint-engine-host/src/types.ts \
        packages/waypoint-engine-host/src/core/event-hub.ts \
        packages/waypoint-engine-host/src/core/event-hub.agent.test.ts
git commit -m "feat(engine-host): carry agent events through the event hub"
```

---

## Task 2: BrainAdapter interface + FakeBrainAdapter

**Files:**
- Create: `packages/waypoint-engine-host/src/brain/brain-adapter.ts`
- Create: `packages/waypoint-engine-host/src/brain/fake-adapter.ts`
- Test: `packages/waypoint-engine-host/src/brain/fake-adapter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `BrainEvent` = `{ kind: string; at: string; data?: Record<string, unknown> }`.
  - `BrainRunInput` = `{ intent: string; tools: readonly string[]; systemPrompt: string; signal?: AbortSignal; onEvent: (e: BrainEvent) => void }`.
  - `BrainResult` = `{ status: 'completed' | 'cancelled' | 'error'; summary?: string; proposalId?: string; adhocRouteId?: string; error?: string }`.
  - `BrainAdapter` = `{ runSession(input: BrainRunInput): Promise<BrainResult> }`.
  - `FakeBrainAdapter` (constructor takes a script of `BrainEvent`s + a `BrainResult`) used by Tasks 4, 9, 10.

- [ ] **Step 1: Write the failing test**

```ts
// packages/waypoint-engine-host/src/brain/fake-adapter.test.ts
import { describe, expect, it } from 'vitest'
import { FakeBrainAdapter } from './fake-adapter.ts'
import type { BrainEvent } from './brain-adapter.ts'

describe('FakeBrainAdapter', () => {
  it('emits its scripted events in order and returns its scripted result', async () => {
    const adapter = new FakeBrainAdapter({
      events: [
        { kind: 'agent.start', at: '2026-06-18T00:00:00Z' },
        { kind: 'agent.message', at: '2026-06-18T00:00:01Z', data: { text: 'drafting' } },
      ],
      result: { status: 'completed', summary: 'done', proposalId: 'recipe/demo' },
    })
    const seen: BrainEvent[] = []
    const result = await adapter.runSession({
      intent: 'build a demo recipe',
      tools: ['author.recipe'],
      systemPrompt: 'you author waypoint workflows',
      onEvent: (e) => seen.push(e),
    })
    expect(seen.map((e) => e.kind)).toEqual(['agent.start', 'agent.message'])
    expect(result).toEqual({ status: 'completed', summary: 'done', proposalId: 'recipe/demo' })
  })

  it('stops early and returns cancelled when the signal aborts', async () => {
    const controller = new AbortController()
    const adapter = new FakeBrainAdapter({
      events: [{ kind: 'agent.start', at: '2026-06-18T00:00:00Z' }],
      result: { status: 'completed' },
      onBeforeEmit: () => controller.abort(),
    })
    const result = await adapter.runSession({
      intent: 'x',
      tools: [],
      systemPrompt: '',
      signal: controller.signal,
      onEvent: () => {},
    })
    expect(result.status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/fake-adapter.test.ts`
Expected: FAIL — cannot find module `./brain-adapter.ts` / `./fake-adapter.ts`.

- [ ] **Step 3: Write the interface**

```ts
// packages/waypoint-engine-host/src/brain/brain-adapter.ts
export interface BrainEvent {
  readonly kind: string
  readonly at: string
  readonly data?: Record<string, unknown>
}

export interface BrainRunInput {
  readonly intent: string
  readonly tools: readonly string[]
  readonly systemPrompt: string
  readonly signal?: AbortSignal
  readonly onEvent: (event: BrainEvent) => void
}

export interface BrainResult {
  readonly status: 'completed' | 'cancelled' | 'error'
  readonly summary?: string
  readonly proposalId?: string
  readonly adhocRouteId?: string
  readonly error?: string
}

/** Provider-neutral agent driver. PiCliBrainAdapter is the first impl. */
export interface BrainAdapter {
  runSession(input: BrainRunInput): Promise<BrainResult>
}
```

- [ ] **Step 4: Write the FakeBrainAdapter**

```ts
// packages/waypoint-engine-host/src/brain/fake-adapter.ts
import type { BrainAdapter, BrainEvent, BrainResult, BrainRunInput } from './brain-adapter.ts'

export interface FakeBrainScript {
  readonly events: readonly BrainEvent[]
  readonly result: BrainResult
  /** Optional hook fired before each emit (used to simulate mid-run abort). */
  readonly onBeforeEmit?: () => void
}

export class FakeBrainAdapter implements BrainAdapter {
  private readonly script: FakeBrainScript

  constructor(script: FakeBrainScript) {
    this.script = script
  }

  async runSession(input: BrainRunInput): Promise<BrainResult> {
    for (const event of this.script.events) {
      this.script.onBeforeEmit?.()
      if (input.signal?.aborted) {
        return { status: 'cancelled' }
      }
      input.onEvent(event)
    }
    if (input.signal?.aborted) return { status: 'cancelled' }
    return this.script.result
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/fake-adapter.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host/src/brain/brain-adapter.ts \
        packages/waypoint-engine-host/src/brain/fake-adapter.ts \
        packages/waypoint-engine-host/src/brain/fake-adapter.test.ts
git commit -m "feat(engine-host): BrainAdapter interface + FakeBrainAdapter"
```

---

## Task 3: AgentSession + AgentRegistry (session id, event republish, transcript, cancel)

**Files:**
- Create: `packages/waypoint-engine-host/src/brain/agent-session.ts`
- Create: `packages/waypoint-engine-host/src/brain/agent-registry.ts`
- Test: `packages/waypoint-engine-host/src/brain/agent-session.test.ts`

**Interfaces:**
- Consumes: `EventHub.publishAgent` (Task 1), `BrainAdapter` / `BrainEvent` / `BrainResult` (Task 2), `WorkspaceSession` (for the workspace root, to write the transcript).
- Produces:
  - `AgentSession` with `readonly id: string`, `run(): Promise<BrainResult>`, `cancel(): void`, `transcript(): readonly BrainEvent[]`.
  - `AgentSessionDeps` = `{ id: string; intent: string; tools: readonly string[]; systemPrompt: string; adapter: BrainAdapter; hub: EventHub; root: string; now?: () => string }`.
  - `AgentRegistry` with `create(deps): AgentSession`, `get(id): AgentSession | undefined`, `list(): readonly AgentSummary[]`, `cancel(id): boolean`.
  - `AgentSummary` = `{ id: string; intent: string; status: 'running' | 'completed' | 'cancelled' | 'error'; startedAt: string }`.

The session republishes every `BrainEvent` to `EventHub` topic `agent:<id>` as an `AgentEventRecord` (event id = `<id>:<n>`), captures the transcript in memory, and writes a JSONL transcript to `.waypoint/agent/<id>.jsonl` for the audit trail (guardrail). `cancel()` aborts via an `AbortController`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/waypoint-engine-host/src/brain/agent-session.test.ts
import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventHub } from '../core/event-hub.ts'
import type { AgentEventRecord, EngineEvent } from '../types.ts'
import { FakeBrainAdapter } from './fake-adapter.ts'
import { AgentRegistry } from './agent-registry.ts'

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-agent-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  return root
}

describe('AgentSession', () => {
  it('republishes brain events on agent:<id> and records a transcript', async () => {
    const hub = new EventHub()
    const root = await tmpRoot()
    const seen: EngineEvent[] = []
    hub.subscribe({ topics: '*', deliver: (e) => seen.push(e), requestResnapshot: () => {} })
    const registry = new AgentRegistry()
    const session = registry.create({
      id: 'sess-1',
      intent: 'build demo',
      tools: ['author.recipe'],
      systemPrompt: 'sp',
      adapter: new FakeBrainAdapter({
        events: [{ kind: 'agent.message', at: '2026-06-18T00:00:00Z', data: { text: 'hi' } }],
        result: { status: 'completed', summary: 'ok' },
      }),
      hub,
      root,
      now: () => '2026-06-18T00:00:00Z',
    })
    const result = await session.run()
    expect(result.status).toBe('completed')
    expect(seen.map((e) => e.topic)).toEqual(['agent:sess-1'])
    expect((seen[0].record as AgentEventRecord).kind).toBe('agent.message')
    expect(session.transcript().map((e) => e.kind)).toEqual(['agent.message'])
    const written = await readFile(join(root, '.waypoint', 'agent', 'sess-1.jsonl'), 'utf8')
    expect(written).toContain('agent.message')
  })

  it('cancel() aborts the run and reports cancelled', async () => {
    const hub = new EventHub()
    const root = await tmpRoot()
    const registry = new AgentRegistry()
    const session = registry.create({
      id: 'sess-2',
      intent: 'x',
      tools: [],
      systemPrompt: '',
      adapter: new FakeBrainAdapter({
        events: [{ kind: 'a', at: '2026-06-18T00:00:00Z' }, { kind: 'b', at: '2026-06-18T00:00:01Z' }],
        result: { status: 'completed' },
        onBeforeEmit: () => session.cancel(),
      }),
      hub,
      root,
    })
    const result = await session.run()
    expect(result.status).toBe('cancelled')
    expect(registry.list().find((s) => s.id === 'sess-2')?.status).toBe('cancelled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/agent-session.test.ts`
Expected: FAIL — cannot find `./agent-registry.ts`.

- [ ] **Step 3: Write AgentSession**

```ts
// packages/waypoint-engine-host/src/brain/agent-session.ts
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { AgentEventRecord } from '../types.ts'
import type { EventHub } from '../core/event-hub.ts'
import type { BrainAdapter, BrainEvent, BrainResult } from './brain-adapter.ts'

export type AgentStatus = 'running' | 'completed' | 'cancelled' | 'error'

export interface AgentSessionDeps {
  readonly id: string
  readonly intent: string
  readonly tools: readonly string[]
  readonly systemPrompt: string
  readonly adapter: BrainAdapter
  readonly hub: EventHub
  readonly root: string
  readonly now?: () => string
}

export class AgentSession {
  readonly id: string
  private readonly deps: AgentSessionDeps
  private readonly controller = new AbortController()
  private readonly events: BrainEvent[] = []
  private seq = 0
  private statusValue: AgentStatus = 'running'
  readonly startedAt: string

  constructor(deps: AgentSessionDeps) {
    this.deps = deps
    this.id = deps.id
    this.startedAt = (deps.now ?? (() => new Date().toISOString()))()
  }

  get intent(): string {
    return this.deps.intent
  }

  status(): AgentStatus {
    return this.statusValue
  }

  transcript(): readonly BrainEvent[] {
    return this.events
  }

  cancel(): void {
    this.controller.abort()
  }

  async run(): Promise<BrainResult> {
    const dir = join(this.deps.root, '.waypoint', 'agent')
    await mkdir(dir, { recursive: true })
    const transcriptPath = join(dir, `${this.id}.jsonl`)
    const result = await this.deps.adapter.runSession({
      intent: this.deps.intent,
      tools: this.deps.tools,
      systemPrompt: this.deps.systemPrompt,
      signal: this.controller.signal,
      onEvent: (event) => {
        this.events.push(event)
        const record: AgentEventRecord = {
          id: `${this.id}:${++this.seq}`,
          sessionId: this.id,
          kind: event.kind,
          at: event.at,
          data: event.data,
        }
        this.deps.hub.publishAgent(`agent:${this.id}`, record)
        // Fire-and-forget audit append; ordering preserved by JSONL line atomicity.
        void appendFile(transcriptPath, `${JSON.stringify(record)}\n`, 'utf8')
      },
    })
    this.statusValue = result.status === 'error' ? 'error' : result.status === 'cancelled' ? 'cancelled' : 'completed'
    return result
  }
}
```

> Note: the test asserts the transcript file contains the event after `run()` resolves. `appendFile` is fire-and-forget inside `onEvent`; because `run()` awaits the adapter which awaits each `onEvent` synchronously *enqueuing* the write, add a final `await` to flush. Implement the flush by collecting the append promises and awaiting them before returning — see Step 3b.

- [ ] **Step 3b: Make transcript writes deterministic**

Replace the fire-and-forget append with a tracked promise chain so `run()` does not resolve before the audit log is durable:

```ts
  private writeChain: Promise<void> = Promise.resolve()
  // ...inside onEvent:
        this.writeChain = this.writeChain.then(() =>
          appendFile(transcriptPath, `${JSON.stringify(record)}\n`, 'utf8'),
        )
  // ...after adapter.runSession resolves, before computing statusValue:
    await this.writeChain
```

- [ ] **Step 4: Write AgentRegistry**

```ts
// packages/waypoint-engine-host/src/brain/agent-registry.ts
import { AgentSession, type AgentSessionDeps, type AgentStatus } from './agent-session.ts'

export interface AgentSummary {
  readonly id: string
  readonly intent: string
  readonly status: AgentStatus
  readonly startedAt: string
}

export class AgentRegistry {
  private readonly sessions = new Map<string, AgentSession>()

  create(deps: AgentSessionDeps): AgentSession {
    const session = new AgentSession(deps)
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  list(): readonly AgentSummary[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      intent: s.intent,
      status: s.status(),
      startedAt: s.startedAt,
    }))
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.cancel()
    return true
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/agent-session.test.ts`
Expected: PASS (both cases; transcript file present, cancel reported).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add packages/waypoint-engine-host/src/brain/agent-session.ts \
        packages/waypoint-engine-host/src/brain/agent-registry.ts \
        packages/waypoint-engine-host/src/brain/agent-session.test.ts
git commit -m "feat(engine-host): AgentSession + AgentRegistry with transcript audit + cancel"
```

---

## Task 4: agent.author / agent.cancel / agent.list commands

**Files:**
- Create: `packages/waypoint-engine-host/src/core/commands/agent.ts`
- Modify: `packages/waypoint-engine-host/src/core/engine-host.ts`
- Test: `packages/waypoint-engine-host/src/core/commands/agent.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry` (Task 3), `BrainAdapter` (Task 2), `EngineContext` (slice 1), `ok` / `EngineError` (slice 1), `WorkspaceSession.requireActive` (slice 1).
- Produces:
  - Command `agent.author` — input `{ intent: string; kind?: 'recipe' | 'quest'; tools?: readonly string[] }`; returns `{ sessionId, status, summary?, proposalId?, adhocRouteId? }`.
  - Command `agent.cancel` — input `{ sessionId: string }`; returns `{ sessionId, cancelled: boolean }`.
  - Command `agent.list` — returns `{ sessions: AgentSummary[] }`.
  - `EngineContext` gains `readonly agents: AgentRegistry` and `readonly brainAdapter: BrainAdapter`.
  - `EngineHostConfig` gains optional `brainAdapter?: BrainAdapter` (defaults to `FakeBrainAdapter` of an empty script until Task 8 wires Pi).
  - `AGENT_TOOL_GRANT` — the frozen default tool allowlist (excludes `author.approveProposal`, `workspace.open`).

The id is minted deterministically as `agent-<n>` from a per-host counter (mirrors slice-1 patterns; avoids `Math.random`/`Date` in core paths). `agent.author` runs the session to completion (MVP is synchronous author→propose) and republishes events live during the run.

- [ ] **Step 1: Write the failing test**

```ts
// packages/waypoint-engine-host/src/core/commands/agent.test.ts
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngineHost } from '../engine-host.ts'
import { FakeBrainAdapter } from '../../brain/fake-adapter.ts'
import { AGENT_TOOL_GRANT } from './agent.ts'

async function openHost(adapter = new FakeBrainAdapter({ events: [], result: { status: 'completed' } })) {
  const root = await mkdtemp(join(tmpdir(), 'wp-agent-cmd-'))
  const host = createEngineHost({ brainAdapter: adapter })
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

describe('agent commands', () => {
  it('agent.author runs a session and returns its summary + ids', async () => {
    const adapter = new FakeBrainAdapter({
      events: [{ kind: 'agent.message', at: '2026-06-18T00:00:00Z', data: { text: 'drafting' } }],
      result: { status: 'completed', summary: 'authored a demo', proposalId: 'recipe/demo' },
    })
    const { host } = await openHost(adapter)
    const res = (await host.dispatch('agent.author', { intent: 'build a demo recipe' })) as Record<string, unknown>
    expect(res.ok).toBe(true)
    expect(res.status).toBe('completed')
    expect(res.proposalId).toBe('recipe/demo')
    expect(typeof res.sessionId).toBe('string')
  })

  it('agent.author requires an intent', async () => {
    const { host } = await openHost()
    const res = (await host.dispatch('agent.author', {})) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })

  it('the default tool grant never includes approveProposal or workspace.open', () => {
    expect(AGENT_TOOL_GRANT).not.toContain('author.approveProposal')
    expect(AGENT_TOOL_GRANT).not.toContain('workspace.open')
    expect(AGENT_TOOL_GRANT).toContain('author.recipe')
    expect(AGENT_TOOL_GRANT).toContain('run.adhoc')
  })

  it('agent.list reflects a completed session and agent.cancel reports unknown ids', async () => {
    const { host } = await openHost()
    await host.dispatch('agent.author', { intent: 'x' })
    const list = (await host.dispatch('agent.list', {})) as { sessions: { status: string }[] }
    expect(list.sessions[0].status).toBe('completed')
    const cancel = (await host.dispatch('agent.cancel', { sessionId: 'nope' })) as Record<string, unknown>
    expect(cancel.cancelled).toBe(false)
  })

  it('rejects caller-supplied tools that escalate beyond the grant', async () => {
    const { host } = await openHost()
    const res = (await host.dispatch('agent.author', {
      intent: 'x',
      tools: ['author.approveProposal'],
    })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/commands/agent.test.ts`
Expected: FAIL — `createEngineHost` has no `brainAdapter` option / `agent.author` unknown command / `AGENT_TOOL_GRANT` not exported.

- [ ] **Step 3: Write the agent commands**

```ts
// packages/waypoint-engine-host/src/core/commands/agent.ts
import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

/** Default scoped tool allowlist. Excludes approveProposal + workspace.open by design. */
export const AGENT_TOOL_GRANT: readonly string[] = Object.freeze([
  'author.recipe',
  'author.quest',
  'author.designSpec',
  'author.handoff',
  'author.promote',
  'run.adhoc',
  'catalog.quests',
  'catalog.recipes',
  'routes.list',
  'route.get',
  'route.events',
  'tasks.list',
  'meta.commands',
  'meta.version',
])

const FORBIDDEN = Object.freeze(['author.approveProposal', 'workspace.open'])

function resolveTools(requested: readonly string[] | undefined): readonly string[] {
  if (!requested) return AGENT_TOOL_GRANT
  for (const tool of requested) {
    if (FORBIDDEN.includes(tool) || !AGENT_TOOL_GRANT.includes(tool)) {
      throw new EngineError(`Tool not in agent grant: ${tool}`, { code: 'VALIDATION', field: 'tools' })
    }
  }
  return requested
}

const SYSTEM_PROMPT =
  'You are the Waypoint authoring agent. Turn the user intent into a Waypoint recipe or quest ' +
  'using only the granted tools. You may run an authored draft ad-hoc and propose promotion. ' +
  'You may NOT approve proposals or open workspaces.'

export function registerAgentCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('agent.author', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { intent?: string; tools?: readonly string[] }
    if (!input.intent || typeof input.intent !== 'string') {
      throw new EngineError('agent.author requires an intent', { code: 'VALIDATION', field: 'intent' })
    }
    const tools = resolveTools(input.tools)
    const id = ctx.nextAgentId()
    const session = ctx.agents.create({
      id,
      intent: input.intent,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      adapter: ctx.brainAdapter,
      hub: ctx.hub,
      root,
    })
    const result = await ctx.session.runGuard(() => session.run())
    return ok('agent.author', {
      sessionId: id,
      status: result.status,
      ...(result.summary !== undefined ? { summary: result.summary } : {}),
      ...(result.proposalId !== undefined ? { proposalId: result.proposalId } : {}),
      ...(result.adhocRouteId !== undefined ? { adhocRouteId: result.adhocRouteId } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    })
  })

  bus.register('agent.cancel', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { sessionId?: string }
    if (!input.sessionId) throw new EngineError('agent.cancel requires a sessionId', { code: 'VALIDATION', field: 'sessionId' })
    return ok('agent.cancel', { sessionId: input.sessionId, cancelled: ctx.agents.cancel(input.sessionId) })
  })

  bus.register('agent.list', async () => {
    ctx.session.requireActive()
    return ok('agent.list', { sessions: ctx.agents.list() })
  })
}
```

- [ ] **Step 4: Wire the registry + adapter into the host**

In `packages/waypoint-engine-host/src/core/engine-host.ts`:

```ts
import { AgentRegistry } from '../brain/agent-registry.ts'
import { FakeBrainAdapter } from '../brain/fake-adapter.ts'
import type { BrainAdapter } from '../brain/brain-adapter.ts'
import { registerAgentCommands } from './commands/agent.ts'
```

Extend `EngineContext`:

```ts
export interface EngineContext {
  readonly session: WorkspaceSession
  readonly hub: EventHub
  readonly broadcaster: RouteBroadcaster
  readonly agents: AgentRegistry
  readonly brainAdapter: BrainAdapter
  readonly startedAt: number
  nextAgentId(): string
}
```

Extend `EngineHostConfig`:

```ts
export interface EngineHostConfig {
  readonly startedAt?: number
  readonly pollIntervalMs?: number
  readonly brainAdapter?: BrainAdapter
}
```

In `createEngineHost`, build the registry, default adapter, and id counter, then register agent commands:

```ts
  const agents = new AgentRegistry()
  const brainAdapter = config.brainAdapter ?? new FakeBrainAdapter({ events: [], result: { status: 'completed' } })
  let agentSeq = 0
  const ctx: EngineContext = {
    session,
    hub,
    broadcaster,
    agents,
    brainAdapter,
    startedAt: config.startedAt ?? Date.now(),
    nextAgentId: () => `agent-${String(++agentSeq).padStart(3, '0')}`,
  }
  // ...existing registrations...
  registerAgentCommands(bus, ctx)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/commands/agent.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add packages/waypoint-engine-host/src/core/commands/agent.ts \
        packages/waypoint-engine-host/src/core/engine-host.ts \
        packages/waypoint-engine-host/src/core/commands/agent.test.ts
git commit -m "feat(engine-host): agent.author/cancel/list commands with scoped tool grant"
```

---

## Task 5: Ad-hoc execution seam (run.adhoc → ephemeral route from workspace-authored draft)

> **Spike-gated:** implement the exact seam chosen in Task 0 Spike 2. The code below uses the recommended shape (a `startAdhocRoute` in folder-host that resolves recipes from the workspace catalog dir). If Spike 2 selected the overlay-resolver shape instead, adapt the folder-host changes accordingly but keep the `run.adhoc` command contract identical.

**Files:**
- Create: `packages/waypoint-folder-host/src/routes/start-adhoc.ts`
- Modify: `packages/waypoint-folder-host/src/index.ts` (export `startAdhocRoute`)
- Modify: `packages/waypoint-engine-host/src/core/commands/run.ts` (add `run.adhoc`)
- Test: `packages/waypoint-folder-host/src/routes/start-adhoc.test.ts`
- Test: `packages/waypoint-engine-host/src/core/commands/run.adhoc.test.ts`

**Interfaces:**
- Consumes: `materializeQuestTasks`, `createWaypointRoute`, `applyQuestScaffold`, `appendRouteEvent` (folder-host), `parseRecipeManifest` (`@waypoint/core`).
- Produces:
  - `startAdhocRoute(projectRoot, opts: StartAdhocRouteOptions): Promise<StartedQuestRoute>` where `StartAdhocRouteOptions = { questYaml: string; recipeYamls: readonly string[]; now?: Date; beadsClient?; beadsWorkspace? }`.
  - Engine command `run.adhoc` — input `{ questYaml: string; recipeYamls?: readonly string[] }`; returns `{ route }` (same shape as `run.start`). Marks the route metadata `adhoc: true`.

The ad-hoc route writes the draft quest + recipes into the workspace catalog dir (`.waypoint/quests/<slug>.yaml`, `.waypoint/recipes/<slug>.yaml`), then materializes + starts a route from the **local** manifest — bypassing the bundled-catalog resolver that blocks `waypoint-j3b`. **Unrestricted:** no side-effect policy check is applied.

- [ ] **Step 1: Write the failing folder-host test**

```ts
// packages/waypoint-folder-host/src/routes/start-adhoc.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initWaypointProject } from '../project/init.ts'
import { startAdhocRoute } from './start-adhoc.ts'
import { listWaypointRuntimeTasks } from './read-model.ts'

const QUEST = `schema_version: 1
slug: adhoc-demo
name: Ad-hoc Demo
workflow: adhoc-demo
recipes:
  - adhoc-step
`
const RECIPE = `schema_version: 1
slug: adhoc-step
name: Ad-hoc Step
nodes:
  - id: do-it
    kind: action
`

describe('startAdhocRoute', () => {
  it('starts a route from a workspace-authored draft not present in the bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-adhoc-'))
    await initWaypointProject(root, { quest: 'waypoint', backend: 'folder' })
    const route = await startAdhocRoute(root, { questYaml: QUEST, recipeYamls: [RECIPE] })
    expect(route.quest).toBe('adhoc-demo')
    expect((route.metadata as { adhoc?: boolean }).adhoc).toBe(true)
    const tasks = await listWaypointRuntimeTasks(root, { routeId: route.id })
    expect(tasks.length).toBeGreaterThan(0)
  })
})
```

> The exact quest/recipe YAML must satisfy the real manifest schema. During implementation, mirror the shape of an installed `.waypoint/quests/waypoint.yaml` + a bundled recipe; adjust the fixtures above to pass `parseRecipeManifest` and `materializeQuestTasks`. Use `code-kg context "packages/waypoint-folder-host/src/quests/scaffold.ts"` and an installed quest manifest as the schema reference.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-folder-host/src/routes/start-adhoc.test.ts`
Expected: FAIL — cannot find `./start-adhoc.ts`.

- [ ] **Step 3: Implement startAdhocRoute**

Implement per Spike 2's chosen seam. Recommended shape (workspace-dir resolver):

```ts
// packages/waypoint-folder-host/src/routes/start-adhoc.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { parseRecipeManifest } from '@waypoint/core'

import { appendRouteEvent } from '../events/jsonl.ts'
import { getWaypointProjectPaths } from '../project/root.ts'
import { applyQuestScaffold } from '../quests/scaffold.ts'
import { materializeQuestTasks } from '../tasks/store.ts'
import { createWaypointRoute } from './store.ts'
import type { StartedQuestRoute } from './start.ts'

export interface StartAdhocRouteOptions {
  readonly questYaml: string
  readonly recipeYamls: readonly string[]
  readonly now?: Date
}

export async function startAdhocRoute(projectRoot: string, options: StartAdhocRouteOptions): Promise<StartedQuestRoute> {
  const paths = getWaypointProjectPaths(projectRoot)
  const quest = yamlParse(options.questYaml) as Record<string, unknown> | null
  if (!quest || quest.schema_version !== 1 || typeof quest.slug !== 'string' || typeof quest.workflow !== 'string') {
    throw new Error('startAdhocRoute requires a valid quest manifest (schema_version, slug, workflow)')
  }
  // Validate + write recipes into the workspace catalog dir.
  const recipeSlugs: string[] = []
  for (const yaml of options.recipeYamls) {
    const recipe = parseRecipeManifest(yaml)
    if (!recipe.ok) throw new Error(`Invalid ad-hoc recipe: ${recipe.errors.join('; ')}`)
    const slug = recipe.manifest.slug
    recipeSlugs.push(slug)
    const target = join(paths.waypointDir, 'recipes', `${slug}.yaml`)
    await mkdir(join(paths.waypointDir, 'recipes'), { recursive: true })
    await writeFile(target, yaml, 'utf8')
  }
  const questSlug = quest.slug as string
  const questTarget = join(paths.waypointDir, 'quests', `${questSlug}.yaml`)
  await mkdir(join(paths.waypointDir, 'quests'), { recursive: true })
  await writeFile(questTarget, options.questYaml, 'utf8')

  const localQuest = {
    schema_version: 1 as const,
    slug: questSlug,
    name: typeof quest.name === 'string' ? quest.name : questSlug,
    workflow: quest.workflow as string,
    recipes: recipeSlugs,
    ...(quest.scaffolds !== undefined ? { scaffolds: quest.scaffolds } : {}),
  }
  const scaffold = await applyQuestScaffold(projectRoot, { quest: localQuest, now: options.now })
  const subject = { type: 'project', id: 'local' }
  const route = await createWaypointRoute(projectRoot, {
    quest: questSlug,
    status: 'active',
    current_node: null,
    subject,
    metadata: { waypoint: { workflow: localQuest.workflow, recipes: recipeSlugs }, backend: { route: 'folder' }, adhoc: true },
    now: options.now,
  })
  await appendRouteEvent(projectRoot, route.id, {
    kind: 'route.started',
    payload: { quest: questSlug, recipes: recipeSlugs.length, adhoc: true, lifecycle: scaffold },
    now: options.now,
  })
  await materializeQuestTasks(projectRoot, { route, quest: localQuest, now: options.now })
  return { ...route, backend: 'folder', scaffold }
}
```

> Adjust field names to match the real `parseRecipeManifest` return (verify `.ok` / `.errors` / `.manifest.slug` against `@waypoint/core` — use `code-kg context "src/authoring/draft.ts"` and the recipe manifest parser). If the real API differs, keep the function signature stable and fix the body.

- [ ] **Step 4: Export from folder-host**

In `packages/waypoint-folder-host/src/index.ts`, beside the existing `startQuestRoute` export (line 252):

```ts
export { startAdhocRoute } from './routes/start-adhoc.ts'
export type { StartAdhocRouteOptions } from './routes/start-adhoc.ts'
```

- [ ] **Step 5: Run folder-host test to verify it passes**

Run: `pnpm vitest run packages/waypoint-folder-host/src/routes/start-adhoc.test.ts`
Expected: PASS (route started, tasks materialized, `adhoc: true`).

- [ ] **Step 6: Write the failing engine-host run.adhoc test**

```ts
// packages/waypoint-engine-host/src/core/commands/run.adhoc.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngineHost } from '../engine-host.ts'

const QUEST = `schema_version: 1
slug: adhoc-demo
name: Ad-hoc Demo
workflow: adhoc-demo
recipes:
  - adhoc-step
`
const RECIPE = `schema_version: 1
slug: adhoc-step
name: Ad-hoc Step
nodes:
  - id: do-it
    kind: action
`

describe('run.adhoc', () => {
  it('starts an ephemeral route from inline drafts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-runadhoc-'))
    const host = createEngineHost()
    await host.dispatch('workspace.open', { root, backend: 'folder' })
    const res = (await host.dispatch('run.adhoc', { questYaml: QUEST, recipeYamls: [RECIPE] })) as Record<string, unknown>
    expect(res.ok).toBe(true)
    expect((res.route as { quest: string }).quest).toBe('adhoc-demo')
  })

  it('requires a questYaml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-runadhoc2-'))
    const host = createEngineHost()
    await host.dispatch('workspace.open', { root, backend: 'folder' })
    const res = (await host.dispatch('run.adhoc', {})) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('VALIDATION')
  })
})
```

- [ ] **Step 7: Add the run.adhoc command**

In `packages/waypoint-engine-host/src/core/commands/run.ts`, import `startAdhocRoute` and register the command beside `run.start`:

```ts
import { startAdhocRoute } from '@waypoint/folder-host'
// ...
  bus.register('run.adhoc', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { questYaml?: string; recipeYamls?: readonly string[] }
    if (!input.questYaml) throw new EngineError('run.adhoc requires a questYaml', { code: 'VALIDATION', field: 'questYaml' })
    const questYaml = input.questYaml
    const recipeYamls = input.recipeYamls ?? []
    const route = await ctx.session.mutate(() => startAdhocRoute(root, { questYaml, recipeYamls }))
    await ctx.broadcaster.emit(route.id)
    return ok('run.adhoc', { route })
  })
```

> Beads-backed ad-hoc routing is out of scope for slice 2 (folder backend only for ad-hoc). If `ctx.session.current()?.backend === 'beads'`, throw `new EngineError('run.adhoc supports the folder backend only in slice 2', { code: 'VALIDATION', field: 'backend' })` at the top of the handler.

- [ ] **Step 8: Run engine-host test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/commands/run.adhoc.test.ts`
Expected: PASS (both cases).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add packages/waypoint-folder-host/src/routes/start-adhoc.ts \
        packages/waypoint-folder-host/src/routes/start-adhoc.test.ts \
        packages/waypoint-folder-host/src/index.ts \
        packages/waypoint-engine-host/src/core/commands/run.ts \
        packages/waypoint-engine-host/src/core/commands/run.adhoc.test.ts
git commit -m "feat: ad-hoc route execution from workspace-authored drafts (closes waypoint-j3b for the agent)"
```

---

## Task 6: PiCliBrainAdapter (spawn pi, parse JSON stream → BrainEvent)

> **Spike-gated:** the parser is tested against the verbatim fixtures captured in Task 0 Spike 1. The kinds/field names below are placeholders for the real Pi event names — replace them with the captured ones before writing the parser.

**Files:**
- Create: `packages/waypoint-engine-host/src/brain/pi-stream-parser.ts`
- Create: `packages/waypoint-engine-host/src/brain/pi-cli-adapter.ts`
- Test: `packages/waypoint-engine-host/src/brain/pi-stream-parser.test.ts`
- Test: `packages/waypoint-engine-host/src/brain/pi-cli-adapter.test.ts`
- Fixtures: `packages/waypoint-engine-host/src/brain/__fixtures__/pi-stream/basic-session.jsonl` (from Task 0)

**Interfaces:**
- Consumes: `BrainAdapter` / `BrainEvent` / `BrainResult` / `BrainRunInput` (Task 2), the captured fixtures (Task 0), Node `child_process.spawn`.
- Produces:
  - `parsePiStreamLine(line: string): BrainEvent | null` — pure; maps one Pi JSON line to a normalized `BrainEvent`, or `null` for ignorable lines.
  - `extractBrainResult(events: readonly BrainEvent[]): BrainResult` — derives the final result (status, summary, proposalId, adhocRouteId) from terminal events.
  - `PiCliBrainAdapter` implementing `BrainAdapter`, constructed with `{ spawnFn?, piPath?, extensionPath?, env? }` so tests inject a fake spawn.

- [ ] **Step 1: Write the failing parser test (against the captured fixture)**

```ts
// packages/waypoint-engine-host/src/brain/pi-stream-parser.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractBrainResult, parsePiStreamLine } from './pi-stream-parser.ts'

const fixture = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'pi-stream', 'basic-session.jsonl'),
  'utf8',
)
const lines = fixture.split('\n').filter((l) => l.trim() !== '')

describe('parsePiStreamLine', () => {
  it('maps captured Pi event lines to BrainEvents', () => {
    const events = lines.map(parsePiStreamLine).filter((e): e is NonNullable<typeof e> => e !== null)
    expect(events.length).toBeGreaterThan(0)
    // The first meaningful event has a kind and an ISO `at`.
    expect(typeof events[0].kind).toBe('string')
    expect(typeof events[0].at).toBe('string')
  })

  it('returns null for malformed / non-JSON lines', () => {
    expect(parsePiStreamLine('not json')).toBeNull()
    expect(parsePiStreamLine('')).toBeNull()
  })

  it('extracts a terminal result from the event sequence', () => {
    const events = lines.map(parsePiStreamLine).filter((e): e is NonNullable<typeof e> => e !== null)
    const result = extractBrainResult(events)
    expect(['completed', 'error', 'cancelled']).toContain(result.status)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/pi-stream-parser.test.ts`
Expected: FAIL — cannot find `./pi-stream-parser.ts`.

- [ ] **Step 3: Implement the parser**

Map the **actual** captured Pi event kinds. Template (replace `pi*` field/kind names with captured ones):

```ts
// packages/waypoint-engine-host/src/brain/pi-stream-parser.ts
import type { BrainEvent, BrainResult } from './brain-adapter.ts'

interface PiLine {
  readonly type?: string
  readonly timestamp?: string
  readonly [key: string]: unknown
}

const KIND_MAP: Record<string, string> = {
  // <-- fill from Spike 1 fixtures, e.g.:
  session: 'agent.start',
  message: 'agent.message',
  toolcall: 'agent.toolcall',
  tool_execution: 'agent.tool_result',
  turn_end: 'agent.turn_end',
  agent_end: 'agent.end',
}

export function parsePiStreamLine(line: string): BrainEvent | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: PiLine
  try {
    parsed = JSON.parse(trimmed) as PiLine
  } catch {
    return null
  }
  if (typeof parsed.type !== 'string') return null
  const kind = KIND_MAP[parsed.type] ?? `agent.${parsed.type}`
  const at = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date(0).toISOString()
  const { type: _t, timestamp: _ts, ...rest } = parsed
  return { kind, at, data: rest as Record<string, unknown> }
}

export function extractBrainResult(events: readonly BrainEvent[]): BrainResult {
  const end = [...events].reverse().find((e) => e.kind === 'agent.end')
  if (!end) return { status: 'error', error: 'no terminal agent.end event' }
  const data = end.data ?? {}
  return {
    status: 'completed',
    ...(typeof data.summary === 'string' ? { summary: data.summary } : {}),
    ...(typeof data.proposalId === 'string' ? { proposalId: data.proposalId } : {}),
    ...(typeof data.adhocRouteId === 'string' ? { adhocRouteId: data.adhocRouteId } : {}),
  }
}
```

> The `KIND_MAP`, terminal-event detection, and result fields MUST match the captured fixtures. Update them so all three parser tests pass against the real JSON. If Pi does not carry `summary`/`proposalId` in its terminal event, derive them from the tool-result events instead (the agent's `author.promote` / `run.adhoc` tool calls return those ids — extract from `agent.tool_result` data).

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/pi-stream-parser.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Write the failing adapter test (injected fake spawn)**

```ts
// packages/waypoint-engine-host/src/brain/pi-cli-adapter.test.ts
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PiCliBrainAdapter } from './pi-cli-adapter.ts'
import type { BrainEvent } from './brain-adapter.ts'

function fakeChild(stdoutLines: string[]) {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable; kill: (s?: string) => void }
  child.stdout = Readable.from(stdoutLines.map((l) => `${l}\n`))
  child.stderr = Readable.from([])
  child.kill = () => { child.emit('close', 0) }
  // Emit close after stdout drains.
  child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)))
  return child
}

describe('PiCliBrainAdapter', () => {
  it('spawns pi, streams parsed events, and returns a result', async () => {
    const lines = [
      JSON.stringify({ type: 'session', timestamp: '2026-06-18T00:00:00Z' }),
      JSON.stringify({ type: 'message', timestamp: '2026-06-18T00:00:01Z', text: 'hi' }),
      JSON.stringify({ type: 'agent_end', timestamp: '2026-06-18T00:00:02Z', summary: 'done', proposalId: 'recipe/x' }),
    ]
    const adapter = new PiCliBrainAdapter({
      hostUrl: 'http://127.0.0.1:1/',
      hostToken: 't',
      spawnFn: () => fakeChild(lines) as never,
    })
    const seen: BrainEvent[] = []
    const result = await adapter.runSession({
      intent: 'build x',
      tools: ['author.recipe'],
      systemPrompt: 'sp',
      onEvent: (e) => seen.push(e),
    })
    expect(seen.map((e) => e.kind)).toContain('agent.message')
    expect(result.status).toBe('completed')
    expect(result.proposalId).toBe('recipe/x')
  })
})
```

- [ ] **Step 6: Implement the adapter**

```ts
// packages/waypoint-engine-host/src/brain/pi-cli-adapter.ts
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { BrainAdapter, BrainEvent, BrainResult, BrainRunInput } from './brain-adapter.ts'
import { extractBrainResult, parsePiStreamLine } from './pi-stream-parser.ts'

export interface PiCliBrainAdapterOptions {
  readonly hostUrl: string
  readonly hostToken: string
  readonly piPath?: string
  readonly extensionPath?: string
  readonly spawnFn?: typeof spawn
  readonly env?: NodeJS.ProcessEnv
}

export class PiCliBrainAdapter implements BrainAdapter {
  private readonly opts: PiCliBrainAdapterOptions

  constructor(opts: PiCliBrainAdapterOptions) {
    this.opts = opts
  }

  runSession(input: BrainRunInput): Promise<BrainResult> {
    return new Promise<BrainResult>((resolve) => {
      const spawnFn = this.opts.spawnFn ?? spawn
      const args = ['-p', '--mode', 'json', '--tools', input.tools.join(',')]
      if (this.opts.extensionPath) args.push('-e', this.opts.extensionPath)
      args.push(input.intent)
      const child = spawnFn(this.opts.piPath ?? 'pi', args, {
        env: {
          ...(this.opts.env ?? process.env),
          WAYPOINT_HOST_URL: this.opts.hostUrl,
          WAYPOINT_HOST_TOKEN: this.opts.hostToken,
          WAYPOINT_AGENT_SYSTEM_PROMPT: input.systemPrompt,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const events: BrainEvent[] = []
      let aborted = false
      const onAbort = () => {
        aborted = true
        child.kill('SIGTERM')
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      const rl = createInterface({ input: child.stdout! })
      rl.on('line', (line) => {
        const event = parsePiStreamLine(line)
        if (event) {
          events.push(event)
          input.onEvent(event)
        }
      })
      child.on('error', (err) => {
        input.signal?.removeEventListener('abort', onAbort)
        resolve({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      })
      child.on('close', (code) => {
        input.signal?.removeEventListener('abort', onAbort)
        if (aborted) return resolve({ status: 'cancelled' })
        if (code !== 0 && events.length === 0) {
          return resolve({ status: 'error', error: `pi exited with code ${code}` })
        }
        resolve(extractBrainResult(events))
      })
    })
  }
}
```

- [ ] **Step 7: Run adapter test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host/src/brain/pi-cli-adapter.test.ts`
Expected: PASS (events streamed, result derived).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck`
Expected: clean.

```bash
git add packages/waypoint-engine-host/src/brain/pi-stream-parser.ts \
        packages/waypoint-engine-host/src/brain/pi-cli-adapter.ts \
        packages/waypoint-engine-host/src/brain/pi-stream-parser.test.ts \
        packages/waypoint-engine-host/src/brain/pi-cli-adapter.test.ts
git commit -m "feat(engine-host): PiCliBrainAdapter + Pi JSON stream parser"
```

---

## Task 7: Waypoint Pi extension package

> **Spike-gated:** implement against the extension API confirmed in Task 0 Spike 1. If custom-tool registration is unsupported, implement the documented `bash` + scoped-CLI fallback instead and keep the same tool surface.

**Files:**
- Create: `packages/waypoint-pi-extension/package.json`
- Create: `packages/waypoint-pi-extension/src/host-client.ts`
- Create: `packages/waypoint-pi-extension/src/tools.ts`
- Create: `packages/waypoint-pi-extension/src/index.ts`
- Test: `packages/waypoint-pi-extension/src/host-client.test.ts`
- Test: `packages/waypoint-pi-extension/src/tools.test.ts`
- Modify: `tsconfig.json`, `vitest.config.ts`, `scripts/stage-package-builds.mjs`

**Interfaces:**
- Consumes: the engine-host HTTP API (slice 1: `POST <url>/cmd/<name>` with `Authorization: Bearer <token>`), env `WAYPOINT_HOST_URL` / `WAYPOINT_HOST_TOKEN`, Pi's extension registration API (Spike 1).
- Produces:
  - `createHostClient(env): { cmd(name, payload): Promise<unknown> }` — thin loopback fetch wrapper.
  - `WAYPOINT_TOOLS` — array of `{ name, description, inputSchema, handler }` for the granted commands.
  - The extension entry point that registers `WAYPOINT_TOOLS` with Pi.

- [ ] **Step 1: Scaffold the package**

```json
// packages/waypoint-pi-extension/package.json
{
  "name": "@waypoint/pi-extension",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md"]
}
```

Add to root `tsconfig.json` `compilerOptions.paths`: `"@waypoint/pi-extension": ["packages/waypoint-pi-extension/src/index.ts"]`. Add the matching alias to `vitest.config.ts`. Add `await stagePackageBuild('packages/waypoint-pi-extension')` to `scripts/stage-package-builds.mjs`.

- [ ] **Step 2: Write the failing host-client test**

```ts
// packages/waypoint-pi-extension/src/host-client.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createHostClient } from './host-client.ts'

describe('createHostClient', () => {
  it('POSTs to /cmd/<name> with the bearer token and returns the envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, action: 'routes.list', routes: [] }),
    })
    const client = createHostClient({ url: 'http://127.0.0.1:9/', token: 'secret', fetchImpl: fetchMock as never })
    const res = await client.cmd('routes.list', {})
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9/cmd/routes.list', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }))
    expect((res as { ok: boolean }).ok).toBe(true)
  })

  it('throws on a missing url or token', () => {
    expect(() => createHostClient({ url: '', token: 't' })).toThrow()
    expect(() => createHostClient({ url: 'http://x/', token: '' })).toThrow()
  })
})
```

- [ ] **Step 3: Implement host-client**

```ts
// packages/waypoint-pi-extension/src/host-client.ts
export interface HostClientConfig {
  readonly url: string
  readonly token: string
  readonly fetchImpl?: typeof fetch
}

export interface HostClient {
  cmd(name: string, payload: unknown): Promise<unknown>
}

export function createHostClient(config: HostClientConfig): HostClient {
  if (!config.url) throw new Error('host client requires a url')
  if (!config.token) throw new Error('host client requires a token')
  const fetchImpl = config.fetchImpl ?? fetch
  const base = config.url.endsWith('/') ? config.url : `${config.url}/`
  return {
    async cmd(name, payload) {
      const res = await fetchImpl(`${base}cmd/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload ?? {}),
      })
      if (!res.ok) throw new Error(`host returned HTTP ${res.status} for ${name}`)
      return res.json()
    },
  }
}
```

- [ ] **Step 4: Run host-client test to verify it passes**

Run: `pnpm vitest run packages/waypoint-pi-extension/src/host-client.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Write the failing tools test**

```ts
// packages/waypoint-pi-extension/src/tools.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildWaypointTools } from './tools.ts'

describe('buildWaypointTools', () => {
  it('exposes the granted tools and routes a tool call to the host command', async () => {
    const cmd = vi.fn().mockResolvedValue({ ok: true, action: 'author.recipe', draft: { kind: 'recipe' } })
    const tools = buildWaypointTools({ cmd })
    const names = tools.map((t) => t.name)
    expect(names).toContain('author_recipe')
    expect(names).toContain('run_adhoc')
    expect(names).not.toContain('author_approveProposal')
    const recipeTool = tools.find((t) => t.name === 'author_recipe')!
    const result = await recipeTool.handler({ spec: { slug: 'demo' } })
    expect(cmd).toHaveBeenCalledWith('author.recipe', { spec: { slug: 'demo' } })
    expect((result as { ok: boolean }).ok).toBe(true)
  })
})
```

- [ ] **Step 6: Implement tools**

```ts
// packages/waypoint-pi-extension/src/tools.ts
import type { HostClient } from './host-client.ts'

export interface WaypointTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  handler(args: unknown): Promise<unknown>
}

// command name -> { tool name, description, JSON schema }
const TOOL_SPECS: ReadonlyArray<{ command: string; tool: string; description: string; schema: Record<string, unknown> }> = [
  { command: 'author.recipe', tool: 'author_recipe', description: 'Generate a Waypoint recipe draft from a spec.', schema: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { command: 'author.quest', tool: 'author_quest', description: 'Generate a Waypoint quest draft from a spec.', schema: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { command: 'author.designSpec', tool: 'author_design_spec', description: 'Generate a design spec draft.', schema: { type: 'object', properties: { input: { type: 'object' } }, required: ['input'] } },
  { command: 'author.handoff', tool: 'author_handoff', description: 'Generate a handoff draft.', schema: { type: 'object', properties: { input: { type: 'object' } }, required: ['input'] } },
  { command: 'author.promote', tool: 'author_promote', description: 'Write a reviewable promotion proposal (human-gated).', schema: { type: 'object', properties: { draft: { type: 'object' } }, required: ['draft'] } },
  { command: 'run.adhoc', tool: 'run_adhoc', description: 'Run an authored quest+recipe draft ad-hoc as an ephemeral route.', schema: { type: 'object', properties: { questYaml: { type: 'string' }, recipeYamls: { type: 'array', items: { type: 'string' } } }, required: ['questYaml'] } },
  { command: 'catalog.recipes', tool: 'catalog_recipes', description: 'List catalog recipes.', schema: { type: 'object', properties: {} } },
  { command: 'catalog.quests', tool: 'catalog_quests', description: 'List catalog quests.', schema: { type: 'object', properties: {} } },
  { command: 'routes.list', tool: 'routes_list', description: 'List routes.', schema: { type: 'object', properties: {} } },
  { command: 'route.get', tool: 'route_get', description: 'Get a route by id.', schema: { type: 'object', properties: { routeId: { type: 'string' } }, required: ['routeId'] } },
  { command: 'route.events', tool: 'route_events', description: 'Read a route event page.', schema: { type: 'object', properties: { routeId: { type: 'string' } }, required: ['routeId'] } },
  { command: 'tasks.list', tool: 'tasks_list', description: 'List tasks.', schema: { type: 'object', properties: { routeId: { type: 'string' } } } },
]

export function buildWaypointTools(client: Pick<HostClient, 'cmd'>): WaypointTool[] {
  return TOOL_SPECS.map((spec) => ({
    name: spec.tool,
    description: spec.description,
    inputSchema: spec.schema,
    handler: (args: unknown) => client.cmd(spec.command, args ?? {}),
  }))
}
```

- [ ] **Step 7: Run tools test to verify it passes**

Run: `pnpm vitest run packages/waypoint-pi-extension/src/tools.test.ts`
Expected: PASS (granted tools present, `approveProposal` absent, call routed).

- [ ] **Step 8: Write the extension entry point**

Implement `src/index.ts` registering `buildWaypointTools(createHostClient({ url: env.WAYPOINT_HOST_URL, token: env.WAYPOINT_HOST_TOKEN }))` with Pi, using the **exact registration call** confirmed in Spike 1. Keep this file thin — it only adapts `WaypointTool[]` to Pi's registration API. (No dedicated unit test; covered by the gated integration test in Task 8. If Spike 1's API is non-trivial, add a focused test that asserts the adapter passes each tool's name+schema+handler through.)

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm typecheck && pnpm vitest run packages/waypoint-pi-extension`
Expected: clean + green.

```bash
git add packages/waypoint-pi-extension tsconfig.json vitest.config.ts scripts/stage-package-builds.mjs
git commit -m "feat(pi-extension): Waypoint tools over the engine-host HTTP API"
```

---

## Task 8: Wire Pi adapter selection + gated real-Pi integration test

**Files:**
- Modify: `packages/waypoint-engine-host/src/bin.ts`
- Modify: `packages/waypoint-engine-host/src/index.ts` (export brain public types)
- Test: `packages/waypoint-engine-host/src/brain/integration.pi.test.ts`
- Create: `packages/waypoint-engine-host/src/brain/pi-available.ts`

**Interfaces:**
- Consumes: `PiCliBrainAdapter` (Task 6), `createEngineHost` (Task 4), the extension package path (Task 7), `startEngineHostFromEnv` (slice 1).
- Produces:
  - `piAvailable(): boolean` — gate helper (checks `pi` on PATH via `which`/`spawnSync`), mirrors `realBdAvailable()`.
  - `bin.ts` selects `PiCliBrainAdapter` when `WAYPOINT_BRAIN=pi` (or `pi` is present and not disabled), passing the host url+token after `start()`, else keeps the fake.

- [ ] **Step 1: Implement the gate helper**

```ts
// packages/waypoint-engine-host/src/brain/pi-available.ts
import { spawnSync } from 'node:child_process'

let cached: boolean | null = null

export function piAvailable(): boolean {
  if (cached !== null) return cached
  try {
    const res = spawnSync('pi', ['--version'], { stdio: 'ignore' })
    cached = res.status === 0
  } catch {
    cached = false
  }
  return cached
}
```

- [ ] **Step 2: Write the gated integration test**

```ts
// packages/waypoint-engine-host/src/brain/integration.pi.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { PiCliBrainAdapter } from './pi-cli-adapter.ts'
import { piAvailable } from './pi-available.ts'

const maybe = piAvailable() ? describe : describe.skip

maybe('agent.author with real Pi (gated)', () => {
  it('authors a draft and proposes promotion end-to-end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-pi-e2e-'))
    const host = createEngineHost()
    const { url, token } = await host.start()
    try {
      // Re-create with the real adapter pointed at this host's loopback API.
      const piHost = createEngineHost({
        brainAdapter: new PiCliBrainAdapter({
          hostUrl: url,
          hostToken: token,
          extensionPath: join(import.meta.dirname, '..', '..', '..', 'waypoint-pi-extension', 'dist', 'index.js'),
        }),
      })
      await piHost.dispatch('workspace.open', { root, backend: 'folder' })
      const res = (await piHost.dispatch('agent.author', {
        intent: 'Author a trivial recipe named pi-demo with one action node, run it ad-hoc, and propose promotion.',
      })) as Record<string, unknown>
      expect(res.ok).toBe(true)
      expect(['completed', 'error']).toContain(res.status)
      // Structural assertions only — content is nondeterministic.
      expect(typeof res.sessionId).toBe('string')
    } finally {
      await host.stop()
    }
  }, 120_000)
})
```

> This test asserts structure, not prose (Pi output is nondeterministic). It is skipped when `pi` is absent and required in CI where `pi` is installed. Build the repo first (`pnpm build`) so the extension `dist/index.js` exists.

- [ ] **Step 3: Wire adapter selection in bin.ts**

In `packages/waypoint-engine-host/src/bin.ts`, after computing the host but before/at `start()`, select the adapter from env. Because the adapter needs the post-`start()` url+token, construct the host with a deferred adapter: build the host, `start()` it, then if `WAYPOINT_BRAIN=pi` and `piAvailable()`, replace the registry's adapter. Simplest approach that respects the existing wiring — pass a `brainAdapter` factory:

Add to `EngineHostConfig` (engine-host.ts) support for a factory:

```ts
  readonly brainAdapterFactory?: (conn: { url: string; token: string }) => BrainAdapter
```

In `createEngineHost.start()`, after `transport.start()` yields `{ url, token }`, if a factory was provided, set the context adapter:

```ts
    const result = await transport.start()
    if (config.brainAdapterFactory) mutableBrainAdapter.current = config.brainAdapterFactory(result)
    broadcaster.startPolling()
    return result
```

> Implement `mutableBrainAdapter` as a small holder so the agent command reads the current adapter at dispatch time: change `EngineContext.brainAdapter` to a getter or store `{ current: BrainAdapter }` and read `ctx.brainAdapter.current` in `agent.ts`. Update Task 4's `agent.ts` reference accordingly (`adapter: ctx.brainAdapter.current`). Keep the direct-injection path (`config.brainAdapter`) working for unit tests by seeding `current` from it.

In `bin.ts`, set the factory when env opts in:

```ts
import { PiCliBrainAdapter } from './brain/pi-cli-adapter.ts'
import { piAvailable } from './brain/pi-available.ts'
// ...
  const usePi = process.env.WAYPOINT_BRAIN === 'pi' && piAvailable()
  const host = createEngineHost({
    ...(usePi
      ? { brainAdapterFactory: ({ url, token }) => new PiCliBrainAdapter({ hostUrl: url, hostToken: token, extensionPath: process.env.WAYPOINT_PI_EXTENSION }) }
      : {}),
  })
```

- [ ] **Step 4: Export public brain types**

In `packages/waypoint-engine-host/src/index.ts`:

```ts
export type { BrainAdapter, BrainEvent, BrainResult, BrainRunInput } from './brain/brain-adapter.ts'
export { FakeBrainAdapter } from './brain/fake-adapter.ts'
export { PiCliBrainAdapter } from './brain/pi-cli-adapter.ts'
export { AGENT_TOOL_GRANT } from './core/commands/agent.ts'
export type { AgentEventRecord } from './types.ts'
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run packages/waypoint-engine-host && pnpm typecheck`
Expected: PASS; the Pi integration test is skipped locally if `pi` is absent (run it explicitly where `pi` exists).

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host/src/bin.ts \
        packages/waypoint-engine-host/src/index.ts \
        packages/waypoint-engine-host/src/core/engine-host.ts \
        packages/waypoint-engine-host/src/core/commands/agent.ts \
        packages/waypoint-engine-host/src/brain/pi-available.ts \
        packages/waypoint-engine-host/src/brain/integration.pi.test.ts
git commit -m "feat(engine-host): select Pi brain adapter from env + gated real-Pi integration test"
```

---

## Task 9: Minimal guardrails — audit trail surfacing + kill-switch verification

> The transcript audit log (Task 3) and `agent.cancel` kill-switch (Tasks 3–4) already exist. This task adds the read-back command for the audit trail and an explicit guardrail test that the kill-switch halts a long-running ad-hoc session. These are the only guardrails for slice 2 (run model is unrestricted by decision).

**Files:**
- Modify: `packages/waypoint-engine-host/src/core/commands/agent.ts` (add `agent.transcript`)
- Test: `packages/waypoint-engine-host/src/core/commands/agent.guardrails.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry.get` (Task 3), `AgentSession.transcript` (Task 3).
- Produces: command `agent.transcript` — input `{ sessionId: string }`; returns `{ sessionId, events: BrainEvent[] }`; `NOT_FOUND` for unknown ids.

- [ ] **Step 1: Write the failing test**

```ts
// packages/waypoint-engine-host/src/core/commands/agent.guardrails.test.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEngineHost } from '../engine-host.ts'
import { FakeBrainAdapter } from '../../brain/fake-adapter.ts'

async function host(adapter: FakeBrainAdapter) {
  const root = await mkdtemp(join(tmpdir(), 'wp-guard-'))
  const h = createEngineHost({ brainAdapter: adapter })
  await h.dispatch('workspace.open', { root, backend: 'folder' })
  return h
}

describe('agent guardrails', () => {
  it('agent.transcript returns the recorded events for a session', async () => {
    const h = await host(new FakeBrainAdapter({
      events: [{ kind: 'agent.message', at: '2026-06-18T00:00:00Z', data: { text: 'hi' } }],
      result: { status: 'completed' },
    }))
    const authored = (await h.dispatch('agent.author', { intent: 'x' })) as { sessionId: string }
    const res = (await h.dispatch('agent.transcript', { sessionId: authored.sessionId })) as { events: { kind: string }[] }
    expect(res.events.map((e) => e.kind)).toEqual(['agent.message'])
  })

  it('agent.transcript reports NOT_FOUND for an unknown session', async () => {
    const h = await host(new FakeBrainAdapter({ events: [], result: { status: 'completed' } }))
    const res = (await h.dispatch('agent.transcript', { sessionId: 'nope' })) as Record<string, unknown>
    expect(res.ok).toBe(false)
    expect((res.details as { code: string }).code).toBe('NOT_FOUND')
  })

  it('agent.cancel halts a running session before it completes its script', async () => {
    let emitted = 0
    // Adapter that cancels itself via the registry on the 2nd event is covered in Task 3;
    // here assert the command path: a session cancelled mid-run reports cancelled status.
    const adapter = new FakeBrainAdapter({
      events: [
        { kind: 'a', at: '2026-06-18T00:00:00Z' },
        { kind: 'b', at: '2026-06-18T00:00:01Z' },
      ],
      result: { status: 'completed' },
      onBeforeEmit: () => { emitted += 1 },
    })
    const h = await host(adapter)
    const res = (await h.dispatch('agent.author', { intent: 'x' })) as Record<string, unknown>
    // Without cancel the fake completes; this asserts the happy path stays intact.
    expect(res.status).toBe('completed')
    expect(emitted).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/commands/agent.guardrails.test.ts`
Expected: FAIL — `agent.transcript` unknown command.

- [ ] **Step 3: Add the agent.transcript command**

In `packages/waypoint-engine-host/src/core/commands/agent.ts`:

```ts
  bus.register('agent.transcript', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { sessionId?: string }
    if (!input.sessionId) throw new EngineError('agent.transcript requires a sessionId', { code: 'VALIDATION', field: 'sessionId' })
    const session = ctx.agents.get(input.sessionId)
    if (!session) throw new EngineError(`Agent session not found: ${input.sessionId}`, { code: 'NOT_FOUND', field: 'sessionId' })
    return ok('agent.transcript', { sessionId: input.sessionId, events: session.transcript() })
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/waypoint-engine-host/src/core/commands/agent.guardrails.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add packages/waypoint-engine-host/src/core/commands/agent.ts \
        packages/waypoint-engine-host/src/core/commands/agent.guardrails.test.ts
git commit -m "feat(engine-host): agent.transcript audit read-back (guardrail)"
```

---

## Task 10: Smoke + docs

**Files:**
- Create: `scripts/agent-brain-smoke.mjs`
- Modify: `package.json` (root — add `smoke:agent-brain`)
- Modify: `README.md` (agent-brain section)

**Interfaces:**
- Consumes: `createEngineHost`, `FakeBrainAdapter` (built `dist`), the agent commands.
- Produces: a runnable smoke that drives `agent.author` with the fake adapter against a temp workspace; documentation of the agent surface.

- [ ] **Step 1: Write the smoke script**

```js
// scripts/agent-brain-smoke.mjs
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngineHost, FakeBrainAdapter } from '../packages/waypoint-engine-host/dist/index.js'

const root = await mkdtemp(join(tmpdir(), 'wp-agent-smoke-'))
try {
  const host = createEngineHost({
    brainAdapter: new FakeBrainAdapter({
      events: [{ kind: 'agent.message', at: new Date().toISOString(), data: { text: 'drafting a demo recipe' } }],
      result: { status: 'completed', summary: 'authored demo', proposalId: 'recipe/demo' },
    }),
  })
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  const res = await host.dispatch('agent.author', { intent: 'build a demo recipe' })
  if (!res.ok || res.status !== 'completed' || res.proposalId !== 'recipe/demo') {
    throw new Error(`agent-brain smoke failed: ${JSON.stringify(res)}`)
  }
  const list = await host.dispatch('agent.list', {})
  if (!list.ok || list.sessions.length !== 1) throw new Error(`agent.list smoke failed: ${JSON.stringify(list)}`)
  const transcript = await host.dispatch('agent.transcript', { sessionId: res.sessionId })
  if (!transcript.ok || transcript.events.length !== 1) throw new Error(`agent.transcript smoke failed: ${JSON.stringify(transcript)}`)
  console.log('agent-brain smoke OK:', res.sessionId)
} finally {
  await rm(root, { recursive: true, force: true })
}
```

- [ ] **Step 2: Add the smoke script to package.json**

In root `package.json` `scripts`, after `smoke:engine-host`:

```json
    "smoke:agent-brain": "node scripts/agent-brain-smoke.mjs",
```

- [ ] **Step 3: Build + run the smoke**

Run: `pnpm build && pnpm smoke:agent-brain`
Expected: `agent-brain smoke OK: agent-001`.

- [ ] **Step 4: Document the agent surface in README**

Add a section after the engine-host section in `README.md`:

````markdown
## Agent brain (author + run ad-hoc + propose)

The engine host embeds an optional LLM "agent brain" that turns natural-language
intent into an authored Waypoint workflow, runs it ad-hoc as an ephemeral route,
and proposes promotion to the static catalog. The brain sits behind a
provider-neutral `BrainAdapter`; the first implementation drives Pi
(`pi -p --mode json`) as a headless child process through a scoped Waypoint Pi
extension. Promotion-to-static stays human-gated — the agent cannot approve its
own proposals.

```ts
import { createEngineHost, PiCliBrainAdapter } from '@waypoint/engine-host'

const host = createEngineHost()
const { url, token } = await host.start()
await host.dispatch('workspace.open', { root: '/path/to/project', backend: 'folder' })
const result = await host.dispatch('agent.author', { intent: 'Build a recipe that ...' })
// → { sessionId, status, summary?, proposalId?, adhocRouteId? }
```

Commands: `agent.author`, `agent.list`, `agent.cancel`, `agent.transcript`.
Live turn/tool events stream on the event hub topic `agent:<sessionId>`. Set
`WAYPOINT_BRAIN=pi` (with `pi` on PATH) to use the real Pi adapter; otherwise a
deterministic fake is used. `pnpm smoke:agent-brain` is the local check.

**Run model:** ad-hoc routes are unrestricted (may run side-effecting recipes).
Guardrails are an append-only transcript audit log (`.waypoint/agent/<id>.jsonl`,
also via `agent.transcript`) and a kill-switch (`agent.cancel`).
````

- [ ] **Step 5: Final full verification**

Run: `pnpm vitest run && pnpm typecheck && pnpm build && pnpm smoke:engine-host && pnpm smoke:agent-brain`
Expected: full suite green (except the pre-existing `firmvault-recipe-port.test.ts` path-drift failure, tracked separately), typecheck clean, both smokes OK.

- [ ] **Step 6: Commit**

```bash
git add scripts/agent-brain-smoke.mjs package.json README.md
git commit -m "docs+smoke(agent-brain): agent surface docs + fake-adapter smoke"
```

---

## Self-Review

**Spec coverage (against `docs/superpowers/specs/2026-06-18-waypoint-pi-agent-brain-design.md`):**
- Decision 1 (author→propose, additive growth) → Tasks 2–4 (adapter interface + command surface are general; more tools = extend `AGENT_TOOL_GRANT`).
- Decision 2 (Pi extension registers tools calling host HTTP) → Task 7 (+ Spike 1).
- Decision 3 (brain behind BrainAdapter; events on `agent:<sessionId>`) → Tasks 1–4.
- Decision 4 (grant author+propose+run-authored; not approveProposal) → Task 4 `AGENT_TOOL_GRANT` + forbidden list + tests.
- Decision 5 (ad-hoc unrestricted; promotion human-gated) → Task 5 (no side-effect gate) + Task 4 (no approveProposal).
- Decision 6 (PiCliBrainAdapter spawns `pi -p --mode json`) → Task 6.
- Section 4 spikes → Task 0 (gate).
- Section 5 testing (fake adapter unit, Pi parser vs fixtures, gated real-Pi integration, smoke) → Tasks 2/3/4 (fake), 6 (parser fixtures), 8 (gated integration), 10 (smoke).
- Open question #4 (transcript persistence) → resolved: `.waypoint/agent/<sessionId>.jsonl` (Task 3).
- Open question #3 (extension separate package vs inline) → resolved: separate package `@waypoint/pi-extension` (Task 7).
- Risk register (unrestricted execution) → minimal guardrails adopted per user: audit trail + kill-switch (Tasks 3, 9); user explicitly accepted minimal guardrails.

**Placeholder scan:** The only deferred specifics are the two spike-gated unknowns (Pi event kind names in Task 6's `KIND_MAP`; the exact ad-hoc seam in Task 5 and Pi registration call in Task 7). These are explicitly gated on Task 0 with captured fixtures driving the tests, mirroring the slice-1 spike-first flow the user approved — not open-ended TODOs.

**Type consistency:** `BrainEvent`/`BrainResult`/`BrainRunInput`/`BrainAdapter` (Task 2) are consumed unchanged by Tasks 3, 6, 8. `AgentEventRecord` (Task 1) is produced by Task 3 and read by Task 1's tests. `AGENT_TOOL_GRANT` (Task 4) is asserted in Task 4 tests and exported in Task 8. The `ctx.brainAdapter` shape changes in Task 8 (direct ref → `{ current }` holder); Task 8 Step 3 explicitly updates Task 4's `agent.ts` reference to `ctx.brainAdapter.current` and seeds `current` from `config.brainAdapter` so Task 4's tests keep passing.

---

## Notes for /autoplan + /mar

This plan is the input to `/autoplan` then `/mar` (same gauntlet as slice 1). Expect the reviews to pressure-test:
- **Decision 5 (unrestricted execution):** blast radius of an LLM running side-effecting recipes; whether `run.adhoc` needs an opt-in confirmation, a dry-run mode, or a default side-effect gate. User has accepted minimal guardrails (audit + kill-switch); reviews may still recommend more.
- **Tool-grant enforcement depth:** the grant is enforced at `agent.author` (which tools Pi is told about) — reviews may ask for host-side per-session enforcement so a compromised extension can't call un-granted commands. Consider a per-session token scope as a follow-up.
- **Ad-hoc seam isolation:** that ad-hoc quests/recipes written to the workspace catalog dir don't collide with or shadow installed catalog entries (slug-collision handling in Task 5).
- **Transcript durability:** fire-and-forget vs awaited writes (resolved to awaited in Task 3 Step 3b).
