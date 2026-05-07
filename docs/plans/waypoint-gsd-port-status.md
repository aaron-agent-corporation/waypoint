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

| Upstream command | Category | Target artifact | Status |
|---|---|---|---|
| new-project.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| discuss-phase.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| plan-phase.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| execute-phase.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| verify-work.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| ship.md | phase entrypoint | quests/gsd.yaml metadata | ✅ |
| debug.md | sub-Quest | quests/debug.yaml | ✅ |
| spike.md | sub-Quest | quests/spike.yaml | ✅ |
| ui-phase.md | sub-Quest | quests/ui-phase.yaml | ✅ |
| spec-phase.md | sub-Quest | quests/spec-phase.yaml | ✅ |
| secure-phase.md | sub-Quest | quests/secure-phase.yaml | ✅ |
| ai-integration-phase.md | sub-Quest | quests/ai-integration-phase.yaml | ✅ |
| ultraplan-phase.md | sub-Quest | quests/ultraplan-phase.yaml | ✅ |
| validate-phase.md | sub-Quest | quests/validate-phase.yaml | ✅ |
| audit-fix.md | audit / review Quest | quests/audit-fix.yaml | ✅ |
| audit-milestone.md | audit / review Quest | quests/audit-milestone.yaml | ✅ |
| audit-uat.md | audit / review Quest | quests/audit-uat.yaml | ✅ |
| code-review.md | audit / review Quest | quests/code-review.yaml | ✅ |
| eval-review.md | audit / review Quest | quests/eval-review.yaml | ✅ |
| ui-review.md | audit / review Quest | quests/ui-review.yaml | ✅ |
| review.md | audit / review Quest | quests/review.yaml | ✅ |
| review-backlog.md | audit / review Quest | quests/review-backlog.yaml | ✅ |
| plan-review-convergence.md | audit / review Quest | quests/plan-review-convergence.yaml | ✅ |
| forensics.md | audit / review Quest | quests/forensics.yaml | ✅ |
| health.md | audit / review Quest | quests/health.yaml | ✅ |
| explore.md | utility / inspection Quest | quests/explore.yaml | ✅ |
| map-codebase.md | utility / inspection Quest | quests/map-codebase.yaml | ✅ |
| stats.md | utility / inspection Quest | quests/stats.yaml | ✅ |
| graphify.md | utility / inspection Quest | quests/graphify.yaml | ✅ |
| extract-learnings.md | utility / inspection Quest | quests/extract-learnings.yaml | ✅ |
| profile-user.md | utility / inspection Quest | quests/profile-user.yaml | ✅ |
| sketch.md | utility / inspection Quest | quests/sketch.yaml | ✅ |
| fast.md | utility / inspection Quest | quests/fast.yaml | ✅ |
| quick.md | utility / inspection Quest | quests/quick.yaml | ✅ |
| cleanup.md | utility / inspection Quest | quests/cleanup.yaml | ✅ |
| complete-milestone.md | utility / inspection Quest | quests/complete-milestone.yaml | ✅ |
| milestone-summary.md | utility / inspection Quest | quests/milestone-summary.yaml | ✅ |
| docs-update.md | utility / inspection Quest | quests/docs-update.yaml | ✅ |
| ingest-docs.md | utility / inspection Quest | quests/ingest-docs.yaml | ✅ |
| add-tests.md | utility / inspection Quest | quests/add-tests.yaml | ✅ |
| pr-branch.md | utility / inspection Quest | quests/pr-branch.yaml | ✅ |
| pause-work.md | operator action | /waypoint pause | ✅ documented |
| resume-work.md | operator action | /waypoint resume | ✅ documented |
| autonomous.md | operator action | /waypoint auto | ✅ documented |
| progress.md | operator action | /waypoint status | ✅ documented |
| manager.md | operator action | /waypoint routes | ✅ documented |
| capture.md | operator action | operator backlog capture action | ✅ documented |
| inbox.md | operator action | operator backlog read action | ✅ documented |
| import.md | operator action | operator import action | ✅ documented |
| update.md | operator action | operator update action | ✅ documented |
| new-milestone.md | operator action | Quest scaffolding action | ✅ documented |
| phase.md | operator action | inspection action | ✅ documented |
| workstreams.md | operator action | inspection action | ✅ documented |
| workspace.md | operator action | inspection action | ✅ documented |
| settings.md | operator action | config action | ✅ documented |
| config.md | operator action | config action | ✅ documented |
| help.md | operator action | /waypoint help | ✅ documented |
| thread.md | operator action | discussion-related action | ✅ documented |
| undo.md | operator action | operator rollback action | ✅ documented |
| ns-context.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |
| ns-ideate.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |
| ns-manage.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |
| ns-project.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |
| ns-review.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |
| ns-workflow.md | deferred / optional | not ported in first catalog pass | ⧗ deferred |

## Main GSD Quest

`quests/gsd.yaml` — **status: ✅ ported, manifest exists and resolves its recipe references**.

The main Quest composes the phase-entrypoint recipes into the full
initialize → discuss → plan → execute → verify → ship loop. Runtime-specific
command and sub-Quest mappings that are not first-class Quest schema yet live
under `metadata.gsd_port` in the manifest.

## Execution order

Per the accepted recovery plan in `WAYPOINT_RESUME_PLAN.md` (which supersedes the fabricated P2–P8 narrative):

- **P0** — attribution + scaffolding + first worked Recipe port ✅
- **P1** — Recipe port sweep (33 total GSD Recipes) ✅
- **P2** — Main Quest manifest (`quests/gsd.yaml`) ✅
- **P3** — Command-informed first-batch sub-Quests ✅
- **P4** — Remaining Quest catalog manifests / operator-action mappings ✅
- **P5** — Structural smoke coverage for the full GSD port ✅
- **P6** — Operator docs and command mapping ☐
- **P7** — Catalog close-out and attribution/license check ☐
- **P8** — Close-out gate ☐
