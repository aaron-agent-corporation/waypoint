# Spine Modularization Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Extract Spine into a host-agnostic runtime core that Mission Control consumes via adapters, while preserving current behavior and release safety.

**Architecture:** Introduce `packages/runner-core` for pure orchestration/runtime logic and define explicit host interfaces (`Store`, `Authz`, `EventBus`, `RecipeRuntime`, `Clock`, `IdGenerator`). Keep Next.js/API/db wiring in Mission Control adapters. Migrate incrementally with parity tests and contract tests to avoid regressions.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, existing Mission Control Workflow Engine + Spine APIs.

---

## Scope and End State

### In scope
- Core/runtime extraction boundaries and interfaces.
- Command/runtime/state-transition logic migration into core.
- Adapter layer in Mission Control for db/auth/events/recipes.
- Contract tests for envelopes, commands, and route behaviors.
- Minimal second-host proof-of-embed.

### Out of scope (for this plan)
- New product features unrelated to modularization.
- Replacing Mission Control’s workflow engine substrate.
- Broad schema redesign.

### Definition of done
1. Mission Control imports orchestration logic from `packages/runner-core`.
2. Core has no Next.js/db-specific imports.
3. Adapter compliance tests pass.
4. Existing Spine endpoint contract/tests remain green.
5. Second-host PoC demonstrates core portability.

---

## File/Module Target Map

### New (core)
- `packages/runner-core/package.json`
- `packages/runner-core/tsconfig.json`
- `packages/runner-core/src/index.ts`
- `packages/runner-core/src/contracts/*.ts`
- `packages/runner-core/src/commands/*.ts`
- `packages/runner-core/src/routes/*.ts`
- `packages/runner-core/src/discussion/*.ts`
- `packages/runner-core/src/autopilot/*.ts`
- `packages/runner-core/src/envelope/*.ts`
- `packages/runner-core/src/__tests__/*.test.ts`

### New (MC adapter)
- `src/lib/runner-adapter/store.ts`
- `src/lib/runner-adapter/authz.ts`
- `src/lib/runner-adapter/event-bus.ts`
- `src/lib/runner-adapter/recipe-runtime.ts`
- `src/lib/runner-adapter/index.ts`

### Existing (to refactor gradually)
- `src/lib/runner.ts`
- `src/lib/runner-command.ts`
- `src/lib/runner-autopilot.ts`
- `src/lib/runner-task-discussion.ts`
- `src/lib/runner-api.ts`
- `src/app/api/projects/[id]/runner/**/route.ts`
- `src/app/api/tasks/[id]/discussion/**/route.ts`

---

## Phase Plan (bite-sized execution)

## Phase M0 — Workspace bootstrap and guardrails

### Task M0.1: Create `runner-core` package skeleton
**Objective:** Establish package boundary without behavior changes.

**Files:**
- Create: `packages/runner-core/package.json`
- Create: `packages/runner-core/tsconfig.json`
- Create: `packages/runner-core/src/index.ts`
- Modify: workspace config files as needed (`pnpm-workspace.yaml`, root tsconfig paths)

**Steps:**
1. Add failing import test in MC that expects `@projectrunner/spine` export.
2. Run targeted test and confirm failure.
3. Add minimal package + export.
4. Re-run test and confirm pass.
5. Commit.

### Task M0.2: Add architecture boundary lint rule
**Objective:** Prevent core importing host-specific modules.

**Files:**
- Modify: eslint config / boundary rules file
- Create: `packages/runner-core/src/__tests__/boundaries.test.ts` (or static check script)

**Steps:**
1. Add failing check that disallows `next/*`, `@/lib/db`, etc. in core.
2. Add boundary config.
3. Verify pass.
4. Commit.

---

## Phase M1 — Contract extraction first (low risk)

### Task M1.1: Move envelope + validation details normalization to core
**Objective:** Make contract helpers host-agnostic and shared by all hosts.

**Files:**
- Create: `packages/runner-core/src/envelope/error-envelope.ts`
- Create: `packages/runner-core/src/envelope/validation-details.ts`
- Modify: `src/lib/runner-api.ts` to delegate to core
- Test: existing route tests + new unit tests under core

**Acceptance:**
- Envelope shape unchanged.
- `details` normalization remains `{ code, path, message }`, `$` root fallback.

### Task M1.2: Extract command grammar/parser to core
**Objective:** Isolate `/runner` command parsing from MC execution wiring.

**Files:**
- Create: `packages/runner-core/src/commands/parser.ts`
- Modify: `src/lib/runner-command.ts` to use parser from core
- Test: parser tests mirrored or moved

**Acceptance:**
- Existing command parser tests pass unchanged.

---

## Phase M2 — Runtime interfaces and adapter seam

### Task M2.1: Define host interfaces in core
**Objective:** Codify ports needed by runtime logic.

**Files:**
- Create: `packages/runner-core/src/contracts/store.ts`
- Create: `packages/runner-core/src/contracts/authz.ts`
- Create: `packages/runner-core/src/contracts/event-bus.ts`
- Create: `packages/runner-core/src/contracts/recipe-runtime.ts`
- Create: `packages/runner-core/src/contracts/system.ts`

**Interface minimums:**
- `ISpineStore`
- `ISpineAuthz`
- `IEventBus`
- `IRecipeRuntime`
- `IClock`, `IIdGenerator`

### Task M2.2: Implement Mission Control adapters
**Objective:** Bind core contracts to current MC infrastructure.

**Files:**
- Create: `src/lib/runner-adapter/*.ts`
- Modify: route handlers/services to instantiate runtime via adapters

**Acceptance:**
- No behavior drift in endpoint tests.

---

## Phase M3 — Move execution logic into core

### Task M3.1: Extract route lifecycle operations
**Objective:** Move start/list/detail/state/gate/event logic behind core use-cases.

**Files:**
- Create: `packages/runner-core/src/routes/use-cases/*.ts`
- Modify: MC route handlers to call use-cases

**Acceptance:**
- Endpoint responses (success/error) parity retained.

### Task M3.2: Extract autopilot orchestration logic
**Objective:** Move bounded-run autopilot planning/decision flow to core.

**Files:**
- Create: `packages/runner-core/src/autopilot/*.ts`
- Modify: `src/lib/runner-autopilot.ts` adapter wrapper

**Progress:**
- ✅ Extracted host-agnostic autopilot progress helper to core (`packages/runner-core/src/autopilot/progress.ts`) and exported from `@projectrunner/spine`.
- ✅ Extracted task-discussion conversation-id helpers to core (`packages/runner-core/src/discussion/conversation.ts`), re-wired Mission Control `slugifyAgent`/`buildTaskDiscussionConversationId` to delegate through `@projectrunner/spine`, and added export-surface contract coverage.
- ✅ Extracted strict task-discussion conversation-id validator to core (`isStrictSpineTaskDiscussionConversationId`) and re-wired Mission Control discussion start flow to use the shared core rule.
- ✅ Extracted task-discussion metadata parsing/merge/enabled helpers to core (`packages/runner-core/src/discussion/metadata.ts`) and re-wired Mission Control task-discussion metadata helpers to delegate through `@projectrunner/spine`.
- ✅ Extracted workflow metadata numeric parsing helper to core (`parseSpineWorkflowMetadataNumber`) and re-wired Mission Control task discussion message metadata construction to source workflow IDs via `@projectrunner/spine`.
- ✅ Extracted task discussion message metadata builder to core (`buildSpineTaskDiscussionMessageMetadata`) and re-wired Mission Control discussion message creation to delegate metadata shaping through `@projectrunner/spine`.
- ✅ Extracted task discussion status resolution helper to core (`resolveSpineTaskDiscussionStatus`) and re-wired Mission Control discussion start flow to preserve `closed`/`summarized` status via shared `@projectrunner/spine` behavior.
- ✅ Extracted task discussion list limit normalization helper to core (`normalizeSpineTaskDiscussionListLimit`) and re-wired Mission Control discussion listing flow to delegate limit clamping through `@projectrunner/spine`.
- ✅ Extracted task discussion message content normalization helper to core (`normalizeSpineTaskDiscussionMessageContent`) and re-wired Mission Control discussion posting flow to delegate content trimming through shared `@projectrunner/spine` behavior.
- ✅ Extracted task discussion agent resolution helper to core (`resolveSpineTaskDiscussionAgent`) and re-wired Mission Control discussion start flow to delegate requested/existing/assigned agent fallback selection through shared `@projectrunner/spine` behavior.
- ✅ Extracted task discussion start metadata builder to core (`buildSpineTaskDiscussionStartMetadata`) and re-wired Mission Control discussion start flow to preserve strict conversation-id rewrite + status/start-time defaults via shared `@projectrunner/spine` behavior.

**Acceptance:**
- Existing autopilot command/API tests pass.

### Task M3.3: Extract discussion metadata/state logic
**Objective:** Keep task-discussion business rules in core; transport in adapter.

**Files:**
- Create: `packages/runner-core/src/discussion/*.ts`
- Modify: `src/lib/runner-task-discussion.ts`
- Keep best-effort event emission behavior in MC API adapters.

---

## Phase M4 — Contract test harness and parity lock

### Task M4.1: Add core contract test suite
**Objective:** Validate host-independent behavior.

**Files:**
- Create: `packages/runner-core/src/__tests__/contract/*.test.ts`

**Covers:**
- envelope and validation details
- command parsing
- gate decisions
- autopilot status pagination
- discussion auto-response gating semantics

### Task M4.2: Add Mission Control adapter compliance tests
**Objective:** Prove MC adapter satisfies core contracts.

**Files:**
- Create: `src/lib/runner-adapter/__tests__/*.test.ts`

**Progress:**
- ✅ Initial coverage added for adapter assembly (`src/lib/runner-adapter/__tests__/index.test.ts`):
  - validates dependency pass-through identity
  - enforces explicit failure on missing required dependency
- ✅ Event bus adapter contract checks added (`src/lib/runner-adapter/__tests__/event-bus.test.ts`):
  - validates publish pass-through behavior
  - enforces explicit failure when `publish` is missing
- ✅ Authz adapter contract checks added (`src/lib/runner-adapter/__tests__/authz.test.ts`):
  - validates read/mutate access pass-through behavior
  - enforces explicit failure when required authz methods are missing
- ✅ Recipe runtime adapter contract checks added (`src/lib/runner-adapter/__tests__/recipe-runtime.test.ts`):
  - validates start/get/cancel pass-through behavior
  - enforces explicit failure when required runtime methods are missing
- ✅ Store adapter contract checks added (`src/lib/runner-adapter/__tests__/store.test.ts`):
  - validates get/list/append pass-through behavior
  - enforces explicit failure when required store methods are missing

---

## Phase M5 — Second-host portability proof

### Task M5.1: Minimal external host harness
**Objective:** Demonstrate “Spine-on-anything.”

**Files:**
- Create: `examples/runner-host-express/` (or similar)

**Capabilities to prove:**
- parse and execute command through core
- start/list route through core + stub store
- emit events via custom bus

### Task M5.2: Portability doc
**Objective:** Document how to integrate Spine core in a new system.

**Files:**
- Create: `docs/runner-core-integration.md`

---

## Testing and Verification Strategy

Run in this order for each slice:

1. Targeted RED/GREEN tests for touched module.
2. Related Spine suites.
3. `pnpm typecheck`
4. `pnpm lint`

Suggested regression pack:
```bash
pnpm exec vitest run \
  src/lib/__tests__/runner*.test.ts \
  src/app/api/projects/[id]/runner/**/__tests__/route.test.ts \
  src/app/api/tasks/[id]/discussion/**/__tests__/route.test.ts
```

Core package test pack (new):
```bash
pnpm exec vitest run packages/runner-core/src/__tests__/**/*.test.ts
```

---

## Risks and Mitigations

1. **Risk:** Hidden coupling to MC db/auth in logic modules.
   - **Mitigation:** Extract contract-first; add boundary checks early (M0.2).
2. **Risk:** Envelope drift during migration.
   - **Mitigation:** Reuse parity matrix and contract tests in M4.
3. **Risk:** Adapter behavior mismatch.
   - **Mitigation:** Adapter compliance suite + staged endpoint migration.
4. **Risk:** Over-extraction slows delivery.
   - **Mitigation:** Migrate only stable runtime logic first; keep host transport local.

---

## Immediate Next 5 execution slices

1. M0.1 package scaffold + export smoke test.
2. M0.2 boundary guard (no host imports in core).
3. M1.1 envelope/validation helper extraction.
4. M1.2 command parser extraction.
5. M2.1 contract interfaces draft with unit tests.

### Incremental progress log
- ✅ Extracted route-key construction helper to core (`packages/runner-core/src/routes/route-key.ts`) and re-wired Mission Control `buildSpineRouteKey` to delegate through `@projectrunner/spine`.
- ✅ Added core export-surface contract coverage for route-key helper behavior in `src/lib/__tests__/runner-core-contracts.test.ts`.
- ✅ Extracted scope normalization + subject-type guard into core (`packages/runner-core/src/routes/scope.ts`), re-wired Mission Control `normalizeSpineScope`/`isSpineSubjectType` to delegate through `@projectrunner/spine`, and added export-surface compatibility coverage for `gsd_*` aliases.
- ✅ Promoted canonical + compatibility subject type constants to core exports (`SPINE_SUBJECT_TYPES`, `SPINE_COMPAT_SUBJECT_TYPES`) and re-wired Mission Control `src/lib/runner.ts` to source those constants directly from `@projectrunner/spine`.

---

## Operator Notes

- Product naming: refer to unified runtime as **Spine**.
- “GSD” only for compatibility/history references.
- Mission Control remains first-party host adapter, not the definition of core.

---

## Handoff

Plan complete and saved. Ready to execute using subagent-driven-development — task-by-task with TDD and parity verification on each slice.
