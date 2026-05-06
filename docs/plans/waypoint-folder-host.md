# Waypoint Folder Host — Standalone Project Runtime Plan

**Status:** Draft plan (no code yet)
**Date:** 2026-05-05
**Goal:** Enable Waypoint to run on any project folder with no Mission Control, no database, no HTTP server — just files on disk and a CLI.

---

## End State (Definition of Done)

A user can run:

```bash
cd ~/projects/quest
waypoint init
waypoint enable
waypoint lifecycle add workstream --key core --name "Core"
waypoint lifecycle add milestone --workstream core --version v1 --title "First Release"
waypoint lifecycle add phase --milestone v1 --key execute --lifecycle execute
waypoint lifecycle add plan --phase execute --ref P-1 --title "Build intake form"
waypoint start plan --plan-id P-1
waypoint status
waypoint routes
waypoint gate --route-id 1 --node review --approve
```

…and have all state persisted in `.waypoint/` inside the project folder. No servers. No DB. No external dependencies beyond Node + `@waypoint/core`.

---

## Why This Is Possible Now

The modularization work (M0–M5, already complete) made Waypoint host-agnostic. `@waypoint/core` has:

- Zero Mission Control dependencies
- Interface contracts (`IWaypointStore`, `IWaypointAuthz`, `IEventBus`, `IRecipeRuntime`, `IClock`, `IIdGenerator`)
- A proof-of-concept external host in `examples/host-minimal/`

Folder Host is the **first real non-MC host** — it replaces the in-memory adapters from `examples/host-minimal/` with a filesystem-backed implementation.

---

## Architecture

### Package layout (new)

```
packages/
├── waypoint-core/                  # (exists)
├── waypoint-folder-host/           # NEW — filesystem adapter
│   ├── src/
│   │   ├── store/
│   │   │   ├── folder-store.ts     # implements IWaypointStore
│   │   │   ├── file-locking.ts     # advisory locks for single-writer safety
│   │   │   └── serialization.ts    # yaml/json helpers
│   │   ├── authz/
│   │   │   └── local-authz.ts      # single-user "everything allowed" impl
│   │   ├── event-bus/
│   │   │   └── jsonl-event-bus.ts  # appends to events/<route>.jsonl
│   │   ├── recipe-runtime/
│   │   │   ├── null-runtime.ts     # tracks state only, no execution
│   │   │   └── local-runtime.ts    # (phase 2) invokes local agent
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
└── waypoint-cli/                   # NEW — thin command wrapper
    ├── src/
    │   ├── commands/
    │   │   ├── init.ts
    │   │   ├── enable.ts
    │   │   ├── status.ts
    │   │   ├── start.ts
    │   │   ├── routes.ts
    │   │   ├── route.ts
    │   │   ├── route-events.ts
    │   │   ├── gate.ts
    │   │   ├── pause.ts
    │   │   ├── resume.ts
    │   │   ├── auto.ts
    │   │   ├── discuss.ts
    │   │   └── lifecycle/
    │   │       ├── add-workstream.ts
    │   │       ├── add-milestone.ts
    │   │       ├── add-phase.ts
    │   │       └── add-plan.ts
    │   ├── bin.ts                  # entry: #!/usr/bin/env node
    │   └── index.ts
    ├── package.json
    └── tsconfig.json
```

### Folder layout (per-project)

```
~/projects/quest/
├── .waypoint/
│   ├── config.yaml                 # enabled flag, metadata, recipe-runtime choice
│   ├── lifecycle/
│   │   ├── workstreams.yaml        # all workstreams for this project
│   │   ├── milestones.yaml
│   │   ├── phases.yaml
│   │   └── plans.yaml
│   ├── workflows/
│   │   ├── plan-execution.yaml     # reference DAGs (or imported)
│   │   └── doctor.yaml
│   ├── routes/
│   │   ├── route-001.yaml          # route state (current node, status, vars)
│   │   └── route-002.yaml
│   ├── events/
│   │   ├── route-001.jsonl         # append-only timeline
│   │   └── route-002.jsonl
│   ├── tasks/
│   │   ├── task-001.yaml           # materialized task state
│   │   └── task-001-discussion.jsonl  # discussion history (if enabled)
│   └── .lock                       # advisory lock file
└── (your actual project files)
```

### Key design choices

1. **YAML for structured state, JSONL for append-only timelines.** YAML is human-editable; JSONL is crash-safe for events.
2. **Single-writer advisory lock.** `.waypoint/.lock` with PID+timestamp. Simple; covers the "don't run two CLIs at once on the same folder" case.
3. **No network.** Folder host is purely local. A future "sync" feature (push/pull to git or a remote Waypoint server) is out of scope.
4. **Recipe runtime is pluggable.** Phase 1 ships with `null-runtime` (state-only). Phase 2 adds `local-runtime` that shells out to agents. Users can pick in `config.yaml`.

---

## Phased Delivery

### F0 — Scaffold + Contracts (1 slice)

- Create `packages/waypoint-folder-host/` with empty adapter stubs
- Create `packages/waypoint-cli/` with a single `waypoint --help` command
- Both consume `@waypoint/core`
- Boundary test: folder host imports only `@waypoint/core` + Node built-ins
- Smoke: `waypoint --version` prints version

### F1 — `init` + `enable` + `config` (1 slice)

- `waypoint init` creates `.waypoint/` skeleton
- `waypoint enable` sets `enabled: true` in `config.yaml`
- Folder-store can read/write `config.yaml`
- Tests: fresh folder → init → enable → status shows enabled

### F2 — Lifecycle Store (2 slices)

- **F2.1:** `folder-store.ts` implements lifecycle read/write against YAML files
  - `listWorkstreams`, `createWorkstream`, `listMilestones`, `createMilestone`, etc.
- **F2.2:** CLI commands `waypoint lifecycle add workstream/milestone/phase/plan`
- Tests: create full hierarchy, read back, verify YAML on disk

### F3 — Workflow Definitions (1 slice)

- Folder host reads YAML workflow definitions from `.waypoint/workflows/`
- Uses existing `parseWorkflowDefinition` from `@waypoint/core` (may need to extract from MC)
- CLI: `waypoint workflows list`
- Tests: drop a YAML file, verify it loads

### F4 — Route Start + List (2 slices)

- **F4.1:** `folder-store.ts` implements route persistence (`routes/route-NNN.yaml`)
- **F4.2:** CLI `waypoint start plan --plan-id <id>` and `waypoint routes`
- Events appended to `events/route-NNN.jsonl`
- Tests: start a route, verify YAML + JSONL, list returns it

### F5 — Route Detail + Events (1 slice)

- CLI `waypoint route --route-id <id>` and `waypoint route-events --route-id <id>`
- Reads route YAML + events JSONL
- Applies same pagination/contract as MC

### F6 — Gate Decisions + State (2 slices)

- **F6.1:** Folder-store gate decision persistence
- **F6.2:** CLI `waypoint gate --approve|--reject` and `waypoint pause|resume`
- Tests: gate approval flow end-to-end

### F7 — Task Materialization + Discussion (2 slices)

- **F7.1:** When a route advances, materialize tasks to `tasks/task-NNN.yaml`
- **F7.2:** CLI `waypoint discuss --task-id <id> --message "…"`
- Discussion history in `tasks/task-NNN-discussion.jsonl`
- Null recipe runtime means nothing auto-executes — user drives it manually

### F8 — Autopilot (1 slice, null-runtime only)

- CLI `waypoint auto --max-iterations N`
- Loops the state machine: advance until blocked on gate/error/cap
- Null-runtime means it just advances state, doesn't actually execute work
- Tests: autopilot advances through a 3-node workflow with no gates

### F9 — Local Recipe Runtime (2 slices, Phase 2)

- **F9.1:** `local-runtime.ts` — shells out to `hermes` CLI or configured agent binary
- **F9.2:** Config in `.waypoint/config.yaml`: choose runtime (`null` vs `local`)
- Tests: mock agent binary, verify invocation

### F10 — Docs + Examples (1 slice)

- `docs/waypoint-folder-host.md` — user-facing guide
- `examples/folder-host-quest/` — a real sample project using folder host
- Updates to `docs/waypoint-core-integration.md` pointing at folder host as the reference filesystem adapter

---

## Test Strategy

Every slice follows TDD:
1. Write failing test (folder state assertions, CLI output assertions)
2. Watch it fail
3. Implement minimally
4. Watch it pass

Cross-host parity tests: the same Waypoint command grammar tests that run against MC should also run against folder host. Extract them into a shared contract test pack that both hosts must pass.

---

## Risks + Open Questions

1. **Concurrency.** Advisory lock is weak. Two CLIs on the same folder could race. First version: fail fast if lock held. Later: proper file locking.
2. **Large event logs.** JSONL grows forever. Add log rotation/compaction in a later slice.
3. **Workflow parser coupling.** `parseWorkflowDefinition` might still live in MC. May need to extract into `@waypoint/core` first (possibly folds into M3 cleanup).
4. **Git compatibility.** YAML/JSONL is git-friendly by design — you *can* commit `.waypoint/` to track project state in version control. Worth documenting.
5. **Recipe runtime in Phase 2.** Deciding the agent dispatch protocol is non-trivial. Null-runtime first keeps Phase 1 scope clean.

---

## What This Doesn't Do (Out of Scope)

- Multi-user collaboration on the same folder (single-writer only)
- Network sync / remote Waypoint servers
- Web UI (future: could be a separate package reading the same folder)
- Replacing MC — MC keeps its adapter; this is a second host, not a replacement

---

## Immediate Next Slice After This Plan Is Approved

**F0** — scaffold both packages, confirm boundaries, CLI prints `--help`. One commit.
