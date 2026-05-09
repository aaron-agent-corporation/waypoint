# FirmVault New Case Bootstrap Runbook

This runbook covers the standalone Waypoint path for creating a new FirmVault personal-injury case folder and activating its local lifecycle. It does not use Mission Control and it does not perform external legal/financial side effects.

## Safety model

- Create cases only under a configured trusted cases root.
- Route agent-initiated FirmVault bootstrap requests through the Hermes `paralegal` profile.
- Use structured input: `casesRootKey`, `caseName`, `caseType`, and optional `start`.
- Do not let natural-language paths become filesystem paths.
- Do not send emails, faxes, portal messages, API calls, or trust-account actions.
- Document intake is local copying/indexing only; substantive landmarks require explicit state/evidence updates.

## Trusted cases root config

The Hermes operator adapter expects a registry with named cases roots. The key is the only value an agent should reference. The path and CLI entrypoint come from trusted config.

```yaml
cases_roots:
  pi:
    path: /trusted/FirmVault/Cases
    waypoint_cli: /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts
    hermes_profile: paralegal
```

Rules:

- `cases_roots.<key>` must be a safe key like `pi` or `firmvault_cases`.
- `path` must be absolute.
- `waypoint_cli` must be absolute.
- `hermes_profile` must be `paralegal` for FirmVault case bootstrap.

## Exact CLI bootstrap command

```bash
waypoint firmvault bootstrap \
  --cases-root /trusted/FirmVault/Cases \
  --case-name "Jane Smith v. Acme Trucking" \
  --case-type personal-injury \
  --start \
  --json
```

Expected result:

- creates `/trusted/FirmVault/Cases/jane-smith-v-acme-trucking/`;
- writes canonical starter files such as `AGENTS.md`, `Dashboard.md`, and the case markdown file;
- initializes `.waypoint/config.yaml` with the `firmvault` Quest;
- installs bundled FirmVault Quest/Recipe manifests;
- initializes `.waypoint/firmvault/*.yaml` state;
- with `--start`, creates `route-001`, `tasks.yaml`, and route events.

## Agent phrase examples

Acceptable operator intent:

```text
Create a new PI case for Jane Smith v. Acme Trucking under the pi cases root and activate FirmVault.
```

Structured adapter request:

```ts
{
  casesRootKey: 'pi',
  caseName: 'Jane Smith v. Acme Trucking',
  caseType: 'personal_injury',
  start: true,
}
```

The adapter resolves `pi` from trusted config, invokes `waypoint firmvault bootstrap ... --json`, and returns a summary that includes the Hermes profile `paralegal`.

Reject these forms:

```text
Create it at /Users/me/Desktop/new-case.
Use ../cases as the cases root.
Run whatever shell command is needed.
```

Those attempt to supply a path or arbitrary execution through natural language instead of using a trusted `casesRootKey`.

## Add documents after bootstrap

From inside the created case folder:

```bash
waypoint firmvault add-document \
  --source /path/to/local/police-report.pdf \
  --kind police-report \
  --note "uploaded by client" \
  --json
```

The command copies the file into `documents/inbox/`, appends metadata to `.waypoint/firmvault/documents.yaml`, and appends a `firmvault.document.added` event to `.waypoint/firmvault/events.jsonl`.

When the external FirmVault document pipeline opens or completes its Forgejo review PR, attach that handoff state without marking legal landmarks complete:

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr-opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/aaron/FirmVault/pulls/123 \
  --branch ingest/2026-05-08-deadbeef \
  --json
```

The command updates the matching `.waypoint/firmvault/documents.yaml` entry and appends a `firmvault.document.handoff_updated` event.

Supported kinds:

- `medical-records`
- `bill`
- `insurance`
- `police-report`
- `correspondence`
- `unknown`

## Inspect the active case lifecycle

Run these from the case folder:

```bash
waypoint status
waypoint routes --json
waypoint tasks --route-id route-001 --json
waypoint firmvault landmarks --json
waypoint route-events --route-id route-001 --limit 20 --json
```

The initial FirmVault bootstrap should report the full deterministic landmark projection with zero substantive landmarks satisfied unless explicit starter evidence/state satisfies one.

## What the system does not do automatically

- It does not send demand letters, medical record requests, emails, faxes, or portal messages.
- It does not contact carriers, providers, clients, courts, or lienholders.
- It does not move trust money or calculate/disburse settlement funds as an external action.
- It does not treat a raw uploaded file as proof that a workflow milestone is complete.
- It does not allow an agent to choose arbitrary filesystem destinations.

Human gates remain mandatory for external communications, settlement/trust actions, and final approvals.
