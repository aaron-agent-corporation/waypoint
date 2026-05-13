# FirmVault Existing Case Adoption Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a Waypoint/FirmVault adoption layer that can inspect real legacy FirmVault case folders in mixed states, infer a conservative source-backed case state, and produce accurate next-action guidance without assuming the folder already matches Waypoint's ideal `.waypoint/firmvault` model.

**Architecture:** Add a read-only legacy case inspector first, then an adoption preview/initialize command that writes Waypoint state only through the existing safe state APIs. Guidance must distinguish evidence found, facts confidently satisfied, facts requiring human confirmation, and missing/blocked next actions.

**Tech Stack:** TypeScript in `packages/waypoint-folder-host`, CLI in `packages/waypoint-cli`, Vitest, local smoke scripts, existing FirmVault fact registry and state projection.

---

## Primary-source findings from real case corpus

Inspected root: `/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases`

Snapshot taken 2026-05-12.

- Case-like directories, excluding hidden/template dirs: **131**
- Existing Waypoint `.waypoint/firmvault` state dirs: **0**
- Legacy `state.yaml` files: **117**
- Top-level directories/files are heterogeneous but patterned:
  - `Activity Log`: 131
  - `wiki-agent`: 131
  - `documents`: 125
  - `contacts`: 121
  - `AGENTS.md`: 121
  - `state.yaml`: 117
  - `Dashboard.md`: 115
  - `claims`: 115
  - `CLAUDE.md`: 109
  - `claims.md`: 78
  - `liens`: 62
  - `liens.md`: 39
- File count buckets:
  - `6-25`: 9 cases
  - `26-100`: 37 cases
  - `101-500`: 53 cases
  - `500+`: 32 cases
  - no truly empty case folders were present in this corpus snapshot
- Corpus file types:
  - `.md`: 39,877
  - extensionless placeholder/import artifacts: 700
  - `.pdf`: 179
  - `.yaml`: 117
  - `.json`: 19
  - `.txt`: 19
  - `.docx`: 18
- Legacy `state.yaml.current_phase` distribution:
  - `phase_2_treatment`: 35
  - `phase_7_litigation`: 33
  - `phase_3_demand`: 17
  - `phase_4_negotiation`: 14
  - `phase_1_file_setup`: 14
  - `phase_8_closed`: 3
  - `phase_6_lien`: 1
- Markdown frontmatter is rich enough for adoption heuristics:
  - markdown with frontmatter: 38,306
  - markdown without/bad frontmatter: 261
  - common frontmatter keys include `case_slug`, `document_category`, `document_type`, `document_date`, `source_file`, `source_hash`, `category`, `status`, `records_received`, `bills_received`, `treatment_status`, `claim_type`, `holder_name`.
- Document category values observed include:
  - `correspondence`: 2,673
  - `financial`: 2,525
  - `medical`: 2,461
  - `court-filings`: 1,510
  - `other`: 1,485
  - `legal`: 1,010
  - `insurance`: 1,003
  - `photos`: 733
  - `police-reports`: 548
- Legacy state is useful but cannot be blindly trusted:
  - all 117 legacy `state.yaml` files mark `client_info_received`, `contract_signed`, `medical_auth_signed`, and `full_intake_complete` true;
  - only 117/131 cases have `state.yaml` at all;
  - many sparse cases have source document files but no legacy state;
  - existing legacy landmarks do not match the current 82-landmark Waypoint state model.

## Representative case shapes found

### Sparse source-backed case

Example: `amaree-stewart-premise-06-17-2022`

- 14 files, all markdown
- top level includes only `Activity Log`, case summary md, two source gap files, `documents`, `wiki-agent`
- no `state.yaml`
- one document under `documents/liens/...`

Adoption implication: do not treat absence of `state.yaml` as empty. The inspector must still classify source documents and produce blocked/missing guidance.

### File setup / early treatment case

Example: `brandon-robinson-jr`

- legacy `state.yaml`
- documents organized into `correspondence`, `financial`, `insurance`, `legal`, `medical`, `other`, `photos`, `police-reports`
- claims and contacts exist
- activity log exists

Adoption implication: can likely bootstrap case setup/intake/claims evidence, but must still validate evidence paths and avoid raw legacy landmark import.

### Demand-stage case

Example: `abigail-whaley`

- `current_phase: phase_3_demand`
- has `demand/readiness.md`, claims, liens, medical/docs, activity log, contacts

Adoption implication: adoption preview should detect demand artifacts and show what legal facts can be proposed versus what needs human confirmation before satisfying demand landmarks.

### Negotiation / large historical case

Example: `amy-mills`

- 1,785 files
- heavy historical activity log and document corpus
- many markdown records under `documents/*`

Adoption implication: adoption must be streaming/index-based and should not load full case contents into memory or prompt context.

### Litigation case

Example: `abby-sitgraves`

- `current_phase: phase_7_litigation`
- litigation PDFs and report artifacts exist
- medical/insurance/liens/contact docs present

Adoption implication: current Waypoint PI facts need an explicit litigation adoption rail instead of forcing all litigation cases through pre-suit demand/settlement assumptions.

### Legacy closed case

Examples: `ashlee-williams`, `elizabeth-lindsey`, `jeremy-lindsey`

- `current_phase: phase_8_closed`
- existing state marks closed phase, but close-case artifacts vary

Adoption implication: closed status should become an adoption proposal requiring closeout evidence confirmation, not an automatic `case_closed` fact.

## Product principle

Existing customers will not start with ideal Waypoint folders. The product needs an adoption workflow:

1. inspect a folder as-is;
2. classify folder shape and available source evidence;
3. preview conservative state proposals;
4. let a human/paralegal accept proposals;
5. write `.waypoint/firmvault/*.yaml` via safe APIs only;
6. run normal `waypoint firmvault guidance` afterward.

## Non-goals for this slice

- No OCR or document splitting. The external document pipeline owns that.
- No external webhooks, Forgejo side effects, emails, faxes, calls, or trust-account actions.
- No direct raw YAML edits to `.waypoint/firmvault/*.yaml`.
- No blanket import of legacy `state.yaml.landmarks` as truth.
- No attempt to read every document body into an LLM prompt.

---

## Task 1: Add legacy case inspection types and scanner

**Objective:** Read a case folder and return a compact structural inventory without mutating state.

**Files:**
- Create: `packages/waypoint-folder-host/src/firmvault/adoption.ts`
- Test: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`
- Modify export: `packages/waypoint-folder-host/src/index.ts`

**Step 1: Write failing tests**

Create fixtures in temp dirs that cover:

- sparse case with no `state.yaml` but one source-backed document;
- legacy case with `state.yaml`, `Dashboard.md`, `claims`, `contacts`, `documents`;
- large-looking case with many files but no `.waypoint`.

Expected inspector result:

- `mutates_state: false`
- `case_root`
- `case_slug`
- `legacy_state.present`
- `legacy_state.current_phase`
- `legacy_state.landmark_count`
- `source_counts.by_extension`
- `source_counts.by_top_level`
- `document_frontmatter.categories`
- `waypoint_state.present`
- warnings for missing `state.yaml` and missing source documents

**Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/adoption.test.ts
```

Expected: FAIL because `inspectFirmVaultLegacyCase` does not exist.

**Step 3: Implement scanner**

Implement:

```ts
export interface FirmVaultLegacyCaseInspection { ... }
export async function inspectFirmVaultLegacyCase(caseRoot: string): Promise<FirmVaultLegacyCaseInspection>
```

Rules:

- use `fs.promises` and path-safe traversal;
- skip `.waypoint`, `.obsidian`, `.git`, `node_modules`;
- count files by extension and top-level directory;
- parse only frontmatter headers from `.md` files, not entire documents;
- cap examples to avoid giant outputs;
- never mutate files.

**Step 4: Verify GREEN**

Run the same Vitest command. Expected: pass.

---

## Task 2: Add adoption preview facts

**Objective:** Convert inspection signals into conservative proposed FirmVault facts, with confidence and source paths.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/adoption.ts`
- Test: `packages/waypoint-folder-host/src/firmvault/adoption.test.ts`

**Step 1: Write failing tests**

Test proposals for:

- case setup when root case md / Dashboard / state exists;
- client intake when intake package or client documents exist;
- HIPAA authorization when `authorization`, `hipaa`, or medical authorization documents exist;
- insurance carrier identified when `claims/*.md` or insurance frontmatter exists;
- police report only when `police-reports` docs exist;
- treatment/records proposals from medical docs/provider files;
- litigation proposal from `litigation`, `legal-filings`, or `court-filings` docs;
- closed proposal from `phase_8_closed`, but requiring human confirmation unless closeout artifacts exist.

Each proposal must include:

- `fact`
- `suggested_status`
- `confidence: high|medium|low|needs_human_confirmation`
- `evidence_candidates`
- `reason`
- `safe_to_apply_automatically: boolean`

**Step 2: Verify RED**

Run adoption tests and confirm missing preview function.

**Step 3: Implement preview**

Implement:

```ts
export async function previewFirmVaultCaseAdoption(caseRoot: string): Promise<FirmVaultCaseAdoptionPreview>
```

Conservative rule:

- only `safe_to_apply_automatically: true` for facts backed by an existing specific source path;
- legacy phase/landmarks may raise confidence but cannot alone satisfy a fact;
- if evidence path is absent, emit blocked recommendation instead of proposal.

**Step 4: Verify GREEN**

Run adoption tests.

---

## Task 3: Add CLI preview command

**Objective:** Let an operator run adoption preview on any existing case folder.

**Files:**
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Test: `packages/waypoint-cli/src/commands/firmvault.test.ts`

**Command:**

```bash
waypoint firmvault adopt preview [--json]
```

**JSON output:**

```json
{
  "schema_version": 1,
  "mutates_state": false,
  "case_slug": "...",
  "legacy_phase": "phase_2_treatment",
  "waypoint_state_present": false,
  "source_summary": { ... },
  "proposed_facts": [ ... ],
  "blocked_or_needs_confirmation": [ ... ],
  "warnings": [ ... ]
}
```

**Human output:** concise stage summary and first 10 proposals.

**Verification:** targeted CLI test passes.

---

## Task 4: Add adoption initialize command using safe APIs

**Objective:** Create `.waypoint/firmvault` state for a legacy folder and optionally apply high-confidence proposals through `setFirmVaultCaseFact`.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/adoption.ts`
- Modify: `packages/waypoint-cli/src/commands/firmvault.ts`
- Test: adoption + CLI tests

**Command:**

```bash
waypoint firmvault adopt init [--case-type personal-injury] [--apply-safe] [--json]
```

Rules:

- call `initFirmVaultCaseState` first;
- if `--apply-safe` is omitted, do not apply facts;
- if `--apply-safe` is present, apply only proposals with `safe_to_apply_automatically: true`;
- all applied facts must go through `setFirmVaultCaseFact`;
- return before/after landmark counts and applied/skipped facts;
- append normal audit events.

**Verification:**

- `.waypoint/firmvault/events.jsonl` exists;
- applied evidence paths are relative and existing;
- `waypoint firmvault guidance --json` works afterward.

---

## Task 5: Add staged real-corpus smoke script

**Objective:** Run preview against representative real folders without mutating them, and run adoption init only in temporary copied fixtures.

**Files:**
- Create: `scripts/firmvault-existing-case-adoption-smoke.mjs`
- Modify: `package.json`

**Script behavior:**

- read corpus root from `FIRMVAULT_CASES_ROOT`, defaulting to the inspected local path;
- select cases from sparse, file setup, treatment, demand, negotiation, litigation, closed buckets;
- run `adopt preview --json` in place;
- copy one or more cases into temp dirs and run `adopt init --apply-safe --json` there;
- run `firmvault guidance --json` in the adopted temp dirs;
- assert no original corpus path gets a `.waypoint` directory.

**Package script:**

```json
"smoke:firmvault-existing-case-adoption": "node scripts/firmvault-existing-case-adoption-smoke.mjs"
```

---

## Task 6: Integrate adoption with guidance and recipes

**Objective:** Make guidance explain when a case needs adoption first, and later map missing facts to recipe candidates.

**Files:**
- Modify: `packages/waypoint-folder-host/src/firmvault/state.ts`
- Modify or create: `packages/waypoint-folder-host/src/firmvault/guidance-recipes.ts`
- Tests: state/guidance tests

Behavior:

- if `.waypoint/firmvault` is absent but legacy shape exists, guidance should say `stage: needs_adoption` and recommend `waypoint firmvault adopt preview`;
- after adoption, guidance uses normal state projection;
- return `recipe_candidates` for next actions where mappings are known;
- do not automatically run recipes in this slice.

---

## Required verification gates

Run before commit:

```bash
pnpm exec vitest run packages/waypoint-folder-host/src/firmvault/adoption.test.ts packages/waypoint-folder-host/src/firmvault/state.test.ts packages/waypoint-cli/src/commands/firmvault.test.ts
pnpm smoke:firmvault-staged-guidance
pnpm smoke:firmvault-existing-case-adoption
pnpm test
pnpm build
```

Only commit if the gates pass. Report real outputs from the same turn.

## Commit plan

Suggested commits:

1. `docs(firmvault): plan existing case adoption`
2. `feat(firmvault): inspect legacy case folders`
3. `feat(firmvault): preview existing case adoption`
4. `feat(firmvault): initialize adopted case state`
5. `test(firmvault): smoke existing case adoption`
6. `feat(firmvault): surface adoption guidance`
