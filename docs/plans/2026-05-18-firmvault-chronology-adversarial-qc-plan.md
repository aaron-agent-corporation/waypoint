# FirmVault Chronology Visual Inspection + Adversarial QC Plan

Date: 2026-05-18
Repo: Waypoint standalone
Scope: FirmVault Quest and Recipes only; no Douglas Livers package regeneration in this slice.

## Problem

The current medical chronology Recipe can pass mechanical output gates while still producing a document-level chronology. That failed Aaron's requirement: source medical records must be visually inspected and consolidated by true date of service/provider/encounter, not by file, packet, OCR hit, or page.

## Goal

Harden the FirmVault Quest/Recipe layer so future chronology work requires:

1. visual source-document inspection before chronology row generation;
2. visit/date/provider grouping evidence before drafting summaries;
3. duplicate/continuation/certification/billing classification;
4. an independent adversarial review Recipe that checks the draft chronology against source images/records; and
5. a human gate after adversarial QC before attorney-facing handoff.

## Implementation slices

### CQC1 — Contract tests

Add failing tests proving the FirmVault catalog requires:

- `firmvault-medical-chronology-update` prompt contains mandatory visual-inspection and visit-grouping gates;
- chronology Recipe declares an adversarial subagent/Recipe handoff;
- new adversarial QC Recipe exists and contains explicit independent-check instructions;
- FirmVault Quest includes the QC Recipe and schedules it immediately after chronology generation, before human completion review.

### CQC2 — Recipe hardening

Patch `recipes/firmvault/medical-chronology-update.yaml` to make visual inspection non-optional:

- source PDFs/images must be reviewed visually enough to identify true DOS/provider/facility/encounter;
- rows must be generated from a grouping ledger, not source filenames;
- same-date/provider materials are combined;
- hospital same-date records are one encounter card with subparts where useful;
- certified packet/export/fax dates are rejected as DOS;
- visible summaries must be substantive and source-backed.

### CQC3 — Adversarial QC Recipe

Add `recipes/firmvault/medical-chronology-adversarial-qc.yaml`:

- separate reviewer posture;
- compares chronology rows to source visual grouping ledger and source docs;
- looks for missed visits, duplicate rows, packet-date mistakes, source-link failures, boilerplate summaries, and layout/readability issues;
- outputs pass/fail, required fixes, and one-question-at-a-time review questions;
- no external side effects and no legal landmark satisfaction.

### CQC4 — Quest wiring

Update `quests/firmvault.yaml`:

- add the QC Recipe slug to the Quest recipe list;
- insert a Recipe task after `firmvault-medical-chronology-update-task` and before `firmvault-records-bills-human-completion-review`;
- make human completion review depend conceptually on QC passing/being addressed.

## Verification gates

- RED: targeted test fails before manifest changes.
- GREEN: targeted test passes after manifest changes.
- Run affected catalog/Quest tests.
- Run `pnpm typecheck`.
- If time permits, run full `pnpm test`.

## Non-goals

- Do not rebuild the Douglas Livers chronology in this slice.
- Do not add runtime support for actually spawning external agents beyond manifest/subagent wiring.
- Do not mutate any case legal state or satisfy FirmVault landmarks from chronology output.
