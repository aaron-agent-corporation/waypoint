# Integrating `@waypoint/core` in a new system

This guide documents how to embed the host-agnostic Waypoint runtime
core (`@waypoint/core`) in any system — not just Mission Control.

## What the core provides

`@waypoint/core` ships only pure runtime/orchestration logic:

- **Envelope contracts**
  - `makeErrorEnvelope(error, details?)`
  - `normalizeValidationDetails(issues)`
- **Command grammar**
  - `parseWaypointCommand(raw)` → `WaypointParsedCommand`
- **Route primitives**
  - `buildWaypointRouteKey({ subjectType, subjectId, definitionSlug, definitionVersion })`
  - `normalizeWaypointScope(...)`, `isWaypointSubjectType(...)`
- **Autopilot**
  - `hasWaypointAutopilotProgress(...)`
- **Discussion**
  - conversation id helpers, metadata helpers, auto-response gating
- **Host contracts (interfaces only — you implement these):**
  - `IWaypointStore`, `IWaypointAuthz`, `IEventBus`, `IRecipeRuntime`,
    `IClock`, `IIdGenerator`

The core contains **no Next.js, no database, no HTTP framework, no
Mission Control-specific types**. It is deliberately portable.

## Minimum integration steps

1. **Add the package** (inside this repo: TS path alias
   `@waypoint/core` → `packages/waypoint-core/src/index.ts`).
2. **Implement host adapters** for whichever contracts your host uses:
   - Storage: translate core `WaypointRouteRecord`/`WaypointEventRecord`
     to your database schema.
   - Authorization: enforce actor/project/mutate semantics.
   - Event bus: forward core-emitted events to your pub/sub / streaming
     layer (Slack, websockets, SSE, Kafka…).
   - Recipe runtime: if your host uses agents/recipes, implement
     `startRecipe/getRun/cancelRun` against your execution substrate.
3. **Wire command entrypoints** (HTTP handler, CLI, chatops) to:
   - Call `parseWaypointCommand` on the raw text.
   - Translate the parsed command to your adapters (start route, list,
     gate decision, etc.).
   - Use `makeErrorEnvelope` for any error response.
4. **Maintain envelope parity** with the established contract:
   - Error: `{ ok:false, action:'error', error, details? }`
   - Success: action-specific, stable across hosts.

## Portability proof

See `examples/waypoint-host-minimal/`. It provides an executable,
tested proof that a brand-new host can:

- parse and validate a Waypoint command through core,
- start a route through an in-memory `IWaypointStore`,
- emit typed events through a custom `IEventBus`,
- run a stub `IRecipeRuntime` — all without importing from Mission
  Control or Next.js.

Run the example:

```
pnpm exec vitest run examples/waypoint-host-minimal/src/
```

A boundary test in that example (`boundaries.test.ts`) fails if
`host.ts` ever imports anything other than `@waypoint/core` or a Node
built-in, which is the primary long-term guard against regressions.

## Recommended integration patterns

- **Thin host adapters:** Keep host-specific code out of core. The more
  logic lives in adapters, the easier it is to host Waypoint elsewhere.
- **Compliance tests:** When adding a new host adapter, re-use the
  core contract test packs (`packages/waypoint-core/src/__tests__/*`)
  as specification and add host-level compliance tests that exercise
  the adapter against those contracts.
- **Versioning:** Treat `@waypoint/core` exports as the stable public
  API; internal file layout can change without consumer impact.
- **Envelope discipline:** Use core helpers (`makeErrorEnvelope`,
  `normalizeValidationDetails`) everywhere. Never hand-format error
  responses in adapters.

## Definition of "Waypoint-ready" host

A host is Waypoint-ready when:

1. It consumes orchestration logic only through `@waypoint/core`.
2. It implements required `IWaypointStore`, `IWaypointAuthz`,
   `IEventBus`, and (optionally) `IRecipeRuntime` adapters.
3. Its command/API error responses match the Waypoint envelope contract.
4. It passes its own adapter compliance tests against the core contract
   test packs.
5. No core imports from host-specific modules.
