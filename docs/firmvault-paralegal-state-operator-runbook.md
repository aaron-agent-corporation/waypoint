# FirmVault Paralegal State Operator Runbook

This runbook is the agent-facing contract for operating FirmVault legal state through Waypoint and Hermes.

The core rule: **Never edit `.waypoint/firmvault/*.yaml` directly.** Legal progress must be recorded through validated Waypoint commands so evidence paths are checked, audit events are appended, and landmarks remain deterministic projections.

## Scope

Use this runbook when a Hermes operator or paralegal-profile agent needs to inspect or advance the legal lifecycle for a trusted FirmVault case.

Allowed lifecycle operations:

- inspect explicit legal state;
- inspect projected legal landmarks;
- check whether an evidence path is safe and exists;
- set an allowlisted legal fact with a validated status and evidence path;
- record document-pipeline/Forgejo handoff metadata separately from legal progress.

Do not use this runbook to send external mail, submit faxes, call APIs, move trust funds, or perform real-world legal side effects. Those remain human gates or separately approved integrations.

## Safety model

Hermes/paralegal must address cases by trusted `casesRootKey` plus safe `caseSlug`.

The registry entry must use the `paralegal` profile, for example:

```yaml
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts
    hermes_profile: paralegal
```

Do not accept arbitrary natural-language filesystem paths from the user as a case root. Resolve only trusted registry keys.

## Standard operating loop

1. Select the trusted case root and safe case slug.
2. Inspect current state and landmarks.
3. Confirm evidence exists or create/copy evidence through an approved local process.
4. Use `waypoint firmvault evidence check` when possible before mutation.
5. Use `waypoint firmvault state set` to record the legal fact.
6. Report the command JSON result, especially `newly_satisfied`, `newly_unsatisfied`, and `legal_landmarks_updated`.

## Inspect state before mutation

Always inspect state and landmarks before mutation.

```bash
waypoint firmvault state show --json
waypoint firmvault landmarks --json
```

For a specific section:

```bash
waypoint firmvault state show --section demand --json
```

Use the response to avoid guessing existing YAML shape or current legal progress.

## Check evidence

Before setting a legal fact with evidence, check the evidence path from inside the case folder:

```bash
waypoint firmvault evidence check \
  --path documents/sent/demand-package-sent.md \
  --json
```

The path must be relative, non-empty, non-traversing, and inside the case folder. Absolute paths and `../` traversal are rejected.

## Set legal state facts

Record legal progress with `waypoint firmvault state set`, not by editing YAML and not by setting landmarks directly.

Example:

```bash
waypoint firmvault state set \
  --fact demand.send \
  --status sent \
  --evidence documents/sent/demand-package-sent.md \
  --note "Sent by human after attorney approval." \
  --json
```

The JSON response includes:

- `fact`
- `status`
- `evidence`
- `landmarks_before`
- `landmarks_after`
- `newly_satisfied`
- `newly_unsatisfied`
- `legal_landmarks_updated`

When reporting progress, quote the returned `newly_satisfied` list. Do not claim a landmark was satisfied unless the command output says it was.

## Document handoff is separate

Use `waypoint firmvault document-handoff` only for document pipeline and Forgejo review state.

Document intake, PR open, PR merge, or handoff status does not satisfy legal landmarks by itself.

Examples:

```bash
waypoint firmvault add-document \
  --source /absolute/path/to/scan.pdf \
  --kind medical-records \
  --note "Daily mail scan" \
  --json
```

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr-opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/owner/repo/pulls/123 \
  --json
```

This records pipeline metadata only. If the reviewed document supports legal progress, a separate `state set` command with case-folder evidence is still required.

## Hermes adapter helpers

The Hermes operator adapter exposes typed helpers over the safe CLI contract:

- `showFirmVaultStateWithHermesOperator(...)`
- `checkFirmVaultEvidenceWithHermesOperator(...)`
- `setFirmVaultStateFactWithHermesOperator(...)`

Each helper must use the trusted `casesRootKey`, safe `caseSlug`, and the configured `paralegal` profile. The helper must not call arbitrary shell commands.

## Reporting discipline

A good completion report includes:

```text
Fact: demand.send
Status: sent
Evidence: documents/sent/demand-package-sent.md
newly_satisfied: demand_sent
legal_landmarks_updated: true
```

A bad completion report says “demand is done” without the JSON output from `state set` or `landmarks`.

## Hard stops

Stop instead of mutating state when:

- the evidence path is missing or unsafe;
- the requested fact is not allowlisted;
- the requested status is not valid for the fact;
- the user asks the agent to mark a landmark directly;
- the requested action would perform an external legal or financial side effect;
- the case root is not in the trusted registry;
- the registry entry is not configured for the `paralegal` profile.
