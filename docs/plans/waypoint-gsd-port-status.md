# GSD Port Status

Tracks the progress of porting get-shit-done-cc (GSD) agents and
commands into Waypoint Recipes and Quests.

Upstream: https://www.npmjs.com/package/get-shit-done-cc
License: MIT — see `third_party/gsd/LICENSE` and `third_party/gsd/NOTICE.md`.

## Legend

- ☐ = not started
- ⧗ = in progress
- ✅ = ported, manifest exists, parses through `parseRecipeManifest` /
      `parseQuestManifest`
- ⛔ = intentionally not ported (with reason)

## Agents → Recipes

33 agents total. Each becomes one Recipe. Slugs keep the `gsd-` prefix
to namespace the library and avoid collisions with non-GSD recipes.
Files live under `recipes/gsd/` (recursive loader handles subfolders).

| Upstream file                         | Recipe slug              | Status |
|---------------------------------------|--------------------------|--------|
| agents/gsd-advisor-researcher.md      | gsd-advisor-researcher   | ✅     |
| agents/gsd-ai-researcher.md           | gsd-ai-researcher        | ✅     |
| agents/gsd-assumptions-analyzer.md    | gsd-assumptions-analyzer | ✅     |
| agents/gsd-code-fixer.md              | gsd-code-fixer           | ✅      |
| agents/gsd-code-reviewer.md           | gsd-code-reviewer        | ✅      |
| agents/gsd-codebase-mapper.md         | gsd-codebase-mapper      | ✅      |
| agents/gsd-debug-session-manager.md   | gsd-debug-session-manager| ✅      |
| agents/gsd-debugger.md                | gsd-debugger             | ✅      |
| agents/gsd-doc-classifier.md          | gsd-doc-classifier       | ✅      |
| agents/gsd-doc-synthesizer.md         | gsd-doc-synthesizer      | ✅      |
| agents/gsd-doc-verifier.md            | gsd-doc-verifier         | ✅      |
| agents/gsd-doc-writer.md              | gsd-doc-writer           | ✅     |
| agents/gsd-domain-researcher.md       | gsd-domain-researcher    | ✅     |
| agents/gsd-eval-auditor.md            | gsd-eval-auditor         | ✅      |
| agents/gsd-eval-planner.md            | gsd-eval-planner         | ✅      |
| agents/gsd-executor.md                | gsd-executor             | ✅      |
| agents/gsd-framework-selector.md      | gsd-framework-selector   | ✅      |
| agents/gsd-integration-checker.md     | gsd-integration-checker  | ✅      |
| agents/gsd-intel-updater.md           | gsd-intel-updater        | ✅      |
| agents/gsd-nyquist-auditor.md         | gsd-nyquist-auditor      | ✅      |
| agents/gsd-pattern-mapper.md          | gsd-pattern-mapper       | ✅      |
| agents/gsd-phase-researcher.md        | gsd-phase-researcher     | ✅      |
| agents/gsd-plan-checker.md            | gsd-plan-checker         | ✅      |
| agents/gsd-planner.md                 | gsd-planner              | ✅      |
| agents/gsd-project-researcher.md      | gsd-project-researcher   | ✅      |
| agents/gsd-research-synthesizer.md    | gsd-research-synthesizer | ✅      |
| agents/gsd-roadmapper.md              | gsd-roadmapper           | ✅      |
| agents/gsd-security-auditor.md        | gsd-security-auditor     | ✅      |
| agents/gsd-ui-auditor.md              | gsd-ui-auditor           | ✅      |
| agents/gsd-ui-checker.md              | gsd-ui-checker           | ✅      |
| agents/gsd-ui-researcher.md           | gsd-ui-researcher        | ✅      |
| agents/gsd-user-profiler.md           | gsd-user-profiler        | ✅      |
| agents/gsd-verifier.md                | gsd-verifier             | ✅      |

Progress: **33 / 33** ported (100%).

## Commands → Quests / sub-Quests / operator actions

65 commands total. Per the port plan, commands fall into categories:

- **Phase entrypoints** (part of the main GSD Quest, one node per)
- **Sub-Quests** (reusable workflows callable from within or outside
  the main Quest, e.g. `/gsd-debug`, `/gsd-forensics`)
- **Operator actions** (exposed through Waypoint's existing command
  surface, e.g. `/waypoint pause` already covers `/gsd-pause-work`)
- **Utility Quests** (standalone, e.g. `/gsd-health`)
- **Won't port** (e.g. GSD-CLI-specific like `/gsd-config`,
  `/gsd-settings`, `/gsd-workspace`)

Full inventory lives in `docs/plans/waypoint-gsd-quest-port.md`.
This table tracks only the ported artifacts.

| Upstream command        | Category          | Target artifact                  | Status |
|-------------------------|-------------------|----------------------------------|--------|
| (none yet)              |                   |                                  | ☐      |

## Main GSD Quest

`quests/gsd.yaml` — **status: ☐ not started**.

The main Quest composes the phase-entrypoint recipes into the full
discuss → plan → execute → verify → ship loop.

## Execution order

Per `docs/plans/waypoint-gsd-quest-port.md`:

- **P0** — attribution + scaffolding + first worked Recipe port ✅ (this commit)
- **P1** — Recipe port sweep (remaining 32 agents) ✅
- **P2** — Main Quest manifest (`quests/gsd.yaml`)
- **P3** — Sub-Quests (debug, forensics, etc.)
- **P4** — Discuss-phase wiring (task-discussion integration)
- **P5** — Execute-phase wiring (multi-plan parallel waves)
- **P6** — Verify + ship wiring
- **P7** — End-to-end Quest smoke test (init → ship, headless fixture)
- **P8** — Docs + public template catalog
