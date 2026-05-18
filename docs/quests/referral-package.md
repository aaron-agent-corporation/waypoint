# Referral Package Quest

`referral-package` is a Waypoint Quest for assembling an attorney referral handoff package from messy case documents.

Waypoint is the runtime. **Referral Package** is the Quest name.

## Source attribution

This Quest is adapted from local `llm-lawyer` referral materials:

- SOP: `/Users/aaronwhaley/Github/llm-lawyer/docs/referrals/referral-package-and-document-naming-sop.md`
- Prompt: `/Users/aaronwhaley/Github/llm-lawyer/docs/referrals/prompts/document-reviewer.md`
- Schemas:
  - `/Users/aaronwhaley/Github/llm-lawyer/docs/referrals/schemas/document-review.schema.json`
  - `/Users/aaronwhaley/Github/llm-lawyer/docs/referrals/schemas/package-qc.schema.json`

## What it does

The Quest models a safe referral-package journey:

1. inventory messy source documents;
2. review documents and classify them with confidence;
3. propose split/segment boundaries for bundled packets;
4. propose canonical referral filenames and folders;
5. draft a `START_HERE` package overview and index;
6. run package QC; and
7. stop at `attorney-handoff-gate` for human approval before any attorney-facing handoff.

## How to inspect and start it

From a folder-host project:

```bash
waypoint quests
waypoint recipes --quest referral-package
waypoint init --quest referral-package
waypoint start --quest referral-package
waypoint tasks --route-id route-001
```

## Recipes

- `referral-package-document-reviewer` — review one document or shadow for type, entities, dates, facts, confidence, and safe handling notes.
- `referral-package-packet-segmenter` — propose source-backed splits for bundled packets without mutating the source file.
- `referral-package-filename-placement-reviewer` — review canonical filenames and package folder placement.
- `referral-package-start-here-builder` — draft the package overview, index, chronology, and unresolved-item list.
- `referral-package-package-qc` — block/approve readiness for the human handoff gate based on completeness, traceability, and safety.

## Safety boundaries

- source folders remain read-only by default.
- The Quest may create or reason over shadows/copies only when an explicit host command supports that mode.
- The output does not satisfy FirmVault legal facts or landmarks.
- FirmVault state remains explicit and can only change through approved FirmVault state APIs or Wizard approved apply.
- Ambiguous files become questions or quarantine/checklist items, not forced classifications.
- No external side effects: no emails, faxes, filings, payments, calls, API actions, trust actions, or attorney-facing delivery.

## Current implementation scope

This initial port installs the Quest/Recipe catalog and operator guide. It does not yet implement deterministic PDF splitting, OCR, source-folder copying, or a dedicated referral-package CLI. Those belong to later implementation phases after the catalog shape is accepted.
