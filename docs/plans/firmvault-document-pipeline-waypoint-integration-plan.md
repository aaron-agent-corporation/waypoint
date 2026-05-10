# FirmVault Document Pipeline → Waypoint Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Wire the existing `firmvault-document-pipeline` ingestion/review system into standalone Waypoint/FirmVault without weakening Waypoint’s local-only deterministic workflow model.

**Architecture:** Treat `firmvault-document-pipeline` as the scanner/classifier/Forgejo review subsystem and Waypoint as the lifecycle/state/progress layer. Document intake may copy or stage source files and record events, but it must not satisfy workflow landmarks until explicit state/evidence files say the legal workflow step is complete.

**Tech Stack:** Waypoint TypeScript packages (`packages/waypoint-folder-host`, `packages/waypoint-cli`, `examples/hermes-operator-adapter`), FirmVault pipeline Python package (`firmvault_pipeline`), Forgejo PR workflow, local Hermes `paralegal` workspace.

---

## Source-backed inspection summary

### Pipeline location and purpose

- Repo: `/Users/aaronwhaley/Github/firmvault-document-pipeline`.
- The repo’s `CLAUDE.md` describes it as a local-first document intake pipeline for inbound Daily Mail into the FirmVault knowledge base at `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault`.
- Its package layout is explicit: `pipeline/` handles scanner → splitter → OCR/extraction → naming/routing/triage; `pipeline/ingest_workflow.py` and `run_pr_ingest.py` implement the Forgejo PR-mediated path; `webhook/` handles post-merge events; `ledger/` stores SQLite WAL state and dedupe.

### Runtime config contract

- `firmvault.yaml` sets:
  - `firmvault_root: /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault`
  - `inbox_path: /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/inbox`
  - `cases_path: /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases`
  - `triage.triage_path: /Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/_triage`
  - `ingest.workflow: forgejo`
  - Forgejo repo: `aaron/FirmVault`, base branch `main`, branch prefix `ingest`
  - external PDF relocation root: `/Users/aaronwhaley/Whaley Law Firm Dropbox/Litigation/Active`
- `src/firmvault_pipeline/config.py` confirms env overlay via `FIRMVAULT_` prefix and keeps Forgejo credentials in environment (`FORGEJO_BASE_URL`, `FORGEJO_API_TOKEN`), not YAML.
- Do not import secrets or persist `.env` contents in Waypoint.

### Ingest / split / naming behavior

- `src/firmvault_pipeline/pipeline/run_pr_ingest.py` runs one source PDF through extraction, splitting, per-segment `simple_naming`, and then commits results through `commit_via_forgejo_pr`.
- Successful segments become `StagedAuto` outputs with:
  - `.md` primary artifact path under `cases/<client>/documents/<bucket>/<filename>.md`
  - sibling `.pdf` path under the same directory
- Failed or ambiguous segments become `StagedNeedsReview` outputs with parked paths:
  - firm-wide: `_needs-review/<error_code>/<filename>`
  - per-case: `cases/<client_slug>/_needs-review/<error_code>/<filename>`
  - optional `.review.md` sidecar with paralegal-editable hints.

### Forgejo review / approval behavior

- `src/firmvault_pipeline/pipeline/ingest_workflow.py` creates a branch named `ingest/<YYYY-MM-DD>-<short-sha>`, writes each staged file via the Forgejo contents API, stashes the original source PDF at `_review/<branch>/<original-filename>`, and opens a PR titled `Daily Mail Ingest — <date> (...)`.
- The design intentionally avoids local git checkout mutations in the dirty paralegal vault working tree.
- `docs/forgejo-webhook-setup.md` describes the approval gate as a paralegal merging the Forgejo PR in the UI.

### Post-merge behavior

- `src/firmvault_pipeline/webhook/handler.py` processes only suitable merged pull requests, fetches PR files via Forgejo API, archives the original inbox source by matching recorded sha256, relocates PDFs to external storage, deletes relocated PDFs from main via API cleanup commit, mirrors/syncs markdown locally, and runs QMD indexing as a soft-fail hook.
- It has explicit deferral behavior for storage unavailable / partial relocation / cleanup partial cases.
- Form-fill sidecar resolution is additive and separately idempotent.

### Existing Waypoint/FirmVault surface

- `packages/waypoint-folder-host/src/firmvault/documents.ts` currently implements a safe local-only `addFirmVaultDocument(projectRoot, input)`:
  - requires an absolute source file path;
  - copies the file into `documents/inbox/` under the case folder;
  - appends `.waypoint/firmvault/documents.yaml`;
  - appends a `firmvault.document.added` event to `.waypoint/firmvault/events.jsonl`;
  - does not satisfy workflow landmarks by itself.
- `packages/waypoint-cli/src/commands/firmvault.ts` exposes `waypoint firmvault add-document --source <path> --kind ... --json` for the local-only intake rail.
- `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts` uses key-based trusted `cases_roots`, requires `hermes_profile: paralegal`, accepts `personal_injury` bootstrap requests, and exposes structured document add/handoff helpers for trusted case slugs.
- `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts` allowlists `firmvault bootstrap`, `firmvault add-document`, and `firmvault document-handoff`; it still does not allow any external pipeline command.

---

## Integration decision

Use **two layers**, not one blended command:

1. **Waypoint local intake layer** stays deterministic and case-folder scoped.
   - It can copy a scanned file into a case-local inbox and record a durable event.
   - It can record a pointer to an external PR or pipeline run after the pipeline has staged review artifacts.
   - It must not mark legal-workflow landmarks complete solely because an upload exists.

2. **FirmVault pipeline layer** remains the document-classification / split / naming / Forgejo review engine.
   - It owns OCR, multi-document splitting, LLM naming, needs-review sidecars, Forgejo PR staging, webhook relocation, and QMD indexing.
   - Waypoint should call or observe it through narrow, allowlisted surfaces, not reimplement its internals.

This preserves the existing safe model while letting scanned PDFs flow into the already-built PR review system.

---

## Proposed Waypoint additions

### Phase D1 — Model pipeline handoff metadata locally

**Objective:** Extend Waypoint’s local document index to remember whether a document has been handed to the external FirmVault pipeline, without making that handoff a landmark.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/documents.ts`
- Test: `packages/waypoint-folder-host/src/firmvault/documents.test.ts` or existing FirmVault CLI tests if no dedicated file exists.

**Fields to add carefully:**
- `handoff?: { system: 'firmvault-document-pipeline'; status: 'not_started' | 'submitted' | 'pr_opened' | 'merged' | 'deferred' | 'failed'; pr_number?: number; pr_url?: string; branch?: string; submitted_at?: string; completed_at?: string }`

**Rules:**
- Default existing entries to no `handoff` field.
- Do not introduce `landmark_satisfied`, `task_complete`, or similar fields here.
- Validate URLs/branches as strings only; do not trust them as filesystem paths.

**Verification:**
- Add a fixture document index with and without `handoff` and prove both parse.
- Run targeted Vitest for FirmVault document indexing.

### Phase D2 — Add a Waypoint command to mark pipeline handoff state

**Objective:** Provide a deterministic local state update after a pipeline PR is opened or merged.

**Files:**
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Modify: `packages/waypoint-folder-host/src/firmvault/documents.ts`
- Test: `packages/waypoint-cli/src/commands/firmvault.test.ts`

**Command shape:**

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr_opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/aaron/FirmVault/pulls/123 \
  --branch ingest/2026-05-08-deadbeef \
  --json
```

**Rules:**
- Mutates only `.waypoint/firmvault/documents.yaml` and `.waypoint/firmvault/events.jsonl`.
- Fails if `document_id` is unknown.
- Does not copy, delete, email, fax, call, or alter trust-account state.

### Phase D3 — Add Hermes operator adapter surface for safe document intake

**Status:** Implemented in this slice.

**Objective:** Let Hermes route trusted, structured document-add and handoff requests into Waypoint while preserving registry key controls.

**Files:**
- Modified: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.ts`
- Modified: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
- Tested: `examples/hermes-operator-adapter/src/firmvault-case-bootstrap.test.ts`
- Tested: `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`

**Adapter behavior:**
- Input uses `casesRootKey` plus safe `caseSlug`; the adapter derives the case root from trusted config and rejects unsafe slug/path attempts before invoking Waypoint.
- The safe command runner allowlists only:
  - `waypoint firmvault add-document --source <absolute> --kind <allowed> [--note] --json`
  - `waypoint firmvault document-handoff --document-id <id> --status <allowed> [--pr-number] [--pr-url] [--branch] [--submitted-at] [--completed-at] --json`
- The adapter still requires Hermes profile `paralegal` through the `cases_roots` registry.
- No external pipeline command is allowlisted in D3.

### Phase D4 — Add optional pipeline-run adapter, separate from Waypoint CLI

**Status:** Implemented in this slice.

**Objective:** Allow a trusted operator flow to invoke the Python pipeline for a source PDF and capture returned PR metadata.

**Files:**
- Create: `examples/hermes-operator-adapter/src/firmvault-document-pipeline.ts`
- Test: `examples/hermes-operator-adapter/src/firmvault-document-pipeline.test.ts`

**Command shape:**

```bash
cd /Users/aaronwhaley/Github/firmvault-document-pipeline
uv run firmvault_ingest_once ingest /absolute/path/to/source.pdf --workflow forgejo
```

**Guardrails:**
- Require a configured, absolute pipeline repo path from registry/config.
- Require source path to be absolute and already staged/known from Waypoint intake.
- Capture stdout/stderr; redact token-like strings before storing/logging.
- Do not pass or read `.env` values in Waypoint.

### Phase D5 — Map PR events back into Waypoint state

**Status:** Implemented in this slice for the manual/operator path.

**Objective:** After a pipeline PR opens or merges, store a local Waypoint event and leave legal workflow landmarks untouched until explicit evidence/status files are updated.

**Implemented first path:** `examples/hermes-operator-adapter/src/firmvault-document-flow.ts` composes the existing safe pieces:
- `addFirmVaultDocumentWithHermesOperator(...)` records the scanned source PDF in the case-local inbox/index.
- `runFirmVaultDocumentPipelineWithHermesOperator(...)` invokes the external Python pipeline adapter and returns redacted PR/branch status.
- `recordFirmVaultDocumentHandoffWithHermesOperator(...)` stores `submitted`, `pr_opened`, or `failed` handoff metadata through the Waypoint CLI.
- The result explicitly reports `legalLandmarksUpdated: false`.

**Remaining implementation options:**
- Webhook-adjacent: FirmVault pipeline webhook calls a local Waypoint handoff update after `post_merge_handler` succeeds.
- Polling: Waypoint/Hermes checks Forgejo PR status and calls `document-handoff`.

**Verification:** `examples/hermes-operator-adapter/src/firmvault-document-flow.test.ts` covers PR-opened, dry-run/submitted, failed-pipeline, unsafe-input rejection, and unchanged legal landmarks.

### Phase D6 — Add source-backed workflow tasks/recipes only after handoff state exists

**Status:** Implemented in this slice.

**Objective:** Add Waypoint tasks that point at document review state without pretending the pipeline completes legal work.

**Candidate recipe names:**
- `firmvault-document-intake-record-source`
- `firmvault-document-pipeline-submit-for-review`
- `firmvault-document-pipeline-review-pr`
- `firmvault-document-pipeline-record-merge`

**Implemented Quest rail:**
- Added the `document-pipeline` phase to `quests/firmvault.yaml` between onboarding and file setup.
- Added Recipe tasks for recording the source, submitting/recording pipeline review submission, preparing PR review, and recording merge/defer/failure handoff state.
- Added a required human gate for Forgejo PR review/approval.

**Gate model:**
- PR merge is a review/filing gate for documents.
- Legal landmarks such as records requested/received, bills verified, lien statuses, demand package sent, or case closed remain governed by existing explicit FirmVault state files and evidence paths.

---

## Acceptance gates

- `pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/*.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts examples/hermes-operator-adapter/src/*.test.ts`
- `pnpm typecheck`
- `pnpm build`
- No generated docs or state file claims a document upload/PR merge satisfies a legal workflow landmark.
- No secrets or `.env` values are read into Waypoint files.
- `git status --short --branch` is clean after commit.

---

## Out of scope

- Reimplementing OCR, splitter, simple_naming, Forgejo contents API client, QMD indexing, or webhook relocation inside Waypoint.
- Sending emails/faxes/portal messages, making phone calls, or trust-account actions.
- Treating a scanned PDF upload, auto-classification, or Forgejo PR merge as completion of a legal workflow obligation.
- Natural-language filesystem path resolution for case roots.
