# Waypoint Engine Host + Local API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@waypoint/engine-host`, a resident Node process that wraps `@waypoint/core` + `@waypoint/folder-host` and exposes the full run + watch + author contract over a transport-agnostic command/event core with a loopback HTTP + WebSocket adapter.

**Architecture:** A pure command/event core — `CommandBus` (named command → envelope) and `EventHub` (seq'd live event fan-out) — sits over a `WorkspaceSession` that binds one Waypoint workspace and delegates every operation to the existing folder-host functions (which auto-select folder vs Beads from workspace config). A thin HTTP+WS transport adapter translates wire ↔ core; a `transport.ts` interface is the seam where Tauri IPC later drops in. Live events are produced by **pumping newly-appended route events from the durable event log after each mutating command** (folder-host's `IEventBus` is publish-only, so there is no live subscription to tap).

**Tech Stack:** TypeScript (ESM, `type: module`), Node 22, `@waypoint/core` (`workspace:*`), `@waypoint/folder-host` (`workspace:*`), `ws` (WebSocket server), Vitest. Beads path uses the existing `bd`-spawning client folder-host constructs by default.

## Global Constraints

- **Module system:** ESM only. `"type": "module"`. Use `.ts` extension in relative imports (repo uses `allowImportingTsExtensions`, `moduleResolution: bundler`).
- **No host leakage into core:** `@waypoint/engine-host` depends on `@waypoint/core` + `@waypoint/folder-host`. Never import engine-host from `src/` (core). `src/boundaries.ts` must still pass.
- **Error envelope:** all command failures return `makeErrorEnvelope(message, details?)` from `@waypoint/core` → `{ ok:false, action:'error', error, details? }`. Success envelopes are `{ ok:true, action:'<command-name>', ...data }`.
- **Networking:** HTTP/WS listener binds `127.0.0.1` only, ephemeral port (`listen(0)`), guarded by a per-process bearer token.
- **Backends:** both `folder` and `beads` are first-class. Engine-host calls backend-agnostic folder-host functions; never branch on backend inside engine-host handlers.
- **Workspace path:** every folder-host call takes the active workspace root from `WorkspaceSession.requireActive().root`. Never read `process.cwd()` inside handlers.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.
- **Verify before done:** run `pnpm --filter @waypoint/engine-host test` (or root `pnpm test`) and `pnpm typecheck` before claiming a task complete.

---

## File Structure

```
packages/waypoint-engine-host/
  package.json                         # new workspace package
  src/
    types.ts                           # EngineEnvelope, EngineBackend, EngineEvent, contexts
    envelope.ts                        # ok() success-envelope helper (error reuses core)
    core/
      command-bus.ts                   # register/dispatch, envelope wrapping
      event-hub.ts                     # seq, ring buffer, subscribe/replay/fan-out
      workspace-session.ts             # active workspace binding + in-flight guard
      engine-host.ts                   # createEngineHost: wires session+hub+bus, pump, start/stop
      commands/
        workspace.ts                   # workspace.open, workspace.status
        catalog.ts                     # catalog.quests, catalog.recipes
        run.ts                         # run.start, routes.list, route.get, tasks.list, route.events, run.pause, run.resume
        gate.ts                        # gate.decide, discuss.post
        author.ts                      # author.quest/recipe/designSpec/handoff/draft/promote
    transport/
      transport.ts                     # Transport interface (the Tauri-IPC seam)
      http-ws/
        server.ts                      # http listener, token guard, POST /cmd/<name>
        ws.ts                          # subscribe protocol, snapshot, deltas, backpressure
    index.ts                           # public exports (createEngineHost, types)
    bin.ts                             # standalone launcher (sidecar entry)
    __tests__/
      command-bus.test.ts
      event-hub.test.ts
      workspace-session.test.ts
      commands.folder.test.ts
      author.test.ts
      http-ws.test.ts
      integration.lifecycle.test.ts    # full lifecycle, parameterized folder+beads
      helpers/
        fake-bd.ts                     # reusable fake `bd` harness (extracted)
        workspace.ts                   # temp-workspace + ws-client test helpers
scripts/
  engine-host-smoke.mjs                # mirrors existing smoke:* pattern
```

Reference signatures this plan relies on (verified against source):

- `makeErrorEnvelope(error: string, details?: unknown): { ok:false, action:'error', error, details? }` — `@waypoint/core`.
- `initWaypointProject(root, { quest: string, backend?: 'folder'|'beads', now?: Date })` — `@waypoint/folder-host`.
- `readWaypointStatus(root, options?) → WaypointProjectStatus` (`{ initialized, quest, backend, routes, beads, ... }`).
- `loadBundledWaypointCatalog() → { quests, recipes, resolveQuestRecipes(quest) }`.
- `startQuestRoute(root, { quest }) → StartedQuestRoute` (extends `WaypointFolderRoute` `{ id, quest, status, current_node, metadata? }`; auto-builds `bd` client when backend=beads).
- `listWaypointRuntimeRoutes(root)`, `getWaypointRuntimeRoute(root, routeId)`, `listWaypointRuntimeTasks(root, { routeId? })`.
- `readWaypointRuntimeRouteEvents(root, routeId, { limit?, offset? }) → { items: WaypointFolderRouteEvent[]; total; limit; offset }` where `WaypointFolderRouteEvent = { id, route_id, kind, created_at, payload? }`.
- `approveRouteGate(root, { routeId, node, note?, nextNode?, now? })`, `rejectRouteGate(root, same)`, `pauseWaypointRoute(root, { routeId, reason?, now? })`, `resumeWaypointRoute(root, { routeId, now? })`.
- `appendTaskDiscussionMessage(root, ...)`, `readTaskDiscussionMessages(root, ...)`.
- `generateAuthoringRecipeDraft(input) → { kind:'recipe', path:'recipes/<slug>.yaml', yaml, validation:{ok,errors}, warnings }` (and `generateAuthoringQuestDraft`, design-spec, handoff equivalents) — `@waypoint/core`. These return YAML + path but **do not write**.

---

### Task 1: Scaffold the `@waypoint/engine-host` package

**Files:**
- Create: `packages/waypoint-engine-host/package.json`
- Create: `packages/waypoint-engine-host/src/index.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/package.test.ts`
- Modify: `tsconfig.json` (add path mapping)
- Modify: root `package.json` (add `ws` dep + smoke script placeholder)

**Interfaces:**
- Produces: `getEngineHostInfo(): { packageName: '@waypoint/engine-host'; corePackage: 'waypoint-core' }`

- [ ] **Step 1: Write the failing test**

`packages/waypoint-engine-host/src/__tests__/package.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { getEngineHostInfo } from '../index.ts'

describe('engine-host package', () => {
  it('reports its package identity', () => {
    expect(getEngineHostInfo()).toEqual({
      packageName: '@waypoint/engine-host',
      corePackage: 'waypoint-core',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host`
Expected: FAIL — cannot resolve `../index.ts`.

- [ ] **Step 3: Create the package manifest**

`packages/waypoint-engine-host/package.json`:
```json
{
  "name": "@waypoint/engine-host",
  "version": "0.1.2",
  "private": false,
  "description": "Resident engine host + local API for Waypoint (run/watch/author over HTTP+WS).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "bin": { "waypoint-engine-host": "./dist/bin.js" },
  "dependencies": {
    "@waypoint/core": "workspace:*",
    "@waypoint/folder-host": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12"
  },
  "files": ["dist", "package.json"]
}
```

- [ ] **Step 4: Create the entry export**

`packages/waypoint-engine-host/src/index.ts`:
```ts
const WAYPOINT_CORE_PACKAGE = 'waypoint-core'
export const WAYPOINT_ENGINE_HOST_PACKAGE = '@waypoint/engine-host'

export interface EngineHostInfo {
  readonly packageName: typeof WAYPOINT_ENGINE_HOST_PACKAGE
  readonly corePackage: typeof WAYPOINT_CORE_PACKAGE
}

export function getEngineHostInfo(): EngineHostInfo {
  return { packageName: WAYPOINT_ENGINE_HOST_PACKAGE, corePackage: WAYPOINT_CORE_PACKAGE }
}
```

- [ ] **Step 5: Add path mapping**

In `tsconfig.json`, add to `compilerOptions.paths`:
```json
"@waypoint/engine-host": ["./packages/waypoint-engine-host/src/index.ts"]
```

- [ ] **Step 6: Add `ws` to the root dependency tree**

Run: `pnpm add ws --filter @waypoint/engine-host && pnpm add -D @types/ws --filter @waypoint/engine-host`
Expected: lockfile updates; `ws` resolves.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm vitest run packages/waypoint-engine-host && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/waypoint-engine-host tsconfig.json package.json pnpm-lock.yaml
git commit -m "feat(engine-host): scaffold @waypoint/engine-host package"
```

---

### Task 2: Engine envelope + shared types

**Files:**
- Create: `packages/waypoint-engine-host/src/types.ts`
- Create: `packages/waypoint-engine-host/src/envelope.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/envelope.test.ts`

**Interfaces:**
- Produces:
  - `type EngineBackend = 'folder' | 'beads'`
  - `interface EngineSuccessEnvelope { ok: true; action: string; [k: string]: unknown }`
  - `type EngineEnvelope = EngineSuccessEnvelope | WaypointErrorEnvelope`
  - `ok(action: string, data?: Record<string, unknown>): EngineSuccessEnvelope`
  - `interface EngineEvent { seq: number; topic: string; record: WaypointFolderRouteEvent }`

- [ ] **Step 1: Write the failing test**

`src/__tests__/envelope.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ok } from '../envelope.ts'

describe('ok envelope', () => {
  it('builds a success envelope with action and data', () => {
    expect(ok('routes.list', { routes: [] })).toEqual({ ok: true, action: 'routes.list', routes: [] })
  })
  it('builds a bare success envelope', () => {
    expect(ok('workspace.status')).toEqual({ ok: true, action: 'workspace.status' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "ok envelope"`
Expected: FAIL — cannot resolve `../envelope.ts`.

- [ ] **Step 3: Implement types**

`src/types.ts`:
```ts
import type { WaypointErrorEnvelope } from '@waypoint/core'
import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'

export type EngineBackend = 'folder' | 'beads'

export interface EngineSuccessEnvelope {
  readonly ok: true
  readonly action: string
  readonly [key: string]: unknown
}

export type EngineEnvelope = EngineSuccessEnvelope | WaypointErrorEnvelope

export interface EngineEvent {
  readonly seq: number
  readonly topic: string
  readonly record: WaypointFolderRouteEvent
}
```

> If `WaypointFolderRouteEvent` is not re-exported from `@waypoint/folder-host`, add `export type { WaypointFolderRouteEvent } from './events/types.ts'` to `packages/waypoint-folder-host/src/index.ts` in this task and commit it with the rest.

- [ ] **Step 4: Implement envelope helper**

`src/envelope.ts`:
```ts
import type { EngineSuccessEnvelope } from './types.ts'

export function ok(action: string, data: Record<string, unknown> = {}): EngineSuccessEnvelope {
  return { ok: true, action, ...data }
}

export { makeErrorEnvelope } from '@waypoint/core'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "ok envelope"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host packages/waypoint-folder-host
git commit -m "feat(engine-host): add engine envelope + shared types"
```

---

### Task 3: CommandBus

**Files:**
- Create: `packages/waypoint-engine-host/src/core/command-bus.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/command-bus.test.ts`

**Interfaces:**
- Consumes: `EngineEnvelope` (Task 2), `makeErrorEnvelope` (Task 2).
- Produces:
  - `type CommandHandler = (payload: unknown) => Promise<EngineEnvelope> | EngineEnvelope`
  - `class CommandBus { register(name, handler): void; has(name): boolean; names(): string[]; dispatch(name, payload): Promise<EngineEnvelope> }`

- [ ] **Step 1: Write the failing test**

`src/__tests__/command-bus.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CommandBus } from '../core/command-bus.ts'
import { ok } from '../envelope.ts'

describe('CommandBus', () => {
  it('dispatches a registered command', async () => {
    const bus = new CommandBus()
    bus.register('ping', () => ok('ping', { pong: true }))
    expect(await bus.dispatch('ping', {})).toEqual({ ok: true, action: 'ping', pong: true })
  })

  it('returns an error envelope for an unknown command', async () => {
    const bus = new CommandBus()
    expect(await bus.dispatch('nope', {})).toEqual({ ok: false, action: 'error', error: 'Unknown command: nope' })
  })

  it('normalizes a thrown error into an error envelope', async () => {
    const bus = new CommandBus()
    bus.register('boom', () => { throw new Error('kaboom') })
    expect(await bus.dispatch('boom', {})).toEqual({ ok: false, action: 'error', error: 'kaboom' })
  })

  it('rejects duplicate registration', () => {
    const bus = new CommandBus()
    bus.register('dup', () => ok('dup'))
    expect(() => bus.register('dup', () => ok('dup'))).toThrow(/already registered/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t CommandBus`
Expected: FAIL — cannot resolve `../core/command-bus.ts`.

- [ ] **Step 3: Implement CommandBus**

`src/core/command-bus.ts`:
```ts
import { makeErrorEnvelope } from '@waypoint/core'
import type { EngineEnvelope } from '../types.ts'

export type CommandHandler = (payload: unknown) => Promise<EngineEnvelope> | EngineEnvelope

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler>()

  register(name: string, handler: CommandHandler): void {
    if (this.handlers.has(name)) throw new Error(`Command already registered: ${name}`)
    this.handlers.set(name, handler)
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  names(): string[] {
    return [...this.handlers.keys()].sort()
  }

  async dispatch(name: string, payload: unknown): Promise<EngineEnvelope> {
    const handler = this.handlers.get(name)
    if (!handler) return makeErrorEnvelope(`Unknown command: ${name}`)
    try {
      return await handler(payload)
    } catch (error) {
      return makeErrorEnvelope(error instanceof Error ? error.message : String(error))
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t CommandBus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add CommandBus with envelope normalization"
```

---

### Task 4: EventHub

**Files:**
- Create: `packages/waypoint-engine-host/src/core/event-hub.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/event-hub.test.ts`

**Interfaces:**
- Consumes: `EngineEvent` (Task 2), `WaypointFolderRouteEvent` (folder-host).
- Produces:
  - `interface EventSubscriber { topics: ReadonlySet<string> | '*'; deliver(e: EngineEvent): void; requestResnapshot(): void }`
  - `class EventHub { constructor(opts?: { ringSize?: number }); currentSeq(): number; publish(topic: string, record: WaypointFolderRouteEvent): EngineEvent; subscribe(sub: EventSubscriber, lastSeq?: number): () => void }`

- [ ] **Step 1: Write the failing test**

`src/__tests__/event-hub.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { EventHub } from '../core/event-hub.ts'
import type { EngineEvent } from '../types.ts'

const rec = (kind: string) => ({ id: 'e', route_id: 'route-001', kind, created_at: 1 })

function collector() {
  const events: EngineEvent[] = []
  let resnapshots = 0
  return {
    events,
    get resnapshots() { return resnapshots },
    sub: (topics: ReadonlySet<string> | '*') => ({
      topics,
      deliver: (e: EngineEvent) => { events.push(e) },
      requestResnapshot: () => { resnapshots += 1 },
    }),
  }
}

describe('EventHub', () => {
  it('assigns monotonic seq and fans out to matching subscribers', () => {
    const hub = new EventHub()
    const c = collector()
    hub.subscribe(c.sub(new Set(['route:route-001'])))
    const e1 = hub.publish('route:route-001', rec('a'))
    const e2 = hub.publish('route:route-001', rec('b'))
    expect([e1.seq, e2.seq]).toEqual([1, 2])
    expect(c.events.map((e) => e.record.kind)).toEqual(['a', 'b'])
  })

  it('does not deliver non-matching topics; wildcard receives all', () => {
    const hub = new EventHub()
    const specific = collector()
    const all = collector()
    hub.subscribe(specific.sub(new Set(['route:route-999'])))
    hub.subscribe(all.sub('*'))
    hub.publish('route:route-001', rec('a'))
    expect(specific.events).toHaveLength(0)
    expect(all.events).toHaveLength(1)
  })

  it('replays buffered events newer than lastSeq on subscribe', () => {
    const hub = new EventHub()
    hub.publish('route:route-001', rec('a')) // seq 1
    hub.publish('route:route-001', rec('b')) // seq 2
    const c = collector()
    hub.subscribe(c.sub('*'), 1)
    expect(c.events.map((e) => e.seq)).toEqual([2])
  })

  it('requests re-snapshot when lastSeq predates the ring buffer', () => {
    const hub = new EventHub({ ringSize: 2 })
    hub.publish('route:route-001', rec('a')) // 1 (evicted)
    hub.publish('route:route-001', rec('b')) // 2
    hub.publish('route:route-001', rec('c')) // 3
    const c = collector()
    hub.subscribe(c.sub('*'), 1)
    expect(c.resnapshots).toBe(1)
    expect(c.events).toHaveLength(0)
  })

  it('stops delivering after unsubscribe', () => {
    const hub = new EventHub()
    const c = collector()
    const unsub = hub.subscribe(c.sub('*'))
    unsub()
    hub.publish('route:route-001', rec('a'))
    expect(c.events).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t EventHub`
Expected: FAIL — cannot resolve `../core/event-hub.ts`.

- [ ] **Step 3: Implement EventHub**

`src/core/event-hub.ts`:
```ts
import type { WaypointFolderRouteEvent } from '@waypoint/folder-host'
import type { EngineEvent } from '../types.ts'

export interface EventSubscriber {
  readonly topics: ReadonlySet<string> | '*'
  deliver(event: EngineEvent): void
  requestResnapshot(): void
}

function matches(sub: EventSubscriber, topic: string): boolean {
  return sub.topics === '*' || sub.topics.has(topic)
}

export class EventHub {
  private seq = 0
  private readonly ring: EngineEvent[] = []
  private readonly maxRing: number
  private readonly subscribers = new Set<EventSubscriber>()

  constructor(opts: { ringSize?: number } = {}) {
    this.maxRing = opts.ringSize ?? 1000
  }

  currentSeq(): number {
    return this.seq
  }

  publish(topic: string, record: WaypointFolderRouteEvent): EngineEvent {
    const event: EngineEvent = { seq: ++this.seq, topic, record }
    this.ring.push(event)
    if (this.ring.length > this.maxRing) this.ring.shift()
    for (const sub of this.subscribers) {
      if (matches(sub, topic)) sub.deliver(event)
    }
    return event
  }

  subscribe(sub: EventSubscriber, lastSeq?: number): () => void {
    if (lastSeq !== undefined) {
      const oldest = this.ring[0]?.seq
      if (oldest !== undefined && lastSeq < oldest - 1) {
        sub.requestResnapshot()
      } else {
        for (const event of this.ring) {
          if (event.seq > lastSeq && matches(sub, event.topic)) sub.deliver(event)
        }
      }
    }
    this.subscribers.add(sub)
    return () => { this.subscribers.delete(sub) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t EventHub`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add EventHub with seq, ring replay, re-snapshot"
```

---

### Task 5: WorkspaceSession

**Files:**
- Create: `packages/waypoint-engine-host/src/core/workspace-session.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/workspace-session.test.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/helpers/workspace.ts`

**Interfaces:**
- Consumes: `initWaypointProject`, `readWaypointStatus` (folder-host); `EngineBackend` (Task 2).
- Produces:
  - `interface WorkspaceState { root: string; backend: EngineBackend; initialized: true }`
  - `interface OpenWorkspaceInput { root: string; backend?: EngineBackend; initBeads?: boolean; force?: boolean }`
  - `class WorkspaceSession { current(): WorkspaceState | null; requireActive(): WorkspaceState; open(input): Promise<WorkspaceState>; runGuard<T>(fn: () => Promise<T>): Promise<T>; status(): Promise<WaypointProjectStatus> }`

- [ ] **Step 1: Write the shared workspace helper**

`src/__tests__/helpers/workspace.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function makeTempDir(prefix = 'wp-engine-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
```

- [ ] **Step 2: Write the failing test**

`src/__tests__/workspace-session.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceSession } from '../core/workspace-session.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('WorkspaceSession', () => {
  let dir: string
  beforeEach(async () => { dir = await makeTempDir() })
  afterEach(async () => { await cleanup(dir) })

  it('throws requireActive before any workspace is open', () => {
    const session = new WorkspaceSession()
    expect(session.current()).toBeNull()
    expect(() => session.requireActive()).toThrow(/No workspace open/)
  })

  it('initializes a fresh folder workspace on open', async () => {
    const session = new WorkspaceSession()
    const state = await session.open({ root: dir, backend: 'folder' })
    expect(state).toEqual({ root: dir, backend: 'folder', initialized: true })
    const status = await session.status()
    expect(status.initialized).toBe(true)
    expect(status.backend).toBe('folder')
  })

  it('refuses to switch workspace while a run is in flight unless forced', async () => {
    const session = new WorkspaceSession()
    await session.open({ root: dir, backend: 'folder' })
    let release!: () => void
    const inFlight = session.runGuard(() => new Promise<void>((r) => { release = () => r() }))
    const second = await makeTempDir()
    try {
      await expect(session.open({ root: second, backend: 'folder' })).rejects.toThrow(/runs are active/)
      await expect(session.open({ root: second, backend: 'folder', force: true })).resolves.toMatchObject({ root: second })
    } finally {
      release()
      await inFlight
      await cleanup(second)
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t WorkspaceSession`
Expected: FAIL — cannot resolve `../core/workspace-session.ts`.

- [ ] **Step 4: Implement WorkspaceSession**

`src/core/workspace-session.ts`:
```ts
import { initWaypointProject, readWaypointStatus } from '@waypoint/folder-host'
import type { WaypointProjectStatus } from '@waypoint/folder-host'
import type { EngineBackend } from '../types.ts'

export interface WorkspaceState {
  readonly root: string
  readonly backend: EngineBackend
  readonly initialized: true
}

export interface OpenWorkspaceInput {
  readonly root: string
  readonly backend?: EngineBackend
  readonly initBeads?: boolean
  readonly force?: boolean
}

export class WorkspaceSession {
  private state: WorkspaceState | null = null
  private inFlight = 0

  current(): WorkspaceState | null {
    return this.state
  }

  requireActive(): WorkspaceState {
    if (!this.state) throw new Error('No workspace open; call workspace.open first')
    return this.state
  }

  async open(input: OpenWorkspaceInput): Promise<WorkspaceState> {
    if (typeof input.root !== 'string' || input.root.trim() === '') {
      throw new Error('workspace.open requires a non-empty root path')
    }
    if (this.state && this.inFlight > 0 && !input.force) {
      throw new Error('Cannot switch workspace while runs are active; pass force to override')
    }
    const backend: EngineBackend = input.backend ?? 'folder'
    const status = await readWaypointStatus(input.root)
    if (!status.initialized) {
      await initWaypointProject(input.root, { quest: 'waypoint', backend })
    }
    this.state = { root: input.root, backend, initialized: true }
    return this.state
  }

  async status(): Promise<WaypointProjectStatus> {
    return readWaypointStatus(this.requireActive().root)
  }

  async runGuard<T>(fn: () => Promise<T>): Promise<T> {
    this.inFlight += 1
    try {
      return await fn()
    } finally {
      this.inFlight -= 1
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t WorkspaceSession`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add WorkspaceSession with init + run guard"
```

---

### Task 6: EngineHost shell + workspace/catalog commands

**Files:**
- Create: `packages/waypoint-engine-host/src/core/engine-host.ts`
- Create: `packages/waypoint-engine-host/src/core/commands/workspace.ts`
- Create: `packages/waypoint-engine-host/src/core/commands/catalog.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts`

**Interfaces:**
- Consumes: `CommandBus`, `EventHub`, `WorkspaceSession`, `ok`, `loadBundledWaypointCatalog`.
- Produces:
  - `interface EngineContext { session: WorkspaceSession; hub: EventHub; pumpRouteEvents(routeId: string): Promise<void> }`
  - `interface EngineHost { bus: CommandBus; hub: EventHub; session: WorkspaceSession; dispatch(name, payload): Promise<EngineEnvelope>; snapshot(): Promise<{ routes; tasks }>; pumpRouteEvents(routeId): Promise<void> }`
  - `createEngineHost(config?: { initialRoot?: string; initialBackend?: EngineBackend }): EngineHost`
  - `registerWorkspaceCommands(bus, ctx)`, `registerCatalogCommands(bus, ctx)`

- [ ] **Step 1: Write the failing test**

`src/__tests__/commands.folder.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host commands (folder)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => { dir = await makeTempDir(); host = createEngineHost() })
  afterEach(async () => { await cleanup(dir) })

  it('opens a workspace and reports status', async () => {
    const opened = await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    expect(opened).toMatchObject({ ok: true, action: 'workspace.open', workspace: { backend: 'folder' } })
    const status = await host.dispatch('workspace.status', {})
    expect(status).toMatchObject({ ok: true, action: 'workspace.status', status: { initialized: true } })
  })

  it('lists the bundled quest catalog', async () => {
    await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
    const quests = await host.dispatch('catalog.quests', {})
    expect(quests.ok).toBe(true)
    expect(Array.isArray((quests as { quests: unknown[] }).quests)).toBe(true)
    expect((quests as { quests: unknown[] }).quests.length).toBeGreaterThan(0)
  })

  it('errors clearly when no workspace is open', async () => {
    expect(await host.dispatch('catalog.quests', {})).toEqual({
      ok: false, action: 'error', error: 'No workspace open; call workspace.open first',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "engine-host commands"`
Expected: FAIL — cannot resolve `../core/engine-host.ts`.

- [ ] **Step 3: Implement workspace commands**

`src/core/commands/workspace.ts`:
```ts
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'
import { ok } from '../../envelope.ts'

export function registerWorkspaceCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('workspace.open', async (payload) => {
    const input = (payload ?? {}) as { root?: string; backend?: 'folder' | 'beads'; initBeads?: boolean; force?: boolean }
    const workspace = await ctx.session.open({
      root: input.root ?? '',
      backend: input.backend,
      initBeads: input.initBeads,
      force: input.force,
    })
    return ok('workspace.open', { workspace })
  })

  bus.register('workspace.status', async () => {
    const status = await ctx.session.status()
    return ok('workspace.status', { status })
  })
}
```

- [ ] **Step 4: Implement catalog commands**

`src/core/commands/catalog.ts`:
```ts
import { loadBundledWaypointCatalog } from '@waypoint/folder-host'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'
import { ok } from '../../envelope.ts'

export function registerCatalogCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('catalog.quests', async () => {
    ctx.session.requireActive()
    const catalog = await loadBundledWaypointCatalog()
    return ok('catalog.quests', { quests: catalog.quests })
  })

  bus.register('catalog.recipes', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    const catalog = await loadBundledWaypointCatalog()
    if (input.quest) {
      const resolved = catalog.resolveQuestRecipes(input.quest)
      if (resolved.ok === false) throw new Error(resolved.message)
      return ok('catalog.recipes', { quest: input.quest, recipes: resolved.recipes })
    }
    return ok('catalog.recipes', { recipes: catalog.recipes })
  })
}
```

> Verify the exact field names on the bundled catalog (`catalog.quests`, `catalog.recipes`, and `resolveQuestRecipes(...)` result `{ ok, recipes, message }`) against `packages/waypoint-folder-host/src/catalog/bundled.ts` while implementing; adjust property access to match.

- [ ] **Step 5: Implement the EngineHost shell**

`src/core/engine-host.ts`:
```ts
import {
  listWaypointRuntimeRoutes,
  listWaypointRuntimeTasks,
  readWaypointRuntimeRouteEvents,
} from '@waypoint/folder-host'
import type { WaypointFolderRoute, WaypointFolderTask } from '@waypoint/folder-host'
import { CommandBus } from './command-bus.ts'
import { EventHub } from './event-hub.ts'
import { WorkspaceSession } from './workspace-session.ts'
import { registerWorkspaceCommands } from './commands/workspace.ts'
import { registerCatalogCommands } from './commands/catalog.ts'
import type { EngineBackend, EngineEnvelope } from '../types.ts'

export interface EngineContext {
  readonly session: WorkspaceSession
  readonly hub: EventHub
  pumpRouteEvents(routeId: string): Promise<void>
}

export interface EngineHost {
  readonly bus: CommandBus
  readonly hub: EventHub
  readonly session: WorkspaceSession
  dispatch(name: string, payload: unknown): Promise<EngineEnvelope>
  snapshot(): Promise<{ routes: WaypointFolderRoute[]; tasks: WaypointFolderTask[] }>
  pumpRouteEvents(routeId: string): Promise<void>
}

export interface EngineHostConfig {
  readonly initialRoot?: string
  readonly initialBackend?: EngineBackend
}

export function createEngineHost(config: EngineHostConfig = {}): EngineHost {
  const session = new WorkspaceSession()
  const hub = new EventHub()
  const bus = new CommandBus()
  const broadcastOffsets = new Map<string, number>()

  async function pumpRouteEvents(routeId: string): Promise<void> {
    const { root } = session.requireActive()
    const offset = broadcastOffsets.get(routeId) ?? 0
    const page = await readWaypointRuntimeRouteEvents(root, routeId, { limit: 1000, offset })
    for (const item of page.items) hub.publish(`route:${routeId}`, item)
    broadcastOffsets.set(routeId, offset + page.items.length)
  }

  const ctx: EngineContext = { session, hub, pumpRouteEvents }

  registerWorkspaceCommands(bus, ctx)
  registerCatalogCommands(bus, ctx)
  // run/gate/author command groups registered in later tasks

  if (config.initialRoot) {
    void session.open({ root: config.initialRoot, backend: config.initialBackend })
  }

  return {
    bus,
    hub,
    session,
    dispatch: (name, payload) => bus.dispatch(name, payload),
    pumpRouteEvents,
    async snapshot() {
      const { root } = session.requireActive()
      const [routes, tasks] = await Promise.all([
        listWaypointRuntimeRoutes(root),
        listWaypointRuntimeTasks(root),
      ])
      return { routes, tasks }
    },
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "engine-host commands"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add EngineHost shell + workspace/catalog commands"
```

---

### Task 7: Run/watch commands + event pump

**Files:**
- Create: `packages/waypoint-engine-host/src/core/commands/run.ts`
- Modify: `packages/waypoint-engine-host/src/core/engine-host.ts` (register run commands)
- Modify: `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts` (add run/watch cases)

**Interfaces:**
- Consumes: `startQuestRoute`, `listWaypointRuntimeRoutes`, `getWaypointRuntimeRoute`, `listWaypointRuntimeTasks`, `readWaypointRuntimeRouteEvents`, `pauseWaypointRoute`, `resumeWaypointRoute` (folder-host); `ctx.pumpRouteEvents`, `ctx.session.runGuard`.
- Produces: `registerRunCommands(bus, ctx)` registering `run.start`, `routes.list`, `route.get`, `tasks.list`, `route.events`, `run.pause`, `run.resume`.

- [ ] **Step 1: Write the failing test (append to commands.folder.test.ts)**

```ts
it('starts a route, lists it, and emits live events to a subscriber', async () => {
  await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  const received: string[] = []
  host.hub.subscribe({ topics: '*', deliver: (e) => received.push(e.record.kind), requestResnapshot: () => {} })

  const started = await host.dispatch('run.start', { quest: 'waypoint' })
  expect(started).toMatchObject({ ok: true, action: 'run.start', route: { quest: 'waypoint', status: 'active' } })

  const routes = await host.dispatch('routes.list', {})
  expect((routes as { routes: unknown[] }).routes).toHaveLength(1)

  const routeId = (started as { route: { id: string } }).route.id
  const tasks = await host.dispatch('tasks.list', { routeId })
  expect(tasks.ok).toBe(true)

  const events = await host.dispatch('route.events', { routeId })
  expect((events as { page: { items: unknown[] } }).page.items.length).toBeGreaterThan(0)
  expect(received.length).toBeGreaterThan(0) // pump fed the hub on run.start
})

it('pauses and resumes a route', async () => {
  await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  const started = await host.dispatch('run.start', { quest: 'waypoint' })
  const routeId = (started as { route: { id: string } }).route.id
  const paused = await host.dispatch('run.pause', { routeId, reason: 'lunch' })
  expect(paused).toMatchObject({ ok: true, action: 'run.pause', route: { status: 'paused' } })
  const resumed = await host.dispatch('run.resume', { routeId })
  expect(resumed).toMatchObject({ ok: true, action: 'run.resume', route: { status: 'active' } })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "live events"`
Expected: FAIL — `run.start` is an unknown command.

- [ ] **Step 3: Implement run commands**

`src/core/commands/run.ts`:
```ts
import {
  getWaypointRuntimeRoute,
  listWaypointRuntimeRoutes,
  listWaypointRuntimeTasks,
  pauseWaypointRoute,
  readWaypointRuntimeRouteEvents,
  resumeWaypointRoute,
  startQuestRoute,
} from '@waypoint/folder-host'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'
import { ok } from '../../envelope.ts'

export function registerRunCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('run.start', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    if (!input.quest) throw new Error('run.start requires a quest slug')
    const route = await ctx.session.runGuard(() => startQuestRoute(root, { quest: input.quest! }))
    await ctx.pumpRouteEvents(route.id)
    return ok('run.start', { route })
  })

  bus.register('routes.list', async () => {
    const { root } = ctx.session.requireActive()
    return ok('routes.list', { routes: await listWaypointRuntimeRoutes(root) })
  })

  bus.register('route.get', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    if (!input.routeId) throw new Error('route.get requires a routeId')
    const route = await getWaypointRuntimeRoute(root, input.routeId)
    if (!route) throw new Error(`Route not found: ${input.routeId}`)
    return ok('route.get', { route })
  })

  bus.register('tasks.list', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    return ok('tasks.list', { tasks: await listWaypointRuntimeTasks(root, { routeId: input.routeId }) })
  })

  bus.register('route.events', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string; limit?: number; offset?: number }
    if (!input.routeId) throw new Error('route.events requires a routeId')
    const page = await readWaypointRuntimeRouteEvents(root, input.routeId, { limit: input.limit, offset: input.offset })
    return ok('route.events', { page })
  })

  bus.register('run.pause', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string; reason?: string }
    if (!input.routeId) throw new Error('run.pause requires a routeId')
    const route = await ctx.session.runGuard(() => pauseWaypointRoute(root, { routeId: input.routeId!, reason: input.reason }))
    await ctx.pumpRouteEvents(route.id)
    return ok('run.pause', { route })
  })

  bus.register('run.resume', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string }
    if (!input.routeId) throw new Error('run.resume requires a routeId')
    const route = await ctx.session.runGuard(() => resumeWaypointRoute(root, { routeId: input.routeId! }))
    await ctx.pumpRouteEvents(route.id)
    return ok('run.resume', { route })
  })
}
```

- [ ] **Step 4: Register run commands in engine-host.ts**

In `src/core/engine-host.ts`, add the import and call:
```ts
import { registerRunCommands } from './commands/run.ts'
// ...after registerCatalogCommands(bus, ctx):
registerRunCommands(bus, ctx)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "live events|pauses and resumes"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add run/watch commands with live event pump"
```

---

### Task 8: Gate + discussion commands

**Files:**
- Create: `packages/waypoint-engine-host/src/core/commands/gate.ts`
- Modify: `packages/waypoint-engine-host/src/core/engine-host.ts` (register)
- Modify: `packages/waypoint-engine-host/src/__tests__/commands.folder.test.ts` (add gate case)

**Interfaces:**
- Consumes: `approveRouteGate`, `rejectRouteGate` (folder-host, `{ routeId, node, note?, nextNode? }`), `appendTaskDiscussionMessage` (folder-host).
- Produces: `registerGateCommands(bus, ctx)` registering `gate.decide`, `discuss.post`.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('decides a gate (approve) and emits an event', async () => {
  await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  const started = await host.dispatch('run.start', { quest: 'waypoint' })
  const route = (started as { route: { id: string; current_node: string | null } }).route
  const node = route.current_node ?? 'phase-1'
  const decided = await host.dispatch('gate.decide', { routeId: route.id, gateId: node, decision: 'approve' })
  expect(decided).toMatchObject({ ok: true, action: 'gate.decide', route: { status: 'active' } })
})

it('rejects an invalid gate decision value', async () => {
  await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  const started = await host.dispatch('run.start', { quest: 'waypoint' })
  const route = (started as { route: { id: string; current_node: string | null } }).route
  const res = await host.dispatch('gate.decide', { routeId: route.id, gateId: route.current_node ?? 'x', decision: 'maybe' })
  expect(res).toMatchObject({ ok: false, action: 'error' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "decides a gate"`
Expected: FAIL — `gate.decide` unknown command.

- [ ] **Step 3: Implement gate/discuss commands**

`src/core/commands/gate.ts`:
```ts
import { appendTaskDiscussionMessage, approveRouteGate, rejectRouteGate } from '@waypoint/folder-host'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'
import { ok } from '../../envelope.ts'

export function registerGateCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('gate.decide', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { routeId?: string; gateId?: string; decision?: string; note?: string; nextNode?: string }
    if (!input.routeId) throw new Error('gate.decide requires a routeId')
    if (!input.gateId) throw new Error('gate.decide requires a gateId')
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      throw new Error(`gate.decide decision must be "approve" or "reject": ${String(input.decision)}`)
    }
    const args = { routeId: input.routeId, node: input.gateId, note: input.note, nextNode: input.nextNode }
    const route = await ctx.session.runGuard(() =>
      input.decision === 'approve' ? approveRouteGate(root, args) : rejectRouteGate(root, args),
    )
    await ctx.pumpRouteEvents(route.id)
    return ok('gate.decide', { route })
  })

  bus.register('discuss.post', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { taskId?: string; message?: string; author?: 'user' | 'agent' }
    if (!input.taskId) throw new Error('discuss.post requires a taskId')
    if (!input.message) throw new Error('discuss.post requires a message')
    const message = await appendTaskDiscussionMessage(root, {
      taskId: input.taskId,
      content: input.message,
      authoredBy: input.author ?? 'user',
    })
    return ok('discuss.post', { message })
  })
}
```

> Confirm `appendTaskDiscussionMessage`'s exact input field names against `packages/waypoint-folder-host/src/discussion/store.ts` while implementing (it may use `content`/`authoredBy` or different names); align the call and adjust the success payload accordingly.

- [ ] **Step 4: Register in engine-host.ts**

```ts
import { registerGateCommands } from './commands/gate.ts'
// ...after registerRunCommands(bus, ctx):
registerGateCommands(bus, ctx)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "decides a gate|invalid gate"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add gate.decide + discuss.post commands"
```

---

### Task 9: Author commands + deterministic promote

**Files:**
- Create: `packages/waypoint-engine-host/src/core/commands/author.ts`
- Modify: `packages/waypoint-engine-host/src/core/engine-host.ts` (register)
- Create: `packages/waypoint-engine-host/src/__tests__/author.test.ts`

**Interfaces:**
- Consumes: `generateAuthoringRecipeDraft`, `generateAuthoringQuestDraft`, design-spec + handoff generators (`@waypoint/core`); `node:fs/promises` `writeFile`/`mkdir`; `getWaypointProjectPaths` (folder-host) for the workspace catalog dir.
- Produces: `registerAuthorCommands(bus, ctx)` registering `author.recipe`, `author.quest`, `author.designSpec`, `author.handoff`, `author.draft`, `author.promote`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/author.test.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host author commands', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  beforeEach(async () => { dir = await makeTempDir(); host = createEngineHost(); await host.dispatch('workspace.open', { root: dir, backend: 'folder' }) })
  afterEach(async () => { await cleanup(dir) })

  it('generates a recipe draft (no write) with yaml + validation', async () => {
    const res = await host.dispatch('author.recipe', {
      spec: { slug: 'demo-recipe', name: 'Demo Recipe', prompt: 'Do the demo work.', source: { inspected_paths: ['src/index.ts'] } },
    })
    expect(res).toMatchObject({ ok: true, action: 'author.recipe', draft: { kind: 'recipe', path: 'recipes/demo-recipe.yaml' } })
    expect((res as { draft: { yaml: string } }).draft.yaml).toContain('slug: demo-recipe')
  })

  it('rejects an invalid draft via the generator validation', async () => {
    const res = await host.dispatch('author.recipe', {
      spec: { slug: 'Bad Slug', name: '', prompt: '', source: { inspected_paths: [] } },
    })
    expect(res).toMatchObject({ ok: false, action: 'error' })
  })

  it('promote writes a validated recipe draft into the workspace catalog', async () => {
    const draft = await host.dispatch('author.recipe', {
      spec: { slug: 'demo-recipe', name: 'Demo Recipe', prompt: 'Do the demo work.', source: { inspected_paths: ['src/index.ts'] } },
    })
    const yaml = (draft as { draft: { yaml: string; path: string } }).draft
    const promoted = await host.dispatch('author.promote', { path: yaml.path, yaml: yaml.yaml })
    expect(promoted).toMatchObject({ ok: true, action: 'author.promote' })
    const written = await readFile(join(dir, '.waypoint', yaml.path), 'utf8')
    expect(written).toContain('slug: demo-recipe')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "author commands"`
Expected: FAIL — `author.recipe` unknown command.

- [ ] **Step 3: Implement author commands**

`src/core/commands/author.ts`:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import {
  generateAuthoringDesignSpec,
  generateAuthoringHandoffDraft,
  generateAuthoringQuestDraft,
  generateAuthoringRecipeDraft,
} from '@waypoint/core'
import { getWaypointProjectPaths } from '@waypoint/folder-host'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'
import { ok } from '../../envelope.ts'

function assertValid(draft: { validation: { ok: boolean; errors: readonly string[] } }): void {
  if (!draft.validation.ok) throw new Error(`Authoring draft invalid: ${draft.validation.errors.join('; ')}`)
}

function safeRelative(target: string): string {
  const normalized = normalize(target)
  if (isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error(`author.promote path must be a safe relative path: ${target}`)
  }
  return normalized
}

export function registerAuthorCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('author.recipe', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { spec?: Parameters<typeof generateAuthoringRecipeDraft>[0] }
    if (!input.spec) throw new Error('author.recipe requires a spec')
    const draft = generateAuthoringRecipeDraft(input.spec)
    assertValid(draft)
    return ok('author.recipe', { draft })
  })

  bus.register('author.quest', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { spec?: Parameters<typeof generateAuthoringQuestDraft>[0] }
    if (!input.spec) throw new Error('author.quest requires a spec')
    const draft = generateAuthoringQuestDraft(input.spec)
    assertValid(draft)
    return ok('author.quest', { draft })
  })

  bus.register('author.designSpec', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { input?: Parameters<typeof generateAuthoringDesignSpec>[0] }
    if (!input.input) throw new Error('author.designSpec requires an input')
    return ok('author.designSpec', { draft: generateAuthoringDesignSpec(input.input) })
  })

  bus.register('author.handoff', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { input?: Parameters<typeof generateAuthoringHandoffDraft>[0] }
    if (!input.input) throw new Error('author.handoff requires an input')
    return ok('author.handoff', { draft: generateAuthoringHandoffDraft(input.input) })
  })

  // author.draft: thin alias that returns the generator output for whichever kind is requested.
  bus.register('author.draft', async (payload) => {
    ctx.session.requireActive()
    const input = (payload ?? {}) as { kind?: 'recipe' | 'quest'; spec?: unknown }
    if (input.kind === 'quest') {
      const draft = generateAuthoringQuestDraft(input.spec as Parameters<typeof generateAuthoringQuestDraft>[0])
      assertValid(draft)
      return ok('author.draft', { draft })
    }
    const draft = generateAuthoringRecipeDraft(input.spec as Parameters<typeof generateAuthoringRecipeDraft>[0])
    assertValid(draft)
    return ok('author.draft', { draft })
  })

  bus.register('author.promote', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { path?: string; yaml?: string }
    if (!input.path || typeof input.yaml !== 'string') {
      throw new Error('author.promote requires { path, yaml }')
    }
    const relative = safeRelative(input.path)
    const paths = getWaypointProjectPaths(root)
    const destination = join(paths.waypointDir, relative)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, input.yaml, 'utf8')
    return ok('author.promote', { path: relative, destination })
  })
}
```

> While implementing: confirm the exported generator names (`generateAuthoringDesignSpec`, `generateAuthoringHandoffDraft`) against `src/authoring/*.ts` / `src/index.ts` and adjust imports to the actual names. The recipe/quest generators are confirmed (`generateAuthoringRecipeDraft`, `generateAuthoringQuestDraft`). If a design-spec/handoff generator has a different signature, wire `author.designSpec`/`author.handoff` to the real export; do not invent one.

- [ ] **Step 4: Register in engine-host.ts**

```ts
import { registerAuthorCommands } from './commands/author.ts'
// ...after registerGateCommands(bus, ctx):
registerAuthorCommands(bus, ctx)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "author commands"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add author commands + deterministic promote"
```

---

### Task 10: Transport interface + HTTP server

**Files:**
- Create: `packages/waypoint-engine-host/src/transport/transport.ts`
- Create: `packages/waypoint-engine-host/src/transport/http-ws/server.ts`
- Modify: `packages/waypoint-engine-host/src/core/engine-host.ts` (add `start`/`stop`)
- Create: `packages/waypoint-engine-host/src/__tests__/http-ws.test.ts`

**Interfaces:**
- Consumes: `EngineHost.dispatch`, `node:http`, `node:crypto` `randomBytes`.
- Produces:
  - `interface Transport { start(): Promise<{ port: number; token: string; url: string }>; stop(): Promise<void> }`
  - `createHttpWsTransport(host: EngineHost, opts?: { host?: string; port?: number; token?: string }): Transport`
  - `EngineHost.start(opts?)`/`EngineHost.stop()` delegating to the configured transport.

- [ ] **Step 1: Write the failing test (HTTP half)**

`src/__tests__/http-ws.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host HTTP transport', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  let started: { port: number; token: string; url: string }
  beforeEach(async () => {
    dir = await makeTempDir()
    host = createEngineHost()
    started = await host.start()
  })
  afterEach(async () => { await host.stop(); await cleanup(dir) })

  it('binds loopback on an ephemeral port with a token', () => {
    expect(started.port).toBeGreaterThan(0)
    expect(started.token).toMatch(/^[a-f0-9]{32,}$/)
    expect(started.url).toContain('127.0.0.1')
  })

  it('rejects requests without the bearer token', async () => {
    const res = await fetch(`${started.url}/cmd/workspace.status`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('dispatches a command over HTTP with the token', async () => {
    const open = await fetch(`${started.url}/cmd/workspace.open`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ root: dir, backend: 'folder' }),
    })
    expect(open.status).toBe(200)
    expect(await open.json()).toMatchObject({ ok: true, action: 'workspace.open' })
  })

  it('returns the error envelope for an unknown command', async () => {
    const res = await fetch(`${started.url}/cmd/nope`, {
      method: 'POST',
      headers: { authorization: `Bearer ${started.token}` },
    })
    expect(await res.json()).toMatchObject({ ok: false, action: 'error', error: 'Unknown command: nope' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "HTTP transport"`
Expected: FAIL — `host.start` is not a function.

- [ ] **Step 3: Define the transport interface**

`src/transport/transport.ts`:
```ts
export interface TransportStartResult {
  readonly port: number
  readonly token: string
  readonly url: string
}

export interface Transport {
  start(): Promise<TransportStartResult>
  stop(): Promise<void>
}
```

- [ ] **Step 4: Implement the HTTP server (WS wired in Task 11)**

`src/transport/http-ws/server.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { makeErrorEnvelope } from '@waypoint/core'
import type { EngineHost } from '../../core/engine-host.ts'
import type { Transport, TransportStartResult } from '../transport.ts'

export interface HttpWsTransportOptions {
  readonly host?: string
  readonly port?: number
  readonly token?: string
}

export function createHttpWsTransport(host: EngineHost, opts: HttpWsTransportOptions = {}): Transport {
  const bindHost = opts.host ?? '127.0.0.1'
  const token = opts.token ?? randomBytes(24).toString('hex')
  let server: Server | null = null

  function authorized(req: IncomingMessage): boolean {
    return req.headers.authorization === `Bearer ${token}`
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (chunks.length === 0) return {}
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') return {}
    return JSON.parse(text)
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(payload)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorized(req)) { send(res, 401, makeErrorEnvelope('Unauthorized')); return }
    const url = new URL(req.url ?? '/', `http://${bindHost}`)
    const match = url.pathname.match(/^\/cmd\/(.+)$/)
    if (req.method !== 'POST' || !match) { send(res, 404, makeErrorEnvelope(`Not found: ${url.pathname}`)); return }
    let payload: unknown
    try {
      payload = await readBody(req)
    } catch {
      send(res, 400, makeErrorEnvelope('Invalid JSON body'))
      return
    }
    const envelope = await host.dispatch(decodeURIComponent(match[1]), payload)
    send(res, envelope.ok ? 200 : 200, envelope)
  }

  return {
    async start(): Promise<TransportStartResult> {
      server = createServer((req, res) => { void handle(req, res) })
      await new Promise<void>((resolve) => server!.listen(opts.port ?? 0, bindHost, resolve))
      const port = (server.address() as AddressInfo).port
      return { port, token, url: `http://${bindHost}:${port}` }
    },
    async stop(): Promise<void> {
      if (!server) return
      await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())))
      server = null
    },
  }
}
```

- [ ] **Step 5: Wire start/stop into EngineHost**

In `src/core/engine-host.ts`: extend the `EngineHost` interface with `start(opts?): Promise<TransportStartResult>` and `stop(): Promise<void>`, hold a lazily-created transport, and delegate. Add to the returned object:
```ts
import { createHttpWsTransport, type HttpWsTransportOptions } from '../transport/http-ws/server.ts'
import type { Transport, TransportStartResult } from '../transport/transport.ts'
// inside createEngineHost, before `return`:
let transport: Transport | null = null
const engineHost: EngineHost = {
  bus, hub, session,
  dispatch: (name, payload) => bus.dispatch(name, payload),
  pumpRouteEvents,
  snapshot: async () => { /* unchanged body from Task 6 */ },
  async start(startOpts?: HttpWsTransportOptions) {
    if (!transport) transport = createHttpWsTransport(engineHost, startOpts)
    return transport.start()
  },
  async stop() { if (transport) { await transport.stop(); transport = null } },
}
return engineHost
```
(Update the `EngineHost` interface to declare `start(opts?: HttpWsTransportOptions): Promise<TransportStartResult>` and `stop(): Promise<void>`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "HTTP transport"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add transport interface + loopback HTTP server"
```

---

### Task 11: WebSocket subscribe/snapshot/delta layer

**Files:**
- Create: `packages/waypoint-engine-host/src/transport/http-ws/ws.ts`
- Modify: `packages/waypoint-engine-host/src/transport/http-ws/server.ts` (attach WS upgrade)
- Modify: `packages/waypoint-engine-host/src/__tests__/http-ws.test.ts` (add WS case)

**Interfaces:**
- Consumes: `ws` (`WebSocketServer`), `EngineHost.hub`, `EngineHost.snapshot`, the bearer token.
- Produces: `attachWebSocket(server, host, token): WebSocketServer` — handshake token check, `{ subscribe: { topics, lastSeq? } }` → `{ type:'snapshot', ... }` then `{ type:'event', topic, record, seq }` deltas; backpressure → `{ type:'resnapshot' }`.

- [ ] **Step 1: Write the failing test (append to http-ws.test.ts)**

```ts
import { WebSocket } from 'ws'

it('streams a snapshot then live deltas over WebSocket', async () => {
  await fetch(`${started.url}/cmd/workspace.open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ root: dir, backend: 'folder' }),
  })

  const wsUrl = `${started.url.replace('http', 'ws')}/ws?token=${started.token}`
  const socket = new WebSocket(wsUrl)
  const messages: any[] = []
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => socket.send(JSON.stringify({ subscribe: { topics: ['*'] } })))
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      messages.push(msg)
      if (msg.type === 'snapshot') {
        void fetch(`${started.url}/cmd/run.start`, {
          method: 'POST',
          headers: { authorization: `Bearer ${started.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ quest: 'waypoint' }),
        })
      }
      if (msg.type === 'event') resolve()
    })
    socket.on('error', reject)
  })
  socket.close()
  expect(messages[0].type).toBe('snapshot')
  expect(messages.some((m) => m.type === 'event')).toBe(true)
})

it('rejects a WebSocket handshake without a valid token', async () => {
  const socket = new WebSocket(`${started.url.replace('http', 'ws')}/ws?token=wrong`)
  await new Promise<void>((resolve) => {
    socket.on('close', () => resolve())
    socket.on('error', () => resolve())
  })
  expect(socket.readyState).toBe(WebSocket.CLOSED)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "WebSocket"`
Expected: FAIL — no WS upgrade handler.

- [ ] **Step 3: Implement the WS layer**

`src/transport/http-ws/ws.ts`:
```ts
import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { EngineHost } from '../../core/engine-host.ts'
import type { EngineEvent } from '../../types.ts'

const MAX_BUFFERED_BYTES = 1_000_000

interface SubscribeMessage {
  readonly subscribe?: { readonly topics?: string[]; readonly lastSeq?: number }
}

export function attachWebSocket(server: Server, host: EngineHost, token: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
  })

  wss.on('connection', (ws: WebSocket) => {
    let unsubscribe: (() => void) | null = null

    const deliver = (event: EngineEvent): void => {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        ws.send(JSON.stringify({ type: 'resnapshot' }))
        return
      }
      ws.send(JSON.stringify({ type: 'event', topic: event.topic, seq: event.seq, record: event.record }))
    }

    ws.on('message', async (raw) => {
      let msg: SubscribeMessage
      try {
        msg = JSON.parse(raw.toString()) as SubscribeMessage
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }))
        return
      }
      if (!msg.subscribe) return
      if (unsubscribe) unsubscribe()

      const topicList = msg.subscribe.topics ?? ['*']
      const topics = topicList.includes('*') ? '*' as const : new Set(topicList)

      // Snapshot first so the client has current state before deltas.
      try {
        const snap = await host.snapshot()
        ws.send(JSON.stringify({ type: 'snapshot', seq: host.hub.currentSeq(), ...snap }))
      } catch (error) {
        ws.send(JSON.stringify({ type: 'snapshot', seq: host.hub.currentSeq(), routes: [], tasks: [], note: error instanceof Error ? error.message : String(error) }))
      }

      unsubscribe = host.hub.subscribe(
        { topics, deliver, requestResnapshot: () => ws.send(JSON.stringify({ type: 'resnapshot' })) },
        msg.subscribe.lastSeq,
      )
    })

    ws.on('close', () => { if (unsubscribe) unsubscribe() })
  })

  return wss
}
```

- [ ] **Step 4: Attach WS in server.ts**

In `createHttpWsTransport`, after the server is created in `start()`, attach the WS layer and close it in `stop()`:
```ts
import { attachWebSocket } from './ws.ts'
import type { WebSocketServer } from 'ws'
// add: let wss: WebSocketServer | null = null
// in start(), after createServer(...):
wss = attachWebSocket(server, host, token)
// in stop(), before closing server:
if (wss) { wss.close(); wss = null }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "WebSocket"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add WebSocket snapshot+delta streaming with token guard"
```

---

### Task 12: Public exports + standalone launcher (`bin.ts`)

**Files:**
- Modify: `packages/waypoint-engine-host/src/index.ts`
- Create: `packages/waypoint-engine-host/src/bin.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/bin.test.ts`

**Interfaces:**
- Consumes: `createEngineHost`; `node:fs/promises` `writeFile` (token file).
- Produces: `startEngineHostFromEnv(argv, env): Promise<{ stop(): Promise<void> }>` — boots the host, opens a workspace if `WAYPOINT_ENGINE_ROOT` is set, writes `{ port, token, url }` to a sidecar handshake file path, prints it.

- [ ] **Step 1: Write the failing test**

`src/__tests__/bin.test.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startEngineHostFromEnv } from '../bin.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'

describe('engine-host launcher', () => {
  let dir: string
  let handle: { stop(): Promise<void> }
  beforeEach(async () => { dir = await makeTempDir() })
  afterEach(async () => { if (handle) await handle.stop(); await cleanup(dir) })

  it('boots, opens the configured root, and writes a handshake file', async () => {
    const handshake = join(dir, 'handshake.json')
    handle = await startEngineHostFromEnv([], {
      WAYPOINT_ENGINE_ROOT: dir,
      WAYPOINT_ENGINE_BACKEND: 'folder',
      WAYPOINT_ENGINE_HANDSHAKE: handshake,
    })
    const info = JSON.parse(await readFile(handshake, 'utf8'))
    expect(info.port).toBeGreaterThan(0)
    expect(typeof info.token).toBe('string')
    const res = await fetch(`${info.url}/cmd/workspace.status`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` },
    })
    expect(await res.json()).toMatchObject({ ok: true, action: 'workspace.status', status: { initialized: true } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/waypoint-engine-host -t "launcher"`
Expected: FAIL — cannot resolve `../bin.ts`.

- [ ] **Step 3: Implement the launcher**

`src/bin.ts`:
```ts
import { writeFile } from 'node:fs/promises'
import { createEngineHost } from './core/engine-host.ts'
import type { EngineBackend } from './types.ts'

export interface EngineHostHandle {
  readonly port: number
  readonly token: string
  readonly url: string
  stop(): Promise<void>
}

export async function startEngineHostFromEnv(
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<EngineHostHandle> {
  const host = createEngineHost()
  const started = await host.start()
  if (env.WAYPOINT_ENGINE_ROOT) {
    await host.dispatch('workspace.open', {
      root: env.WAYPOINT_ENGINE_ROOT,
      backend: (env.WAYPOINT_ENGINE_BACKEND as EngineBackend | undefined) ?? 'folder',
    })
  }
  const info = { port: started.port, token: started.token, url: started.url }
  if (env.WAYPOINT_ENGINE_HANDSHAKE) {
    await writeFile(env.WAYPOINT_ENGINE_HANDSHAKE, JSON.stringify(info), 'utf8')
  }
  return { ...info, stop: () => host.stop() }
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`
if (isDirectRun) {
  startEngineHostFromEnv(process.argv.slice(2))
    .then((handle) => {
      process.stdout.write(`${JSON.stringify({ port: handle.port, url: handle.url })}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    })
}
```

- [ ] **Step 4: Export the public surface**

Append to `src/index.ts`:
```ts
export { createEngineHost } from './core/engine-host.ts'
export type { EngineHost, EngineHostConfig, EngineContext } from './core/engine-host.ts'
export { startEngineHostFromEnv } from './bin.ts'
export type { EngineHostHandle } from './bin.ts'
export type { EngineBackend, EngineEnvelope, EngineSuccessEnvelope, EngineEvent } from './types.ts'
export type { Transport, TransportStartResult } from './transport/transport.ts'
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run packages/waypoint-engine-host -t "launcher" && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "feat(engine-host): add public exports + standalone launcher"
```

---

### Task 13: Headless full-lifecycle integration test (folder)

**Files:**
- Create: `packages/waypoint-engine-host/src/__tests__/integration.lifecycle.test.ts`
- Create: `packages/waypoint-engine-host/src/__tests__/helpers/client.ts`

**Interfaces:**
- Consumes: `host.start`/`stop`, `fetch`, `ws`.
- Produces: `cmd(url, token, name, payload): Promise<EngineEnvelope>` test client helper.

- [ ] **Step 1: Write the client helper**

`src/__tests__/helpers/client.ts`:
```ts
export async function cmd(url: string, token: string, name: string, payload: unknown = {}): Promise<any> {
  const res = await fetch(`${url}/cmd/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}
```

- [ ] **Step 2: Write the failing integration test**

`src/__tests__/integration.lifecycle.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'
import { cmd } from './helpers/client.ts'

describe('engine-host full lifecycle (folder, over HTTP+WS)', () => {
  let dir: string
  let host: ReturnType<typeof createEngineHost>
  let s: { port: number; token: string; url: string }
  beforeEach(async () => { dir = await makeTempDir(); host = createEngineHost(); s = await host.start() })
  afterEach(async () => { await host.stop(); await cleanup(dir) })

  it('open -> start -> list -> events -> gate -> author -> promote', async () => {
    expect(await cmd(s.url, s.token, 'workspace.open', { root: dir, backend: 'folder' })).toMatchObject({ ok: true })

    const started = await cmd(s.url, s.token, 'run.start', { quest: 'waypoint' })
    expect(started.ok).toBe(true)
    const routeId = started.route.id

    const routes = await cmd(s.url, s.token, 'routes.list')
    expect(routes.routes).toHaveLength(1)

    const events = await cmd(s.url, s.token, 'route.events', { routeId })
    expect(events.page.items.length).toBeGreaterThan(0)

    const node = started.route.current_node ?? 'phase-1'
    const gate = await cmd(s.url, s.token, 'gate.decide', { routeId, gateId: node, decision: 'approve' })
    expect(gate.ok).toBe(true)

    const draft = await cmd(s.url, s.token, 'author.recipe', {
      spec: { slug: 'lifecycle-recipe', name: 'Lifecycle Recipe', prompt: 'work', source: { inspected_paths: ['src/index.ts'] } },
    })
    expect(draft.ok).toBe(true)

    const promoted = await cmd(s.url, s.token, 'author.promote', { path: draft.draft.path, yaml: draft.draft.yaml })
    expect(promoted.ok).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `pnpm vitest run packages/waypoint-engine-host -t "full lifecycle (folder"`
Expected: PASS (all dependencies exist by now). If the gate step fails because the started route's `current_node` is not an approvable gate node, adjust the test to first read `route.get` and use a node the quest's manifest marks as a gate; keep the assertion that `gate.decide` returns `ok:true`.

- [ ] **Step 4: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "test(engine-host): headless full-lifecycle integration over HTTP+WS (folder)"
```

---

### Task 14: Beads/Dolt as a first-class, fully-tested backend

**Files:**
- Create: `packages/waypoint-engine-host/src/__tests__/helpers/fake-bd.ts` (extracted from CLI smoke test)
- Modify: `packages/waypoint-engine-host/src/__tests__/integration.lifecycle.test.ts` (parameterize backend)
- Create: `packages/waypoint-engine-host/src/__tests__/integration.beads.test.ts` (resident-process no-lock-contention)

**Interfaces:**
- Consumes: the fake-`bd` harness pattern from `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts` (`installFakeBd`, `realBdAvailable`, `WAYPOINT_FAKE_BD_STATE`, `PATH` shim).
- Produces: `installFakeBd(dir): Promise<{ binDir: string; statePath: string }>`, `realBdAvailable(): boolean`.

- [ ] **Step 1: Extract the fake-`bd` harness into a reusable helper**

Open `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts`, copy its `installFakeBd` and `realBdAvailable` implementations verbatim into `src/__tests__/helpers/fake-bd.ts`, and `export` both. Do not alter behavior — only move + export. (Read that file end-to-end first; reproduce the fake `bd` script and state-file handling exactly.)

- [ ] **Step 2: Write the failing parameterized integration test**

Refactor `integration.lifecycle.test.ts` to run the existing lifecycle assertions for each backend. The Beads case installs the fake `bd` on `PATH` and sets `WAYPOINT_FAKE_BD_STATE` before `workspace.open` with `backend: 'beads'`:
```ts
import { installFakeBd } from './helpers/fake-bd.ts'

const BACKENDS = ['folder', 'beads'] as const

describe.each(BACKENDS)('engine-host full lifecycle (%s, over HTTP+WS)', (backend) => {
  let dir: string, host: ReturnType<typeof createEngineHost>, s: { port: number; token: string; url: string }
  let restore: (() => void) | null = null

  beforeEach(async () => {
    dir = await makeTempDir()
    if (backend === 'beads') {
      const fake = await installFakeBd(dir)
      const prevPath = process.env.PATH, prevState = process.env.WAYPOINT_FAKE_BD_STATE
      process.env.PATH = `${fake.binDir}:${prevPath ?? ''}`
      process.env.WAYPOINT_FAKE_BD_STATE = fake.statePath
      restore = () => { process.env.PATH = prevPath; process.env.WAYPOINT_FAKE_BD_STATE = prevState }
    }
    host = createEngineHost()
    s = await host.start()
  })
  afterEach(async () => { await host.stop(); await cleanup(dir); if (restore) { restore(); restore = null } })

  it('open -> start -> list -> events -> gate -> author -> promote', async () => {
    // ...identical body to Task 13, but using `backend` in workspace.open...
  })
})
```

- [ ] **Step 3: Write the resident-process no-lock-contention test**

`src/__tests__/integration.beads.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngineHost } from '../core/engine-host.ts'
import { cleanup, makeTempDir } from './helpers/workspace.ts'
import { cmd } from './helpers/client.ts'
import { installFakeBd } from './helpers/fake-bd.ts'

describe('engine-host Beads resident process', () => {
  let dir: string, host: ReturnType<typeof createEngineHost>, s: any, restore: () => void
  beforeEach(async () => {
    dir = await makeTempDir()
    const fake = await installFakeBd(dir)
    const prevPath = process.env.PATH, prevState = process.env.WAYPOINT_FAKE_BD_STATE
    process.env.PATH = `${fake.binDir}:${prevPath ?? ''}`
    process.env.WAYPOINT_FAKE_BD_STATE = fake.statePath
    restore = () => { process.env.PATH = prevPath; process.env.WAYPOINT_FAKE_BD_STATE = prevState }
    host = createEngineHost(); s = await host.start()
    await cmd(s.url, s.token, 'workspace.open', { root: dir, backend: 'beads' })
    await cmd(s.url, s.token, 'run.start', { quest: 'waypoint' })
  })
  afterEach(async () => { await host.stop(); await cleanup(dir); restore() })

  it('handles many sequential commands without lock errors', async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await cmd(s.url, s.token, 'routes.list')
      expect(res.ok).toBe(true)
    }
  })

  it('handles concurrent reads without lock errors', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => cmd(s.url, s.token, 'routes.list')))
    for (const res of results) expect(res.ok).toBe(true)
  })
})
```

- [ ] **Step 4: Run the beads-backed tests**

Run: `pnpm vitest run packages/waypoint-engine-host -t "beads|Beads"`
Expected: PASS with the fake `bd`. If a step surfaces a behavior the fake `bd` doesn't model, extend the fake `bd` script in `helpers/fake-bd.ts` to cover that command (matching how the CLI smoke test's fake `bd` already handles `init`/`start`/reads), rather than weakening the assertion.

- [ ] **Step 5: Run the full suite for both backends + typecheck**

Run: `pnpm vitest run packages/waypoint-engine-host && pnpm typecheck`
Expected: PASS — lifecycle green for both `folder` and `beads`.

- [ ] **Step 6: Commit**

```bash
git add packages/waypoint-engine-host
git commit -m "test(engine-host): make Beads/Dolt first-class — parameterized lifecycle + resident-process checks"
```

---

### Task 15: Smoke script, package wiring, boundaries

**Files:**
- Create: `scripts/engine-host-smoke.mjs`
- Modify: root `package.json` (`smoke:engine-host` script)
- Modify: `README.md` (mention the engine host package + smoke)

**Interfaces:**
- Consumes: built `@waypoint/engine-host` (or ts via the same runner the other smokes use). Match the invocation style of `scripts/folder-host-smoke.mjs`.

- [ ] **Step 1: Read an existing smoke for the exact pattern**

Read `scripts/folder-host-smoke.mjs` fully and mirror its temp-dir setup, import strategy (built dist vs. ts loader), success/failure exit codes, and console output conventions.

- [ ] **Step 2: Write the smoke script**

`scripts/engine-host-smoke.mjs` (follow the structure observed in step 1):
```js
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngineHost } from '@waypoint/engine-host'

const dir = await mkdtemp(join(tmpdir(), 'waypoint-engine-smoke-'))
const host = createEngineHost()
const started = await host.start()
try {
  const open = await host.dispatch('workspace.open', { root: dir, backend: 'folder' })
  if (!open.ok) throw new Error(`workspace.open failed: ${open.error}`)
  const run = await host.dispatch('run.start', { quest: 'waypoint' })
  if (!run.ok) throw new Error(`run.start failed: ${run.error}`)
  const routes = await host.dispatch('routes.list', {})
  if (!routes.ok || routes.routes.length !== 1) throw new Error('routes.list mismatch')
  console.log(`engine-host smoke OK on ${started.url} (route ${run.route.id})`)
} finally {
  await host.stop()
  await rm(dir, { recursive: true, force: true })
}
```

- [ ] **Step 3: Wire the smoke script**

In root `package.json` `scripts`, add:
```json
"smoke:engine-host": "node scripts/engine-host-smoke.mjs"
```

- [ ] **Step 4: Run the smoke + boundaries + full test suite**

Run: `pnpm build && pnpm smoke:engine-host`
Expected: prints `engine-host smoke OK ...`, exit 0.
Run: `pnpm test && pnpm typecheck`
Expected: PASS, including `src/boundaries.ts` guard (core imports unchanged).

> If `scripts/folder-host-smoke.mjs` imports from `dist/` rather than the package name, match that exactly (the smoke may need `pnpm build` first, as shown). If it uses a TS loader against `src/`, mirror that instead and drop the build step.

- [ ] **Step 5: Update README**

Add a short subsection under "Runtime modes" noting `packages/waypoint-engine-host` exposes the run/watch/author API over loopback HTTP+WS, with `pnpm smoke:engine-host` as the local check.

- [ ] **Step 6: Commit**

```bash
git add scripts/engine-host-smoke.mjs package.json README.md
git commit -m "chore(engine-host): add smoke script + wire package scripts + docs"
```

---

## Self-Review

**1. Spec coverage:**
- Resident process wrapping core + folder-host → Tasks 1, 6, 12. ✓
- Transport-agnostic CommandBus + EventHub → Tasks 3, 4. ✓
- HTTP+WS adapter on 127.0.0.1, token-guarded, ephemeral port → Tasks 10, 11. ✓
- Catalog/run/watch/author/gate/discuss command surface → Tasks 6, 7, 8, 9. ✓
- `author.promote` deterministic stub → Task 9. ✓
- Snapshot-on-subscribe + delta + lastSeq resume + backpressure→re-snapshot → Tasks 4 (replay/ring), 11 (snapshot/backpressure). ✓
- Transport seam for later Tauri IPC → Task 10 (`transport.ts`). ✓
- Headless integration test → Task 13. ✓
- Beads/Dolt first-class, full lifecycle on both backends + resident-process lock check → Task 14. ✓
- Smoke + boundaries → Task 15. ✓
- Module boundaries/files match spec's layout → File Structure section. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The `> Verify …` notes flag real field-name confirmations (catalog props, discussion-store fields, design-spec/handoff generator names) the implementer must check against source while implementing — each names the exact file to confirm against and the fallback, which is guidance, not a deferred decision. Code blocks are complete and runnable.

**3. Type consistency:** `EngineEnvelope`/`EngineSuccessEnvelope`/`ok()` consistent across all command files. `EngineContext` (`session`, `hub`, `pumpRouteEvents`) consistent in Tasks 6–9. `EngineHost` gains `start`/`stop` in Task 10 with the interface updated. `Transport`/`TransportStartResult` consistent in Tasks 10–12. Event shape `{ seq, topic, record }` consistent across EventHub (Task 4), pump (Task 6), WS (Task 11). `route.events` returns `{ page: { items } }` consistently in run command (Task 7) and tests (Tasks 13, 14).

## Execution Handoff

(Plan saved; execution options offered after this document is written.)

---

## GSTACK REVIEW REPORT

**Pipeline:** /autoplan — CEO → Eng → DX (Design skipped: no UI in slice 1). Dual voices per phase: Claude subagent + Codex 0.128.0. Date: 2026-06-18.

### Consensus tables (CONFIRMED = both voices agree)

**CEO (strategy/scope)**
| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Premises validated (resident process; Pi SDK)? | No | No | CONFIRMED — assumed, not validated |
| Right problem first? | No | No | CONFIRMED — de-risk/vertical-proof first |
| Scope calibrated? | No (Beads parity wide) | No (platform not product) | CONFIRMED — over-scoped |
| Alternatives explored? | No | No | CONFIRMED — listed, not analyzed |
| 6-month trajectory sound? | At risk | At risk | CONFIRMED — delete-WS / Pi-mismatch / Beads-contention regrets |

**Eng (architecture/test/security)**
| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Architecture sound? | Core yes, pump no | Core yes, pump no | CONFIRMED — core good, **event-pump broken** |
| Test coverage sufficient? | No | No | CONFIRMED — fake-bd gap, self-adjusting gate test |
| Performance (Dolt locks)? | Unproven | Unproven | CONFIRMED — contention untested |
| Security threats? | Low (loopback) | Underpowered | CONFIRMED — token/handshake/body hardening needed |
| Error paths handled? | Gaps | Gaps | CONFIRMED — pump races, restart wedge |
| Correctness/deploy? | catalog-shape + discuss bugs | **workspace.open missing catalog install → tests fail** | CONFIRMED — blocking bugs |

**DX (developer experience)**
| Dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Getting started <5 min? | No | No | CONFIRMED — no shipped client/example |
| Naming guessable? | Mostly, asymmetries | Mostly, asymmetries | CONFIRMED — run.* vs route.*, gateId vs node |
| Error messages actionable? | No | No | CONFIRMED — bare strings, structured validation lost |
| Docs findable/complete? | No | No | CONFIRMED — cmd() buried in tests |
| Versioning/discoverability? | No apiVersion/meta | No meta endpoint | CONFIRMED — add meta.commands/health/version |

### Blocking bugs (mechanical — one right answer, fix on approval)
1. **`workspace.open` doesn't install the bundled catalog** — CLI `init` installs quests/recipes; `initWaypointProject` alone doesn't. `startQuestRoute` reads `.waypoint/quests/<quest>.yaml`, so every fresh-workspace lifecycle test (Tasks 6/7/13/14) would FAIL. Must call the CLI init sequence (init → catalog install → optional Beads init).
2. **`catalog.quests` returns a registry, not an array** — supplied test asserts `.length` on a non-array; return `.list()`.
3. **`discuss.post` wrong signature** — actual `appendTaskDiscussionMessage(root, taskId, { content, author })`; plan passes one object, wrong arity → won't compile.
4. **Event pump incoherent for Beads** — Beads events are re-sorted with positional IDs; integer offset drops/dupes. Switch to **command-returned deltas** (the route op already returns what changed) or **broadcast event-ID set diff**; serialize the pump per route; document that out-of-band writes (autopilot/Gas City/external) are not live in slice 1.
5. **EventHub resume wedges on restart** (`lastSeq > currentSeq` delivers nothing, no resnapshot) + **snapshot-before-subscribe race**. Subscribe→queue→snapshot(asOf)→flush.
6. **`author.promote` path-safety + reachability** — `recipes/../config.yaml` escapes; whitelist `^(quests|recipes)/[a-z0-9-]+\.ya?ml$`, temp-file+rename, parse/validate manifest, and write where the runtime actually reads it.
7. **Security hardening** — atomic handshake write (tmp+rename, 0600, pid/staleness), WS token via header not query string, `crypto.timingSafeEqual`, request-body size cap, wrap `sub.deliver` in try/catch.
8. **DX** — add `meta.commands`/`meta.health`/`meta.version` (+apiVersion); ship a `cmd()`/typed client from the package + README hello-world; structured error `{code, field, details}` preserving `validation.errors`; normalize list envelopes; rename `gateId`→`node`; pin the gate test deterministically (no self-adjusting assertion).

### Structural challenges (NOT auto-decided — both models challenge the stated direction; see final gate)
- **UC1 Sequencing:** spike Pi SDK reachability + real-`bd`/Dolt contention BEFORE building slice 1.
- **UC2 Transport:** build the in-process command/event core first; defer HTTP+WS (Tauri IPC is the end state).
- **UC3 Beads scope:** downgrade slice-1 Beads to folder-first + opt-in **real-bd** smoke (fake-bd proves nothing about Dolt locks).
- **UC4 author.promote:** make promotion emit a review/proposal artifact, not a direct catalog write.

### Decision Audit Trail
| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Eng | Fix blocking bugs 1-3 | Mechanical | P5 explicit | Plan doesn't compile/tests fail as written |
| 2 | Eng | Event-pump → command-returned deltas + serialize + document scope | Mechanical | P1 completeness | Offset pump provably wrong for Beads |
| 3 | Eng | EventHub subscribe→queue→snapshot→flush; restart resnapshot | Mechanical | P1 | Closes missed-delta race + restart wedge |
| 4 | Eng | author.promote whitelist + temp-rename + validate | Mechanical | P5 | Path-escape + corrupt-write risk |
| 5 | Eng | Security hardening batch | Mechanical | P1 | Cheap, in blast radius |
| 6 | DX | meta endpoints + shipped client + structured errors + naming | Mechanical | P1/P5 | Contract serves two clients; near-zero cost |
| 7 | CEO | Sequencing / transport / Beads scope / promote model | USER CHALLENGE | — | Both models challenge stated direction; user decides |

---

## POST-REVIEW REVISIONS (authoritative — supersedes task bodies where they conflict)

Outcome of /autoplan final gate. User decisions: UC1 **spike-first**, UC2 **keep HTTP+WS**, UC3 **Beads first-class with REAL bd (not fake)**, UC4 **promote emits a proposal artifact**.

### NEW Task 0: De-risk spikes (GATE — do before any slice-1 task)

Two throwaway spikes; slice-1 build is gated on both passing. Commit findings to `docs/superpowers/spikes/2026-06-18-engine-host-spikes.md`. Do NOT keep spike code.

- [ ] **Spike A — Pi SDK reachability.** In a scratch Node script, authenticate to pi.dev and run ONE tool-calling agent loop: register a trivial tool, have the agent call it, capture the result. Record: is there a programmatic Node SDK? auth model? streaming? tool-loop ergonomics? If NO usable SDK → STOP and revisit slice 2's brain design (provider-neutral `BrainAdapter`) before proceeding; slice 1 continues but the spec's "in-process Pi" rationale is flagged.
- [ ] **Spike B — real bd/Dolt resident-process contention.** With real `bd` + Dolt installed, boot a long-lived Node process, `init --backend beads`, start a route, then fire 25 sequential + 12 concurrent `bd`-backed operations (mixed read/write: routes.list, gate, pause/resume, route-events). Record any `database is locked`/timeout. If contention appears → adopt the per-workspace **serialized bd mutation queue** (see correction E) as a hard requirement, not optional.

**Gate:** both spikes documented before Task 1.

### Per-task corrections

**A. Task 6 — `workspace.open` must mirror CLI init (BLOCKING).** `initWaypointProject` alone does not install the bundled catalog, so `startQuestRoute` (reads `.waypoint/quests/<quest>.yaml`) fails. On a fresh root, run the same sequence as `packages/waypoint-cli/src/commands/init.ts`: optional Beads init (when `initBeads`/`backend:'beads'`), `initWaypointProject`, then `installQuestCatalog`, then readiness check. For an existing workspace, derive backend from `readWaypointStatus` and reject a conflicting `backend` argument. Add a test that `run.start` succeeds on a freshly-opened workspace (this currently would fail).

**B. Task 6 — catalog command shape (BLOCKING).** `catalog.quests`/`catalog.recipes` are registries, not arrays. Return `catalog.quests.list()` / `catalog.recipes.list()` and `resolveQuestRecipes(quest).recipes`. Update the Task 6 test to assert on the array from `.list()`.

**C. Task 8 — `discuss.post` signature (BLOCKING).** Real signature is `appendTaskDiscussionMessage(root, taskId, { content, author })`. Replace the handler call with:
```ts
const message = await appendTaskDiscussionMessage(root, input.taskId, { content: input.message, author: input.author ?? 'user' })
```
Add `discuss.list` wrapping `readTaskDiscussionMessages` (read counterpart, DX).

**D. Task 7 — event delivery via command-returned deltas (replaces integer-offset pump).** The offset pump is wrong for Beads (events re-sorted, positional IDs) and races under interleaving. Replace `pumpRouteEvents(routeId)` with delta emission driven by what each command already knows:
- After a mutating command, read the route's events once and publish only events whose stable **event ID** has not been broadcast before (maintain `Set<string>` of broadcast IDs per route, not an integer offset). This is idempotent under interleaving and correct for both backends.
- Serialize per-route emission with an async mutex keyed by routeId.
- Wrap each `sub.deliver` in try/catch so one bad subscriber can't abort fan-out.
- **Document the scope limit:** events from autopilot / Gas City / external writers are NOT live in slice 1. Add a periodic poll tick (every ~3s while a route has subscribers) that runs the same ID-diff emit, so out-of-band events eventually surface. Update the WS protocol doc and the spec's streaming section to state "deltas = events this host observes via poll+command; subscribe to re-snapshot for full truth."

**E. Beads concurrency (from Spike B).** Add a per-workspace serialized mutation queue in `WorkspaceSession` (real lock, not the `inFlight` counter) so concurrent `bd`-backed mutations don't collide on Dolt. Reuse a single `WaypointBeadsCliIssueClient` per workspace rather than constructing one per call.

**F. Task 11 — EventHub/WS correctness.** (1) Subscribe order: register subscriber with a temporary queue FIRST, then take the snapshot (`asOf = hub.currentSeq()`), then flush queued events with `seq > asOf` — eliminates the snapshot/subscribe missed-delta race. (2) On reconnect with `lastSeq > currentSeq` (process restarted, seq reset) → send `resnapshot`, never silently deliver nothing. (3) Move the WS token out of the query string into the `Sec-WebSocket-Protocol` or `Authorization` upgrade header.

**G. Task 9 — `author.promote` emits a PROPOSAL artifact (UC4), not a direct catalog write.** Replace the direct write with: validate+parse the manifest (reject if `slug !== basename`), write to a reviewable proposal location `.waypoint/proposals/<kind>/<slug>.yaml` plus a `.waypoint/proposals/<kind>/<slug>.proposal.json` (source draft + target catalog path + diff-vs-existing + status `pending`). A separate explicit `author.approveProposal { id }` command (human/gate-driven) performs the validated catalog write via temp-file+`rename`, path-whitelisted to `^(quests|recipes)/[a-z0-9-]+\.ya?ml$`. Add tests: promote creates a pending proposal (catalog unchanged); approveProposal lands it and `run.start`/`resolveQuestRecipes` can then find it (proves reachability, not just bytes-on-disk).

**H. Task 10/12 — security hardening.** `crypto.timingSafeEqual` for token compare; cap request body size (e.g. 1MB) in `readBody`; atomic handshake write (write `*.tmp`, `chmod 0600`, `rename`; include `{ schemaVersion, pid, url, token, createdAt, workspaceRoot }`; delete stale file at startup; unlink on clean shutdown). Direct-run stdout must print the full record (incl. token) or nothing — not a token-less line that disagrees with the file.

**I. Task 6/12 — `meta` command group (DX).** Add `meta.commands` → `{ commands: bus.names() }`, `meta.health` → `{ ok, uptime, workspaceOpen, seq }`, `meta.version` → `{ apiVersion: '1', pkg }`. Include `apiVersion` in the WS `snapshot` message. Gives the sidecar a readiness probe and the Pi agent a discoverable surface.

**J. Task 12 — ship a client + hello-world (DX).** Export `createEngineClient({ url, token })` with `.cmd(name, payload)` and `.subscribe(topics, onEvent)` from the package (promote `__tests__/helpers/client.ts`). README must include a copy-paste hello-world for both shapes (embed `createEngineHost`; drive over HTTP with `Authorization: Bearer`).

**K. Errors structured (DX).** Use `makeErrorEnvelope`'s `details` to carry `{ code, field?, issues? }`. Codes: `UNKNOWN_COMMAND`, `NO_WORKSPACE`, `VALIDATION`, `NOT_FOUND`, `BACKEND_ERROR`, `CONFLICT`. For authoring, pass `validation.errors` through as `details.issues` instead of stringifying. Keep the helpful "next action" phrasing (`NO_WORKSPACE` already does).

**L. Naming normalization (DX).** Rename `gate.decide` payload `gateId`→`node` (matches `current_node`/folder-host). Normalize all list envelopes to named arrays (drop the `{ page }` wrapper inconsistency on `route.events` — return `{ events, total, limit, offset }`). Keep `run.*` for lifecycle verbs but document that routes are read under `route.*`.

**M. Task 13 — deterministic gate test.** Remove the self-adjusting "if the gate step fails, adjust the test" escape hatch. Read the quest manifest's first gate node from a known fixture quest and assert against it.

### UC3 — Task 14 uses REAL bd (replaces fake-bd)

Replace the fake-`bd` harness with a real-`bd`-gated suite. Keep the full parameterized lifecycle on both folder AND Beads, but the Beads lane runs only when `realBdAvailable()` (skipped locally without bd, **required in CI** with bd/Dolt installed). The resident-process contention test (25 sequential + 12 concurrent mixed read/write) must run against real bd/Dolt to actually validate the "no lock contention" claim. Drop `helpers/fake-bd.ts`; reuse the `realBdAvailable()` gate pattern from `packages/waypoint-cli/src/commands/beads-backend-smoke.test.ts`. Acceptance: "Beads first-class" is only claimed once the real-bd CI lane is green.

### Decision Audit Trail (gate outcomes)
| # | Decision | Class | Outcome |
|---|---|---|---|
| UC1 | Spike Pi + real-bd/Dolt before build | User Challenge | ACCEPTED — new Task 0 gate |
| UC2 | HTTP+WS now vs in-process-core-first | User Challenge | DECLINED change — keep HTTP+WS (user's direction) |
| UC3 | Beads scope | User Challenge | MODIFIED — keep first-class, replace fake-bd with real-bd-gated suite |
| UC4 | promote model | User Challenge | ACCEPTED — proposal artifact + explicit approveProposal |
