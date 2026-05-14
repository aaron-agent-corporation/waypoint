# Waypoint Wizard

Waypoint Wizard turns arbitrary user file folders into a Waypoint-shaped, agent-friendly markdown shadow workspace. It is an adoption bridge, not a source-folder migration tool and not a legal-truth inference engine.

## Safety model

- Product name: Waypoint Wizard.
- User source files remain wherever they are and are treated as read-only inputs.
- Waypoint Wizard writes Waypoint-owned artifacts under the target case folder, primarily `.waypoint/shadows` and `.waypoint/wizard`.
- Markdown shadows are representations for agent review, not the real source documents.
- Each shadow frontmatter points back to the real source file with source path, sha256 hash, size, media metadata, and discovered timestamp.
- Shadows include PII masking metadata so agents know whether raw text was omitted, summarized, or masked.
- Shadows do not satisfy FirmVault legal facts by existing.
- FirmVault state remains explicit: legal progress comes only from approved safe state operations.
- No external side effects are performed by the Wizard: no emails, faxes, filings, payments, calls, API sends, settlements, disbursements, or trust actions.

## Command flow

From this repository, use the private development CLI by direct Node path or an installed `waypoint` alias.

```bash
waypoint wizard scan --source <source> --domain firmvault --json
waypoint wizard shadow --source <source> --target <case-root> --domain firmvault --json
waypoint wizard questions --case <case-root> --json
waypoint wizard answer --case <case-root> --question <id> --answer <text> --json
waypoint wizard plan --case <case-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
waypoint wizard apply --case <case-root> --plan .waypoint/wizard/adoption-plan.yaml --json
```

Direct source-run form:

```bash
repo=/Users/aaronwhaley/Github/waypoint
node "$repo/packages/waypoint-cli/src/bin.ts" wizard scan --source <source> --domain firmvault --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard shadow --source <source> --target <case-root> --domain firmvault --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard questions --case <case-root> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard answer --case <case-root> --question <id> --answer <text> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard plan --case <case-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard apply --case <case-root> --plan .waypoint/wizard/adoption-plan.yaml --json
```

## What each step does

### 1. Scan

`waypoint wizard scan` recursively inventories the source folder without writing to it. The scan returns deterministic file records with absolute source path, root-relative path, sha256, size, extension, and media hints.

### 2. Shadow

`waypoint wizard shadow` creates markdown shadows under:

```text
<case-root>/.waypoint/shadows/firmvault/...
```

The Wizard chooses a canonical shadow category from deterministic FirmVault filename/path classification. The source files are not reorganized.

### 3. Questions and answers

When classification or fact mapping is ambiguous, the Wizard creates one-question-at-a-time review prompts under `.waypoint/wizard/questions.yaml`. Use `wizard questions` to fetch the next pending question and `wizard answer` to persist the operator answer.

### 4. Plan

`waypoint wizard plan` writes a durable adoption plan under `.waypoint/wizard/adoption-plan.yaml`. The plan links source inventory, shadows, classifications, questions, answers, proposed FirmVault facts, missing documents, warnings, and approval state.

Proposed facts are review-only until explicitly approved in the plan. The Wizard does not treat shadows, filenames, folder names, or extracted text as legal truth by themselves.

### 5. Apply

`waypoint wizard apply` reads the adoption plan and applies only approved proposed facts through the existing FirmVault safe state APIs. This is an approval before apply workflow: unapproved proposed facts are skipped. After apply, run guidance to see the next legal/workflow action:

```bash
waypoint firmvault guidance --json
```

## Verification smoke

Run the end-to-end synthetic no-PII FirmVault Wizard smoke:

```bash
pnpm smoke:waypoint-wizard-firmvault
```

The smoke covers scan → shadow → questions → answer → plan → approved apply → FirmVault guidance and verifies the fixture source files were not mutated.
