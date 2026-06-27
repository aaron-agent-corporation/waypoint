# Waypoint UI — Operation Controls Design

**Date:** 2026-06-27
**Status:** Draft (pending MAR review)
**Tracking:** waypoint-aws
**Packages:** `packages/waypoint-ui` (primary), `packages/waypoint-engine-host` (one new command)

## Problem

The Waypoint console is observability-only: it renders routes, the DAG, tasks,
recipes, and an agent-chat pane, but the human-in-the-loop control points of a
running route — starting a quest, pausing/resuming a route, deciding a gate,
approving an agent's proposed write, and posting to a discussion — all require
CLI or raw `curl /cmd/...`. The engine already exposes every one of these
commands, and the UI proxy already carries the unrestricted `global` token, so
the console *can* drive a route today; it simply offers no affordances. This
slice adds them, turning the console from a window into an operating surface.

## Scope

This is **slice 4a — operation** of a larger "full operation + authoring"
intent, deliberately decomposed:

- **In scope (A+B+C):** run controls (start / pause / resume), decision points
  (gate decide, proposal approve), and discussion (list / post).
- **Out of scope (D, separate later cycle):** authoring recipes/quests from the
  UI (`author.recipe` / `author.quest` / `author.handoff` / `author.promote`) —
  a whole editor surface with its own validation/footgun design.

## Goal

The operator can, from the console alone:

1. Start any catalog quest, and pause/resume any route.
2. Approve or reject a pending gate, and approve an agent's proposed write.
3. Read and post to a node's discussion thread.

All without leaving the UI, with consequential actions guarded by a confirm
step.

## Architecture

**Almost entirely UI-side, plus exactly one new engine command**
(`catalog.install`). Every other control issues a command the engine already
registers; the Vite dev proxy forwards every `/cmd/*` and injects the host's
`global` (unrestricted) bearer token server-side, so there is no proxy, token,
or permission-model change.

### Command surface used

| Control | Command | Payload | Returns |
| --- | --- | --- | --- |
| Install a quest | `catalog.install` *(new)* | `{ quest }` | `{ quest, installedQuestPaths }` |
| Start a quest | `run.start` | `{ quest }` | `{ route }` |
| Pause a route | `run.pause` | `{ routeId, reason? }` | `{ route }` |
| Resume a route | `run.resume` | `{ routeId }` | `{ route }` |
| Decide a gate | `gate.decide` | `{ routeId, node, decision: 'approve' \| 'reject', note? }` | `{ route }` |
| Approve a proposal | `author.approveProposal` | `{ id }` | `{ proposalId, path }` |
| List a discussion | `discuss.list` | `{ taskId }` | `{ discussion }` |
| Post to a discussion | `discuss.post` | `{ taskId, message }` | `{ message }` |
| List quests (start picker) | `catalog.quests` *(existing)* | — | `{ quests, warnings }` |

### State refresh after a mutation

Control commands mutate route/task state. The engine's event hub already pushes
route events over the WS, which the store turns into a `routesEpoch` bump → a
`routes.list` / `tasks.list` refetch (the existing path). To avoid depending on
event timing, **each control also bumps `routesEpoch` on a successful
response** (belt-and-suspenders); the refetch is idempotent, so a redundant bump
is harmless. No new polling, no new subscription.

### Placement principle

Controls live *on the entity they act on*, not in a separate panel:

- route lifecycle → on the route row / a route header,
- gate decision → in `TaskDetail` when a `gate` node is selected,
- proposal approval → on the AgentChat transcript record that carries the
  `proposalId`,
- discussion → in `TaskDetail` when a `discussion` node is selected.

## Control surfaces

### A. Run controls

**Quest-start picker (`StartQuest.tsx`, new).** A "Start quest" button opens a
picker populated from `catalog.quests`. Selecting a quest triggers the
consequential-action **confirm** ("Start `<quest>`? This launches an agent
run."). On confirm: `catalog.install { quest }` (idempotent/additive — safe even
if already installed), then `run.start { quest }`. The new route appears via the
post-success `routesEpoch` refetch. A start failure surfaces in the control
error banner and leaves the picker open to retry.

**Pause / Resume.** Per-route, status-aware. A route whose status is active shows
**Pause** → `run.pause { routeId }` (direct, reversible); a paused route shows
**Resume** → `run.resume { routeId }` (direct). The exact status literal that
`run.pause` sets is confirmed during implementation; the button derives from
`route.status` and never assumes a status it has not read. Rendered on the route
row in `RoutesPanel` (compact icon-buttons) so it is reachable without selecting
the route.

### B. Decision points

**Gates.** When the selected task is `kind: 'gate'`, `TaskDetail` shows
**Approve** (direct) and **Reject** (consequential confirm + an optional note
field). Both issue `gate.decide { routeId: task.route_id, node, decision, note? }`.
The gate `node` key is the node the route is blocked on; the design resolves it
from the route's `current_node` for the gate's route (the route is, by
definition, awaiting that gate), falling back to the gate task's
`metadata.waypoint.node_key` if `current_node` is absent. The exact metadata
path is confirmed during implementation against `read-model`. Reject is treated
as consequential because it can terminate or redirect a route.

**Proposals.** An agent run can return a `proposalId` (surfaced today in the
AgentChat transcript records). That record gains an **Approve proposal** button →
consequential confirm ("Approve proposal — this writes files to the
workspace.") → `author.approveProposal { id }`. Only proposal-bearing records get
the button; approval is idempotent-safe at the engine (a second approve of an
already-applied proposal fails loud, surfaced in the banner).

### C. Discussion

When the selected task is `kind: 'discussion'`, `TaskDetail` renders a
`DiscussionThread.tsx` (new): on mount it fetches `discuss.list { taskId }` and
shows the messages; a post box submits `discuss.post { taskId, message }`
(direct, low-stakes) and refetches the thread. The thread is fetched per
selected discussion task and cached by `taskId` in the store (same fetch-once
pattern as recipes), invalidated for that task after a successful post.

## Shared infrastructure

### `ConfirmAction.tsx` (new)

A small reusable inline-confirm: renders a trigger button; on click it swaps to a
"Confirm / Cancel" pair (with an optional free-text note field for gate-reject).
Consequential actions (`run.start`, `author.approveProposal`, gate **reject**)
wrap their trigger in `ConfirmAction`; cheap/reversible actions (pause, resume,
gate **approve**, discussion **post**) call directly. Inline (not a modal) to
keep the operator in context and keep the component trivially testable.

### `useEngineCommand` hook (new)

A thin wrapper over `client.cmd` that every control uses:

- tracks an in-flight flag (the calling control disables itself + shows a pending
  state while a command is outstanding — prevents double-submit),
- throws on a non-ok envelope via the existing `listField` throw-on-non-ok
  helper,
- on success, bumps `routesEpoch` (the post-mutation refresh) and clears
  `controlError`,
- on failure, sets `controlError` to the message and re-enables the control.

### Error surfacing

A new `controlError: string | null` store field, rendered as a `control` row in
the existing per-source error banner (`App.tsx` `errors[]`), with **Dismiss**.
A failed mutation is always visible and never silently swallowed; the control
stays enabled to retry. Distinct from `routesError` / `recipesError` /
`sessionsError` / `error` so one source clearing cannot hide another.

## Engine: `catalog.install` (the one non-UI change)

A new command registered alongside `catalog.quests` / `catalog.recipes`:

```ts
bus.register('catalog.install', async (payload) => {
  const { root } = ctx.session.requireActive()
  const input = (payload ?? {}) as { quest?: string }
  if (!input.quest) throw new EngineError('catalog.install requires a quest slug', { code: 'VALIDATION', field: 'quest' })
  const result = await ctx.session.mutate(() => installQuestCatalog(root, { quest: input.quest! }))
  return ok('catalog.install', { quest: result.quest, installedQuestPaths: result.installedQuestPaths })
})
```

`installQuestCatalog` (folder-host) is additive and idempotent — it copies the
quest manifest + its recipes into `.waypoint/`. An unknown slug surfaces as the
existing `resolveQuestRecipes` failure → a `NOT_FOUND` envelope. It runs inside
`ctx.session.mutate` so it serializes with other workspace mutations, consistent
with `run.start`. This is the **only** change outside `packages/waypoint-ui`.

## Error handling

- Every mutation can fail (validation, `NOT_FOUND`, runtime). All failures route
  through `useEngineCommand` → `controlError` banner → visible, dismissible,
  retryable. No control performs a destructive local state change before the
  engine confirms success (the UI reflects engine state, never predicts it).
- In-flight controls are disabled to prevent double-submit; a slow command shows
  a pending state rather than appearing inert.
- `catalog.install` failure aborts the start sequence (no `run.start` is issued)
  and surfaces the install error.

## Testing

**Engine (vitest):** `catalog.install` handler — success installs the manifest +
recipes and returns `installedQuestPaths`; missing `quest` → `VALIDATION`;
unknown quest → `NOT_FOUND`.

**UI (vitest + Testing Library, `FakeEngineClient` asserting exact command +
payload):**

- `StartQuest`: picker lists `catalog.quests`; selecting + confirming issues
  `catalog.install { quest }` **then** `run.start { quest }` in that order; an
  install failure does **not** issue `run.start` and surfaces the banner.
- Pause/Resume: an active route renders Pause and issues `run.pause { routeId }`;
  a paused route renders Resume and issues `run.resume { routeId }`; the button
  for the wrong status is absent.
- Gate: a `gate` task renders Approve/Reject; Approve issues
  `gate.decide { decision: 'approve', routeId, node }` directly; Reject requires
  confirm and threads the note into `gate.decide { decision: 'reject', note }`.
- Proposal: a transcript record with a `proposalId` renders Approve; confirming
  issues `author.approveProposal { id }`; a record without a `proposalId` renders
  no button.
- Discussion: selecting a `discussion` task fetches `discuss.list { taskId }`
  once and renders the messages; posting issues `discuss.post { taskId, message }`
  and refetches.
- `ConfirmAction`: trigger → confirm fires the action, cancel does not; the note
  field value reaches the action.
- `useEngineCommand`: disables during flight, bumps `routesEpoch` on success,
  sets `controlError` on failure; the banner shows the `control` row.

## Non-goals

- Authoring recipes/quests from the UI (slice D — separate spec/plan cycle).
- Multi-operator auth, roles, or per-action permissions (the token is already
  global; this is a single-operator local tool).
- Bulk/batch controls (start-many, pause-all).
- New run-status polling or WS subscriptions — reuse the existing event →
  `routesEpoch` → refetch path.
- Optimistic UI / local state prediction — the console always reflects confirmed
  engine state.

## Risks & mitigations

- **Real-cost actions.** `run.start` on the Pi brain spawns paid model calls;
  `approveProposal` writes files. Mitigation: both are behind the consequential
  confirm with explicit copy naming the consequence.
- **Gate node resolution.** Deciding a gate needs the correct `node` key. The
  design resolves it from `route.current_node` (the route is awaiting the gate),
  with the gate task's `metadata.waypoint.node_key` as a documented fallback; the
  implementation verifies the exact source against `read-model` before wiring,
  and the gate test pins the payload.
- **Stale read after mutation.** If the WS event lags, the post-success
  `routesEpoch` bump still refetches, so the panel cannot strand on pre-mutation
  state.
- **Double-submit.** The in-flight disable in `useEngineCommand` prevents a
  second identical mutation while one is outstanding.
