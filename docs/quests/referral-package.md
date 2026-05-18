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
5. if medical records are present, run the FirmVault medical chronology/binder workflow and independent chronology QC;
6. draft a `START_HERE` attorney case dashboard and package index that link the chronology artifacts from the Medical section;
7. run package QC, including medical chronology artifact checks when medical records are present; and
8. stop at `attorney-handoff-gate` for human approval before any attorney-facing handoff.

The intended operator UX is intentionally short: `Create a referral package for <folder>`. The Quest and its Recipes carry the detailed medical chronology/binder rules so the operator does not have to paste them into the prompt.

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
- `firmvault-medical-chronology-update` — when medical records are present, build the visit-level medical chronology/binder package with one extracted visit PDF per chronology row, deduplicated source buttons, chronology-first binder ordering, and no process/meta language in attorney-facing output.
- `firmvault-medical-chronology-adversarial-qc` — independently QC visual source inspection, visit-level consolidation, extracted visit PDFs, deduplicated source links, binder order, layout, and attorney-facing cleanliness before package dashboard/QC.
- `referral-package-start-here-builder` — draft the attorney case dashboard, source-backed case summary, inclusive timeline, medical chronology links, document navigator, and unresolved-item list.
- `referral-package-package-qc` — block/approve readiness for the human handoff gate based on completeness, traceability, and safety.

## START_HERE dashboard template

The `referral-package-start-here-builder` Recipe should give agents a reusable dashboard format to fill in, not a blank “overview” prompt:

- start directly with the case header and attorney-useful vitals; do not copy fake screenshot chrome such as Tasks, Feed, Search, hamburger menus, or nonfunctional top navigation;
- use left-side category navigation: Case Summary, Insurance, Medical, Liens, Expenses, Litigation, Timeline, Documents;
- structure Case Summary as `Summary of facts`, `Current status`, and `Summary of medicals`;
- use saved docket/court materials for current status when present, rather than a generic red “verify docket/deadlines” warning;
- keep the medical summary broad enough to include treatment, providers, medical records, provider bills, payment ledgers, itemizations, and special-damages totals;
- when chronology output exists, link the chronology markdown, `medical-chronology.html` quick-review accordion, timeline PDF, master binder PDF, and audit reports from the Medical section / chronology review aid;
- when medical records are present, package QC must treat `medical-chronology-update` and `medical-chronology-adversarial-qc` as part of the referral package path, including one extracted visit PDF per chronology row and source buttons pointing to consolidated visit PDFs;
- include Activity Log entries in the Timeline when an `Activity Log/` folder is available;
- name liability/photo evidence descriptively from visible content instead of retaining hash-style names.

## Safety boundaries

- source folders remain read-only by default.
- The Quest may create or reason over shadows/copies only when an explicit host command supports that mode.
- The output does not satisfy FirmVault legal facts or landmarks.
- FirmVault state remains explicit and can only change through approved FirmVault state APIs or Wizard approved apply.
- Ambiguous files become questions or quarantine/checklist items, not forced classifications.
- No external side effects: no emails, faxes, filings, payments, calls, API actions, trust actions, or attorney-facing delivery.

## Current implementation scope

This initial port installs the Quest/Recipe catalog and operator guide. It does not yet implement deterministic PDF splitting, OCR, source-folder copying, or a dedicated referral-package CLI. Those belong to later implementation phases after the catalog shape is accepted.
