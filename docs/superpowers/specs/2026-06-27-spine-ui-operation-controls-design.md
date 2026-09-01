# Spine UI — Operation Controls Design

**Date:** 2026-06-27
**Status:** Final — MAR-converged (run `runs/20260627-aqr1vf`, base `claude-1`, status `agreed`; integrated artifact `014-claude-1-integration.md`, decision record `decision-record.md`)
**Slice:** 4a — operation (run controls, decision points, discussion)
**Tracking:** runner-aws
**Packages:** `packages/spine-ui` (primary), `packages/spine-engine-host` (one new command)

## Problem

The Spine console is observability-only. It renders routes, the DAG, tasks, recipes, and an agent-chat pane, but every human-in-the-loop control point of a running route — starting a quest, pausing/resuming, deciding a gate, approving an agent's proposed write, posting to a discussion — requires the CLI or a raw `curl /cmd/...`. The engine already registers every one of these commands, and the Vite dev proxy already forwards `/cmd/*` with the host's unrestricted `global` bearer token injected server-side, so the console *can* drive a route today; it simply offers no affordances. This slice adds them, turning the console from a window into an operating surface.

## Scope

This is **slice 4a — operation** of a larger "full operation + authoring" intent, deliberately decomposed:

- **In scope (A+B+C):** run controls (start / pause / resume), decision points (gate decide, proposal approve), discussion (list / post).
- **Out of scope (D, separate cycle):** authoring recipes/quests from the UI (`author.recipe` / `author.quest` / `author.handoff` / `author.promote`) — its own editor surface with separate validation/footgun design.

## Goal

From the console alone the operator can:

1. Start any catalog quest, and pause/resume any route.
2. Approve or reject a pending gate, and approve an agent's proposed write.
3. Read and post to a node's discussion thread.

All without leaving the UI, with consequential actions guarded by a confirm step.

## Architecture

**Almost entirely UI-side, plus exactly one new engine command** (`catalog.install`). Every other control issues a command the engine already registers; the dev proxy injects the `global` token server-side, so there is **no proxy, token, or permission-model change**.

### Command surface used (verified against `core/commands`)

| Control | Command | Payload | Returns |
| --- | --- | --- | --- |
| Install a quest | `catalog.install` *(new)* | `{ quest }` | `{ quest, recipes, installedQuestPaths, installedRecipePaths }` |
| Start a quest | `run.start` | `{ quest }` | `{ route }` |
| Pause a route | `run.pause` | `{ routeId, reason? }` | `{ route }` |
| Resume a route | `run.resume` | `{ routeId }` | `{ route }` |
| Decide a gate | `gate.decide` | `{ routeId, node, decision: 'approve' \| 'reject', note? }` | `{ route }` |
| Approve a proposal | `author.approveProposal` | `{ id }` | `{ proposalId, path }` |
| List a discussion | `discuss.list` | `{ taskId }` | `{ discussion: { task_id, total, items } }` |
| Post to a discussion | `discuss.post` | `{ taskId, message }` | `{ message }` |
| List quests (start picker) | `catalog.quests` *(existing)* | — | `{ quests, warnings }` |

> Note on the install return shape: `installQuestCatalog` returns the full envelope `{ quest, recipes, installedQuestPaths, installedRecipePaths }` (`folder-host/src/catalog/install.ts:11-15`). The new command surfaces **all four** fields so callers and tests bind the complete contract rather than a partial one; a follow-up recipes refresh can use `installedRecipePaths`, while the UI itself only depends on the success envelope.

### State refresh after a mutation

Control commands mutate route/task state. The engine's event hub already pushes route events over the WS; the store turns these into a `routesEpoch` bump → a `routes.list` / `tasks.list` refetch (the existing `App.tsx` effect keyed on `routesEpoch`). To avoid depending on event timing, **each control also bumps `routesEpoch` on a successful response** (belt-and-suspenders via `bumpRoutesEpoch()`); the refetch is idempotent, so a redundant bump is harmless. No new polling, no new subscription.

### Placement principle

Controls live *on the entity they act on*, not in a separate panel:

- route lifecycle → on the route row / a route header,
- gate decision → in `TaskDetail` when a `gate` node is selected,
- proposal approval → on the `AgentChat` transcript record carrying the `proposalId`,
- discussion → in `TaskDetail` when a `discussion` node is selected.

## Control surfaces

### A. Run controls

**Quest-start picker (`StartQuest.tsx`, new).** A "Start quest" button opens a picker populated from `catalog.quests`. Selecting a quest triggers the consequential **confirm** ("Start `<quest>`? This launches an agent run."). On confirm: `catalog.install { quest }` (additive/idempotent, **workspace-wins** — see Engine section), **then** `run.start { quest }`. The new route appears via the post-success `routesEpoch` refetch. A start failure surfaces in the control error banner and leaves the picker open to retry.

**Pause / Resume — and the `'blocked'` overload (corrected via paused-provenance).** The route status enum is `'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'` (`spine-folder-host/src/routes/types.ts`). There is **no `'paused'` or `'running'` literal**. `run.pause` sets status to `'blocked'` and appends a `route.paused` event (`routes/state.ts:99-103`); `run.resume` sets it back to `'active'` and appends a `route.resumed` event (`state.ts:113-122`).

The critical consequence the naïve "active → Pause, blocked → Resume" mapping misses: **`'blocked'` is overloaded.** A route awaiting a gate is also `'blocked'` (`state.ts:72-83`), and so are autopilot and other blockers. Status alone — and even `status` plus `current_node` kind — therefore cannot distinguish an operator-paused route from a gate-blocked or otherwise-blocked one. A `current_node`-kind heuristic is unsound: a non-gate current node is **not** proof of a pause (autopilot/other blockers also produce `blocked` + a non-gate node), and it fails the dual case of a route explicitly paused *while parked on a gate*.

Resolution — derive Pause/Resume from **true paused-provenance via the route's event lifecycle**, not from status or node kind:

- `status === 'active'` → show **Pause** → `run.pause { routeId }` (reversible, direct).
- **paused-provenance** — the latest pause-relevant event in the route's lifecycle is `route.paused` with **no subsequent `route.resumed`** → show **Resume** → `run.resume { routeId }` (direct). This holds **independent of `current_node`**, so a genuinely-paused route that happens to be parked on a gate correctly shows Resume.
- `status === 'blocked'` with **no** paused-provenance (gate-awaiting, autopilot, or any other blocker that never emitted `route.paused`) → show **no** Pause/Resume. If the block is a gate, the decision affordance (gate Approve/Reject, see §B) is the correct control; resuming a route that was never paused would desync it.
- terminal statuses (`complete` / `cancelled` / `failed`) → no lifecycle control.

If the read model later exposes a derived `paused` boolean computed off the same `route.paused`/`route.resumed` events, the UI consumes that flag instead of re-walking the event list; the contract (provenance, not status) is unchanged. Rendered on the route row in `RoutesPanel` as compact icon-buttons so it is reachable without selecting the route. The Pause/Resume tests pin three cases: `active ⇒ Pause`, `paused-provenance ⇒ Resume`, `blocked-without-pause ⇒ neither`.

### B. Decision points

**Gates.** When the selected task is `kind: 'gate'`, `TaskDetail` shows **Approve** (direct) and **Reject** (consequential confirm + optional note). Both issue `gate.decide { routeId: task.route_id, node, decision, note? }`.

Node resolution: the gate `node` is matched engine-side by `entry.plan_ref === node || entry.id === node || entry.beads_id === node` (`folder-host/src/beads/transitions.ts`). The route exposes `current_node: string | null` (`routes/types.ts`), and the route is by definition parked on the gate it awaits, so **`route.current_node` is the primary source** for `node`. If `current_node` is **null**, fall back to the gate task's own identifier (`plan_ref` → `id` → `beads_id`), which the engine matcher accepts equivalently — **not** an assumed `metadata.runner.node_key`, which is not what the matcher reads. The gate test pins the exact `node` value sent. Reject is consequential because it can terminate or redirect a route.

**Proposals.** An agent run can emit a `proposalId`, surfaced today in `AgentChat` transcript records (a tool-result event whose JSON text carries `proposalId`, e.g. `author_promote`). That record gains an **Approve proposal** button → consequential confirm ("Approve proposal — this writes files to the workspace.") → `author.approveProposal { id }`, which returns `{ proposalId, path }`. Only proposal-bearing records get the button. A second approve of an already-applied proposal fails loud at the engine and surfaces in the banner (no silent success).

### C. Discussion

When the selected task is `kind: 'discussion'`, `TaskDetail` renders `DiscussionThread.tsx` (new): on mount it fetches `discuss.list { taskId }` and renders `discussion.items` (the return is a page `{ task_id, total, items }`). A post box submits `discuss.post { taskId, message }` (direct, low-stakes) and refetches. `discuss.post` also accepts an optional `author` field; the UI **omits it** and lets the engine apply its default `operator` identity (operator posts are user-authored — hardcoding `'operator'` would duplicate, and risk contradicting, the engine default). The thread is fetched per selected discussion task and cached by `taskId` in the store (the same fetch-once pattern as recipes in `App.tsx` / `store.ts`), invalidated for that task after a successful post.

## Shared infrastructure

### `ConfirmAction.tsx` (new)

A small reusable **inline** confirm: renders a trigger button; on click it swaps to a "Confirm / Cancel" pair, with an optional free-text note field (gate-reject). Consequential actions (`run.start`, `author.approveProposal`, gate **reject**) wrap their trigger; cheap/reversible actions (pause, resume, gate **approve**, discussion **post**) call directly. Inline rather than modal to keep the operator in context and the component trivially testable.

### Shared `listField` helper

The envelope-unwrap helper `listField(env, action, key)` — which **throws** on `!env.ok` rather than silently returning `undefined` — is **extracted out of `App.tsx` into a shared module** (`packages/spine-ui/src/lib/engine.ts`) imported by **both** `App.tsx` and the new `useEngineCommand` hook. The new control path consumes the shared helper rather than reaching across into `App.tsx`, satisfying the "single shared extraction helper" requirement and keeping one definition of the success/failure contract.

### `useEngineCommand` hook (new)

A thin wrapper over `client.cmd` that every control uses:

- tracks an in-flight flag (the calling control disables itself + shows a pending state — prevents double-submit),
- unwraps the envelope via the **shared** `listField` helper (from `lib/engine.ts`),
- on success: bumps `routesEpoch` and clears `controlError`,
- on failure: sets `controlError` to the message and re-enables the control.

### Error surfacing

A new `controlError: string | null` store field, rendered as a `control` row in the existing per-source error banner (`App.tsx` `errors[]`), with **Dismiss**. A failed mutation is always visible and never silently swallowed; the control stays enabled to retry. Distinct from `routesError` / `recipesError` / `sessionsError` / `error` so clearing one source cannot hide another.

## Engine: `catalog.install` (the one non-UI change)

A new command registered alongside `catalog.quests` / `catalog.recipes`. The real `installQuestCatalog` signature is the **3-argument** `(projectRoot, catalog, options)` and requires the **bundled catalog**, so the handler must load it the same way `catalog.quests` does — it is *not* a two-argument `installQuestCatalog(root, { quest })` call as a naïve sketch would suggest.

Two correctness constraints govern the handler:

1. **Workspace-wins (do not clobber authored content).** `installQuestCatalog`'s underlying copy (`install.ts:28-35`) writes the quest manifest + recipes to target paths unconditionally. Before invoking it, the handler checks whether an **authored** `.runner/quests/<slug>.yaml` already exists in the workspace. If it does, that manifest is **preserved (not overwritten)** and reported back as the existing path; only missing recipes are installed. "Additive/idempotent" is thus enforced by an explicit existence guard, not assumed from the copy's behavior.
2. **Full result envelope.** The handler returns all four fields from the install result (`install.ts:11-15`): `{ quest, recipes, installedQuestPaths, installedRecipePaths }`.

```ts
bus.register('catalog.install', async (payload) => {
  const { root } = ctx.session.requireActive()
  const input = (payload ?? {}) as { quest?: string }
  if (!input.quest) {
    throw new EngineError('catalog.install requires a quest slug', { code: 'VALIDATION', field: 'quest' })
  }
  const catalog = await loadBundledCatalog() // same source catalog.quests reads
  const result = await ctx.session.mutate(() =>
    // workspace-wins: installQuestCatalog skips an authored quest manifest that already
    // exists at .runner/quests/<slug>.yaml, preserving it and installing only missing recipes.
    installQuestCatalog(root, catalog, { quest: input.quest! }),
  )
  return ok('catalog.install', {
    quest: result.quest,
    recipes: result.recipes,
    installedQuestPaths: result.installedQuestPaths,
    installedRecipePaths: result.installedRecipePaths,
  })
})
```

An unknown slug surfaces as the existing resolve failure → a `NOT_FOUND` envelope. The command runs inside `ctx.session.mutate` so it serializes with other workspace mutations, consistent with `run.start`. This is the **only** change outside `packages/spine-ui`.

> Note: the workspace-wins guard may live inside `installQuestCatalog` (preferred — one place enforces it for all callers) or in the `catalog.install` handler if the shared function must stay backward-compatible; either way the engine test below pins the byte-identical-after-reinstall behavior.

## Error handling

- Every mutation can fail (validation, `NOT_FOUND`, runtime). All failures route through `useEngineCommand` → `controlError` banner → visible, dismissible, retryable. No control performs a destructive local state change before the engine confirms (the UI reflects engine state, never predicts it).
- In-flight controls are disabled to prevent double-submit; a slow command shows a pending state rather than appearing inert.
- `catalog.install` failure aborts the start sequence (no `run.start` is issued) and surfaces the install error.

## Testing

**Engine (vitest):** `catalog.install` handler — success installs the manifest + recipes and returns the **full** envelope `{ quest, recipes, installedQuestPaths, installedRecipePaths }` (all four keys asserted); missing `quest` → `VALIDATION`; unknown quest → `NOT_FOUND`; **workspace-wins** — an authored `.runner/quests/<slug>.yaml` is **byte-identical** after a re-install (the guard preserves it), while a missing recipe is still installed.

**UI (vitest + Testing Library, `FakeEngineClient` asserting exact command + payload):**

- `StartQuest`: picker lists `catalog.quests`; selecting + confirming issues `catalog.install { quest }` **then** `run.start { quest }` in that order; an install failure does **not** issue `run.start` and surfaces the banner.
- Pause/Resume (paused-provenance): an `active` route renders Pause → `run.pause { routeId }`; a route whose latest lifecycle event is `route.paused` with no later `route.resumed` renders Resume → `run.resume { routeId }` **regardless of `current_node`** (including when parked on a gate); a `blocked` route with **no** paused-provenance (gate-awaiting / autopilot) renders **neither**; the button for the wrong state is absent.
- Gate: a `gate` task renders Approve/Reject; Approve issues `gate.decide { decision: 'approve', routeId, node }` directly with `node` derived from `current_node` (and the `plan_ref`/`id`/`beads_id` fallback when `current_node` is null); Reject requires confirm and threads the note into `gate.decide { decision: 'reject', note }`.
- Proposal: a transcript record with a `proposalId` renders Approve; confirming issues `author.approveProposal { id }`; a record without a `proposalId` renders no button.
- Discussion: selecting a `discussion` task fetches `discuss.list { taskId }` once and renders `discussion.items`; posting issues `discuss.post { taskId, message }` **with no `author` field** and refetches.
- `ConfirmAction`: trigger → confirm fires the action, cancel does not; the note-field value reaches the action.
- `useEngineCommand`: disables during flight, bumps `routesEpoch` on success, sets `controlError` on failure; the banner shows the `control` row; it imports `listField` from the shared `lib/engine.ts` module (not from `App.tsx`).

## Non-goals

- Authoring recipes/quests from the UI (slice D — separate spec/plan cycle).
- Multi-operator auth, roles, or per-action permissions (the token is already global; this is a single-operator local tool).
- Bulk/batch controls (start-many, pause-all).
- New run-status polling or WS subscriptions — reuse the existing event → `routesEpoch` → refetch path.
- Optimistic UI / local state prediction — the console always reflects confirmed engine state.

## Risks & mitigations

- **`'blocked'` is overloaded (paused vs. gate-awaiting vs. other blockers).** The design's sharpest correctness risk: a single status covers operator-pause, gate-wait, autopilot, and more. Mitigation: Pause/Resume derives from **true paused-provenance** (latest `route.paused` with no subsequent `route.resumed`), independent of `status`-detail and `current_node` kind — so Resume appears on (and only on) a genuinely-paused route, including one parked on a gate, and never on a route that was merely gate-blocked or autopilot-blocked. Pinned by the three-case Pause/Resume tests.
- **Real-cost actions.** `run.start` on the Pi brain spawns paid model calls; `approveProposal` writes files. Mitigation: both behind the consequential confirm with explicit copy naming the consequence.
- **Gate node resolution.** Deciding a gate needs a `node` the engine matches (`plan_ref` / `id` / `beads_id`). Resolved from `route.current_node`, with the gate task's own identifier as the fallback when `current_node` is null — **not** an assumed metadata key. The gate test pins the payload.
- **Clobbering authored quests.** `installQuestCatalog`'s copy is unconditional. Mitigation: the workspace-wins existence guard preserves an authored `.runner/quests/<slug>.yaml`, installing only missing recipes; pinned by the byte-identical-after-reinstall engine test.
- **Engine `installQuestCatalog` arity.** The real signature is 3-arg and requires the bundled catalog; the handler loads it the way `catalog.quests` does rather than calling a two-arg shape that does not exist.
- **Stale read after mutation.** If the WS event lags, the post-success `routesEpoch` bump still refetches, so the panel cannot strand on pre-mutation state.
- **Double-submit.** The in-flight disable in `useEngineCommand` prevents a second identical mutation while one is outstanding.

## Resolved decisions

- **Pause/Resume keys on paused-provenance, not status or node kind.** Resume is offered iff the route's event lifecycle shows the latest pause-relevant event is `route.paused` with no subsequent `route.resumed` (`state.ts:99-103` / `state.ts:113-122`). `current_node` is not load-bearing for Pause/Resume; a genuinely-paused gate-parked route shows Resume, a gate-blocked-but-never-paused route shows neither. The earlier "blocked + non-gate `current_node` ⇒ Resume" heuristic is **dropped** as unsound.
- **`catalog.install` is workspace-wins.** An authored `.runner/quests/<slug>.yaml` is preserved (existence guard before the copy), only missing recipes are installed, and the test asserts the file is byte-identical after re-install.
- **`catalog.install` returns the full envelope** `{ quest, recipes, installedQuestPaths, installedRecipePaths }`, matching `install.ts:11-15`.
- **`listField` is a shared helper** in `packages/spine-ui/src/lib/engine.ts`, imported by both `App.tsx` and `useEngineCommand`; it throws on `!env.ok`.
- **`gate.decide` node** comes from `route.current_node`, falling back to the gate task identifier (`plan_ref`/`id`/`beads_id`) when null — not `metadata.runner.node_key`.
- **`discuss.post` omits `author`**, letting the engine apply its default `operator` identity.

### Open decisions

- Whether the workspace-wins guard lives inside `installQuestCatalog` (preferred, one enforcement point for all callers) or in the `catalog.install` handler (if the shared function must remain backward-compatible). Either satisfies the byte-identical-after-reinstall test; the implementer picks based on whether other callers should inherit the guard.
