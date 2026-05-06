# Waypoint — Remaining Roadmap (Post-Modularization)

**Status:** Roadmap after Mission Control extraction is complete
**Date:** 2026-05-05
**Purpose:** One doc capturing every concrete thing left to do on Waypoint, so nothing is hand-wavy.

---

## Context

As of today:
- Mission Control has Waypoint fully wired (runtime hardening, envelope parity, release gate signed GO).
- `@waypoint/core` extraction (M0–M5) is complete and verified.
- Discussion auto-response wiring (W0–W4) is complete end-to-end.
- A standalone `/Users/aaronwhaley/Github/waypoint/` repo exists as a byte-identical copy of the core + example host, pushed to GitHub.

From here, the remaining work splits into five independent tracks. None block the others.

---

## Track 0 — Quests & Recipes Model (foundation for Track 4)

See `docs/plans/waypoint-quests-and-recipes.md` for the full design.

**Goal:** Promote the two first-class concepts — **Quest** (named reusable workflow template) and **Recipe** (named reusable agent definition) — into `@waypoint/core` as real types, parsers, and registries.

**Why this matters:** The word "lifecycle" was conflating two things: the *journey template* (Quest) and the *skeleton it generates* (workstream/milestone/phase/plan). Quests cleanly own the journey; recipes cleanly own the agent prompts. This is also a hard dependency for Track 4 (porting GSD).

**Slices:**
1. **Q1** — Add `QuestManifest` type + YAML parser to `@waypoint/core`.
2. **Q2** — Add `RecipeManifest` type + YAML parser to `@waypoint/core`.
3. **Q3** — Add `QuestRegistry` + `RecipeRegistry` with slug resolution.
4. **Q4** — Core contract tests: Quest parses, recipe references resolve or error cleanly.
5. **Q5** — `quests/` and `recipes/` directories at waypoint repo root, plus one worked example of each. Directory loaders MUST support **recursive nested folders** (e.g. `quests/dev/`, `quests/research/`, `recipes/writing/`). Flat-only is not acceptable — operator feedback already flagged this as a hard requirement.
6. **Q6** — Doc pass: update `docs/waypoint-core-integration.md` to explain Quests and Recipes.

**Ends when:** A Quest YAML can be loaded, its Recipe references can be resolved, and the registry rejects malformed or unresolved references with typed errors. No runtime behavior change required.

---

## Track 1 — Standalone Folder Host (biggest track)

See `docs/plans/waypoint-folder-host.md` for the full plan.

**Goal:** Run Waypoint on any project folder with no MC, no DB, no server.

**Phases:** F0 → F10 (10 phases, ~15 slices total)
- F0: scaffold packages + CLI
- F1: `init` + `enable`
- F2: lifecycle store (YAML-backed)
- F3: workflow definitions
- F4: route start + list
- F5: route detail + events
- F6: gate + state
- F7: task materialization + discussion
- F8: autopilot (null-runtime)
- F9: local recipe runtime (Phase 2)
- F10: docs + example project

**Ends when:** `cd ~/projects/quest && waypoint start plan --plan-id P-1 && waypoint status` works end-to-end on a clean machine.

---

## Track 2 — Mission Control Cutover (optional, medium effort)

**Goal:** MC consumes `@waypoint/core` from the external repo as a real npm-style dependency, not via local path alias.

**Why optional:** Today MC has a local copy in `packages/waypoint-core/`. It works. The cutover is about hygiene, not function.

**Slices:**
1. **C1** — Publish `@waypoint/core` to a private registry (GitHub Packages or Verdaccio) OR use `npm install github:Whaleylaw/waypoint`.
2. **C2** — Update MC's `package.json` to depend on the external package. Remove the local `packages/waypoint-core/` copy from MC.
3. **C3** — Update MC's tsconfig path alias to point at `node_modules/@waypoint/core` instead of `./packages/waypoint-core/src`.
4. **C4** — Run full MC regression. Fix any import path drift.
5. **C5** — Document the dependency in MC's README and runbook.

**Risks:**
- Version drift between the two repos. Need a clear release process for `@waypoint/core` → MC.
- First-time pain: whenever `@waypoint/core` changes, MC needs a bump+test cycle.

**Ends when:** MC's `packages/waypoint-core/` folder is deleted and MC's build still passes pulling from the external repo.

---

## Track 3 — Discussion Auto-Response: Real Hermes Integration (medium effort)

**Goal:** The webhook we built actually reaches Hermes and an agent actually replies in MC.

**Why not done:** W3 shipped the *receiver contract* and *reference adapter* in `examples/host-minimal/`. The real Hermes gateway doesn't yet route to it. This is integration work, not runtime work.

**Slices:**
1. **H1** — Define the Hermes gateway route that accepts the webhook. Shared-secret HMAC validation already specified in `@waypoint/core`.
2. **H2** — Hermes dispatches to the agent named in the payload (`agent: "gsd-doc-drafter"` → delegates to that recipe; unknown → orchestrator).
3. **H3** — Agent reply path: agent calls back into MC via `POST /api/tasks/:id/discussion/messages` with `authored_by: "agent"` + service token.
4. **H4** — End-to-end smoke: enable discussion on a task, user posts message, Hermes replies in-thread, no infinite loop.
5. **H5** — Dogfood + operator runbook updates confirming the real transport.

**Ends when:** A real user can enable a task discussion, type a message, and see an agent reply generated by Hermes appear in the thread.

---

## Track 4 — GSD Quest Port (big content track)

See `docs/plans/waypoint-gsd-quest-port.md` for the full plan.

**Goal:** Port the GSD CLI project (`get-shit-done-cc` / `get-shit-done-main`) into Waypoint as:
- One main **Quest** (`quests/gsd.yaml`) — the opinionated discuss → plan → execute → verify → ship lifecycle.
- A full **Recipe library** (`recipes/*.yaml`) — 33 recipes ported 1:1 from GSD's agent files.
- A set of **sub-Quests** (`quests/*.yaml`) — debug, spike, ui-phase, spec-phase, audits, code review, etc. (~25+ sub-Quests).

**Why this matters:** You explicitly asked for this. GSD is the inspiration for Waypoint's lifecycle model; porting it cleanly gives Waypoint a "batteries-included" starting point so any project can run `waypoint init --quest gsd` and have a full opinionated workflow out of the box. It also gives us the recipe library so future Quests can compose existing agents instead of re-authoring prompts.

**Depends on:** Track 0 (Quests & Recipes model must exist in `@waypoint/core` first).

**Phases (from the plan doc):**
- **P0** — Verify Track 0 readiness.
- **P1** — Mechanical port of 33 agents into `recipes/*.yaml`.
- **P2** — Author `quests/gsd.yaml` (main Quest).
- **P3** — Port sub-Quests (debug, spike, ui-phase, etc.).
- **P4** — Port utility/inspection Quests (explore, stats, graphify, etc.).
- **P5** — Map GSD operator commands to Waypoint equivalents (doc pass, no code).
- **P6** — Integration smoke test (Quest parses, DAG validates, no cycles, all recipe refs resolve).
- **P7** — Operator-facing docs (`docs/quests/gsd.md`).
- **P8** — Close-out and release candidate tag.

**Ends when:**
- All 33 GSD agents exist as parseable recipes.
- `quests/gsd.yaml` parses and every recipe reference resolves.
- All identified sub-Quests exist and parse.
- Registry tests green: no duplicates, no unresolved refs, no schema violations.
- `docs/quests/gsd.md` explains how to adopt the Quest.
- DAG structural validation passes.

**Explicit non-goals:** We are **not** porting GSD's CLI, hooks, SDK, npm packaging, or model profile config. We're porting the *content* (prompts, lifecycle shape, orchestration patterns), not the runtime.

---

## Smaller Cleanup Items (nice-to-have, any time)

- **Rename `gsd_enabled` column.** Currently the opt-in flag is still `gsd_enabled` in the DB. Renaming to `waypoint_enabled` is a data migration + code sweep. Priority bumped now that `gsd` is being retired as a *name* and moved to being a *Quest slug* instead.
- **Rename `gsd_*` lifecycle tables.** Same story — still named `gsd_workstreams/milestones/phases/plans`. Functional but historically named. Rename to `waypoint_workstreams/milestones/phases/plans`.
- **Forgejo remote.** Add the local Forgejo remote to `/Users/aaronwhaley/Github/waypoint/` once you're in the office with the token.
- **README at waypoint repo root.** Currently minimal. Should have quick-start, architecture diagram, badge for tests, and a section on Quests + Recipes.
- **LICENSE at waypoint repo root.** Set to MIT or whatever you prefer. Required before the GSD Quest port can ship (attribution of GSD's own license may require it).
- **Changelog discipline.** Start tagging `@waypoint/core` releases (0.1.0, 0.2.0, etc.) so MC can pin versions.

---

## Recommended Execution Order

Updated to account for Tracks 0 and 4:

1. **Forgejo remote** (5 min, blocked only on you being in office with token)
2. **README + LICENSE** at waypoint repo (30 min, must precede Track 4 for attribution)
3. **Track 0: Quests & Recipes model** — this is the unlock for the whole Quest-based direction. Small, self-contained.
4. **Track 1: Folder Host** — the big strategic win. Unlocks "Waypoint on any folder."
5. **Track 4: GSD Quest Port** — big content track. Makes `waypoint init --quest gsd` a real thing that scaffolds a full opinionated workflow.
6. **Track 3: Hermes integration** — closes the last deferred loop from the MC work.
7. **Track 2: MC cutover** — only once Track 1 is stable and we actually *need* version independence.
8. **Small cleanup: rename `gsd_*` to `waypoint_*`** — do once Track 4 is done so the naming retirement is consistent.

---

## What I Will NOT Do Without Explicit Approval

- Delete or modify `packages/waypoint-core/` in Mission Control (keeps MC working until cutover is deliberate).
- Auto-execute Track 2 or Track 3 while Track 1 is in flight.
- Make breaking changes to the existing `@waypoint/core` API without a plan.
- Begin Track 4 before Track 0 is done (hard dependency — would produce un-parseable files).
- Port GSD's CLI, SDK, hooks, or npm packaging. Only content (prompts, lifecycle shape, orchestration patterns) gets ported.
