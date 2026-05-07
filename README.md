# Waypoint

Host-agnostic lifecycle + workflow execution runtime. Waypoint is the unified system that combines lifecycle/intent modeling (workstreams, milestones, phases, plans) with executable DAG workflows (routes, nodes, recipes, review, gates, autopilot).

**Status:** extracted from [Mission Control](https://github.com/Whaleylaw/) as of the M5 portability milestone (May 2026). Mission Control is the first host/adapter — this repo contains the portable core and a reference minimal host.

## Layout

```
src/                          # @waypoint/core — portable runtime
  envelope/                   # error envelope + validation-details normalization
  commands/                   # command grammar parser
  contracts/                  # host interfaces (store, authz, event-bus, recipe-runtime)
  discussion/                 # task-scoped discussion metadata + auto-response contract
  routes/                     # route-key, scope primitives
  autopilot/                  # autopilot progress helpers
  boundaries.ts               # runtime guard — keeps core free of host-specific imports

examples/host-minimal/        # reference external host (no MC, no Next.js)

docs/
  waypoint-runtime-design.md
  waypoint-envelope-parity-matrix.md
  waypoint-core-integration.md      # how to build a new host
  waypoint-operations-runbook.md
  plans/waypoint-modularization-plan.md
```

## Quick start

```bash
pnpm install          # or npm install
pnpm test             # runs vitest across core + example host
pnpm typecheck
```


## Quest and Recipe catalog

Waypoint includes a bundled GSD-inspired Quest and Recipe catalog as a portability example and batteries-included workflow library:

- Operator guide: [`docs/quests/gsd.md`](docs/quests/gsd.md)
- Human-readable command map: [`docs/quests/gsd-command-map.md`](docs/quests/gsd-command-map.md)
- Machine-readable command map: [`docs/quests/gsd-command-map.yaml`](docs/quests/gsd-command-map.yaml)

The GSD Quest preserves the initialize → discuss → plan → execute → verify → ship loop as Waypoint manifests. It does not make GSD the runtime identity; Waypoint remains the unified runtime.

## Host contract

To embed Waypoint in a new system, implement these interfaces from `@waypoint/core`:

- `IWaypointStore` — persistence
- `IWaypointAuthz` — authn/authz
- `IEventBus` — event publish/subscribe
- `IRecipeRuntime` — recipe execution
- `IClock`, `IIdGenerator` — determinism + portability

See `docs/waypoint-core-integration.md` for the full integration guide and `examples/host-minimal/` for a working reference.

## Error envelope contract

Standard error shape across all Waypoint-hosted endpoints:

```json
{ "ok": false, "action": "error", "error": "...", "details": "optional" }
```

Zod-style validation `details` normalize to `{ code, path, message }` with `path` as dotted string (`$` for root).

## Relationship to GSD

Waypoint is the evolution of Mission Control's internal GSD lifecycle system. GSD is historical inspiration and compatibility naming in some legacy tables/paths — not the product name going forward. Waypoint is the unified runtime.

## License

MIT — see [LICENSE](./LICENSE).
