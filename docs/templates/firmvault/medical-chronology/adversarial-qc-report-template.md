# Medical Chronology Adversarial QC Report Template

Case: `{case_name}`
Chronology package path: `{medical_chronology_output_path}`
Reviewer: `{reviewer}`
Date: `{YYYY-MM-DD}`
Decision: `PASS | FAIL | PASS WITH HUMAN QUESTIONS`

## Required checks

- [ ] Visual source-inspection ledger exists and was sampled/reviewed against rendered source pages.
- [ ] Chronology rows are grouped by date of service + provider/facility + encounter, not by file, packet, print, fax, or certification date.
- [ ] Each chronology row has exactly one independent extracted visit PDF.
- [ ] HTML source buttons point to consolidated visit PDFs and do not enumerate repeated provider productions.
- [ ] Master binder order is chronology first, then extracted visit PDFs in chronology order.
- [ ] Attorney-facing chronology/dashboard contains no process/meta notes.
- [ ] Billing, EOB, CMS/HCFA, fax covers, certification pages, and transmission artifacts are not clinical visits unless used only as support.
- [ ] Visit summaries are substantive and do not tell the reader to go read the records.

## Duplicate / merge audit

List suspected duplicate rows, duplicate source files, same-date/provider merges, continuation pages, certified-packet repeats, and billing-only materials.

## Missed-visit audit

List source dates/providers visible in source pages but absent from the chronology, with page references and whether the issue is a required fix or a human question.

## Source-link and binder audit

Record row count, source-button count, extracted visit PDF count, timeline page count, binder page count, and broken/missing links.

## Attorney-facing cleanliness audit

Scan for and remove visible build-process language, including `fresh start pass`, `restart pass`, `inventoried`, `prior output`, source inventory counts, and agent process notes.

## Required fixes

1. `{row/source}` — `{fix}` — `{evidence}`

## One-question-at-a-time human questions

1. `{question}`
