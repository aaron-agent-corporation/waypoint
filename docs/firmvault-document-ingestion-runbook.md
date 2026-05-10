# FirmVault Document Ingestion Runbook

This runbook is the operator path for the Waypoint ⇄ FirmVault document-pipeline bridge.

Use it when a scanned PDF needs to enter a FirmVault case, be processed by the external `firmvault-document-pipeline`, reviewed in Forgejo, and recorded back into Waypoint handoff state.

## Safety model

- Waypoint owns deterministic case lifecycle/state.
- `firmvault-document-pipeline` owns OCR, splitting, naming, Forgejo PR staging, post-merge relocation, and QMD/indexing behavior.
- Document ingestion does not satisfy legal workflow landmarks.
- Forgejo PR merge does not satisfy legal workflow landmarks.
- Legal landmarks remain controlled by explicit `.waypoint/firmvault/*.yaml` status fields plus evidence paths.
- The Hermes operator path must use trusted `casesRootKey` values and the `paralegal` profile. Do not resolve arbitrary natural-language paths.
- Do not copy Forgejo tokens, `.env` contents, API keys, or other secrets into Waypoint state or docs.

## Required pieces

- A trusted FirmVault case root registry entry with `hermes_profile: paralegal`.
- A bootstrapped or existing Waypoint FirmVault case folder.
- A local scanned PDF source path.
- The external pipeline repo, normally `/Users/aaronwhaley/Github/firmvault-document-pipeline`.
- Forgejo review access for the PR opened by the pipeline.

## Operator flow

### 1. Bootstrap or select a trusted FirmVault case

This section covers how to bootstrap or select a trusted FirmVault case.

For a new case, create the case folder and start the FirmVault Quest:

```bash
waypoint firmvault bootstrap \
  --cases-root /absolute/path/to/cases \
  --case-name "Client Name v. Defendant" \
  --case-type personal-injury \
  --start \
  --json
```

For an existing case, the Hermes/paralegal adapter should identify it by trusted registry key plus safe case slug, not by free-form path text.

### 2. Record the scanned source PDF locally

From the case folder, add the scan to the Waypoint/FirmVault local inbox:

```bash
waypoint firmvault add-document \
  --source /absolute/path/to/scanned-mail.pdf \
  --kind unknown \
  --note "scanned Daily Mail source" \
  --json
```

This copies the file into `documents/inbox/`, appends `.waypoint/firmvault/documents.yaml`, and writes a `firmvault.document.added` event.

It does not satisfy legal workflow landmarks.

### 3. Submit the PDF to the external pipeline

The composed Hermes/paralegal flow calls the external `firmvault-document-pipeline` adapter. The adapter invokes the external repo with argv, not shell, and the pipeline handles split/name/stage/Forgejo behavior.

The effective command shape is:

```bash
cd /Users/aaronwhaley/Github/firmvault-document-pipeline
uv run firmvault_ingest_once ingest /absolute/path/to/scanned-mail.pdf --workflow forgejo
```

The pipeline should return or expose PR metadata such as branch, PR number, and PR URL. Any token-like stdout/stderr must be redacted before it is stored or shown.

### 4. Record the opened Forgejo PR in Waypoint

After the pipeline opens a Forgejo PR, record the handoff:

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr-opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/aaron/FirmVault/pulls/123 \
  --branch ingest/2026-05-08-deadbeef \
  --json
```

The composed operator flow does this automatically when the pipeline adapter returns PR metadata.

The handoff state lives in `.waypoint/firmvault/documents.yaml`. It is audit/progress metadata for the document pipeline, not proof that records, bills, liens, demand, settlement, or close-case work is complete.

### 5. Review the Forgejo PR

A human reviews the Forgejo PR:

- confirm split segments are correct;
- confirm names and filing locations are correct;
- inspect needs-review sidecars;
- approve, revise, defer, or merge through Forgejo.

Waypoint’s `document-pipeline` Quest phase includes tasks and a human gate for this review loop.

### 6. Sync the PR result back to Waypoint

After review, sync the PR result through the PR sync adapter or equivalent operator command path. The adapter maps PR state to handoff state:

- open PR: leave `pr_opened` unchanged;
- merged PR: record `merged` and `completed_at`;
- closed unmerged PR: record `deferred`;
- lookup/client failure: record `failed`.

The adapter returns `legalLandmarksUpdated: false`.

### 7. Verify no legal landmark moved from ingestion alone

Check the FirmVault landmark projection:

```bash
waypoint firmvault landmarks --json
```

A document upload, a pipeline submission, a Forgejo PR, or a merge event does not satisfy legal workflow landmarks. If legal progress occurred, update the appropriate explicit FirmVault state YAML and evidence path separately.

## Smoke test

Run the injected/no-live smoke from the Waypoint repo:

```bash
pnpm smoke:firmvault-document-ingestion
```

The smoke uses fake executor/client behavior. It proves the local operator loop without live Forgejo credentials or a real Python pipeline run.

Expected proof:

- document added to `documents/inbox/`;
- handoff reaches `pr_opened`;
- PR sync updates handoff to `merged`;
- `.waypoint/firmvault/documents.yaml` contains PR metadata;
- `.waypoint/firmvault/events.jsonl` includes document-added and handoff-updated events;
- `waypoint firmvault landmarks --json` still shows zero legal landmarks satisfied from ingestion alone.

## Troubleshooting

- If the source path is rejected, confirm it is absolute and points to a `.pdf` file for pipeline submission.
- If a case slug is rejected, use the canonical safe slug created by `waypoint firmvault bootstrap`.
- If a PR cannot be synced, confirm at least one lookup key is present: PR number, PR URL, or branch.
- If secrets appear in pipeline output, stop and redact them before persisting or sharing the output.
- If a legal landmark appears satisfied after only ingestion/PR sync, treat that as a bug in the landmark projection or state update path.
