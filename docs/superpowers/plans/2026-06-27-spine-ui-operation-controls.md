# Spine UI — Operation Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Spine observability console into an operating surface — start/pause/resume routes, decide gates, approve agent proposals, and post to discussions — from the UI.

**Architecture:** One new engine command (`catalog.install`); everything else is UI-side in `packages/spine-ui`, issuing commands the engine already exposes via the global-token proxy. A shared `useEngineCommand` hook centralizes in-flight state, envelope-unwrap (shared `listField`), post-success `routesEpoch` refetch, and a `controlError` banner. Consequential actions wrap in an inline `ConfirmAction`. Pause/Resume is derived from **paused-provenance** (route event lifecycle), never from the overloaded `'blocked'` status.

**Tech Stack:** React 18, Zustand, TypeScript (ESM, `.ts`/`.tsx` specifiers), Vite, Vitest + @testing-library/react. Engine: the existing `CommandBus` / `EngineError` / `ok` envelope.

## Global Constraints

- **One engine change only:** `catalog.install` in `packages/spine-engine-host`. Everything else is `packages/spine-ui`. No proxy/token/permission change (the UI proxy already carries the unrestricted `global` token and forwards all `/cmd/*`).
- **Confirm consequential actions only:** `run.start`, `author.approveProposal`, and gate **reject** wrap in `ConfirmAction`. Cheap/reversible — pause, resume, gate **approve**, discussion **post** — act directly.
- **Pause/Resume keys on paused-provenance, never status.** `'blocked'` is overloaded (pause vs gate-wait vs autopilot). Resume shows iff the route's latest pause-relevant event is `route.paused` with no later `route.resumed`; independent of `current_node`. Tests pin `active⇒Pause`, `paused-provenance⇒Resume`, `blocked-without-pause⇒neither`.
- **`gate.decide` node** comes from `route.current_node`, falling back to the gate task identifier (`plan_ref` → `id` → `beads_id`) when null — NOT `metadata.runner.node_key` (the engine matcher reads `plan_ref`/`id`/`beads_id`, `beads/transitions.ts`).
- **`discuss.post` omits `author`** — the engine applies its default identity.
- **`catalog.install` is workspace-wins:** an authored `.runner/quests/<slug>.yaml` is preserved, only missing recipes installed; returns the full envelope `{ quest, recipes, installedQuestPaths, installedRecipePaths }`. Real `installQuestCatalog` signature is 3-arg `(projectRoot, catalog, options)`.
- **No optimistic UI:** no control mutates local state before the engine confirms; the UI reflects engine state and refetches.
- **TDD.** Run UI tests from `packages/spine-ui` with `npx vitest run <file>`; engine tests from repo root with `npx vitest run <file>`; `npm run typecheck` from repo root.

---

### Task 1: Engine — `catalog.install` command

**Files:**
- Modify: `packages/spine-engine-host/src/core/commands/catalog.ts`
- Test: `packages/spine-engine-host/src/core/commands/catalog.test.ts` (create if absent; else extend)

**Interfaces:**
- Consumes: `loadBundledSpineCatalog`, `installQuestCatalog` from `@projectrunner/spine-folder-host`; `EngineError`, `ok` from `../../envelope.ts`.
- Produces: command `catalog.install` with payload `{ quest: string }` → `ok('catalog.install', { quest, recipes, installedQuestPaths, installedRecipePaths })`.

- [ ] **Step 1: Write the failing test**

Add to `packages/spine-engine-host/src/core/commands/catalog.test.ts` (mirror the existing `catalog.quests`/`catalog.recipes` test harness in that file — same `registerCatalogCommands` + a temp workspace with an active session). If the file does not exist, model it on `packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts` (which already dispatches `catalog.*` against a real workspace). The new cases:

```ts
it('catalog.install installs a bundled quest and returns the full envelope', async () => {
  const res = await dispatch('catalog.install', { quest: 'add-tests' })
  expect(res.ok).toBe(true)
  const r = res as { ok: true; quest: { slug: string }; recipes: unknown; installedQuestPaths: string[]; installedRecipePaths: string[] }
  expect(r.quest.slug).toBe('add-tests')
  expect(Array.isArray(r.installedQuestPaths)).toBe(true)
  expect(Array.isArray(r.installedRecipePaths)).toBe(true)
  // the quest manifest now exists locally
  const installed = await readFile(join(root, '.runner/quests/add-tests.yaml'), 'utf8')
  expect(installed).toContain('slug: add-tests')
})

it('catalog.install rejects a missing quest slug with VALIDATION', async () => {
  const res = await dispatch('catalog.install', {})
  expect(res).toMatchObject({ ok: false, code: 'VALIDATION', field: 'quest' })
})

it('catalog.install surfaces NOT_FOUND for an unknown quest', async () => {
  const res = await dispatch('catalog.install', { quest: 'no-such-quest-xyz' })
  expect(res).toMatchObject({ ok: false, code: 'NOT_FOUND' })
})

it('catalog.install is workspace-wins: an authored quest manifest is byte-identical after re-install', async () => {
  await dispatch('catalog.install', { quest: 'add-tests' })
  const path = join(root, '.runner/quests/add-tests.yaml')
  const authored = (await readFile(path, 'utf8')) + '\n# operator edit\n'
  await writeFile(path, authored, 'utf8')
  await dispatch('catalog.install', { quest: 'add-tests' }) // re-install
  expect(await readFile(path, 'utf8')).toBe(authored) // preserved, not clobbered
})
```

Use the file's existing `dispatch`/`root` helpers; import `readFile`/`writeFile` from `node:fs/promises` and `join` from `node:path` if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/spine-engine-host/src/core/commands/catalog.test.ts`
Expected: FAIL — `Unknown command: catalog.install` (or the dispatch returns a not-registered failure).

- [ ] **Step 3: Implement the command**

In `packages/spine-engine-host/src/core/commands/catalog.ts`:

3a. Extend the imports:

```ts
import { formatCatalogEntryWarning, installQuestCatalog, loadBundledSpineCatalog, loadWorkspaceSpineCatalog } from '@projectrunner/spine-folder-host'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
```

3b. Register the command inside `registerCatalogCommands(bus, ctx)` (after `catalog.recipes`):

```ts
bus.register('catalog.install', async (payload) => {
  const { root } = ctx.session.requireActive()
  const input = (payload ?? {}) as { quest?: string }
  if (!input.quest) {
    throw new EngineError('catalog.install requires a quest slug', { code: 'VALIDATION', field: 'quest' })
  }
  const quest = input.quest
  // workspace-wins: preserve an authored quest manifest rather than clobbering it.
  const questPath = join(root, '.runner', 'quests', `${quest}.yaml`)
  const questAlreadyAuthored = await access(questPath).then(() => true).catch(() => false)
  const catalog = await loadBundledSpineCatalog()
  const result = await ctx.session.mutate(() =>
    installQuestCatalog(root, catalog, { quest, preserveExistingQuest: questAlreadyAuthored }),
  )
  return ok('catalog.install', {
    quest: result.quest,
    recipes: result.recipes,
    installedQuestPaths: result.installedQuestPaths,
    installedRecipePaths: result.installedRecipePaths,
  })
})
```

3c. `installQuestCatalog` must honor `preserveExistingQuest`. Open `packages/spine-folder-host/src/catalog/install.ts`. Add the option to `InstallQuestCatalogOptions`:

```ts
export interface InstallQuestCatalogOptions {
  readonly quest: string
  readonly preserveExistingQuest?: boolean
}
```

and guard the quest-manifest copy (the unconditional `copyCatalogFile(resolved.questEntry.path, questTarget)` near line 30) so it is skipped when the target exists and `preserveExistingQuest` is set:

```ts
const questExists = await access(questTarget).then(() => true).catch(() => false)
const preserveQuest = options.preserveExistingQuest === true && questExists
if (!preserveQuest) {
  await copyCatalogFile(resolved.questEntry.path, questTarget)
}
```

(Add `import { access } from 'node:fs/promises'` to `install.ts` if not present. Recipes continue to install unconditionally — only the quest manifest is preserved.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/spine-engine-host/src/core/commands/catalog.test.ts`
Expected: PASS (4 new cases). Also run the existing install test to confirm no regression:
Run: `npx vitest run packages/spine-folder-host/src/catalog/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-engine-host/src/core/commands/catalog.ts packages/spine-engine-host/src/core/commands/catalog.test.ts packages/spine-folder-host/src/catalog/install.ts
git commit -m "feat(engine): catalog.install command (workspace-wins) (runner-aws)"
```

---

### Task 2: UI — extract `listField` into a shared `lib/engine.ts`

**Files:**
- Create: `packages/spine-ui/src/lib/engine.ts`
- Modify: `packages/spine-ui/src/App.tsx` (remove the local `listField`, import it)
- Test: `packages/spine-ui/src/lib/engine.test.ts`

**Interfaces:**
- Produces: `listField<K extends string, T>(env: { ok: boolean; error?: string }, action: string, key: K): T | undefined` — throws `Error(env.error ?? "<action> failed")` when `!env.ok`.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/lib/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { listField } from './engine'

describe('listField', () => {
  it('returns the keyed field on an ok envelope', () => {
    expect(listField({ ok: true, routes: [1, 2] } as never, 'routes.list', 'routes')).toEqual([1, 2])
  })

  it('throws the envelope error message when not ok', () => {
    expect(() => listField({ ok: false, error: 'boom' }, 'routes.list', 'routes')).toThrow('boom')
  })

  it('throws a default message when not ok and no error string', () => {
    expect(() => listField({ ok: false }, 'tasks.list', 'tasks')).toThrow('tasks.list failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/lib/engine.test.ts`
Expected: FAIL — `Failed to resolve import './engine'`.

- [ ] **Step 3: Create the module and rewire App.tsx**

Create `packages/spine-ui/src/lib/engine.ts`:

```ts
/** Throws (instead of silently no-op'ing) on a non-ok command envelope. */
export function listField<K extends string, T>(env: { ok: boolean; error?: string }, action: string, key: K): T | undefined {
  if (!env.ok) throw new Error(env.error ?? `${action} failed`)
  return (env as unknown as Record<K, T>)[key]
}
```

In `packages/spine-ui/src/App.tsx`: delete the local `listField` function definition (the `function listField<K extends string, T>(...) {...}` block) and add the import near the other local imports:

```ts
import { listField } from './lib/engine'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/lib/engine.test.ts src/App.test.tsx`
Expected: PASS — the new helper tests plus all existing App tests (App still unwraps envelopes identically).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/lib/engine.ts packages/spine-ui/src/lib/engine.test.ts packages/spine-ui/src/App.tsx
git commit -m "refactor(ui): extract shared listField into lib/engine (runner-aws)"
```

---

### Task 3: UI store — `controlError` + App banner row

**Files:**
- Modify: `packages/spine-ui/src/store.ts`
- Modify: `packages/spine-ui/src/App.tsx`
- Test: `packages/spine-ui/src/store.test.ts`

**Interfaces:**
- Produces: store state `controlError: string | null` (init null) + action `setControlError(e: string | null): void`. A `control`-keyed row in the `App.tsx` `errors[]` banner.

- [ ] **Step 1: Write the failing test**

Append to the `store recipe state` describe (or a new describe) in `packages/spine-ui/src/store.test.ts`:

```ts
it('setControlError sets and clears the control error', () => {
  useStore.getState().setControlError('run.start failed')
  expect(useStore.getState().controlError).toBe('run.start failed')
  useStore.getState().setControlError(null)
  expect(useStore.getState().controlError).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/store.test.ts`
Expected: FAIL — `setControlError is not a function`.

- [ ] **Step 3: Implement**

In `packages/spine-ui/src/store.ts`:

3a. Add to the `UiState` interface (after `recipesEpoch: number`):

```ts
  controlError: string | null
```

3b. Add the action signature (after `bumpRecipesEpoch(): void`):

```ts
  setControlError(e: string | null): void
```

3c. Add the initial value (after `recipesEpoch: 0,`):

```ts
  controlError: null,
```

3d. Add the action implementation (next to `setRecipesError`):

```ts
  setControlError: (controlError) => set({ controlError }),
```

3e. In `packages/spine-ui/src/App.tsx`, add the selector inside `Console` (after `recipesError`):

```ts
  const controlError = useStore((s) => s.controlError)
  const setControlError = useStore((s) => s.setControlError)
```

and push a `control` row into the `errors[]` array (after the `recipes` row):

```ts
  if (controlError) errors.push({ key: 'control', msg: controlError, clear: () => setControlError(null) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/store.test.ts src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/store.ts packages/spine-ui/src/store.test.ts packages/spine-ui/src/App.tsx
git commit -m "feat(ui): controlError store field + banner row (runner-aws)"
```

---

### Task 4: UI — `useEngineCommand` hook

**Files:**
- Create: `packages/spine-ui/src/engine/useEngineCommand.ts`
- Test: `packages/spine-ui/src/engine/useEngineCommand.test.tsx`

**Interfaces:**
- Consumes: `useClient` from `./context`; `listField` from `../lib/engine`; store `bumpRoutesEpoch`, `setControlError`.
- Produces: `useEngineCommand(): { run: (name: string, payload?: unknown, opts?: { field?: string }) => Promise<unknown>; pending: boolean }`. `run` calls `client.cmd`, throws-on-non-ok via `listField` (returning `opts.field` value if given, else the whole envelope), bumps `routesEpoch` + clears `controlError` on success, sets `controlError` + rethrows on failure, and tracks `pending`.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/engine/useEngineCommand.test.tsx`:

```tsx
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from './context'
import { useEngineCommand } from './useEngineCommand'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function Harness({ client, onReady }: { client: FakeEngineClient; onReady: (api: ReturnType<typeof useEngineCommand>) => void }) {
  const api = useEngineCommand()
  onReady(api)
  return null
}

describe('useEngineCommand', () => {
  it('bumps routesEpoch and clears controlError on success', async () => {
    const client = new FakeEngineClient()
    client.responses['run.pause'] = { ok: true, action: 'run.pause', route: { id: 'r1' } } as never
    useStore.setState({ controlError: 'stale' })
    let api!: ReturnType<typeof useEngineCommand>
    render(<ClientProvider client={client}><Harness client={client} onReady={(a) => (api = a)} /></ClientProvider>)
    const epoch = useStore.getState().routesEpoch
    await act(async () => { await api.run('run.pause', { routeId: 'r1' }) })
    expect(client.calls.at(-1)).toEqual({ name: 'run.pause', payload: { routeId: 'r1' } })
    expect(useStore.getState().routesEpoch).toBe(epoch + 1)
    expect(useStore.getState().controlError).toBeNull()
  })

  it('sets controlError and rethrows on a non-ok envelope', async () => {
    const client = new FakeEngineClient()
    client.responses['run.pause'] = { ok: false, action: 'run.pause', error: 'nope' } as never
    let api!: ReturnType<typeof useEngineCommand>
    render(<ClientProvider client={client}><Harness client={client} onReady={(a) => (api = a)} /></ClientProvider>)
    await act(async () => { await expect(api.run('run.pause', { routeId: 'r1' })).rejects.toThrow('nope') })
    expect(useStore.getState().controlError).toBe('nope')
    expect(useStore.getState().routesEpoch).toBe(initial.routesEpoch)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/engine/useEngineCommand.test.tsx`
Expected: FAIL — `Failed to resolve import './useEngineCommand'`.

- [ ] **Step 3: Implement the hook**

Create `packages/spine-ui/src/engine/useEngineCommand.ts`:

```ts
import { useCallback, useState } from 'react'

import { useClient } from './context'
import { listField } from '../lib/engine'
import { useStore } from '../store'

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useEngineCommand(): {
  run: (name: string, payload?: unknown, opts?: { field?: string }) => Promise<unknown>
  pending: boolean
} {
  const client = useClient()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (name: string, payload?: unknown, opts?: { field?: string }): Promise<unknown> => {
      setPending(true)
      try {
        const env = (await client.cmd(name, payload)) as { ok: boolean; error?: string }
        const value = opts?.field ? listField(env, name, opts.field) : (assertOk(env, name), env)
        useStore.getState().bumpRoutesEpoch()
        useStore.getState().setControlError(null)
        return value
      } catch (err) {
        useStore.getState().setControlError(toMessage(err))
        throw err
      } finally {
        setPending(false)
      }
    },
    [client],
  )

  return { run, pending }
}

/** Throw on a non-ok envelope when no field is requested. */
function assertOk(env: { ok: boolean; error?: string }, name: string): void {
  if (!env.ok) throw new Error(env.error ?? `${name} failed`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/engine/useEngineCommand.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/engine/useEngineCommand.ts packages/spine-ui/src/engine/useEngineCommand.test.tsx
git commit -m "feat(ui): useEngineCommand hook (in-flight + controlError + routesEpoch) (runner-aws)"
```

---

### Task 5: UI — `ConfirmAction` component

**Files:**
- Create: `packages/spine-ui/src/components/ConfirmAction.tsx`
- Test: `packages/spine-ui/src/components/ConfirmAction.test.tsx`

**Interfaces:**
- Produces: `ConfirmAction(props: { label: string; confirmLabel?: string; withNote?: boolean; disabled?: boolean; onConfirm: (note?: string) => void }): JSX.Element`. Renders the trigger; on click swaps to Confirm/Cancel (+ a note input when `withNote`). Confirm calls `onConfirm(note)`; Cancel reverts.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/ConfirmAction.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmAction } from './ConfirmAction'

describe('ConfirmAction', () => {
  it('fires onConfirm only after the confirm step', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Start" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancel reverts without firing', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Reject" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('threads the note value into onConfirm when withNote', () => {
    const onConfirm = vi.fn()
    render(<ConfirmAction label="Reject" withNote onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByPlaceholderText('note (optional)'), { target: { value: 'bad plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledWith('bad plan')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/ConfirmAction.test.tsx`
Expected: FAIL — `Failed to resolve import './ConfirmAction'`.

- [ ] **Step 3: Implement**

Create `packages/spine-ui/src/components/ConfirmAction.tsx`:

```tsx
import { useState } from 'react'

export function ConfirmAction({
  label,
  confirmLabel = 'Confirm',
  withNote,
  disabled,
  onConfirm,
}: {
  label: string
  confirmLabel?: string
  withNote?: boolean
  disabled?: boolean
  onConfirm: (note?: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')

  if (!confirming) {
    return (
      <button type="button" disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {withNote ? (
        <input
          type="text"
          placeholder="note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ fontSize: 12 }}
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onConfirm(withNote ? note : undefined)
          setConfirming(false)
          setNote('')
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => { setConfirming(false); setNote('') }}>
        Cancel
      </button>
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/ConfirmAction.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/ConfirmAction.tsx packages/spine-ui/src/components/ConfirmAction.test.tsx
git commit -m "feat(ui): ConfirmAction inline-confirm component (runner-aws)"
```

---

### Task 6: UI — `StartQuest` (install → start, confirmed)

**Files:**
- Create: `packages/spine-ui/src/components/StartQuest.tsx`
- Modify: `packages/spine-ui/src/components/RoutesPanel.tsx` (mount `<StartQuest />` in the Routes header)
- Test: `packages/spine-ui/src/components/StartQuest.test.tsx`

**Interfaces:**
- Consumes: `useEngineCommand`, `ConfirmAction`; `catalog.quests` (lists `{ slug, name }[]`), `catalog.install { quest }`, `run.start { quest }`.
- Produces: a "Start quest" control that fetches the catalog quest list, lets the operator pick one, confirms, then issues `catalog.install` **then** `run.start`.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/StartQuest.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { StartQuest } from './StartQuest'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function renderWith(client: FakeEngineClient) {
  return render(<ClientProvider client={client}><StartQuest /></ClientProvider>)
}

describe('StartQuest', () => {
  it('lists catalog quests, then installs and starts on confirm in order', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'add-tests', name: 'Add Tests' }], warnings: [] } as never
    client.responses['catalog.install'] = { ok: true, action: 'catalog.install', quest: { slug: 'add-tests' }, recipes: [], installedQuestPaths: [], installedRecipePaths: [] } as never
    client.responses['run.start'] = { ok: true, action: 'run.start', route: { id: 'route-9' } } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Add Tests')
    fireEvent.click(screen.getByText('Add Tests'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const names = client.calls.map((c) => c.name)
      expect(names).toContain('catalog.install')
      expect(names).toContain('run.start')
      expect(names.indexOf('catalog.install')).toBeLessThan(names.indexOf('run.start'))
    })
    expect(client.calls.find((c) => c.name === 'run.start')?.payload).toEqual({ quest: 'add-tests' })
  })

  it('does not start when install fails', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'add-tests', name: 'Add Tests' }], warnings: [] } as never
    client.responses['catalog.install'] = { ok: false, action: 'catalog.install', error: 'install boom' } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Add Tests')
    fireEvent.click(screen.getByText('Add Tests'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(useStore.getState().controlError).toBe('install boom'))
    expect(client.calls.some((c) => c.name === 'run.start')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/StartQuest.test.tsx`
Expected: FAIL — `Failed to resolve import './StartQuest'`.

- [ ] **Step 3: Implement**

Create `packages/spine-ui/src/components/StartQuest.tsx`:

```tsx
import { useState } from 'react'

import { ConfirmAction } from './ConfirmAction'
import { useClient } from '../engine/context'
import { useEngineCommand } from '../engine/useEngineCommand'
import { listField } from '../lib/engine'

interface CatalogQuest {
  readonly slug: string
  readonly name?: string
}

export function StartQuest() {
  const client = useClient()
  const { run, pending } = useEngineCommand()
  const [open, setOpen] = useState(false)
  const [quests, setQuests] = useState<CatalogQuest[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const openPicker = async () => {
    setOpen(true)
    if (quests === null) {
      try {
        const env = (await client.cmd('catalog.quests')) as { ok: boolean; error?: string; quests?: CatalogQuest[] }
        setQuests(listField<'quests', CatalogQuest[]>(env, 'catalog.quests', 'quests') ?? [])
      } catch {
        setQuests([])
      }
    }
  }

  const startSelected = async (slug: string) => {
    // install (workspace-wins) THEN start; a failed install rejects and skips start.
    await run('catalog.install', { quest: slug })
    await run('run.start', { quest: slug })
    setOpen(false)
    setSelected(null)
  }

  return (
    <div style={{ fontSize: 12 }}>
      {!open ? (
        <button type="button" onClick={openPicker}>Start quest</button>
      ) : (
        <div>
          {quests === null ? (
            <span>Loading quests…</span>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {quests.map((q) => (
                <li key={q.slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button type="button" onClick={() => setSelected(q.slug)} style={{ fontWeight: q.slug === selected ? 700 : 400 }}>
                    {q.name || q.slug}
                  </button>
                  {q.slug === selected ? (
                    <ConfirmAction
                      label="Start"
                      disabled={pending}
                      onConfirm={() => void startSelected(q.slug)}
                    />
                  ) : null}
                </li>
              ))}
              {quests.length === 0 ? <li>No quests.</li> : null}
            </ul>
          )}
          <button type="button" onClick={() => { setOpen(false); setSelected(null) }}>Close</button>
        </div>
      )}
    </div>
  )
}
```

In `packages/spine-ui/src/components/RoutesPanel.tsx`, import and mount it in the Routes header:

```tsx
import { StartQuest } from './StartQuest'
```

Change the `<h3>Routes</h3>` line to:

```tsx
      <h3 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Routes</span>
        <StartQuest />
      </h3>
```

Note: the confirm copy lives in `ConfirmAction`'s flow; the consequential-confirm requirement is met by wrapping Start in `ConfirmAction` (the spec's "Start `<quest>`? This launches an agent run." appears as the confirm step).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/StartQuest.test.tsx src/components/RoutesPanel.test.tsx`
Expected: PASS — StartQuest tests plus the existing RoutesPanel tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/StartQuest.tsx packages/spine-ui/src/components/StartQuest.test.tsx packages/spine-ui/src/components/RoutesPanel.tsx
git commit -m "feat(ui): StartQuest picker — install→start, confirmed (runner-aws)"
```

---

### Task 7: UI — Pause/Resume via paused-provenance

**Files:**
- Create: `packages/spine-ui/src/routeStatus.ts` (pure paused-provenance helper)
- Modify: `packages/spine-ui/src/engine/types.ts` (re-export route-event types)
- Modify: `packages/spine-ui/src/store.ts` (route-events cache)
- Modify: `packages/spine-ui/src/App.tsx` (fetch route events for blocked routes)
- Modify: `packages/spine-ui/src/components/RoutesPanel.tsx` (Pause/Resume buttons)
- Test: `packages/spine-ui/src/routeStatus.test.ts`, and Pause/Resume cases in `RoutesPanel.test.tsx`

**Interfaces:**
- Produces: `routeIsPaused(events: readonly SpineFolderRouteEvent[]): boolean` — true iff the latest `route.paused`/`route.resumed` event is `route.paused`. Store `routeEventsByRoute: Record<string, SpineFolderRouteEvent[]>` + `setRouteEvents(routeId, events)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/spine-ui/src/routeStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { routeIsPaused } from './routeStatus'
import type { SpineFolderRouteEvent } from './engine/types'

const ev = (kind: string, id: number): SpineFolderRouteEvent => ({ id: String(id), route_id: 'r1', kind, created_at: `t${id}` } as SpineFolderRouteEvent)

describe('routeIsPaused', () => {
  it('is true when the latest pause-relevant event is route.paused', () => {
    expect(routeIsPaused([ev('route.started', 1), ev('route.paused', 2)])).toBe(true)
  })
  it('is false when a route.resumed follows the pause', () => {
    expect(routeIsPaused([ev('route.paused', 1), ev('route.resumed', 2)])).toBe(false)
  })
  it('is false with no pause events', () => {
    expect(routeIsPaused([ev('route.started', 1)])).toBe(false)
    expect(routeIsPaused([])).toBe(false)
  })
  it('uses the LAST pause-relevant event when several exist', () => {
    expect(routeIsPaused([ev('route.paused', 1), ev('route.resumed', 2), ev('route.paused', 3)])).toBe(true)
  })
})
```

Add Pause/Resume cases to `packages/spine-ui/src/components/RoutesPanel.test.tsx` (inside the `RoutesPanel routes/sessions` describe or a new one):

```tsx
it('shows Pause for an active route and issues run.pause', async () => {
  const client = new FakeEngineClient()
  useStore.setState({ routes: [route('route-1', 'q')] }) // route() helper builds status:'active'
  render(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  await waitFor(() => expect(client.calls.some((c) => c.name === 'run.pause' && (c.payload as { routeId: string }).routeId === 'route-1')).toBe(true))
})

it('shows Resume for a blocked route with paused-provenance, and neither for a gate-blocked route', () => {
  const blocked = { ...route('route-2', 'q'), status: 'blocked' as const }
  useStore.setState({
    routes: [blocked],
    routeEventsByRoute: { 'route-2': [{ id: '1', route_id: 'route-2', kind: 'route.paused', created_at: 't' } as never] },
  })
  const client = new FakeEngineClient()
  const { rerender } = render(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()

  // gate-blocked (no pause events) → neither Pause nor Resume
  useStore.setState({ routeEventsByRoute: { 'route-2': [{ id: '1', route_id: 'route-2', kind: 'route.started', created_at: 't' } as never] } })
  rerender(<ClientProvider client={client}><RoutesPanel /></ClientProvider>)
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
})
```

(Ensure the test file imports `ClientProvider` from `../engine/context`, `fireEvent`/`waitFor` from `@testing-library/react`, and `FakeEngineClient` from `../test/fake-client`; add a `route(id, quest)` helper that returns a `SpineFolderRoute` with `status: 'active'` if one is not already present.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/spine-ui && npx vitest run src/routeStatus.test.ts src/components/RoutesPanel.test.tsx`
Expected: FAIL — `./routeStatus` unresolved; no Pause/Resume buttons.

- [ ] **Step 3a: Pure helper + type re-exports**

Create `packages/spine-ui/src/routeStatus.ts`:

```ts
import type { SpineFolderRouteEvent } from './engine/types'

/**
 * Paused-provenance: a route is operator-paused iff the latest pause-relevant
 * lifecycle event is `route.paused` with no subsequent `route.resumed`. This is
 * independent of the route's (overloaded) `'blocked'` status and `current_node`.
 */
export function routeIsPaused(events: readonly SpineFolderRouteEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const kind = events[i].kind
    if (kind === 'route.paused') return true
    if (kind === 'route.resumed') return false
  }
  return false
}
```

In `packages/spine-ui/src/engine/types.ts`, add `SpineFolderRouteEvent` and `RouteEventPage` to the `import type {…} from '@projectrunner/spine-folder-host'` block and the `export type {…}` re-export block.

- [ ] **Step 3b: Store route-events cache**

In `packages/spine-ui/src/store.ts`: add `SpineFolderRouteEvent` to the type imports; add state `routeEventsByRoute: Record<string, SpineFolderRouteEvent[]>` (init `{}`), action signature `setRouteEvents(routeId: string, events: SpineFolderRouteEvent[]): void`, and the implementation:

```ts
  setRouteEvents: (routeId, events) => set({ routeEventsByRoute: { ...get().routeEventsByRoute, [routeId]: events } }),
```

- [ ] **Step 3c: Fetch route events for blocked routes (App.tsx)**

In `Console` (after the recipes fetch effect), add an effect that fetches `route.events` for every `blocked` route whenever routes or the epoch change, so paused-provenance is known. It reads `getState()` for the cache check and is guarded by `cancelled`:

```ts
  const setRouteEvents = useStore((s) => s.setRouteEvents)
  // Blocked routes are status-ambiguous (pause vs gate vs autopilot). Fetch their
  // event lifecycle so the Pause/Resume control can derive true paused-provenance.
  // Re-fetched when routesEpoch advances (a pause/resume bumps it), so the cache
  // tracks the live lifecycle. active/terminal routes need no events.
  useEffect(() => {
    let cancelled = false
    const blocked = routesList.filter((r) => r.status === 'blocked')
    void Promise.all(
      blocked.map(async (r) => {
        try {
          const env = (await client.cmd('route.events', { routeId: r.id })) as { ok: boolean; error?: string; events?: { items?: SpineFolderRouteEvent[] } }
          if (cancelled) return
          const page = listField<'events', { items?: SpineFolderRouteEvent[] }>(env, 'route.events', 'events')
          setRouteEvents(r.id, page?.items ?? [])
        } catch {
          /* a route-events fetch failure leaves prior provenance intact; surfaced nowhere blocking */
        }
      }),
    )
    return () => { cancelled = true }
  }, [client, routesList, routesEpoch, setRouteEvents])
```

Add `SpineFolderRouteEvent` to the `engine/types` import in `App.tsx`. (`route.events` returns `{ events: RouteEventPage }` where `RouteEventPage` is `{ items, total }`.)

- [ ] **Step 3d: Pause/Resume buttons (RoutesPanel.tsx)**

In `RoutesPanel.tsx`: import the hook + helper, read `routeEventsByRoute`, and render the status-aware control on each route row.

```tsx
import { useEngineCommand } from '../engine/useEngineCommand'
import { routeIsPaused } from '../routeStatus'
```

Inside the component add:

```tsx
  const routeEventsByRoute = useStore((s) => s.routeEventsByRoute)
  const { run, pending } = useEngineCommand()
```

and a small inline renderer used in the route `<li>`:

```tsx
  const lifecycleControl = (r: { id: string; status: string }) => {
    if (r.status === 'active') {
      return <button type="button" disabled={pending} onClick={() => void run('run.pause', { routeId: r.id })}>Pause</button>
    }
    if (r.status === 'blocked' && routeIsPaused(routeEventsByRoute[r.id] ?? [])) {
      return <button type="button" disabled={pending} onClick={() => void run('run.resume', { routeId: r.id })}>Resume</button>
    }
    return null
  }
```

Render `{lifecycleControl(r)}` next to the route button inside each route `<li>` (wrap the existing route button + the control in a flex row).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/spine-ui && npx vitest run src/routeStatus.test.ts src/components/RoutesPanel.test.tsx`
Expected: PASS. Then the full suite to confirm no regression:
Run: `cd packages/spine-ui && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/routeStatus.ts packages/spine-ui/src/routeStatus.test.ts packages/spine-ui/src/engine/types.ts packages/spine-ui/src/store.ts packages/spine-ui/src/App.tsx packages/spine-ui/src/components/RoutesPanel.tsx packages/spine-ui/src/components/RoutesPanel.test.tsx
git commit -m "feat(ui): Pause/Resume via paused-provenance from route events (runner-aws)"
```

---

### Task 8: UI — Gate decision in TaskDetail

**Files:**
- Modify: `packages/spine-ui/src/components/TaskDetail.tsx`
- Test: `packages/spine-ui/src/components/TaskDetail.test.tsx`

**Interfaces:**
- Consumes: `useEngineCommand`, `ConfirmAction`; `gate.decide { routeId, node, decision, note? }`.
- Produces: when the selected task is `kind: 'gate'`, an Approve (direct) / Reject (confirm + note) control. `node` is `route.current_node ?? task.plan_ref ?? task.id ?? task.beads_id`.

- [ ] **Step 1: Write the failing test**

Add to the `TaskDetail dispatcher` describe in `packages/spine-ui/src/components/TaskDetail.test.tsx`:

```tsx
it('renders gate Approve/Reject for a gate task and issues gate.decide', async () => {
  const gateRoute = { ...route, current_node: 'human_plan_gate' }
  const gateTask: SpineFolderTask = { id: 'task-g', route_id: 'route-001', plan_ref: 'human_plan_gate', title: 't', phase: 'x', wave: 0, kind: 'gate', status: 'blocked', created_at: 't', updated_at: 't' }
  const client = new FakeEngineClient()
  useStore.setState({ routes: [gateRoute], selectedRouteId: 'route-001', tasks: [gateTask], selectedTaskId: 'task-g', selectedRecipeSlug: null })
  render(<ClientProvider client={client}><TaskDetail /></ClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => {
    const c = client.calls.find((x) => x.name === 'gate.decide')
    expect(c?.payload).toEqual({ routeId: 'route-001', node: 'human_plan_gate', decision: 'approve' })
  })
})

it('gate Reject requires confirm and threads the note', async () => {
  const gateRoute = { ...route, current_node: 'human_plan_gate' }
  const gateTask: SpineFolderTask = { id: 'task-g', route_id: 'route-001', plan_ref: 'human_plan_gate', title: 't', phase: 'x', wave: 0, kind: 'gate', status: 'blocked', created_at: 't', updated_at: 't' }
  const client = new FakeEngineClient()
  useStore.setState({ routes: [gateRoute], selectedRouteId: 'route-001', tasks: [gateTask], selectedTaskId: 'task-g', selectedRecipeSlug: null })
  render(<ClientProvider client={client}><TaskDetail /></ClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  fireEvent.change(screen.getByPlaceholderText('note (optional)'), { target: { value: 'no' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => {
    const c = client.calls.find((x) => x.name === 'gate.decide')
    expect(c?.payload).toEqual({ routeId: 'route-001', node: 'human_plan_gate', decision: 'reject', note: 'no' })
  })
})
```

(The test file already imports `SpineFolderTask`, `route` fixture, `useStore`, `render`, `screen`; add `ClientProvider` from `../engine/context`, `fireEvent`/`waitFor` from `@testing-library/react`, and `FakeEngineClient` from `../test/fake-client`. Note these tests render TaskDetail inside `ClientProvider` — wrap existing renders too if a hook now requires the client.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/spine-ui && npx vitest run src/components/TaskDetail.test.tsx`
Expected: FAIL — no gate controls.

- [ ] **Step 3: Implement**

In `packages/spine-ui/src/components/TaskDetail.tsx`: import the hook + ConfirmAction; in the non-recipe branch, when `task.kind === 'gate'`, render the controls. Add near the top of the component body:

```tsx
import { ConfirmAction } from './ConfirmAction'
import { useEngineCommand } from '../engine/useEngineCommand'
```

```tsx
  const { run, pending } = useEngineCommand()
  const route = useStore((s) => s.routes.find((r) => r.id === (task?.route_id ?? '')))
```

In the task-fields branch (where `task` is rendered), add — after the `<dl>` — a gate block:

```tsx
      {task.kind === 'gate' ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          {(() => {
            const node = route?.current_node ?? task.plan_ref ?? task.id
            return (
              <>
                <button type="button" disabled={pending} onClick={() => void run('gate.decide', { routeId: task.route_id, node, decision: 'approve' })}>
                  Approve
                </button>
                <ConfirmAction
                  label="Reject"
                  withNote
                  disabled={pending}
                  onConfirm={(note) => void run('gate.decide', { routeId: task.route_id, node, decision: 'reject', ...(note ? { note } : {}) })}
                />
              </>
            )
          })()}
        </div>
      ) : null}
```

(`beads_id` is not on the `SpineFolderTask` UI type; `plan_ref`/`id` cover the fallback the engine matcher accepts. If `current_node` is set, that wins, matching the spec.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/spine-ui && npx vitest run src/components/TaskDetail.test.tsx`
Expected: PASS (gate cases + existing TaskDetail tests).

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/TaskDetail.tsx packages/spine-ui/src/components/TaskDetail.test.tsx
git commit -m "feat(ui): gate Approve/Reject in TaskDetail (runner-aws)"
```

---

### Task 9: UI — Discussion thread in TaskDetail

**Files:**
- Create: `packages/spine-ui/src/components/DiscussionThread.tsx`
- Modify: `packages/spine-ui/src/engine/types.ts` (re-export discussion types)
- Modify: `packages/spine-ui/src/components/TaskDetail.tsx` (render thread for `discussion` tasks)
- Test: `packages/spine-ui/src/components/DiscussionThread.test.tsx`

**Interfaces:**
- Consumes: `useClient`, `useEngineCommand`; `discuss.list { taskId }` → `{ discussion: { task_id, total, items } }`; `discuss.post { taskId, message }`.
- Produces: `DiscussionThread(props: { taskId: string }): JSX.Element` — fetches + renders messages, posts new ones (no `author` field), refetches after post.

- [ ] **Step 1: Write the failing test**

Create `packages/spine-ui/src/components/DiscussionThread.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { DiscussionThread } from './DiscussionThread'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

const page = (items: { id: string; author: string; content: string }[]) => ({
  ok: true, action: 'discuss.list', discussion: { task_id: 'task-d', total: items.length, items },
})

describe('DiscussionThread', () => {
  it('fetches and renders messages on mount', async () => {
    const client = new FakeEngineClient()
    client.responses['discuss.list'] = page([{ id: 'm1', author: 'agent', content: 'first message' }]) as never
    render(<ClientProvider client={client}><DiscussionThread taskId="task-d" /></ClientProvider>)
    expect(await screen.findByText('first message')).toBeInTheDocument()
    expect(client.calls.find((c) => c.name === 'discuss.list')?.payload).toEqual({ taskId: 'task-d' })
  })

  it('posts a message with no author field and refetches', async () => {
    const client = new FakeEngineClient()
    client.responses['discuss.list'] = page([]) as never
    client.responses['discuss.post'] = { ok: true, action: 'discuss.post', message: { id: 'm2' } } as never
    render(<ClientProvider client={client}><DiscussionThread taskId="task-d" /></ClientProvider>)
    await waitFor(() => expect(client.calls.some((c) => c.name === 'discuss.list')).toBe(true))
    fireEvent.change(screen.getByPlaceholderText('Add a message…'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => {
      const c = client.calls.find((x) => x.name === 'discuss.post')
      expect(c?.payload).toEqual({ taskId: 'task-d', message: 'hello' })
    })
    expect(client.calls.filter((c) => c.name === 'discuss.list').length).toBeGreaterThanOrEqual(2) // refetched
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/DiscussionThread.test.tsx`
Expected: FAIL — `Failed to resolve import './DiscussionThread'`.

- [ ] **Step 3: Implement**

In `packages/spine-ui/src/engine/types.ts`, add `TaskDiscussionMessagePage` and `SpineTaskDiscussionMessage` to the folder-host import + re-export blocks.

Create `packages/spine-ui/src/components/DiscussionThread.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'

import { useClient } from '../engine/context'
import { useEngineCommand } from '../engine/useEngineCommand'
import type { TaskDiscussionMessagePage, SpineTaskDiscussionMessage } from '../engine/types'
import { listField } from '../lib/engine'

export function DiscussionThread({ taskId }: { taskId: string }) {
  const client = useClient()
  const { run, pending } = useEngineCommand()
  const [items, setItems] = useState<readonly SpineTaskDiscussionMessage[] | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const env = (await client.cmd('discuss.list', { taskId })) as { ok: boolean; error?: string; discussion?: TaskDiscussionMessagePage }
      const page = listField<'discussion', TaskDiscussionMessagePage>(env, 'discuss.list', 'discussion')
      setItems(page?.items ?? [])
    } catch {
      setItems([])
    }
  }, [client, taskId])

  useEffect(() => { void load() }, [load])

  const post = async () => {
    const message = draft.trim()
    if (!message) return
    await run('discuss.post', { taskId, message }) // no author — engine applies default identity
    setDraft('')
    await load()
  }

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h4 style={{ margin: '0 0 8px' }}>Discussion</h4>
      {items === null ? (
        <div style={{ color: '#666' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#666' }}>No messages yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((m) => (
            <li key={m.id} style={{ marginBottom: 6 }}>
              <span style={{ color: '#666', fontSize: 12, marginRight: 6 }}>{m.author}</span>
              {m.content}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
        <input type="text" placeholder="Add a message…" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
        <button type="button" disabled={pending || draft.trim() === ''} onClick={() => void post()}>Post</button>
      </div>
    </div>
  )
}
```

In `packages/spine-ui/src/components/TaskDetail.tsx`, in the task-fields branch, render the thread when `task.kind === 'discussion'`:

```tsx
import { DiscussionThread } from './DiscussionThread'
```

```tsx
      {task.kind === 'discussion' ? <DiscussionThread taskId={task.id} /> : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/DiscussionThread.test.tsx src/components/TaskDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/DiscussionThread.tsx packages/spine-ui/src/components/DiscussionThread.test.tsx packages/spine-ui/src/engine/types.ts packages/spine-ui/src/components/TaskDetail.tsx
git commit -m "feat(ui): discussion thread (list + post) in TaskDetail (runner-aws)"
```

---

### Task 10: UI — Approve proposal in AgentChat

**Files:**
- Modify: `packages/spine-ui/src/components/AgentChat.tsx`
- Test: `packages/spine-ui/src/components/AgentChat.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useEngineCommand`, `ConfirmAction`; `author.approveProposal { id }`.
- Produces: a transcript `agent.tool_result` record whose `data.text` JSON parses to an object with a `proposalId` renders an **Approve proposal** confirm control → `author.approveProposal { id: proposalId }`. Records without a parseable `proposalId` render no button.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/spine-ui/src/components/AgentChat.test.tsx`. First read `AgentChat.tsx` to mirror how it selects the active session + transcript from the store (it reads `activeSessionId` and `transcripts[sessionId]`). Model the test on that:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { AgentChat } from './AgentChat'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function seedTranscript(text: string) {
  useStore.setState({
    activeSessionId: 'agent-1',
    transcripts: { 'agent-1': [{ id: 'e1', sessionId: 'agent-1', kind: 'agent.tool_result', at: 't', idx: 0, data: { toolName: 'author_promote', text } } as never] },
  })
}

describe('AgentChat proposal approval', () => {
  it('renders Approve proposal for a tool_result carrying a proposalId and approves on confirm', async () => {
    const client = new FakeEngineClient()
    client.responses['author.approveProposal'] = { ok: true, action: 'author.approveProposal', proposalId: 'prop-7', path: 'recipes/x.yaml' } as never
    seedTranscript(JSON.stringify({ proposalId: 'prop-7' }))
    render(<ClientProvider client={client}><AgentChat /></ClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: /approve proposal/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(client.calls.find((c) => c.name === 'author.approveProposal')?.payload).toEqual({ id: 'prop-7' }))
  })

  it('renders no approve button for a tool_result without a proposalId', () => {
    const client = new FakeEngineClient()
    seedTranscript(JSON.stringify({ result: 'ok' }))
    render(<ClientProvider client={client}><AgentChat /></ClientProvider>)
    expect(screen.queryByRole('button', { name: /approve proposal/i })).toBeNull()
  })
})
```

(Verify the transcript record field names against `AgentChat.tsx` / `AgentEventRecord` and adjust the seeded record shape to match — the record carries `kind` and a `data`/payload object with `text`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/spine-ui && npx vitest run src/components/AgentChat.test.tsx`
Expected: FAIL — no Approve proposal button.

- [ ] **Step 3: Implement**

In `packages/spine-ui/src/components/AgentChat.tsx`: add a helper that extracts a `proposalId` from a tool-result record's text, and render the confirm control when present. Import:

```tsx
import { ConfirmAction } from './ConfirmAction'
import { useEngineCommand } from '../engine/useEngineCommand'
```

Add the extractor (module scope):

```tsx
function proposalIdOf(data: { toolName?: unknown; text?: unknown }): string | null {
  if (typeof data?.text !== 'string') return null
  try {
    const parsed = JSON.parse(data.text) as { proposalId?: unknown }
    return typeof parsed.proposalId === 'string' ? parsed.proposalId : null
  } catch {
    return null
  }
}
```

In the transcript renderer, for an `agent.tool_result` record, compute `const pid = proposalIdOf(data)` and, when non-null, render (alongside the existing tool-result line):

```tsx
{pid ? (
  <ConfirmAction
    label="Approve proposal"
    confirmLabel="Confirm"
    disabled={approve.pending}
    onConfirm={() => void approve.run('author.approveProposal', { id: pid })}
  />
) : null}
```

where `const approve = useEngineCommand()` is called once in the `AgentChat` component body (not inside the row renderer — hooks must be top-level; pass `approve` into the row renderer or render rows inline within the component).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/spine-ui && npx vitest run src/components/AgentChat.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/spine-ui/src/components/AgentChat.tsx packages/spine-ui/src/components/AgentChat.test.tsx
git commit -m "feat(ui): approve proposal from AgentChat transcript (runner-aws)"
```

---

### Task 11: Full typecheck + suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole repo**

Run: `cd /Users/aaronwhaley/Agent-Corporation/runner && npm run typecheck`
Expected: no errors (covers the engine `catalog.install` + `install.ts` change and all UI changes).

- [ ] **Step 2: Run the engine command tests**

Run: `npx vitest run packages/spine-engine-host/src/core/commands/catalog.test.ts packages/spine-folder-host/src/catalog/install.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the entire UI suite**

Run: `cd packages/spine-ui && npx vitest run`
Expected: PASS — every suite (lib/engine, store, useEngineCommand, ConfirmAction, StartQuest, routeStatus, RoutesPanel, TaskDetail, DiscussionThread, AgentChat, plus all pre-existing recipe-detail/console suites).

- [ ] **Step 4: Manual smoke (optional, recommended)**

With an engine host running (handshake env set), `SPINE_ENGINE_HANDSHAKE=… pnpm dev:ui`, open the console: Start a quest (confirm), Pause then Resume the new route, select a gate node and Approve, select a discussion node and Post, and (if an agent run produced one) Approve a proposal in the chat pane.

- [ ] **Step 5: Commit (only if Steps 1–3 required a fix)**

```bash
git add -A packages/spine-ui packages/spine-engine-host packages/spine-folder-host
git commit -m "chore: typecheck + full-suite green for operation controls (runner-aws)"
```

---

## Notes for the executor

- **Pre-existing test files exist** for `store`, `App`, `RoutesPanel`, `TaskDetail`, `AgentChat` — **extend, never overwrite** them (a prior slice lost coverage to an overwrite). Add new `describe`/`it` blocks; keep every existing test green.
- **`ClientProvider` is required** for any component that calls `useEngineCommand`/`useClient` — wrap such components in tests with `<ClientProvider client={new FakeEngineClient()}>` (see `App.test.tsx` for the pattern). When you add the hook to `RoutesPanel`/`TaskDetail`, update their existing tests to wrap renders in `ClientProvider` (those components now need a client).
- **`FakeEngineClient`** records `.calls` (`{name, payload}[]`) and serves `.responses[name]`; assert exact command + payload through it.
- **Do not touch any package other than the three named** (`spine-ui`, plus the single `catalog.install` change spanning `spine-engine-host` + `spine-folder-host/src/catalog/install.ts`).
- **No control predicts state** — every mutation goes through `useEngineCommand`, which refetches via `routesEpoch`; never set route/task state locally.
- The **paused-provenance** rule (Task 7) is the spec's sharpest correctness point: Pause/Resume must derive from `routeIsPaused(events)`, never from `status === 'blocked'`.
