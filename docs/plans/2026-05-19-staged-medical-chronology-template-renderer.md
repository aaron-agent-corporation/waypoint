# Staged Medical Chronology Template Renderer Plan

Date: 2026-05-19
Repo: Waypoint standalone
Scope: Referral Package Quest / FirmVault medical chronology generation.

## Goal

Stop relying on an agent to hand-author final chronology HTML. The Quest should create the final chronology through deterministic stages:

1. identify every date of service / chronology row candidate;
2. collect/fill structured visit content for each row;
3. render final attorney-facing HTML/PDF/binder through a shared template renderer;
4. validate the rendered output and block if artifacts are missing or non-conforming.

The agent may reason over records and write structured data, but the final HTML structure is produced by code.

## Design principles

- Bills are a first-class starting point for dates of service because every billed visit should have a DOS and billing support is needed anyway.
- Medical records remain the source for clinical substance; bills seed/check the DOS ledger, not clinical summaries.
- The Quest should pass structured JSON between stages, not prose-only handoffs.
- The renderer owns layout. Agents fill fields; they do not design HTML.
- Attorney-facing output must match the Livers-style template: visit-card structure, Visit Summary first, clinical details in a consistent grid/accordion, source links to consolidated visit PDFs, and no process/meta text.
- Missing or ambiguous dates/visits become review questions or blocked artifacts, not fabricated rows.

## Proposed pipeline

### C1 — DOS ledger extraction

Create a structured ledger artifact:

`03-medical/medical-chronology-output/reports/date-of-service-ledger.json`

Suggested schema:

```json
{
  "schema_version": 1,
  "case": { "case_slug": "", "client_name": "" },
  "generated_from": {
    "bill_sources": [],
    "medical_record_sources": []
  },
  "dates_of_service": [
    {
      "dos": "YYYY-MM-DD",
      "provider": "",
      "facility": "",
      "encounter_key": "YYYY-MM-DD::provider-or-facility::encounter",
      "source_basis": ["bill", "medical_record"],
      "bill_sources": [
        { "path": "", "pages": [], "amount": null, "confidence": "high|medium|low" }
      ],
      "record_sources": [
        { "path": "", "pages": [], "confidence": "high|medium|low" }
      ],
      "status": "ready_for_visit_summary|needs_record_match|needs_review",
      "question": null
    }
  ]
}
```

Rules:

- Start from bills/itemizations/payment ledgers where available.
- Cross-check against medical record dates.
- Deduplicate by true DOS + provider/facility + encounter.
- Keep hospital/multi-provider same-day care as one date-level encounter unless records prove separate encounters.
- Do not exclude a DOS for relatedness reasons; mark uncertainty separately.

Gate: every chronology row must originate in the DOS ledger or be explicitly added with source evidence and reason.

### C2 — Visit content fill

Create one structured content artifact fed by the DOS ledger:

`03-medical/medical-chronology-output/reports/visit-content.json`

Suggested schema:

```json
{
  "schema_version": 1,
  "visits": [
    {
      "encounter_key": "YYYY-MM-DD::provider-or-facility::encounter",
      "dos": "YYYY-MM-DD",
      "provider": "",
      "facility": "",
      "chronology_treatment": "",
      "visit_summary": "",
      "history_narrative": "",
      "complaints": [],
      "tests": [],
      "diagnoses": [],
      "prescriptions_new": [],
      "plan": [],
      "source_visit_pdf": "extracted-visit-pdfs/YYYY-MM-DD-provider-visit.pdf",
      "supporting_sources": [
        { "path": "", "pages": [], "role": "clinical|bill|support|duplicate" }
      ],
      "confidence": "high|medium|low",
      "review_questions": []
    }
  ]
}
```

Rules:

- Agent fills clinical fields as text/arrays only.
- Source text, OCR snippets, filenames, page numbers, build notes, and citations stay in internal reports, not visible attorney-facing fields.
- If the agent cannot fill a clinical field, use `N.A.` or a clearly bounded limitation in that field.
- Each visit must point to one consolidated extracted visit PDF.

### C3 — Deterministic template render

Add a shared renderer, likely in `packages/waypoint-folder-host/src/firmvault/medical-chronology/`, that takes `visit-content.json` and writes:

- `medical-chronology.html`
- `medical-chronology-timeline.pdf`
- `medical-chronology-master-binder.pdf`
- `reports/rendered-template-check.json`

Renderer responsibilities:

- Own all HTML/CSS/layout.
- Emit Livers-style `article.visit-card`, `visit-head`, `summary`, `details-grid`, `box`, `source-row` structure every time.
- Escape all text.
- Link to the consolidated visit PDF for each row.
- Keep process/meta/QC language out of attorney-facing HTML.
- Produce stable output from the same JSON input.

### C4 — Validation and Quest gating

Extend the existing chronology-template validator so it validates:

- `date-of-service-ledger.json` exists and parses.
- `visit-content.json` exists and every rendered card maps to one visit row.
- every visit has one source PDF and the link resolves.
- no extra/missing rendered chronology rows compared with `visit-content.json`.
- forbidden process/meta strings are absent.

Quest should block on missing/invalid structured artifacts before package drafting and handoff.

## TDD implementation slices

1. RED: test that a non-template/ad hoc chronology builder is insufficient because required structured artifacts are absent.
2. GREEN: add schema/types/parser for DOS ledger and visit content.
3. RED: test renderer output from a fixture `visit-content.json` expects Livers-style fragments and escaped data.
4. GREEN: implement HTML renderer as a pure function/file writer.
5. RED: test autopilot blocks when `medical-chronology.html` has cards but no DOS ledger / visit content mapping.
6. GREEN: extend artifact validation to require structured artifacts and row parity.
7. RED/GREEN: wire Recipe/Quest metadata to require the staged artifacts.
8. End-to-end smoke: fixture case with bills + minimal medical records produces ledger → visit content → rendered chronology → QC gate.

## Verification gates

- `pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/medical-chronology packages/waypoint-folder-host/src/autopilot/run.test.ts`
- `pnpm exec vitest run src/__tests__/firmvault-recipe-port.test.ts src/__tests__/referral-package-quest.test.ts`
- `pnpm typecheck`
- Full `pnpm test` at phase boundary.

## Non-goals

- No direct mutation of FirmVault legal-state YAML.
- No external communication or attorney handoff automation.
- No agent-authored final HTML layout.
- No treating bill presence alone as clinical chronology substance.
