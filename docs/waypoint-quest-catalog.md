# Waypoint Quest Catalog

This catalog is generated from the Quest and Recipe manifests currently present on disk. It describes the bundled Waypoint Quest/Recipe library; Waypoint is the system name, while `firmvault` and `waypoint` are primary starter Quests a user can choose when setting up a folder.

## Loader-backed counts

- Total Quests loaded from disk: 40
- Total Recipes loaded from disk: 108
- Waypoint source-derived Recipes: 33
- Source command mappings documented: 65

Counts above are based on manifest files under `quests/` and `recipes/` and are covered by `src/__tests__/waypoint-docs.test.ts`.

## Primary starter Quest additions

- `agile-delivery` — Agile Delivery, a structured agile software delivery Quest adapted from BMad Method source concepts.
  - First-wave Recipes: `agile-delivery-prd`, `agile-delivery-architecture`, `agile-delivery-epics-stories`, `agile-delivery-readiness`, `agile-delivery-sprint-planning`, `agile-delivery-create-story`, `agile-delivery-dev-story`.
  - Source attribution: BMad Method / `bmad-method@6.7.0`; BMAD/BMad/BMad Method are trademarks of BMad Code, LLC and are used here only for attribution/provenance.
- `product-sprint` — Product Sprint, a gstack-derived product/software sprint Quest for founder-led product work.
  - First-wave Recipes: `product-sprint-office-hours`, `product-sprint-ceo-review`, `product-sprint-eng-review`, `product-sprint-design-review`, `product-sprint-devex-review`, `product-sprint-autoplan`, `product-sprint-review`, `product-sprint-qa-only`, `product-sprint-ship`, `product-sprint-retro`.
  - Source attribution: gstack / `gstack@1.40.0.0`; gstack methodology is used here only as source attribution/provenance and host-specific side effects remain gated or deferred.

## Attribution and license

Waypoint itself is MIT-licensed under `LICENSE` (Copyright (c) 2026 Aaron Whaley).

The bundled Waypoint source-derived Quest/Recipe artifacts are adaptations of the get-shit-done-cc project by Lex Christopherson:

- Upstream local snapshot checked for P7: `/Users/aaronwhaley/Downloads/get-shit-done-main/`
- Upstream license read for P7: `MIT License`
- Upstream copyright read for P7: `Copyright (c) 2025 Lex Christopherson`
- Preserved repo attribution: `third_party/gsd/LICENSE`
- Preserved repo notice: `third_party/gsd/NOTICE.md`

When redistributing Waypoint with the Waypoint source-derived Quest/Recipe library, preserve `third_party/gsd/LICENSE` and `third_party/gsd/NOTICE.md`.

## Quests

- `add-tests` — Add Tests Quest
  - Path: `quests/add-tests.yaml`
  - Description: Waypoint catalog Quest port of gsd:add-tests for generate tests for a completed phase from UAT criteria and implementation evidence.

  - Recipes: `waypoint-verifier`, `waypoint-executor`
- `ai-integration-phase` — AI Integration Phase Quest
  - Path: `quests/ai-integration-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ai-integration-phase for generating AI-SPEC contracts for AI-system phases.

  - Recipes: `waypoint-framework-selector`, `waypoint-ai-researcher`, `waypoint-domain-researcher`, `waypoint-eval-planner`
- `audit-fix` — Audit Fix Quest
  - Path: `quests/audit-fix.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-fix for autonomous audit-to-fix pipeline that classifies findings, fixes auto-fixable issues, and verifies results.

  - Recipes: `waypoint-code-reviewer`, `waypoint-code-fixer`, `waypoint-verifier`
- `audit-milestone` — Audit Milestone Quest
  - Path: `quests/audit-milestone.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-milestone for milestone completion audit that checks delivered work against original intent before archiving.

  - Recipes: `waypoint-verifier`, `waypoint-integration-checker`, `waypoint-assumptions-analyzer`
- `audit-uat` — Audit UAT Quest
  - Path: `quests/audit-uat.yaml`
  - Description: Waypoint catalog Quest port of gsd:audit-uat for cross-phase audit of outstanding UAT and verification items.

  - Recipes: `waypoint-verifier`
- `cleanup` — Cleanup Quest
  - Path: `quests/cleanup.yaml`
  - Description: Waypoint catalog Quest port of gsd:cleanup for archive accumulated phase directories from completed milestones.

  - Recipes: `waypoint-doc-synthesizer`
- `code-review` — Code Review Quest
  - Path: `quests/code-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:code-review for source review loop for changed files with optional fix iteration.

  - Recipes: `waypoint-code-reviewer`, `waypoint-code-fixer`
- `complete-milestone` — Complete Milestone Quest
  - Path: `quests/complete-milestone.yaml`
  - Description: Waypoint catalog Quest port of gsd:complete-milestone for archive a completed milestone and prepare the project for the next version.

  - Recipes: `waypoint-roadmapper`, `waypoint-doc-synthesizer`
- `debug` — Debug Quest
  - Path: `quests/debug.yaml`
  - Description: Waypoint sub-Quest port of gsd:debug for systematic debugging with checkpointable investigation and continuation loops.

  - Recipes: `waypoint-debug-session-manager`, `waypoint-debugger`
- `docs-update` — Docs Update Quest
  - Path: `quests/docs-update.yaml`
  - Description: Waypoint catalog Quest port of gsd:docs-update for generate or verify project documentation against the codebase.

  - Recipes: `waypoint-doc-writer`, `waypoint-doc-verifier`
- `eval-review` — Evaluation Review Quest
  - Path: `quests/eval-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:eval-review for audit AI/evaluation coverage for a completed AI phase.

  - Recipes: `waypoint-eval-auditor`, `waypoint-eval-planner`
- `example` — Example Quest
  - Path: `quests/example.yaml`
  - Description: A trivial Quest demonstrating the manifest shape. It names a workflow YAML file, references two recipes, and declares a one-workstream scaffold.

  - Recipes: `doc-writer`, `reviewer`
- `explore` — Explore Quest
  - Path: `quests/explore.yaml`
  - Description: Waypoint catalog Quest port of gsd:explore for socratic ideation and idea-routing session before committing to a plan.

  - Recipes: `waypoint-advisor-researcher`, `waypoint-domain-researcher`
- `extract-learnings` — Extract Learnings Quest
  - Path: `quests/extract-learnings.yaml`
  - Description: Waypoint catalog Quest port of gsd:extract-learnings for extract decisions, lessons, patterns, and surprises from completed phase artifacts.

  - Recipes: `waypoint-doc-synthesizer`, `waypoint-pattern-mapper`
- `fast` — Fast Quest
  - Path: `quests/fast.yaml`
  - Description: Waypoint catalog Quest port of gsd:fast for trivial task execution path with minimal planning overhead.

  - Recipes: `waypoint-executor`
- `firmvault` — FirmVault
  - Path: `quests/firmvault.yaml`
  - Description: Standalone Waypoint Quest for a law-firm personal-injury case folder.
  - Recipes: `firmvault-case-setup-create-shell`, `firmvault-document-collection-review-intake`, `firmvault-document-collection-request-missing-documents`, `firmvault-document-collection-send-signature-packets`, `firmvault-accident-report-analyze`, `firmvault-medical-provider-setup-case`, `firmvault-client-check-in-start-cadence`, `firmvault-client-check-in-prepare-handoff`, `firmvault-insurance-bi-identify-carrier`, `firmvault-insurance-bi-prepare-lor`, `firmvault-insurance-bi-process-acknowledgment`, `firmvault-insurance-pip-open-claim`, `firmvault-pip-file-application`, `firmvault-pip-confirm-approval`, `firmvault-pip-track-exhaustion`, `firmvault-medical-provider-review-status`, `firmvault-lien-identify-potential`, `firmvault-medical-records-verify-authorization`, `firmvault-request-records-bills-prepare-request`, `firmvault-request-records-bills-send-request`, `firmvault-request-records-bills-follow-up`, `firmvault-medical-records-receive-and-process`, `firmvault-medical-chronology-update`, `firmvault-medical-records-prepare-request`, `firmvault-medical-records-send-request`, `firmvault-medical-records-first-follow-up`, `firmvault-medical-records-second-follow-up`, `firmvault-medical-records-escalate-delay`, `firmvault-demand-gather-materials`, `firmvault-demand-check-final-lien-process`, `firmvault-demand-draft-letter`, `firmvault-demand-identify-recipients`, `firmvault-demand-send-package`, `firmvault-negotiation-track-offer`, `firmvault-negotiation-offer-evaluation`, `firmvault-negotiation-document-client-decision`, `firmvault-negotiation-prepare-response`, `firmvault-negotiation-document-response`, `firmvault-settlement-prepare-statement`, `firmvault-settlement-prepare-authorization`, `firmvault-settlement-document-funds`, `firmvault-settlement-lien-audit`, `firmvault-settlement-lien-document-result`, `firmvault-lien-resolution-review-inventory`, `firmvault-lien-resolution-prepare-final-request`, `firmvault-lien-resolution-document-final-amount`, `firmvault-lien-resolution-document-payment`, `firmvault-final-distribution-prepare-statement`, `firmvault-final-distribution-zero-trust`, `firmvault-close-case-verify-readiness`, `firmvault-close-case-prepare-letter`, `firmvault-close-case-document-closure`, `firmvault-document-intake-record-source`, `firmvault-document-pipeline-submit-for-review`, `firmvault-document-pipeline-review-pr`, `firmvault-document-pipeline-record-merge`
 - `forensics` — Forensics Quest
  - Path: `quests/forensics.yaml`
  - Description: Waypoint catalog Quest port of gsd:forensics for post-mortem investigation for failed or stuck workflows.

  - Recipes: `waypoint-debugger`, `waypoint-codebase-mapper`
- `graphify` — Graphify Quest
  - Path: `quests/graphify.yaml`
  - Description: Waypoint catalog Quest port of gsd:graphify for knowledge graph build and inspection flow for project planning context.

  - Recipes: `waypoint-pattern-mapper`
- `health` — Health Quest
  - Path: `quests/health.yaml`
  - Description: Waypoint catalog Quest port of gsd:health for planning-directory and workflow health diagnostic.

  - Recipes: `waypoint-verifier`
- `ingest-docs` — Ingest Docs Quest
  - Path: `quests/ingest-docs.yaml`
  - Description: Waypoint catalog Quest port of gsd:ingest-docs for bootstrap or merge planning setup from existing ADRs, PRDs, specs, and docs.

  - Recipes: `waypoint-doc-classifier`, `waypoint-doc-synthesizer`
- `map-codebase` — Map Codebase Quest
  - Path: `quests/map-codebase.yaml`
  - Description: Waypoint catalog Quest port of gsd:map-codebase for parallel codebase analysis producing structured codebase intelligence.

  - Recipes: `waypoint-codebase-mapper`
- `milestone-summary` — Milestone Summary Quest
  - Path: `quests/milestone-summary.yaml`
  - Description: Waypoint catalog Quest port of gsd:milestone-summary for generate a comprehensive completed-milestone summary for onboarding and review.

  - Recipes: `waypoint-doc-synthesizer`
- `plan-review-convergence` — Plan Review Convergence Quest
  - Path: `quests/plan-review-convergence.yaml`
  - Description: Waypoint catalog Quest port of gsd:plan-review-convergence for iterative plan-review convergence loop until high concerns are resolved.

  - Recipes: `waypoint-planner`, `waypoint-plan-checker`
- `pr-branch` — PR Branch Quest
  - Path: `quests/pr-branch.yaml`
  - Description: Waypoint catalog Quest port of gsd:pr-branch for create a clean review branch that filters planning-only commits out of the PR diff.

  - Recipes: `waypoint-executor`
- `product-sprint` — Product Sprint
  - Path: `quests/product-sprint.yaml`
  - Description: gstack-derived product/software sprint Quest for founder-led product work; think, plan, build, review, test, ship, and reflect.
  - Recipes: `product-sprint-office-hours`, `product-sprint-ceo-review`, `product-sprint-eng-review`, `product-sprint-design-review`, `product-sprint-devex-review`, `product-sprint-autoplan`, `product-sprint-review`, `product-sprint-qa-only`, `product-sprint-ship`, `product-sprint-retro`
- `profile-user` — Profile User Quest
  - Path: `quests/profile-user.yaml`
  - Description: Waypoint catalog Quest port of gsd:profile-user for generate developer behavior and preference profile artifacts with consent gates.

  - Recipes: `waypoint-user-profiler`
- `quick` — Quick Quest
  - Path: `quests/quick.yaml`
  - Description: Waypoint catalog Quest port of gsd:quick for short-path task execution with optional discussion, research, and validation.

  - Recipes: `waypoint-planner`, `waypoint-executor`, `waypoint-verifier`
- `review` — External Review Quest
  - Path: `quests/review.yaml`
  - Description: Waypoint catalog Quest port of gsd:review for cross-AI peer review of phase plans.

  - Recipes: `waypoint-plan-checker`
- `review-backlog` — Review Backlog Quest
  - Path: `quests/review-backlog.yaml`
  - Description: Waypoint catalog Quest port of gsd:review-backlog for review and promote backlog items into active planning.

  - Recipes: `waypoint-roadmapper`, `waypoint-planner`
- `secure-phase` — Secure Phase Quest
  - Path: `quests/secure-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:secure-phase for retroactively verifying threat mitigations for completed work.

  - Recipes: `waypoint-security-auditor`, `waypoint-verifier`, `waypoint-code-fixer`
- `sketch` — Sketch Quest
  - Path: `quests/sketch.yaml`
  - Description: Waypoint catalog Quest port of gsd:sketch for explore UI/design directions through throwaway mockups before implementation.

  - Recipes: `waypoint-ui-researcher`, `waypoint-ui-auditor`
- `spec-phase` — Spec Phase Quest
  - Path: `quests/spec-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:spec-phase for clarifying what a phase delivers before planning how to build it.

  - Recipes: `waypoint-assumptions-analyzer`, `waypoint-codebase-mapper`, `waypoint-doc-writer`, `waypoint-plan-checker`
- `spike` — Spike Quest
  - Path: `quests/spike.yaml`
  - Description: Waypoint sub-Quest port of gsd:spike for focused experiential exploration before committing to a build path.

  - Recipes: `waypoint-project-researcher`, `waypoint-domain-researcher`, `waypoint-assumptions-analyzer`, `waypoint-executor`, `waypoint-doc-synthesizer`
- `stats` — Stats Quest
  - Path: `quests/stats.yaml`
  - Description: Waypoint catalog Quest port of gsd:stats for project statistics report for phases, plans, requirements, git metrics, and timeline.

  - Recipes: `waypoint-doc-synthesizer`
- `ui-phase` — UI Phase Quest
  - Path: `quests/ui-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ui-phase for generating UI-SPEC design contracts for frontend phases.

  - Recipes: `waypoint-ui-researcher`, `waypoint-ui-checker`, `waypoint-ui-auditor`, `waypoint-doc-writer`
- `ui-review` — UI Review Quest
  - Path: `quests/ui-review.yaml`
  - Description: Waypoint catalog Quest port of gsd:ui-review for retroactive UI and visual quality audit.

  - Recipes: `waypoint-ui-auditor`, `waypoint-ui-checker`
- `ultraplan-phase` — Ultraplan Phase Quest
  - Path: `quests/ultraplan-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:ultraplan-phase for offloading planning to a remote cloud planning session and importing the result.

  - Recipes: `waypoint-phase-researcher`, `waypoint-planner`, `waypoint-plan-checker`
- `validate-phase` — Validate Phase Quest
  - Path: `quests/validate-phase.yaml`
  - Description: Waypoint sub-Quest port of gsd:validate-phase for auditing and filling Nyquist validation gaps after execution.

  - Recipes: `waypoint-nyquist-auditor`, `waypoint-verifier`, `waypoint-code-fixer`, `waypoint-eval-auditor`
- `waypoint` — Project Delivery (GSD)
  - Path: `quests/waypoint.yaml`
  - Description: Project-delivery Quest port of the get-shit-done-cc project flow. It models the initialize → discuss → plan → execute → verify → ship journey as a reusable Quest while preserving GSD source command intent in metadata for later runtime and catalog phases. Use this when a folder needs a general planning/execution Quest rather than the FirmVault legal case Quest.

  - Recipes: `waypoint-doc-writer`, `waypoint-project-researcher`, `waypoint-roadmapper`, `waypoint-assumptions-analyzer`, `waypoint-codebase-mapper`, `waypoint-phase-researcher`, `waypoint-planner`, `waypoint-plan-checker`, `waypoint-executor`, `waypoint-verifier`, `waypoint-doc-synthesizer`, `waypoint-code-reviewer`

## Recipes

- `doc-writer` — Doc Writer
  - Path: `recipes/doc-writer.yaml`
  - Description: Produces clear, well-organized documentation from a set of source notes or an outline. Favors concrete examples over abstractions.

- `firmvault-accident-report-analyze` — FirmVault Accident Report Analyze
  - Path: `recipes/firmvault/accident-report-analyze.yaml`
  - Description: Analyzes a crash or accident report shadow and updates accident, party, witness, and insurance ledgers.
  - External side effects: `forbidden`
- `firmvault-case-setup-create-shell` — FirmVault Case Setup Create Shell
  - Path: `recipes/firmvault/case-setup-create-shell.yaml`
  - Description: Creates or verifies the native FirmVault case shell from accepted intake information.
  - External side effects: `forbidden`
- `firmvault-client-check-in-prepare-handoff` — FirmVault Client Check-In Prepare Handoff
  - Path: `recipes/firmvault/client-check-in-prepare-handoff.yaml`
  - Description: Prepares a human-facing client check-in script and task handoff without sending it.
  - External side effects: `forbidden`
- `firmvault-client-check-in-start-cadence` — FirmVault Client Check-In Start Cadence
  - Path: `recipes/firmvault/client-check-in-start-cadence.yaml`
  - Description: Establishes the recurring client check-in cadence without contacting the client.
  - External side effects: `forbidden`
- `firmvault-close-case-document-closure` — FirmVault Close Case - Document Closure
  - Path: `recipes/firmvault/close-case-document-closure.yaml`
  - Description: Document final case closure locally from human-send/archive evidence and canonical closure files.
  - External side effects: `forbidden`
- `firmvault-close-case-prepare-letter` — FirmVault Close Case - Prepare Closing Letter
  - Path: `recipes/firmvault/close-case-prepare-letter.yaml`
  - Description: Prepare a local client closing-letter draft and human-send handoff from verified closure facts.
  - External side effects: `forbidden`
- `firmvault-close-case-verify-readiness` — FirmVault Close Case - Verify Readiness
  - Path: `recipes/firmvault/close-case-verify-readiness.yaml`
  - Description: Verify closure readiness from explicit local case-folder obligations and prepare a closure checklist.
  - External side effects: `forbidden`
- `firmvault-document-collection-request-missing-documents` — FirmVault Document Collection Request Missing Documents
  - Path: `recipes/firmvault/document-collection-request-missing-documents.yaml`
  - Description: Prepares the client-facing handoff for missing onboarding documents after the intake checklist has been reviewed.
  - External side effects: `forbidden`
- `firmvault-document-collection-review-intake` — FirmVault Document Collection Review Intake
  - Path: `recipes/firmvault/document-collection-review-intake.yaml`
  - Description: Reviews onboarding documents and identifies missing intake, contract, and authorization items.
  - External side effects: `forbidden`
- `firmvault-document-collection-send-signature-packets` — FirmVault Document Collection Send Signature Packets
  - Path: `recipes/firmvault/document-collection-send-signature-packets.yaml`
  - Description: Stages the signature-packet handoff after missing onboarding documents have been identified.
  - External side effects: `forbidden`
- `firmvault-document-intake-record-source` — FirmVault Document Intake - Record Source
  - Path: `recipes/firmvault/document-intake-record-source.yaml`
  - Description: Record a scanned source PDF as local document-intake work without classifying it as legal completion.
  - External side effects: `forbidden`
- `firmvault-document-pipeline-record-merge` — FirmVault Document Pipeline - Record Merge
  - Path: `recipes/firmvault/document-pipeline-record-merge.yaml`
  - Description: Record owner-confirmed document-pipeline PR merge or deferred result into Waypoint handoff state.
  - External side effects: `forbidden`
- `firmvault-document-pipeline-review-pr` — FirmVault Document Pipeline - Review PR
  - Path: `recipes/firmvault/document-pipeline-review-pr.yaml`
  - Description: Prepare a human review checklist for a document-pipeline Forgejo PR and needs-review sidecars.
  - External side effects: `forbidden`
- `firmvault-document-pipeline-submit-for-review` — FirmVault Document Pipeline - Submit for Review
  - Path: `recipes/firmvault/document-pipeline-submit-for-review.yaml`
  - Description: Prepare or record submission of an indexed source PDF to the external document pipeline review flow.
  - External side effects: `forbidden`
- `firmvault-insurance-bi-identify-carrier` — FirmVault Insurance BI - Identify Carrier
  - Path: `recipes/firmvault/insurance-bi-identify-carrier.yaml`
  - Description: Identifies and normalizes the at-fault bodily-injury carrier from canonical FirmVault evidence.
  - External side effects: `forbidden`
- `firmvault-insurance-bi-prepare-lor` — FirmVault Insurance BI - Prepare LOR Handoff
  - Path: `recipes/firmvault/insurance-bi-prepare-lor.yaml`
  - Description: Prepares a BI letter-of-representation draft or exact human handoff without sending it externally.
  - External side effects: `forbidden`
- `firmvault-insurance-bi-process-acknowledgment` — FirmVault Insurance BI - Process Acknowledgment
  - Path: `recipes/firmvault/insurance-bi-process-acknowledgment.yaml`
  - Description: Processes a BI carrier acknowledgment or prepares a human follow-up when no acknowledgment arrived after the wait.
  - External side effects: `forbidden`
- `firmvault-insurance-pip-open-claim` — FirmVault Insurance PIP - Open Claim
  - Path: `recipes/firmvault/insurance-pip-open-claim.yaml`
  - Description: Identifies the PIP carrier path and prepares or documents opening a Kentucky PIP claim.
  - External side effects: `forbidden`
- `firmvault-lien-identify-potential` — FirmVault Early Lien Identification
  - Path: `recipes/firmvault/lien-identify-potential.yaml`
  - Description: Identifies evidence-backed lien and payor clues without starting final lien resolution.
  - External side effects: `forbidden`
- `firmvault-medical-chronology-update` — FirmVault Medical Chronology - Update
  - Path: `recipes/firmvault/medical-chronology-update.yaml`
  - Description: Updates a provider or case medical chronology from received records shadows.
  - External side effects: `forbidden`
- `firmvault-medical-provider-review-status` — FirmVault Medical Provider Status - Review
  - Path: `recipes/firmvault/medical-provider-review-status.yaml`
  - Description: Reviews and normalizes provider treatment status without requesting records or bills.
  - External side effects: `forbidden`
- `firmvault-medical-provider-setup-case` — FirmVault Medical Provider Setup Case
  - Path: `recipes/firmvault/medical-provider-setup-case.yaml`
  - Description: Creates or normalizes medical provider ledgers for known providers in one FirmVault case.
  - External side effects: `forbidden`
- `firmvault-medical-records-escalate-delay`, `firmvault-demand-gather-materials`, `firmvault-demand-check-final-lien-process`, `firmvault-demand-draft-letter`, `firmvault-demand-identify-recipients`, `firmvault-demand-send-package` — FirmVault Medical Records Escalate Delay
  - Path: `recipes/firmvault/medical-records-escalate-delay.yaml`
  - Description: Prepares escalation for records and bills still missing 30 days after the original request.
  - External side effects: `forbidden`
- `firmvault-medical-records-first-follow-up` — FirmVault Medical Records First Follow-Up
  - Path: `recipes/firmvault/medical-records-first-follow-up.yaml`
  - Description: Performs the 14-day follow-up review for pending medical records and bills requests.
  - External side effects: `forbidden`
- `firmvault-medical-records-prepare-request` — FirmVault Medical Records Prepare Request
  - Path: `recipes/firmvault/medical-records-prepare-request.yaml`
  - Description: Prepares provider-specific records and bills request work product from FirmVault masked case data.
  - External side effects: `forbidden`
- `firmvault-medical-records-receive-and-process` — FirmVault Medical Records Receive and Process
  - Path: `recipes/firmvault/medical-records-receive-and-process.yaml`
  - Description: Confirms received medical records or bills are present in the FirmVault vault shadow and updates provider receipt tracking.
  - External side effects: `forbidden`
- `firmvault-medical-records-second-follow-up` — FirmVault Medical Records Second Follow-Up
  - Path: `recipes/firmvault/medical-records-second-follow-up.yaml`
  - Description: Performs the 21-day second follow-up review for pending medical records and bills requests.
  - External side effects: `forbidden`
- `firmvault-medical-records-send-request` — FirmVault Medical Records Send Request
  - Path: `recipes/firmvault/medical-records-send-request.yaml`
  - Description: Confirms or prepares human handoff for sending records and bills requests, then records the request status in the FirmVault shadow vault.
  - External side effects: `forbidden`
- `firmvault-medical-records-verify-authorization` — FirmVault Medical Records Verify Authorization
  - Path: `recipes/firmvault/medical-records-verify-authorization.yaml`
  - Description: Verifies that a FirmVault case has a signed HIPAA or medical authorization before records and bills are requested.
  - External side effects: `forbidden`
- `firmvault-pip-confirm-approval` — FirmVault PIP Confirm Approval
  - Path: `recipes/firmvault/pip-confirm-approval.yaml`
  - Description: Confirms whether a Kentucky PIP claim is approved or active for one FirmVault case, normalizes the masked claim shadow when supported, and blocks with a precise handoff when approval evidence is missing.
  - External side effects: `forbidden`
- `firmvault-pip-file-application` — FirmVault PIP File Application
  - Path: `recipes/firmvault/pip-file-application.yaml`
  - Description: Prepares or confirms filing of the Kentucky KACP PIP application for one FirmVault case using masked vault data.
  - External side effects: `forbidden`
- `firmvault-pip-track-exhaustion` — FirmVault PIP Track Exhaustion
  - Path: `recipes/firmvault/pip-track-exhaustion.yaml`
  - Description: Tracks whether PIP benefits are exhausted and records the supported status in the FirmVault masked claim shadow.
  - External side effects: `forbidden`
- `firmvault-request-records-bills-follow-up` — FirmVault Request Records and Bills - Follow Up
  - Path: `recipes/firmvault/request-records-bills-follow-up.yaml`
  - Description: Reviews pending records/bills requests after a timer and prepares or documents the follow-up.
  - External side effects: `forbidden`
- `firmvault-request-records-bills-prepare-request` — FirmVault Request Records and Bills - Prepare Request
  - Path: `recipes/firmvault/request-records-bills-prepare-request.yaml`
  - Description: Prepares provider-specific medical records and bills request work product.
  - External side effects: `forbidden`
- `firmvault-request-records-bills-send-request` — FirmVault Request Records and Bills - Send Request
  - Path: `recipes/firmvault/request-records-bills-send-request.yaml`
  - Description: Confirms sending evidence or prepares a precise human handoff for records and bills requests.
  - External side effects: `forbidden`
- `product-sprint-autoplan` — Product Sprint Autoplan
  - Path: `recipes/product-sprint/autoplan.yaml`
  - Description: Coordinate multiple reviews into a coherent plan before build work starts.
  - External side effects: `none`
- `product-sprint-ceo-review` — Product Sprint CEO Review
  - Path: `recipes/product-sprint/ceo-review.yaml`
  - Description: Founder/CEO strategy review for product direction, wedge, sequencing, and company-level tradeoffs.
  - External side effects: `none`
- `product-sprint-design-review` — Product Sprint Design Review
  - Path: `recipes/product-sprint/design-review.yaml`
  - Description: Product taste and UX review for interaction quality, clarity, and AI-slop reduction.
  - External side effects: `none`
- `product-sprint-devex-review` — Product Sprint DevEx Review
  - Path: `recipes/product-sprint/devex-review.yaml`
  - Description: Developer-experience review for build, setup, testing, and maintainability friction.
  - External side effects: `none`
- `product-sprint-eng-review` — Product Sprint Engineering Review
  - Path: `recipes/product-sprint/eng-review.yaml`
  - Description: Architecture and implementation-plan review for feasibility, sequencing, and technical risk.
  - External side effects: `none`
- `product-sprint-office-hours` — Product Sprint Office Hours
  - Path: `recipes/product-sprint/office-hours.yaml`
  - Description: Discovery and product interrogation for early ideas and ambiguous product direction.
  - External side effects: `none`
- `product-sprint-qa-only` — Product Sprint QA Only
  - Path: `recipes/product-sprint/qa-only.yaml`
  - Description: Report-only QA pass that identifies issues without applying fixes or taking external action.
  - External side effects: `gated`
- `product-sprint-retro` — Product Sprint Retro
  - Path: `recipes/product-sprint/retro.yaml`
  - Description: Reflection loop to capture learnings, missed risks, and process improvements after a sprint.
  - External side effects: `none`
- `product-sprint-review` — Product Sprint Code Review
  - Path: `recipes/product-sprint/review.yaml`
  - Description: Review diffs and implementation quality before landing changes.
  - External side effects: `none`
- `product-sprint-ship` — Product Sprint Ship
  - Path: `recipes/product-sprint/ship.yaml`
  - Description: Release-preparation checklist and handoff with deployment and publishing side effects gated.
  - External side effects: `gated`
- `reviewer` — Reviewer
  - Path: `recipes/reviewer.yaml`
  - Description: Reviews completed work for correctness, completeness, and adherence to stated acceptance criteria. Produces a pass/fail verdict with specific issues to address when failing.

- `waypoint-advisor-researcher` — Advisor Researcher
  - Path: `recipes/waypoint/advisor-researcher.yaml`
  - Description: Researches a single gray area decision and returns a structured comparison table with rationale. Spawned by discuss-phase advisor mode.
- `waypoint-ai-researcher` — Ai Researcher
  - Path: `recipes/waypoint/ai-researcher.yaml`
  - Description: Researches a chosen AI framework's official docs to produce implementation-ready guidance — best practices, syntax, core patterns, and pitfalls distilled for the specific use case. Writes the Framework Quick Reference and Implementation Guidance sections of AI-SPEC.md. Spawned by /waypoint-ai-integration-phase orchestrator.
- `waypoint-assumptions-analyzer` — Assumptions Analyzer
  - Path: `recipes/waypoint/assumptions-analyzer.yaml`
  - Description: Deeply analyzes codebase for a phase and returns structured assumptions with evidence. Spawned by discuss-phase assumptions mode.
- `waypoint-code-fixer` — Code Fixer
  - Path: `recipes/waypoint/code-fixer.yaml`
  - Description: Applies fixes to code review findings from REVIEW.md. Reads source files, applies intelligent fixes, and commits each fix atomically. Spawned by /waypoint-code-review --fix.
- `waypoint-code-reviewer` — Code Reviewer
  - Path: `recipes/waypoint/code-reviewer.yaml`
  - Description: Reviews source files for bugs, security issues, and code quality problems. Produces structured REVIEW.md with severity-classified findings. Spawned by /waypoint-code-review.
- `waypoint-codebase-mapper` — Codebase Mapper
  - Path: `recipes/waypoint/codebase-mapper.yaml`
  - Description: Explores codebase and writes structured analysis documents. Spawned by map-codebase with a focus area (tech, arch, quality, concerns). Writes documents directly to reduce orchestrator context load.
- `waypoint-debug-session-manager` — Debug Session Manager
  - Path: `recipes/waypoint/debug-session-manager.yaml`
  - Description: Manages multi-cycle /waypoint-debug checkpoint and continuation loop in isolated context. Spawns waypoint-debugger agents, handles checkpoints via AskUserQuestion, dispatches specialist skills, applies fixes. Returns compact summary to main context. Spawned by /waypoint-debug command.
- `waypoint-debugger` — Debugger
  - Path: `recipes/waypoint/debugger.yaml`
  - Description: Investigates bugs using scientific method, manages debug sessions, handles checkpoints. Spawned by /waypoint-debug orchestrator.
- `waypoint-doc-classifier` — Doc Classifier
  - Path: `recipes/waypoint/doc-classifier.yaml`
  - Description: Classifies a single planning document as ADR, PRD, SPEC, DOC, or UNKNOWN. Extracts title, scope summary, and cross-references. Spawned in parallel by /waypoint-ingest-docs. Writes a JSON classification file and returns a one-line confirmation.
- `waypoint-doc-synthesizer` — Doc Synthesizer
  - Path: `recipes/waypoint/doc-synthesizer.yaml`
  - Description: Synthesizes classified planning docs into a single consolidated context. Applies precedence rules, detects cross-ref cycles, enforces LOCKED-vs-LOCKED hard-blocks, and writes INGEST-CONFLICTS.md with three buckets (auto-resolved, competing-variants, unresolved-blockers). Spawned by /waypoint-ingest-docs.
- `waypoint-doc-verifier` — Doc Verifier
  - Path: `recipes/waypoint/doc-verifier.yaml`
  - Description: Verifies factual claims in generated docs against the live codebase. Returns structured JSON per doc.
- `waypoint-doc-writer` — Doc Writer
  - Path: `recipes/waypoint/doc-writer.yaml`
  - Description: Writes and updates project documentation files. Spawned with a doc_assignment block specifying doc type, mode (create / update / supplement / fix), and project context. Ported from the GSD waypoint-doc-writer agent.
- `waypoint-domain-researcher` — Domain Researcher
  - Path: `recipes/waypoint/domain-researcher.yaml`
  - Description: Researches the business domain and real-world application context of the AI system being built. Surfaces domain expert evaluation criteria, industry-specific failure modes, regulatory context, and what "good" looks like for practitioners in this field — before the eval-planner turns it into measurable rubrics. Spawned by /waypoint-ai-integration-phase orchestrator.
- `waypoint-eval-auditor` — Eval Auditor
  - Path: `recipes/waypoint/eval-auditor.yaml`
  - Description: Retroactive audit of an implemented AI phase's evaluation coverage. Checks implementation against the AI-SPEC.md evaluation plan. Scores each eval dimension as COVERED/PARTIAL/MISSING. Produces a scored EVAL-REVIEW.md with findings, gaps, and remediation guidance. Spawned by /waypoint-eval-review orchestrator.
- `waypoint-eval-planner` — Eval Planner
  - Path: `recipes/waypoint/eval-planner.yaml`
  - Description: Designs a structured evaluation strategy for an AI phase. Identifies critical failure modes, selects eval dimensions with rubrics, recommends tooling, and specifies the reference dataset. Writes the Evaluation Strategy, Guardrails, and Production Monitoring sections of AI-SPEC.md. Spawned by /waypoint-ai-integration-phase orchestrator.
- `waypoint-executor` — Executor
  - Path: `recipes/waypoint/executor.yaml`
  - Description: Executes GSD plans with atomic commits, deviation handling, checkpoint protocols, and state management. Spawned by execute-phase orchestrator or execute-plan command.
- `waypoint-framework-selector` — Framework Selector
  - Path: `recipes/waypoint/framework-selector.yaml`
  - Description: Presents an interactive decision matrix to surface the right AI/LLM framework for the user's specific use case. Produces a scored recommendation with rationale. Spawned by /waypoint-ai-integration-phase and /waypoint-select-framework orchestrators.
- `waypoint-integration-checker` — Integration Checker
  - Path: `recipes/waypoint/integration-checker.yaml`
  - Description: Verifies cross-phase integration and E2E flows. Checks that phases connect properly and user workflows complete end-to-end.
- `waypoint-intel-updater` — Intel Updater
  - Path: `recipes/waypoint/intel-updater.yaml`
  - Description: Analyzes codebase and writes structured intel files to .planning/intel/.
- `waypoint-nyquist-auditor` — Nyquist Auditor
  - Path: `recipes/waypoint/nyquist-auditor.yaml`
  - Description: Fills Nyquist validation gaps by generating tests and verifying coverage for phase requirements
- `waypoint-pattern-mapper` — Pattern Mapper
  - Path: `recipes/waypoint/pattern-mapper.yaml`
  - Description: Analyzes codebase for existing patterns and produces PATTERNS.md mapping new files to closest analogs. Read-only codebase analysis spawned by /waypoint-plan-phase orchestrator before planning.
- `waypoint-phase-researcher` — Phase Researcher
  - Path: `recipes/waypoint/phase-researcher.yaml`
  - Description: Researches how to implement a phase before planning. Produces RESEARCH.md consumed by waypoint-planner. Spawned by /waypoint-plan-phase orchestrator.
- `waypoint-plan-checker` — Plan Checker
  - Path: `recipes/waypoint/plan-checker.yaml`
  - Description: Verifies plans will achieve phase goal before execution. Goal-backward analysis of plan quality. Spawned by /waypoint-plan-phase orchestrator.
- `waypoint-planner` — Planner
  - Path: `recipes/waypoint/planner.yaml`
  - Description: Creates executable phase plans with task breakdown, dependency analysis, and goal-backward verification. Spawned by /waypoint-plan-phase orchestrator.
- `waypoint-project-researcher` — Project Researcher
  - Path: `recipes/waypoint/project-researcher.yaml`
  - Description: Researches domain ecosystem before roadmap creation. Produces files in .planning/research/ consumed during roadmap creation. Spawned by /waypoint-new-project or /waypoint-new-milestone orchestrators.
- `waypoint-research-synthesizer` — Research Synthesizer
  - Path: `recipes/waypoint/research-synthesizer.yaml`
  - Description: Synthesizes research outputs from parallel researcher agents into SUMMARY.md. Spawned by /waypoint-new-project after 4 researcher agents complete.
- `waypoint-roadmapper` — Roadmapper
  - Path: `recipes/waypoint/roadmapper.yaml`
  - Description: Creates project roadmaps with phase breakdown, requirement mapping, success criteria derivation, and coverage validation. Spawned by /waypoint-new-project orchestrator.
- `waypoint-security-auditor` — Security Auditor
  - Path: `recipes/waypoint/security-auditor.yaml`
  - Description: Verifies threat mitigations from PLAN.md threat model exist in implemented code. Produces SECURITY.md. Spawned by /waypoint-secure-phase.
- `waypoint-ui-auditor` — Ui Auditor
  - Path: `recipes/waypoint/ui-auditor.yaml`
  - Description: Retroactive 6-pillar visual audit of implemented frontend code. Produces scored UI-REVIEW.md. Spawned by /waypoint-ui-review orchestrator.
- `waypoint-ui-checker` — Ui Checker
  - Path: `recipes/waypoint/ui-checker.yaml`
  - Description: Validates UI-SPEC.md design contracts against 6 quality dimensions. Produces BLOCK/FLAG/PASS verdicts. Spawned by /waypoint-ui-phase orchestrator.
- `waypoint-ui-researcher` — Ui Researcher
  - Path: `recipes/waypoint/ui-researcher.yaml`
  - Description: Produces UI-SPEC.md design contract for frontend phases. Reads upstream artifacts, detects design system state, asks only unanswered questions. Spawned by /waypoint-ui-phase orchestrator.
- `waypoint-user-profiler` — User Profiler
  - Path: `recipes/waypoint/user-profiler.yaml`
  - Description: Analyzes extracted session messages across 8 behavioral dimensions to produce a scored developer profile with confidence levels and evidence. Spawned by profile orchestration workflows.
- `waypoint-verifier` — Verifier
  - Path: `recipes/waypoint/verifier.yaml`
  - Description: Verifies phase goal achievement through goal-backward analysis. Checks codebase delivers what phase promised, not just that tasks completed. Creates VERIFICATION.md report.

- `firmvault-demand-gather-materials` — FirmVault Demand - Gather Materials
  - Path: `recipes/firmvault/demand-gather-materials.yaml`
  - External side effects: `forbidden`
- `firmvault-demand-check-final-lien-process` — FirmVault Demand - Check Final Lien Process
  - Path: `recipes/firmvault/demand-check-final-lien-process.yaml`
  - External side effects: `forbidden`
- `firmvault-demand-draft-letter` — FirmVault Demand - Draft Letter
  - Path: `recipes/firmvault/demand-draft-letter.yaml`
  - External side effects: `forbidden`
- `firmvault-demand-identify-recipients` — FirmVault Demand - Identify Recipients
  - Path: `recipes/firmvault/demand-identify-recipients.yaml`
  - External side effects: `forbidden`
- `firmvault-demand-send-package` — FirmVault Demand - Send Package
  - Path: `recipes/firmvault/demand-send-package.yaml`
  - External side effects: `forbidden`


## Deferred / not implemented in this repo

- No standalone source CLI is implemented here.
- No first-class sub-Quest schema field exists yet; command mapping intent lives in metadata/docs.
- No built-in recipe executor is shipped in the standalone core package yet; hosts provide `IRecipeRuntime`.
- Namespace commands from the upstream source CLI (`ns-*`) remain deferred optional mappings, documented in `docs/quests/waypoint-command-map.md`.
- FirmVault recipes are source-backed workflow/SOP ports staged wave-by-wave under the FirmVault folder-host plan. Close-case wave status: `part_six_g_close_case_wave`.
