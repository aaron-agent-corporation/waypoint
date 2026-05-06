# Changelog

All notable changes to `@waypoint/core` are documented here.

## 0.1.0 — 2026-05-06

Initial extraction from Mission Control (`feat/waypoint-runtime-slice` branch).

### Included

- **Envelope contract** — standardized error envelope `{ ok:false, action:'error', error, details? }` and validation-details normalizer `{ code, path, message }`.
- **Command parser** — `/waypoint …` command grammar: `status`, `start plan`, `auto`, `auto status`, `routes`, `route`, `route-events`, `pause`, `resume`, `gate`, `discuss`, `doctor`, `forensics`, `help`.
- **Contracts** — host interfaces: `IWaypointStore`, `IWaypointAuthz`, `IEventBus`, `IRecipeRuntime`, plus `IClock` / `IIdGenerator`.
- **Discussion** — task-scoped discussion metadata helpers, conversation-id validator, auto-response contract types (payload shape, authored-by values).
- **Routes** — `buildWaypointRouteKey`, `normalizeWaypointScope`, subject-type constants, autopilot progress helpers.
- **Boundaries guard** — runtime check + test pack ensuring core imports no host-specific modules.
- **Reference external host** — `examples/host-minimal/` proves portability without Mission Control or Next.js.
- **Docs** — runtime design, envelope parity matrix, integration guide, operations runbook, modularization plan.

### Source commits (pre-extraction, in Mission Control repo)

- M0–M5 modularization milestones
- W0.1 auto-response contract types
- W1 agent authorship + loop prevention (host-side; not included in core)
