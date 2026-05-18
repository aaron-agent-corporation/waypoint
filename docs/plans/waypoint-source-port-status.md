# GSD Port Status

Tracks the progress of porting get-shit-done-cc agents and
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

33 agents total. Each becomes one Recipe. Slugs keep the `waypoint-` prefix
to namespace the library and avoid collisions with non-GSD recipes.
Files live under `recipes/waypoint/` (recursive loader handles subfolders).

| Upstream file                         | Recipe slug              | Status |
|---------------------------------------|--------------------------|--------|
| agents/waypoint-advisor-researcher.md      | waypoint-advisor-researcher   | ✅     |
| agents/waypoint-ai-researcher.md           | waypoint-ai-researcher        | ✅     |
| agents/waypoint-assumptions-analyzer.md    | waypoint-assumptions-analyzer | ✅     |
| agents/waypoint-code-fixer.md              | waypoint-code-fixer           | ✅      |
| agents/waypoint-code-reviewer.md           | waypoint-code-reviewer        | ✅      |
| agents/waypoint-codebase-mapper.md         | waypoint-codebase-mapper      | ✅      |
| agents/waypoint-debug-session-manager.md   | waypoint-debug-session-manager| ✅      |
| agents/waypoint-debugger.md                | waypoint-debugger             | ✅      |
| agents/waypoint-doc-classifier.md          | waypoint-doc-classifier       | ✅      |
| agents/waypoint-doc-synthesizer.md         | waypoint-doc-synthesizer      | ✅      |
| agents/waypoint-doc-verifier.md            | waypoint-doc-verifier         | ✅      |
| agents/waypoint-doc-writer.md              | waypoint-doc-writer           | ✅     |
| agents/waypoint-domain-researcher.md       | waypoint-domain-researcher    | ✅     |
| agents/waypoint-eval-auditor.md            | waypoint-eval-auditor         | ✅      |
| agents/waypoint-eval-planner.md            | waypoint-eval-planner         | ✅      |
| agents/waypoint-executor.md                | waypoint-executor             | ✅      |
| agents/waypoint-framework-selector.md      | waypoint-framework-selector   | ✅      |
| agents/waypoint-integration-checker.md     | waypoint-integration-checker  | ✅      |
| agents/waypoint-intel-updater.md           | waypoint-intel-updater        | ✅      |
| agents/waypoint-nyquist-auditor.md         | waypoint-nyquist-auditor      | ✅      |
| agents/waypoint-pattern-mapper.md          | waypoint-pattern-mapper       | ✅      |
| agents/waypoint-phase-researcher.md        | waypoint-phase-researcher     | ✅      |
| agents/waypoint-plan-checker.md            | waypoint-plan-checker         | ✅      |
| agents/waypoint-planner.md                 | waypoint-planner              | ✅      |
| agents/waypoint-project-researcher.md      | waypoint-project-researcher   | ✅      |
| agents/waypoint-research-synthesizer.md    | waypoint-research-synthesizer | ✅      |
| agents/waypoint-roadmapper.md              | waypoint-roadmapper           | ✅      |
| agents/waypoint-security-auditor.md        | waypoint-security-auditor     | ✅      |
| agents/waypoint-ui-auditor.md              | waypoint-ui-auditor           | ✅      |
| agents/waypoint-ui-checker.md              | waypoint-ui-checker           | ✅      |
| agents/waypoint-ui-researcher.md           | waypoint-ui-researcher        | ✅      |
| agents/waypoint-user-profiler.md           | waypoint-user-profiler        | ✅      |
| agents/waypoint-verifier.md                | waypoint-verifier             | ✅      |

Progress: **33 / 33** ported (100%).

## Commands → Quests / sub-Quests / operator actions

65 commands total. Per the port plan, commands fall into categories:

- **Phase entrypoints** (part of the main Waypoint Quest, one node per)
- **Sub-Quests** (reusable workflows callable from within or outside
  the main Quest, e.g. `/waypoint-debug`, `/waypoint-forensics`)
- **Operator actions** (exposed through Waypoint's existing command
  surface, e.g. `/waypoint pause` already covers `/waypoint-pause-work`)
- **Utility Quests** (standalone, e.g. `/waypoint-health`)
- **Won't port** (e.g. GSD-CLI-specific like `/waypoint-config`,
  `/waypoint-settings`, `/waypoint-workspace`)

Full inventory lives in `docs/plans/waypoint-waypoint-quest-port.md`.
This table tracks only the ported artifacts.

| Upstream command | Category | Target artifact | Status |
|---|---|---|---|
| new-project.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
| discuss-phase.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
| plan-phase.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
| execute-phase.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
| verify-work.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
| ship.md | phase entrypoint | quests/waypoint.yaml metadata | ✅ |
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

## Main Waypoint Quest

`quests/waypoint.yaml` — **status: ✅ ported, manifest exists and resolves its recipe references**.

The main Quest composes the phase-entrypoint recipes into the full
initialize → discuss → plan → execute → verify → ship loop. Runtime-specific
command and sub-Quest mappings that are not first-class Quest schema yet live
under `metadata.source_port` in the manifest.

## P6 operator documentation

P6 added (implementation commit `4be4ef1`):

- `docs/quests/waypoint.md` — operator guide for the Waypoint Quest.
- `docs/quests/waypoint-command-map.md` — human-readable command map generated from `docs/quests/waypoint-command-map.yaml`.
- README links to the Waypoint Quest operator docs and command maps.
- `src/__tests__/waypoint-docs.test.ts` — docs smoke coverage for the guide, links, and all 65 command mappings.

## P7 catalog close-out and attribution/license check

P7 added (implementation commit `4f83277`):

- `docs/waypoint-quest-catalog.md` — loader-backed catalog of all current Quest and Recipe manifests.
- README link to the Quest/Recipe catalog.
- Extended `src/__tests__/waypoint-docs.test.ts` to assert catalog counts against the real recursive loaders and to require the preserved GSD license/notice references.
- Re-read upstream `/Users/aaronwhaley/Downloads/get-shit-done-main/LICENSE` during P7. It is MIT licensed with `Copyright (c) 2025 Lex Christopherson`; attribution is preserved under `third_party/gsd/LICENSE` and `third_party/gsd/NOTICE.md`.


## P8 close-out gate

P8 records the final close-out state for the Track 4 Waypoint Quest/Recipe port.

- Actual Quest count: 39
- Actual Recipe count: 98
- Waypoint source-derived Recipe count: 33
- Source command mappings documented: 65
- Verification commands to run for close-out:
  - `pnpm test`
  - `pnpm typecheck`
- Latest verified pre-P8 commit: `790ccb5` (`docs(waypoint-port): record P7 catalog close-out`)
- P8 close-out implementation commit: `7d76a47` (`docs(waypoint-port): add P8 close-out gate`)

Explicit deferred work:

- folder-host runtime execution remains out of scope for Track 4 and belongs to the folder-host track.
- live Recipe execution remains out of scope for Track 4 and belongs to a future host/runtime integration track.
- first-class sub-Quest composition fields remain deferred; current command/sub-Quest mapping intent is stored under manifest metadata and docs.
- namespace commands (`ns-*`) remain deferred optional catalog work.

## Execution order

Per the accepted recovery plan in `WAYPOINT_RESUME_PLAN.md` (which supersedes the fabricated P2–P8 narrative):

- **P0** — attribution + scaffolding + first worked Recipe port ✅
- **P1** — Recipe port sweep (33 total Waypoint Recipes) ✅
- **P2** — Main Quest manifest (`quests/waypoint.yaml`) ✅
- **P3** — Command-informed first-batch sub-Quests ✅
- **P4** — Remaining Quest catalog manifests / operator-action mappings ✅
- **P5** — Structural smoke coverage for the full Waypoint source port ✅
- **P6** — Operator docs and command mapping ✅
- **P7** — Catalog close-out and attribution/license check ✅
- **P8** — Close-out gate ✅


## FirmVault folder-host source-port continuation

The original Waypoint source-port close-out remains recorded above. FirmVault folder-host work is continuing as a standalone runtime integration track.

Latest FirmVault slice: Document-pipeline review tasks wave. This slice adds source-backed document-pipeline review Recipe manifests and a FirmVault Quest rail for recording source PDFs, pipeline submission state, Forgejo PR review, and merge/defer/failure handoff metadata while preserving legal-landmark separation:

- FirmVault installed Recipe count: 56
- FirmVault scaffold plan/task count: 92
- FirmVault deterministic landmark count: 82
- Total bundled Recipe count after this slice: 91

Source systems used for this slice:

- `/Users/aaronwhaley/Github/firmvault-document-pipeline/pipeline/run_pr_ingest.py`
- `/Users/aaronwhaley/Github/firmvault-document-pipeline/forgejo/pr_body.py`
- `/Users/aaronwhaley/Github/firmvault-document-pipeline/webhook/handler.py`

Deferred FirmVault scope after this slice: post-close reporting, optional litigation branch workflows, and automated webhook/polling sync from Forgejo PR state into Waypoint handoff metadata.
