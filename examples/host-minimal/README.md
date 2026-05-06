# Minimal Waypoint Host (portability proof)

This example demonstrates that `@waypoint/core` is host-agnostic: it runs
entirely outside of Mission Control, using in-memory stub adapters for
`IWaypointStore`, `IWaypointAuthz`, `IEventBus`, and `IRecipeRuntime`.

The example proves M5.1 of the modularization plan: parse & execute a
Waypoint command through core, start/list a route via a stub store, and
emit events through a custom bus — without importing anything from
Mission Control or Next.js.

Files:
- `src/host.ts` — stub adapters + driver wiring `@waypoint/core`
- `src/host.test.ts` — host-agnostic end-to-end test

Run just this example's test:

```
pnpm exec vitest run examples/waypoint-host-minimal/src/host.test.ts
```
