# Waypoint Wizard PRD

## Product

**Name:** Waypoint Wizard

**One-line definition:** Waypoint Wizard turns arbitrary user file folders into a Waypoint-shaped, agent-friendly markdown shadow workspace, then uses guided Q&A to map those shadows into approved workflow state, tasks, recipes, and handoffs.

## Why this exists

Users will not start with clean Waypoint folders. They will have real files in arbitrary locations with arbitrary names, formats, nesting, duplicates, scans, exports, and gaps.

Waypoint should not require users to reorganize their files before adoption. It also should not infer workflow or legal truth directly from messy file paths. The product gap is a bridge between:

```text
user-owned arbitrary files
```

and:

```text
Waypoint-owned structured workflow state
```

The bridge is not copying all real files into a canonical case folder. The bridge is a **markdown shadow layer**: Waypoint creates organized markdown representations of user files, masks or summarizes sensitive material, preserves pointers to the real source files in frontmatter, and asks clarifying questions before applying workflow/legal state.

## North-star user story

A user says:

> I want to use Waypoint on this folder, but my files do not look like Waypoint files.

Waypoint Wizard should let an agent or CLI run:

```bash
waypoint wizard scan --source /path/to/user/files --domain firmvault --json
waypoint wizard shadow --source /path/to/user/files --target /path/to/waypoint-case --domain firmvault --json
waypoint wizard questions --case /path/to/waypoint-case --json
waypoint wizard answer --case /path/to/waypoint-case --question <id> --answer <text> --json
waypoint wizard plan --case /path/to/waypoint-case --json
waypoint wizard apply --case /path/to/waypoint-case --json
```

And produce:

```text
real user files anywhere on disk
  -> markdown shadows under the Waypoint case
  -> source pointers + hashes in frontmatter
  -> PII masking/summaries
  -> canonical Waypoint organization
  -> one-question-at-a-time clarification
  -> durable adoption plan
  -> approved state mutations only
  -> post-adoption guidance
```

## Goals

1. **Accept arbitrary user file structure**
   - User source files can live anywhere.
   - Waypoint does not require source folders to match Waypoint conventions.
   - Source folders are not mutated by default.

2. **Create markdown shadows**
   - Every imported source document gets a Waypoint-owned markdown shadow.
   - Shadows live in a canonical Waypoint organization.
   - Shadows contain frontmatter pointing back to the real file.
   - Shadows can include masked text, summaries, extracted metadata, classification, and proposed mappings.

3. **Support PII masking and safe agent work**
   - Agents should primarily work on markdown shadows, not raw source files.
   - Shadows can omit, redact, or summarize sensitive content.
   - Source path and hash preserve auditability without exposing full raw contents in every agent context.

4. **Use guided Q&A for ambiguity**
   - The Wizard should ask one question at a time when classification or mapping is ambiguous.
   - This should resemble the existing authoring/brainstorming model: inspect context, ask targeted questions, preserve answers, and use answers to update a plan.

5. **Preserve explicit truth boundaries**
   - File existence does not equal workflow progress.
   - A markdown shadow does not satisfy a legal fact by existing.
   - Legal/workflow state changes require approved state operations.
   - Landmarks remain projections from explicit state.

6. **Produce a durable adoption plan**
   - The plan links source files, shadows, classifications, questions, answers, proposed facts, missing documents, warnings, and approval state.
   - The plan is reviewable, repeatable, and safe to apply deterministically.

7. **Integrate with existing Waypoint primitives**
   - FirmVault facts, evidence validation, guidance, operator manifests, tool registry, handoffs, and authoring should all remain usable.
   - Wizard output should feed existing `firmvault state set` and `firmvault guidance` behavior instead of bypassing it.

## Non-goals

- Do not mutate the user source folder by default.
- Do not require source files to be copied into Waypoint's canonical document tree.
- Do not mark landmarks directly.
- Do not treat filenames, folder names, OCR text, or markdown summaries as legal truth by themselves.
- Do not send emails, faxes, filings, payments, or any external side effect.
- Do not build LLM/OCR-heavy extraction first. The first implementation can use safe deterministic text stubs and rule-based classification, with later adapters for richer extraction.
- Do not require FirmVault-only architecture. FirmVault is the first domain, but the Wizard should be domain-capable.

## Core concepts

### Source file

A real user-owned file. It may be anywhere on disk and may have any name or structure.

Example:

```text
/Users/user/Desktop/Messy Case/scan001.pdf
```

### Shadow file

A Waypoint-owned markdown representation of a source file.

Example:

```text
/path/to/waypoint-case/.waypoint/shadows/firmvault/intake/client-intake.md
```

The shadow is the agent-facing copy. It may include redacted text, summaries, classifications, proposed facts, and questions.

### Source pointer

Frontmatter metadata inside a shadow that points back to the real file and proves identity.

Minimum fields:

```yaml
source:
  path: /absolute/path/to/source/file.pdf
  sha256: <hash>
  size_bytes: 12345
  media_type: application/pdf
  discovered_at: 2026-05-14T00:00:00.000Z
```

### Adoption plan

A durable YAML/JSON artifact that records the Wizard's proposed bridge from source corpus to Waypoint state.

Suggested path:

```text
.waypoint/wizard/adoption-plan.yaml
```

### Clarification question

A one-question-at-a-time prompt persisted by the Wizard when it cannot safely decide a mapping.

Example:

```text
I found three documents that may be the signed fee agreement. Which one should support client.contracts.fee_agreement?
```

### Approved operation

A deterministic operation allowed to mutate Waypoint state, normally by calling existing safe APIs such as `firmvault state set`.

## Shadow file format

Each shadow is markdown with YAML frontmatter.

Example:

```markdown
---
schema_version: 1
shadow_type: document
domain: firmvault
source:
  path: /Users/user/Desktop/Messy Case/Scan 001.pdf
  sha256: abc123
  size_bytes: 482991
  media_type: application/pdf
  discovered_at: 2026-05-14T00:00:00.000Z
pii:
  masked: true
  strategy: local-redaction-v1
classification:
  kind: intake
  confidence: medium
  rationale: filename and extracted headings suggest an intake packet
waypoint:
  canonical_path: .waypoint/shadows/firmvault/intake/client-intake.md
  proposed_facts:
    - client.intake
review:
  status: pending
  questions:
    - intake-signed-or-draft
---
# Client Intake Shadow

Masked or summarized extracted content goes here.
```

## Wizard filesystem layout

Inside a Waypoint case:

```text
.waypoint/
  shadows/
    firmvault/
      intake/
      contracts/
      authorizations/
      accident/
      insurance/
      providers/
      medical-records/
      bills/
      liens/
      demand/
      negotiation/
      settlement/
      closing/
      correspondence/
      unknown/
  wizard/
    scan.json
    source-map.yaml
    questions.yaml
    answers.yaml
    adoption-plan.yaml
  firmvault/
    case.yaml
    client.yaml
    landmarks.yaml
    events.jsonl
```

## Domain model

The Wizard should have generic primitives and domain-specific adapters.

### Generic Wizard primitives

- file inventory
- source hashing
- shadow document schema
- safe path checks
- markdown/frontmatter writer
- question/answer persistence
- adoption plan schema
- approval/apply framework

### FirmVault adapter

- FirmVault shadow categories
- FirmVault classification rules
- FirmVault fact proposals
- FirmVault missing-document checklist
- FirmVault state apply using existing `firmvault state set`
- FirmVault guidance after apply

## Required CLI surface

Initial target commands:

```bash
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan <path>] [--json]
waypoint wizard apply --case <case-root> [--plan <path>] [--json]
```

FirmVault-specific aliases may be added later, but the generic `wizard` namespace is the product surface.

## User experience requirements

1. **Scan is read-only**
   - Produces file counts, type counts, duplicate warnings, unreadable warnings, and candidate counts.

2. **Shadow generation is local-only**
   - Writes only under the target Waypoint case.
   - Does not mutate source files.
   - Creates canonical shadow paths.
   - Preserves source pointers and hashes.

3. **Ambiguity creates questions**
   - Ambiguous classifications or fact mappings become persisted questions.
   - The system asks one question at a time.
   - Answers update the adoption plan.

4. **Apply is approval-bound**
   - Unapproved facts are not applied.
   - Apply calls safe state APIs, not raw YAML edits.
   - Apply reports exact operations and resulting guidance.

5. **Reports are source-backed**
   - Every proposed fact names a shadow and source path.
   - Every applied fact names the command/result that changed state.

## FirmVault-specific requirements

### Canonical shadow categories

Initial categories:

```text
intake
contracts
authorizations
accident
insurance
providers
medical-records
bills
liens
demand
negotiation
settlement
closing
correspondence
unknown
```

### Fact proposal rules

The Wizard may propose facts, but it may not apply them without approval.

Example proposal:

```yaml
proposed_facts:
  - fact: client.contracts.fee_agreement
    status: signed
    evidence_shadow: .waypoint/shadows/firmvault/contracts/fee-agreement.md
    source_path: /Users/user/Desktop/Messy Case/DocuSign Complete.pdf
    confidence: high
    review_required: true
    approved: false
```

### Legal truth boundary

- Shadows are evidence references, not legal state.
- Proposed facts are review items, not satisfied facts.
- Satisfied landmarks come only from `.waypoint/firmvault` state after approved state operations.

## Acceptance criteria

The first complete release of Waypoint Wizard is accepted when:

1. A messy fixture folder can be scanned without source mutation.
2. Markdown shadows are generated under `.waypoint/shadows/<domain>/...`.
3. Each shadow has frontmatter with source path, hash, PII metadata, classification metadata, and review status.
4. The Wizard produces persisted questions for ambiguous documents.
5. The Wizard records answers and updates an adoption plan.
6. The Wizard generates a FirmVault adoption plan with proposed facts and missing-document warnings.
7. Approved fact proposals can be applied through existing safe FirmVault state APIs.
8. Post-apply `firmvault guidance --json` shows updated stage/landmarks/next actions.
9. Tests prove source files are not mutated.
10. Tests prove shadows do not satisfy legal landmarks until approved state apply.
11. A smoke test proves messy folder -> shadows -> questions/answers -> adoption plan -> approved apply -> guidance.

## Risks

1. **False confidence from file names**
   - Mitigation: classification confidence + review-required defaults.

2. **PII leakage into agent context**
   - Mitigation: shadow layer with redaction metadata and masked content.

3. **Source path portability**
   - Mitigation: store absolute path, optional relative source root path, and sha256.

4. **Large folders**
   - Mitigation: inventory/index files; never load entire corpus into memory or prompt context.

5. **Direct-state bypass**
   - Mitigation: apply uses existing state APIs and tests assert no raw landmark mutation.

6. **Domain coupling**
   - Mitigation: generic Wizard core plus FirmVault adapter.

## Open questions

1. Should source paths in frontmatter be absolute only, or include both absolute and source-root-relative paths?
2. What should be the first PII masking strategy: deterministic regex redaction, stub summaries, or pluggable extractor?
3. Should Wizard questions live in one YAML file or one markdown file per question for agent discussion?
4. How should approvals be represented: boolean on proposed fact, answer-driven status, or explicit approval records?
5. Should `wizard apply` require a separate `--approve` flag or only apply facts marked approved in the plan?

## Product principle

Waypoint Wizard lets users keep their files where they are, while Waypoint creates the structure it needs.

The real files remain source evidence. The markdown shadows become the safe agent workspace. The adoption plan becomes the bridge. Approved state operations remain the only path to workflow/legal progress.
