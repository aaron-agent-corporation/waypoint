# FirmVault Workflow Port Map

This document explains the source-backed inventory in `docs/quests/firmvault-workflow-map.yaml` for the first FirmVault folder-host port slice.

## Source authority stack

- Primary executable source: `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-*.yaml`.
- Aggregate/legacy workflow source: `/Users/aaronwhaley/Github/Active Projects/mission-control/workflows/firmvault-workflows.yaml`.
- Passive landmark source for later phases: `/Users/aaronwhaley/Github/Active Projects/mission-control/src/lib/firmvault-passive-landmarks.ts`.

## Duplicate source rule

When a workflow exists both as a standalone executable YAML file and as an entry in the aggregate catalog, the map records both files and sets `source_priority: standalone_then_aggregate`. The standalone `workflows/firmvault-*.yaml` definition wins for executable node names and recipe bindings. The aggregate entry is retained because it preserves older roadmap/wave intent and trigger context.

## Part One scope

Part One includes Wave 0/1 onboarding and file-setup scaffolding in the installable `firmvault` Quest. Later workflows are mapped now so future waves can replace placeholders with source-backed recipes without re-discovering the Mission Control source set.

Included first-wave areas:

- case setup
- initial document collection
- accident report
- medical provider setup
- client check-in cadence

Deferred after Part One:

- insurance and treatment expansion
- records and bills request automation
- demand drafting/sending
- negotiation
- settlement, liens, distribution, and close

## Safety and verification

No external side effects are allowed in Part One. Placeholder recipes may draft local handoff artifacts, inspect local files, and write local Waypoint/FirmVault artifacts only; they must not send email, fax, portal messages, SMS, or otherwise contact outside parties.

Automated verification uses a temp FirmVault-style case folder. It must not touch a real client case folder, the operator home directory, or any external system.
