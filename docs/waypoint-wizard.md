# Waypoint Wizard

Waypoint Wizard turns arbitrary user file folders into a Waypoint-shaped, agent-friendly markdown shadow workspace. It is an adoption bridge, not a source-folder migration tool and not a domain-truth inference engine.

## Safety model

- Product name: Waypoint Wizard.
- User source files remain wherever they are and are treated as read-only inputs.
- Waypoint Wizard writes Waypoint-owned artifacts under the target folder, primarily `.waypoint/shadows` and `.waypoint/wizard`.
- Markdown shadows are representations for agent review, not the real source documents.
- Each shadow frontmatter points back to the real source file with source path, sha256 hash, size, media metadata, and discovered timestamp.
- Shadows include PII masking metadata so agents know whether raw text was omitted, summarized, or masked.
- Shadows do not satisfy domain facts by existing. Waypoint is domain-agnostic: any state change in a host domain system goes through that host's own reviewed APIs, never through the Wizard.
- The Wizard performs no external side effects: no emails, filings, payments, calls, or API sends.

## Command flow

From this repository, use the CLI by direct Node path or an installed `waypoint` alias. `--domain` is a free-form label that namespaces the shadow tree (for example `documents`).

```bash
waypoint wizard scan --source <source> --domain <domain> --json
waypoint wizard shadow --source <source> --target <target-root> --domain <domain> --json
waypoint wizard organize --source <source> --target <target-root> --domain <domain> --copy-files --json
waypoint wizard questions --case <target-root> --json
waypoint wizard answer --case <target-root> --question <id> --answer <text> --json
waypoint wizard plan --case <target-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
```

Direct source-run form:

```bash
repo=/path/to/waypoint
node "$repo/packages/waypoint-cli/src/bin.ts" wizard scan --source <source> --domain <domain> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard shadow --source <source> --target <target-root> --domain <domain> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard organize --source <source> --target <target-root> --domain <domain> --copy-files --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard questions --case <target-root> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard answer --case <target-root> --question <id> --answer <text> --json
node "$repo/packages/waypoint-cli/src/bin.ts" wizard plan --case <target-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
```

## What each step does

### 1. Scan

`waypoint wizard scan` recursively inventories the source folder without writing to it. The scan returns deterministic file records with absolute source path, root-relative path, sha256, size, extension, and media hints.

### 2. Shadow

`waypoint wizard shadow` creates markdown shadows under:

```text
<target-root>/.waypoint/shadows/<domain>/...
```

The Wizard chooses a shadow category from deterministic filename/path classification for the given domain. The source files are not reorganized.

### 3. Organize

`waypoint wizard organize` creates a clean Waypoint-owned document package from a messy source folder. It runs scan and shadow creation, writes a canonical document tree, source manifest, organization plan, organize report, and missing-document checklist. By default it does not copy source files; with `--copy-files`, files are copied into deterministic `documents/<category>/...` paths under the target root.

Ambiguous or low-confidence files stay in `documents/unknown/` and produce one-question-at-a-time Wizard questions instead of being forced into a category.

Organization is not domain truth. Clean folders, copied files, and shadows satisfy zero domain facts by themselves; `domain_facts_from_organization` is explicitly `forbidden`.

### 4. Questions and answers

When classification or fact mapping is ambiguous, the Wizard creates one-question-at-a-time review prompts under `.waypoint/wizard/questions.yaml`. Use `wizard questions` to fetch the next pending question and `wizard answer` to persist the operator answer.

### 5. Plan

`waypoint wizard plan` writes a durable adoption plan under `.waypoint/wizard/adoption-plan.yaml`. The plan links source inventory, shadows, classifications, questions, answers, proposed domain facts, missing documents, warnings, and approval state. When an organized package exists, the plan also carries the canonical document path and copied evidence path from `.waypoint/wizard/organization-plan.yaml` so review can see both the markdown shadow and the copied source document.

Proposed facts are review-only until explicitly approved in the plan. The Wizard does not treat shadows, filenames, folder names, organized copied files, or extracted text as domain truth by themselves, and it does not apply anything: handing approved proposals to a domain system's own state APIs is the host's responsibility.

## Verification

The wizard surface is covered by the CLI and core unit suites:

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/wizard.test.ts
pnpm exec vitest run src/wizard
```
