# Waypoint Quest Catalog

This catalog is generated from the Quest and Recipe manifests currently present on disk. It describes the bundled Waypoint Quest/Recipe library; it is not a claim that a standalone CLI or live recipe executor exists in this repo.

## Loader-backed counts

- Total Quests loaded from disk: 37
- Total Recipes loaded from disk: 35
- GSD-derived Recipes: 33
- GSD command mappings documented: 65

Counts above are based on manifest files under `quests/` and `recipes/` and are covered by `src/__tests__/gsd-docs.test.ts`.

## Attribution and license

Waypoint itself is MIT-licensed under `LICENSE` (Copyright (c) 2026 Aaron Whaley).

The bundled GSD-derived Quest/Recipe artifacts are adaptations of the get-shit-done-cc project by Lex Christopherson:

- Upstream local snapshot checked for P7: `/Users/aaronwhaley/Downloads/get-shit-done-main/`
- Upstream license read for P7: `MIT License`
- Upstream copyright read for P7: `Copyright (c) 2025 Lex Christopherson`
- Preserved repo attribution: `third_party/gsd/LICENSE`
- Preserved repo notice: `third_party/gsd/NOTICE.md`

When redistributing Waypoint with the GSD-derived Quest/Recipe library, preserve `third_party/gsd/LICENSE` and `third_party/gsd/NOTICE.md`.

## Quests

### Main Quest

- `gsd` — GSD Quest
  - Path: `quests/gsd.yaml`
  - Description: Waypoint Quest port of the get-shit-done-cc project flow. It models the initialize → discuss → plan → execute → verify → ship journey as a reusable Quest while preserving source command intent in metadata for later runtime and catalog phases.
  - Recipes: `gsd-doc-writer`, `gsd-project-researcher`, `gsd-roadmapper`, `gsd-assumptions-analyzer`, `gsd-codebase-mapper`, `gsd-phase-researcher`, `gsd-planner`, `gsd-plan-checker`, `gsd-executor`, `gsd-verifier`, `gsd-doc-synthesizer`, `gsd-code-reviewer`
  - GSD port scope: `main_quest_manifest`

### GSD-derived catalog Quests

- `add-tests` — Add Tests Quest
  - Path: `quests/add-tests.yaml`
  - Description: Waypoint catalog Quest port of gsd:add-tests for generate tests for a completed phase from UAT criteria and implementation evidence.
  - Recipes: `gsd-verifier`, `gsd-executor`
  - GSD port scope: `command_informed_sub_quest`
- `ai-integration-phase` — AI Integration Phase Quest
  - Path: `quests/ai-integration-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ai-integration-phase for generating AI-SPEC contracts for AI-system phases.
  - Recipes: `gsd-framework-selector`, `gsd-ai-researcher`, `gsd-domain-researcher`, `gsd-eval-planner`
  - GSD port scope: `command_informed_sub_quest`
- `audit-fix` — Audit Fix Quest
  - Path: `quests/audit-fix.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-fix for autonomous audit-to-fix pipeline that classifies findings, fixes auto-fixable issues, and verifies results.
  - Recipes: `gsd-code-reviewer`, `gsd-code-fixer`, `gsd-verifier`
  - GSD port scope: `command_informed_sub_quest`
- `audit-milestone` — Audit Milestone Quest
  - Path: `quests/audit-milestone.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-milestone for milestone completion audit that checks delivered work against original intent before archiving.
  - Recipes: `gsd-verifier`, `gsd-integration-checker`, `gsd-assumptions-analyzer`
  - GSD port scope: `command_informed_sub_quest`
- `audit-uat` — Audit UAT Quest
  - Path: `quests/audit-uat.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-uat for cross-phase audit of outstanding UAT and verification items.
  - Recipes: `gsd-verifier`
  - GSD port scope: `command_informed_sub_quest`
- `cleanup` — Cleanup Quest
  - Path: `quests/cleanup.yaml`
  - Description: Waypoint catalog Quest port of gsd:cleanup for archive accumulated phase directories from completed milestones.
  - Recipes: `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `code-review` — Code Review Quest
  - Path: `quests/code-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:code-review for source review loop for changed files with optional fix iteration.
  - Recipes: `gsd-code-reviewer`, `gsd-code-fixer`
  - GSD port scope: `command_informed_sub_quest`
- `complete-milestone` — Complete Milestone Quest
  - Path: `quests/complete-milestone.yaml`
  - Description: Waypoint catalog Quest port of gsd:complete-milestone for archive a completed milestone and prepare the project for the next version.
  - Recipes: `gsd-roadmapper`, `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `debug` — Debug Quest
  - Path: `quests/debug.yaml`
  - Description: Waypoint sub-Quest port of gsd:debug for systematic debugging with checkpointable investigation and continuation loops.
  - Recipes: `gsd-debug-session-manager`, `gsd-debugger`
  - GSD port scope: `command_informed_sub_quest`
- `docs-update` — Docs Update Quest
  - Path: `quests/docs-update.yaml`
  - Description: Waypoint catalog Quest port of gsd:docs-update for generate or verify project documentation against the codebase.
  - Recipes: `gsd-doc-writer`, `gsd-doc-verifier`
  - GSD port scope: `command_informed_sub_quest`
- `eval-review` — Evaluation Review Quest
  - Path: `quests/eval-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:eval-review for audit AI/evaluation coverage for a completed AI phase.
  - Recipes: `gsd-eval-auditor`, `gsd-eval-planner`
  - GSD port scope: `command_informed_sub_quest`
- `explore` — Explore Quest
  - Path: `quests/explore.yaml`
  - Description: Waypoint catalog Quest port of gsd:explore for socratic ideation and idea-routing session before committing to a plan.
  - Recipes: `gsd-advisor-researcher`, `gsd-domain-researcher`
  - GSD port scope: `command_informed_sub_quest`
- `extract-learnings` — Extract Learnings Quest
  - Path: `quests/extract-learnings.yaml`
  - Description: Waypoint catalog Quest port of gsd:extract-learnings for extract decisions, lessons, patterns, and surprises from completed phase artifacts.
  - Recipes: `gsd-doc-synthesizer`, `gsd-pattern-mapper`
  - GSD port scope: `command_informed_sub_quest`
- `fast` — Fast Quest
  - Path: `quests/fast.yaml`
  - Description: Waypoint catalog Quest port of gsd:fast for trivial task execution path with minimal planning overhead.
  - Recipes: `gsd-executor`
  - GSD port scope: `command_informed_sub_quest`
- `forensics` — Forensics Quest
  - Path: `quests/forensics.yaml`
  - Description: Waypoint catalog Quest port of gsd:forensics for post-mortem investigation for failed or stuck workflows.
  - Recipes: `gsd-debugger`, `gsd-codebase-mapper`
  - GSD port scope: `command_informed_sub_quest`
- `graphify` — Graphify Quest
  - Path: `quests/graphify.yaml`
  - Description: Waypoint catalog Quest port of gsd:graphify for knowledge graph build and inspection flow for project planning context.
  - Recipes: `gsd-pattern-mapper`
  - GSD port scope: `command_informed_sub_quest`
- `health` — Health Quest
  - Path: `quests/health.yaml`
  - Description: Waypoint catalog Quest port of gsd:health for planning-directory and workflow health diagnostic.
  - Recipes: `gsd-verifier`
  - GSD port scope: `command_informed_sub_quest`
- `ingest-docs` — Ingest Docs Quest
  - Path: `quests/ingest-docs.yaml`
  - Description: Waypoint catalog Quest port of gsd:ingest-docs for bootstrap or merge planning setup from existing ADRs, PRDs, specs, and docs.
  - Recipes: `gsd-doc-classifier`, `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `map-codebase` — Map Codebase Quest
  - Path: `quests/map-codebase.yaml`
  - Description: Waypoint catalog Quest port of gsd:map-codebase for parallel codebase analysis producing structured codebase intelligence.
  - Recipes: `gsd-codebase-mapper`
  - GSD port scope: `command_informed_sub_quest`
- `milestone-summary` — Milestone Summary Quest
  - Path: `quests/milestone-summary.yaml`
  - Description: Waypoint catalog Quest port of gsd:milestone-summary for generate a comprehensive completed-milestone summary for onboarding and review.
  - Recipes: `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `plan-review-convergence` — Plan Review Convergence Quest
  - Path: `quests/plan-review-convergence.yaml`
  - Description: Waypoint catalog Quest port of gsd:plan-review-convergence for iterative plan-review convergence loop until high concerns are resolved.
  - Recipes: `gsd-planner`, `gsd-plan-checker`
  - GSD port scope: `command_informed_sub_quest`
- `pr-branch` — PR Branch Quest
  - Path: `quests/pr-branch.yaml`
  - Description: Waypoint catalog Quest port of gsd:pr-branch for create a clean review branch that filters planning-only commits out of the PR diff.
  - Recipes: `gsd-executor`
  - GSD port scope: `command_informed_sub_quest`
- `profile-user` — Profile User Quest
  - Path: `quests/profile-user.yaml`
  - Description: Waypoint catalog Quest port of gsd:profile-user for generate developer behavior and preference profile artifacts with consent gates.
  - Recipes: `gsd-user-profiler`
  - GSD port scope: `command_informed_sub_quest`
- `quick` — Quick Quest
  - Path: `quests/quick.yaml`
  - Description: Waypoint catalog Quest port of gsd:quick for short-path task execution with optional discussion, research, and validation.
  - Recipes: `gsd-planner`, `gsd-executor`, `gsd-verifier`
  - GSD port scope: `command_informed_sub_quest`
- `review` — External Review Quest
  - Path: `quests/review.yaml`
  - Description: Waypoint catalog Quest port of gsd:review for cross-AI peer review of phase plans.
  - Recipes: `gsd-plan-checker`
  - GSD port scope: `command_informed_sub_quest`
- `review-backlog` — Review Backlog Quest
  - Path: `quests/review-backlog.yaml`
  - Description: Waypoint catalog Quest port of gsd:review-backlog for review and promote backlog items into active planning.
  - Recipes: `gsd-roadmapper`, `gsd-planner`
  - GSD port scope: `command_informed_sub_quest`
- `secure-phase` — Secure Phase Quest
  - Path: `quests/secure-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:secure-phase for retroactively verifying threat mitigations for completed work.
  - Recipes: `gsd-security-auditor`, `gsd-verifier`, `gsd-code-fixer`
  - GSD port scope: `command_informed_sub_quest`
- `sketch` — Sketch Quest
  - Path: `quests/sketch.yaml`
  - Description: Waypoint catalog Quest port of gsd:sketch for explore UI/design directions through throwaway mockups before implementation.
  - Recipes: `gsd-ui-researcher`, `gsd-ui-auditor`
  - GSD port scope: `command_informed_sub_quest`
- `spec-phase` — Spec Phase Quest
  - Path: `quests/spec-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:spec-phase for clarifying what a phase delivers before planning how to build it.
  - Recipes: `gsd-assumptions-analyzer`, `gsd-codebase-mapper`, `gsd-doc-writer`, `gsd-plan-checker`
  - GSD port scope: `command_informed_sub_quest`
- `spike` — Spike Quest
  - Path: `quests/spike.yaml`
  - Description: Waypoint sub-Quest port of gsd:spike for focused experiential exploration before committing to a build path.
  - Recipes: `gsd-project-researcher`, `gsd-domain-researcher`, `gsd-assumptions-analyzer`, `gsd-executor`, `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `stats` — Stats Quest
  - Path: `quests/stats.yaml`
  - Description: Waypoint catalog Quest port of gsd:stats for project statistics report for phases, plans, requirements, git metrics, and timeline.
  - Recipes: `gsd-doc-synthesizer`
  - GSD port scope: `command_informed_sub_quest`
- `ui-phase` — UI Phase Quest
  - Path: `quests/ui-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ui-phase for generating UI-SPEC design contracts for frontend phases.
  - Recipes: `gsd-ui-researcher`, `gsd-ui-checker`, `gsd-ui-auditor`, `gsd-doc-writer`
  - GSD port scope: `command_informed_sub_quest`
- `ui-review` — UI Review Quest
  - Path: `quests/ui-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:ui-review for retroactive UI and visual quality audit.
  - Recipes: `gsd-ui-auditor`, `gsd-ui-checker`
  - GSD port scope: `command_informed_sub_quest`
- `ultraplan-phase` — Ultraplan Phase Quest
  - Path: `quests/ultraplan-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ultraplan-phase for offloading planning to a remote cloud planning session and importing the result.
  - Recipes: `gsd-phase-researcher`, `gsd-planner`, `gsd-plan-checker`
  - GSD port scope: `command_informed_sub_quest`
- `validate-phase` — Validate Phase Quest
  - Path: `quests/validate-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:validate-phase for auditing and filling Nyquist validation gaps after execution.
  - Recipes: `gsd-nyquist-auditor`, `gsd-verifier`, `gsd-code-fixer`, `gsd-eval-auditor`
  - GSD port scope: `command_informed_sub_quest`

### Examples

- `example` — Example Quest
  - Path: `quests/example.yaml`
  - Description: A trivial Quest demonstrating the manifest shape. It names a workflow YAML file, references two recipes, and declares a one-workstream scaffold.
  - Recipes: `doc-writer`, `reviewer`

## Recipes

### GSD-derived Recipes

- `gsd-advisor-researcher` — Advisor Researcher (GSD)
  - Path: `recipes/gsd/advisor-researcher.yaml`
  - Description: Researches a single gray area decision and returns a structured comparison table with rationale. Spawned by discuss-phase advisor mode.
  - Source: `agents/gsd-advisor-researcher.md` (MIT)
- `gsd-ai-researcher` — Ai Researcher (GSD)
  - Path: `recipes/gsd/ai-researcher.yaml`
  - Description: Researches a chosen AI framework's official docs to produce implementation-ready guidance — best practices, syntax, core patterns, and pitfalls distilled for the specific use case. Writes the Framework Quick Reference and Implementation Guidance sections of AI-SPEC.md. Spawned by /gsd-ai-integration-phase orchestrator.
  - Source: `agents/gsd-ai-researcher.md` (MIT)
- `gsd-assumptions-analyzer` — Assumptions Analyzer (GSD)
  - Path: `recipes/gsd/assumptions-analyzer.yaml`
  - Description: Deeply analyzes codebase for a phase and returns structured assumptions with evidence. Spawned by discuss-phase assumptions mode.
  - Source: `agents/gsd-assumptions-analyzer.md` (MIT)
- `gsd-code-fixer` — Code Fixer (GSD)
  - Path: `recipes/gsd/code-fixer.yaml`
  - Description: Applies fixes to code review findings from REVIEW.md. Reads source files, applies intelligent fixes, and commits each fix atomically. Spawned by /gsd-code-review --fix.
- `gsd-code-reviewer` — Code Reviewer (GSD)
  - Path: `recipes/gsd/code-reviewer.yaml`
  - Description: Reviews source files for bugs, security issues, and code quality problems. Produces structured REVIEW.md with severity-classified findings. Spawned by /gsd-code-review.
- `gsd-codebase-mapper` — Codebase Mapper (GSD)
  - Path: `recipes/gsd/codebase-mapper.yaml`
  - Description: Explores codebase and writes structured analysis documents. Spawned by map-codebase with a focus area (tech, arch, quality, concerns). Writes documents directly to reduce orchestrator context load.
- `gsd-debug-session-manager` — Debug Session Manager (GSD)
  - Path: `recipes/gsd/debug-session-manager.yaml`
  - Description: Manages multi-cycle /gsd-debug checkpoint and continuation loop in isolated context. Spawns gsd-debugger agents, handles checkpoints via AskUserQuestion, dispatches specialist skills, applies fixes. Returns compact summary to main context. Spawned by /gsd-debug command.
- `gsd-debugger` — Debugger (GSD)
  - Path: `recipes/gsd/debugger.yaml`
  - Description: Investigates bugs using scientific method, manages debug sessions, handles checkpoints. Spawned by /gsd-debug orchestrator.
- `gsd-doc-classifier` — Doc Classifier (GSD)
  - Path: `recipes/gsd/doc-classifier.yaml`
  - Description: Classifies a single planning document as ADR, PRD, SPEC, DOC, or UNKNOWN. Extracts title, scope summary, and cross-references. Spawned in parallel by /gsd-ingest-docs. Writes a JSON classification file and returns a one-line confirmation.
- `gsd-doc-synthesizer` — Doc Synthesizer (GSD)
  - Path: `recipes/gsd/doc-synthesizer.yaml`
  - Description: Synthesizes classified planning docs into a single consolidated context. Applies precedence rules, detects cross-ref cycles, enforces LOCKED-vs-LOCKED hard-blocks, and writes INGEST-CONFLICTS.md with three buckets (auto-resolved, competing-variants, unresolved-blockers). Spawned by /gsd-ingest-docs.
- `gsd-doc-verifier` — Doc Verifier (GSD)
  - Path: `recipes/gsd/doc-verifier.yaml`
  - Description: Verifies factual claims in generated docs against the live codebase. Returns structured JSON per doc.
- `gsd-doc-writer` — Doc Writer (GSD)
  - Path: `recipes/gsd/doc-writer.yaml`
  - Description: Writes and updates project documentation files. Spawned with a doc_assignment block specifying doc type, mode (create / update / supplement / fix), and project context. Ported from the GSD gsd-doc-writer agent.
  - Source: `agents/gsd-doc-writer.md` (MIT)
- `gsd-domain-researcher` — Domain Researcher (GSD)
  - Path: `recipes/gsd/domain-researcher.yaml`
  - Description: Researches the business domain and real-world application context of the AI system being built. Surfaces domain expert evaluation criteria, industry-specific failure modes, regulatory context, and what "good" looks like for practitioners in this field — before the eval-planner turns it into measurable rubrics. Spawned by /gsd-ai-integration-phase orchestrator.
  - Source: `agents/gsd-domain-researcher.md` (MIT)
- `gsd-eval-auditor` — Eval Auditor (GSD)
  - Path: `recipes/gsd/eval-auditor.yaml`
  - Description: Retroactive audit of an implemented AI phase's evaluation coverage. Checks implementation against the AI-SPEC.md evaluation plan. Scores each eval dimension as COVERED/PARTIAL/MISSING. Produces a scored EVAL-REVIEW.md with findings, gaps, and remediation guidance. Spawned by /gsd-eval-review orchestrator.
- `gsd-eval-planner` — Eval Planner (GSD)
  - Path: `recipes/gsd/eval-planner.yaml`
  - Description: Designs a structured evaluation strategy for an AI phase. Identifies critical failure modes, selects eval dimensions with rubrics, recommends tooling, and specifies the reference dataset. Writes the Evaluation Strategy, Guardrails, and Production Monitoring sections of AI-SPEC.md. Spawned by /gsd-ai-integration-phase orchestrator.
- `gsd-executor` — Executor (GSD)
  - Path: `recipes/gsd/executor.yaml`
  - Description: Executes GSD plans with atomic commits, deviation handling, checkpoint protocols, and state management. Spawned by execute-phase orchestrator or execute-plan command.
- `gsd-framework-selector` — Framework Selector (GSD)
  - Path: `recipes/gsd/framework-selector.yaml`
  - Description: Presents an interactive decision matrix to surface the right AI/LLM framework for the user's specific use case. Produces a scored recommendation with rationale. Spawned by /gsd-ai-integration-phase and /gsd-select-framework orchestrators.
- `gsd-integration-checker` — Integration Checker (GSD)
  - Path: `recipes/gsd/integration-checker.yaml`
  - Description: Verifies cross-phase integration and E2E flows. Checks that phases connect properly and user workflows complete end-to-end.
- `gsd-intel-updater` — Intel Updater (GSD)
  - Path: `recipes/gsd/intel-updater.yaml`
  - Description: Analyzes codebase and writes structured intel files to .planning/intel/.
- `gsd-nyquist-auditor` — Nyquist Auditor (GSD)
  - Path: `recipes/gsd/nyquist-auditor.yaml`
  - Description: Fills Nyquist validation gaps by generating tests and verifying coverage for phase requirements
- `gsd-pattern-mapper` — Pattern Mapper (GSD)
  - Path: `recipes/gsd/pattern-mapper.yaml`
  - Description: Analyzes codebase for existing patterns and produces PATTERNS.md mapping new files to closest analogs. Read-only codebase analysis spawned by /gsd-plan-phase orchestrator before planning.
- `gsd-phase-researcher` — Phase Researcher (GSD)
  - Path: `recipes/gsd/phase-researcher.yaml`
  - Description: Researches how to implement a phase before planning. Produces RESEARCH.md consumed by gsd-planner. Spawned by /gsd-plan-phase orchestrator.
- `gsd-plan-checker` — Plan Checker (GSD)
  - Path: `recipes/gsd/plan-checker.yaml`
  - Description: Verifies plans will achieve phase goal before execution. Goal-backward analysis of plan quality. Spawned by /gsd-plan-phase orchestrator.
- `gsd-planner` — Planner (GSD)
  - Path: `recipes/gsd/planner.yaml`
  - Description: Creates executable phase plans with task breakdown, dependency analysis, and goal-backward verification. Spawned by /gsd-plan-phase orchestrator.
- `gsd-project-researcher` — Project Researcher (GSD)
  - Path: `recipes/gsd/project-researcher.yaml`
  - Description: Researches domain ecosystem before roadmap creation. Produces files in .planning/research/ consumed during roadmap creation. Spawned by /gsd-new-project or /gsd-new-milestone orchestrators.
- `gsd-research-synthesizer` — Research Synthesizer (GSD)
  - Path: `recipes/gsd/research-synthesizer.yaml`
  - Description: Synthesizes research outputs from parallel researcher agents into SUMMARY.md. Spawned by /gsd-new-project after 4 researcher agents complete.
- `gsd-roadmapper` — Roadmapper (GSD)
  - Path: `recipes/gsd/roadmapper.yaml`
  - Description: Creates project roadmaps with phase breakdown, requirement mapping, success criteria derivation, and coverage validation. Spawned by /gsd-new-project orchestrator.
- `gsd-security-auditor` — Security Auditor (GSD)
  - Path: `recipes/gsd/security-auditor.yaml`
  - Description: Verifies threat mitigations from PLAN.md threat model exist in implemented code. Produces SECURITY.md. Spawned by /gsd-secure-phase.
- `gsd-ui-auditor` — Ui Auditor (GSD)
  - Path: `recipes/gsd/ui-auditor.yaml`
  - Description: Retroactive 6-pillar visual audit of implemented frontend code. Produces scored UI-REVIEW.md. Spawned by /gsd-ui-review orchestrator.
- `gsd-ui-checker` — Ui Checker (GSD)
  - Path: `recipes/gsd/ui-checker.yaml`
  - Description: Validates UI-SPEC.md design contracts against 6 quality dimensions. Produces BLOCK/FLAG/PASS verdicts. Spawned by /gsd-ui-phase orchestrator.
- `gsd-ui-researcher` — Ui Researcher (GSD)
  - Path: `recipes/gsd/ui-researcher.yaml`
  - Description: Produces UI-SPEC.md design contract for frontend phases. Reads upstream artifacts, detects design system state, asks only unanswered questions. Spawned by /gsd-ui-phase orchestrator.
- `gsd-user-profiler` — User Profiler (GSD)
  - Path: `recipes/gsd/user-profiler.yaml`
  - Description: Analyzes extracted session messages across 8 behavioral dimensions to produce a scored developer profile with confidence levels and evidence. Spawned by profile orchestration workflows.
- `gsd-verifier` — Verifier (GSD)
  - Path: `recipes/gsd/verifier.yaml`
  - Description: Verifies phase goal achievement through goal-backward analysis. Checks codebase delivers what phase promised, not just that tasks completed. Creates VERIFICATION.md report.

### Non-GSD example Recipes

- `doc-writer` — Doc Writer
  - Path: `recipes/doc-writer.yaml`
  - Description: Produces clear, well-organized documentation from a set of source notes or an outline. Favors concrete examples over abstractions.
  - Tools: `read_file`, `write_file`, `search_files`
- `reviewer` — Reviewer
  - Path: `recipes/reviewer.yaml`
  - Description: Reviews completed work for correctness, completeness, and adherence to stated acceptance criteria. Produces a pass/fail verdict with specific issues to address when failing.
  - Tools: `read_file`, `search_files`

## Deferred / not implemented in this repo

- No standalone GSD CLI is implemented here.
- No first-class sub-Quest schema field exists yet; command mapping intent lives in metadata/docs.
- No built-in recipe executor is shipped in the standalone core package yet; hosts provide `IRecipeRuntime`.
- Namespace commands from the upstream GSD CLI (`ns-*`) remain deferred optional mappings, documented in `docs/quests/gsd-command-map.md`.
