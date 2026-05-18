# Agile Delivery BMAD Quest Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a BMAD-derived software-delivery methodology as a formal folder-settable Waypoint Quest without using BMAD as a Waypoint product name or embedding the BMAD runtime.

**Architecture:** Waypoint remains the product/runtime. The new Quest is presented publicly as **Agile Delivery** with slug `agile-delivery`; BMAD/BMad Method is preserved only as source attribution and compatibility/provenance metadata. The first implementation ports BMAD's methodology catalog into Waypoint Quest/Recipe manifests and starter-menu docs; it does not execute BMAD's installer, module runtime, or external side-effect workflows.

**Tech Stack:** TypeScript, YAML Quest/Recipe manifests, folder-host catalog loader, CLI Quest listing, Vitest, docs smoke tests, built import verification.

---

## Source evidence inspected

- Waypoint repo: `/Users/aaronwhaley/Github/active projects/waypoint`
- BMAD source folder: `/Users/aaronwhaley/Github/BMAD-METHOD-main`
- BMAD source files inspected:
  - `README.md`
  - `package.json`
  - `LICENSE`
  - `TRADEMARK.md`
  - `bmad-modules.yaml`
  - `src/core-skills/module.yaml`
  - `src/bmm-skills/module.yaml`
  - `src/bmm-skills/module-help.csv`
  - representative skills under `src/bmm-skills/**`
- Waypoint catalog files inspected:
  - `packages/waypoint-cli/src/commands/quests.ts`
  - `src/quests/manifest.ts`
  - `docs/waypoint-quest-catalog.md`
  - prior plan `docs/plans/2026-05-17-quest-starter-naming-and-gstack-plan.md`

Observed BMAD facts from source:

- `package.json` reports:
  - package name: `bmad-method`
  - version: `6.7.0`
  - license: `MIT`
  - description: `Breakthrough Method of Agile AI-driven Development`
  - author: `Brian (BMad) Madison`
- `README.md` presents BMAD as:
  - “Build More Architect Dreams”
  - “AI-driven agile development”
  - “Complete Lifecycle — From brainstorming to deployment”
- `src/bmm-skills/module.yaml` describes the core module as:
  - `Full-lifecycle AI agile development: analysis, planning, architecture, implementation`
- `src/bmm-skills/module-help.csv` contains 31 menu rows and a clean phase model:
  - `1-analysis`
  - `2-planning`
  - `3-solutioning`
  - `4-implementation`
- Local `/Users/aaronwhaley/Github/BMAD-METHOD-main` did not return git log output during inspection, so attribution must cite source path + package/version/license/trademark files, not a local commit hash.

---

## Naming and trademark rule

**Do not call the public Waypoint Quest “BMAD,” “BMad,” or “BMad Method.”**

Reason: `LICENSE` and `TRADEMARK.md` state that BMAD/BMad/BMad Method/BMad Core/BMad Code marks are trademarks of BMad Code, LLC and that the MIT license applies to software code, not brand identity.

Correct usage in Waypoint:

- Public Quest name: **Agile Delivery**
- Public slug: `agile-delivery`
- Provenance metadata: “Adapted from BMad Method concepts/source files.”
- Docs wording: “Inspired by / adapted from BMad Method; not an official BMAD product and not endorsed by BMad Code, LLC.”
- Recipe slugs may use a source prefix such as `agile-delivery-*` publicly. Avoid `bmad-*` in user-facing starter menus unless it is strictly source/provenance metadata.

---

## Starter Quest positioning

The folder setup menu should present these primary starter Quests:

1. **FirmVault** — legal case workflow for personal-injury matter folders.
2. **Project Delivery** — GSD-derived general project delivery workflow.
3. **Product Sprint** — gstack-derived founder/product/team sprint workflow.
4. **Agile Delivery** — BMAD-derived structured agile software lifecycle.

Suggested assistant language when a user asks to set up a folder:

> I can set up this folder with a Waypoint Quest. Current starter options are FirmVault, Project Delivery, Product Sprint, and Agile Delivery. Agile Delivery is best when you want a structured software lifecycle: analysis, PRD, UX, architecture, epics/stories, sprint execution, QA, and retrospective.

---

## Assessment: is BMAD a good Quest candidate?

Yes. BMAD maps extremely cleanly to Waypoint's Quest/Recipe model because it already contains:

- a phase taxonomy;
- required and optional workflow rows;
- output-location hints;
- predecessor/follow-up hints;
- agent roster metadata;
- skill directories with prompts, steps, templates, and checklists.

BMAD should be adapted as a **Waypoint Quest + Recipe catalog**, not as a runtime dependency.

### What to port first

Port the core BMAD Method flow from `src/bmm-skills/module-help.csv` into an `agile-delivery` starter Quest.

Core required Recipes:

- `agile-delivery-prd` from `bmad-prd`
- `agile-delivery-architecture` from `bmad-create-architecture`
- `agile-delivery-epics-stories` from `bmad-create-epics-and-stories`
- `agile-delivery-readiness` from `bmad-check-implementation-readiness`
- `agile-delivery-sprint-planning` from `bmad-sprint-planning`
- `agile-delivery-create-story` from `bmad-create-story:create`
- `agile-delivery-dev-story` from `bmad-dev-story`

Useful first-wave optional Recipes:

- `agile-delivery-brainstorming` from `bmad-brainstorming`
- `agile-delivery-market-research` from `bmad-market-research`
- `agile-delivery-domain-research` from `bmad-domain-research`
- `agile-delivery-technical-research` from `bmad-technical-research`
- `agile-delivery-product-brief` from `bmad-product-brief`
- `agile-delivery-prfaq` from `bmad-prfaq`
- `agile-delivery-ux-design` from `bmad-create-ux-design`
- `agile-delivery-sprint-status` from `bmad-sprint-status`
- `agile-delivery-validate-story` from `bmad-create-story:validate`
- `agile-delivery-code-review` from `bmad-code-review`
- `agile-delivery-qa-automation` from `bmad-qa-generate-e2e-tests`
- `agile-delivery-retrospective` from `bmad-retrospective`
- `agile-delivery-correct-course` from `bmad-correct-course`
- `agile-delivery-quick-dev` from `bmad-quick-dev`

### What not to port first

Do not port in the first implementation slice:

- BMAD installer behavior (`npx bmad-method install`, `tools/installer/**`).
- BMAD module marketplace/registry behavior as a runtime dependency.
- Party mode / multi-agent live session behavior as an executing runtime.
- Network, deploy, publishing, or external side-effect actions.
- Any BMAD brand/logo assets into Waypoint UI/docs except plain-text attribution links.

---

## Target Quest manifest shape

Create:

- `quests/agile-delivery.yaml`

Skeleton:

```yaml
schema_version: 1
slug: agile-delivery
name: Agile Delivery
workflow: workflows/agile-delivery.yaml
description: Structured agile software delivery Quest adapted from BMad Method source concepts.
recipes:
  - agile-delivery-brainstorming
  - agile-delivery-product-brief
  - agile-delivery-prfaq
  - agile-delivery-prd
  - agile-delivery-ux-design
  - agile-delivery-architecture
  - agile-delivery-epics-stories
  - agile-delivery-readiness
  - agile-delivery-sprint-planning
  - agile-delivery-create-story
  - agile-delivery-validate-story
  - agile-delivery-dev-story
  - agile-delivery-code-review
  - agile-delivery-qa-automation
  - agile-delivery-retrospective
metadata:
  waypoint:
    quest_family: primary_starter
    public_name: Agile Delivery
    selection_summary: Structured software lifecycle from analysis through PRD, architecture, epics/stories, sprint execution, QA, and retrospective.
    source_family: bmad-method
  source:
    project: bmad-method
    package: bmad-method
    version: 6.7.0
    path: /Users/aaronwhaley/Github/BMAD-METHOD-main
    license: MIT
    trademark_notice: BMAD/BMad/BMad Method are trademarks of BMad Code, LLC; Waypoint uses this only as attribution/provenance.
scaffolds:
  workstreams:
    - key: software
      name: Agile Delivery
      milestones:
        - version_label: v1
          title: Agile software delivery lifecycle
          phases:
            - phase_key: "10"
              phase_slug: analysis
              lifecycle_phase: analysis
              plans:
                - plan_ref: analysis-brainstorm
                  title: Brainstorm and clarify the product idea
                - plan_ref: analysis-research
                  title: Research market, domain, and technical context
                - plan_ref: analysis-brief-or-prfaq
                  title: Produce product brief or PRFAQ
            - phase_key: "20"
              phase_slug: planning
              lifecycle_phase: planning
              plans:
                - plan_ref: planning-prd
                  title: Create, edit, and validate PRD
                - plan_ref: planning-ux
                  title: Create UX design when UI is in scope
            - phase_key: "30"
              phase_slug: solutioning
              lifecycle_phase: solutioning
              plans:
                - plan_ref: solutioning-architecture
                  title: Create architecture
                - plan_ref: solutioning-epics-stories
                  title: Create epics and stories
                - plan_ref: solutioning-readiness
                  title: Check implementation readiness
            - phase_key: "40"
              phase_slug: implementation
              lifecycle_phase: implementation
              plans:
                - plan_ref: implementation-sprint-planning
                  title: Plan sprint execution
                - plan_ref: implementation-story-cycle
                  title: Create, validate, develop, review, and test stories
                - plan_ref: implementation-retrospective
                  title: Capture retrospective and course corrections
```

Notes:

- `workflows/agile-delivery.yaml` may be a placeholder/non-executing route definition at first if the current folder host only needs manifest/catalog scaffolding.
- Do not mark any side-effecting ship/deploy behavior as autonomous. If a later BMAD-derived ship workflow is added, gate external actions explicitly.

---

## Recipe manifest pattern

Create Recipes under:

- `recipes/agile-delivery/*.yaml`

Each Recipe should include:

```yaml
schema_version: 1
slug: agile-delivery-prd
name: Agile Delivery PRD
version: 1
runtime:
  supports_discussion: true
  supports_autonomous: false
source:
  project: bmad-method
  package: bmad-method
  version: 6.7.0
  source_skill: bmad-prd
  source_path: src/bmm-skills/2-plan-workflows/bmad-prd/SKILL.md
  license: MIT
  trademark_notice: BMAD marks are source attribution only; this is not an official BMAD product.
tools: []
prompt: |
  Ported/adapted from BMAD Method source skill bmad-prd.
  Preserve the source workflow intent, but enforce Waypoint safety boundaries:
  - produce drafts, questions, plans, and review items;
  - do not execute external side effects;
  - ask one question at a time when input is ambiguous;
  - keep all folder source files read-only unless an explicit approved copy/write task is in scope.
```

For first implementation, do not try to fully transcribe every asset/checklist by hand. Use a helper script only after adding tests that verify:

- required source skill files exist;
- generated recipe manifests parse;
- every `quests/agile-delivery.yaml` recipe reference resolves;
- source attribution fields exist for every generated recipe.

---

## TDD implementation tasks

### Task 1: Add RED catalog test for Agile Delivery starter

**Objective:** Prove the new Quest is missing before adding manifests.

**Files:**

- Modify test: `packages/waypoint-folder-host/src/catalog/bundled.test.ts`
- Or create test: `src/__tests__/agile-delivery-quest.test.ts`

**Step 1: Write failing test**

Assert:

- bundled catalog has quest `agile-delivery`;
- quest name is `Agile Delivery`;
- `metadata.waypoint.quest_family === 'primary_starter'`;
- quest recipes include the required core list;
- all recipe references resolve.

**Step 2: Run RED**

```bash
pnpm exec vitest run src/__tests__/agile-delivery-quest.test.ts
```

Expected: FAIL because `agile-delivery` does not exist.

**Step 3:** Commit nothing yet.

---

### Task 2: Add minimal Agile Delivery Quest manifest

**Objective:** Add the Quest scaffold and metadata without recipe bodies yet.

**Files:**

- Create: `quests/agile-delivery.yaml`
- Create if required: `workflows/agile-delivery.yaml`

**Step 1:** Add the Quest manifest shown above.

**Step 2:** Add a minimal workflow definition only if the parser/catalog requires the referenced workflow to exist.

**Step 3:** Run targeted test.

```bash
pnpm exec vitest run src/__tests__/agile-delivery-quest.test.ts
```

Expected: still FAIL until recipe manifests exist.

---

### Task 3: Add first-wave Recipe manifests

**Objective:** Add source-backed Recipe manifests for the required core and first-wave optional BMAD workflows.

**Files:**

- Create: `recipes/agile-delivery/*.yaml`
- Optionally create helper: `scripts/port-bmad-method-recipes.py`

**Step 1:** If using a helper script, write it so it reads:

- `src/bmm-skills/module-help.csv`
- source `SKILL.md` paths under `/Users/aaronwhaley/Github/BMAD-METHOD-main/src/bmm-skills/**`

**Step 2:** Generate or hand-create manifests with source metadata.

**Step 3:** Run parser/resolution tests.

```bash
pnpm exec vitest run src/__tests__/agile-delivery-quest.test.ts packages/waypoint-folder-host/src/catalog/bundled.test.ts
```

Expected: PASS.

**Step 4:** Commit:

```bash
git add quests/agile-delivery.yaml workflows/agile-delivery.yaml recipes/agile-delivery src/__tests__/agile-delivery-quest.test.ts packages/waypoint-folder-host/src/catalog/bundled.test.ts
git commit -m "feat(quests): add agile delivery starter quest"
```

---

### Task 4: Update starter menu and docs

**Objective:** Present Agile Delivery as a primary starter Quest alongside FirmVault, Project Delivery, and Product Sprint.

**Files:**

- Modify: `docs/waypoint-folder-host.md`
- Modify: `docs/waypoint-quest-catalog.md`
- Modify: any Quest catalog docs tests under `src/__tests__/*docs*.test.ts`
- Possibly modify: `README.md`

**Step 1:** Add docs smoke expectations before editing docs.

Assertions:

- Docs list `Agile Delivery` as a starter Quest.
- Docs state BMAD is source attribution only / not official endorsement.
- Docs do not present “BMAD” as the public Quest/product name.

**Step 2:** Run RED docs test.

```bash
pnpm exec vitest run src/__tests__/waypoint-docs.test.ts src/__tests__/folder-host-docs.test.ts
```

Expected: FAIL until docs are updated.

**Step 3:** Update docs.

**Step 4:** Run GREEN docs test.

```bash
pnpm exec vitest run src/__tests__/waypoint-docs.test.ts src/__tests__/folder-host-docs.test.ts
```

Expected: PASS.

---

### Task 5: Add CLI/catalog starter-menu coverage

**Objective:** Ensure `waypoint quests` lists Agile Delivery in primary starter Quests.

**Files:**

- Modify: `packages/waypoint-cli/src/commands/quests.test.ts` or existing CLI catalog test file.
- Modify only if required: `packages/waypoint-cli/src/commands/quests.ts`

**Step 1:** Add test asserting stdout includes:

```text
Primary starter Quests
- firmvault: FirmVault
- project-delivery: Project Delivery
- product-sprint: Product Sprint
- agile-delivery: Agile Delivery
```

Do not assert exact ordering unless the catalog has deterministic sort semantics; if order matters, implement a stable sort intentionally.

**Step 2:** Run RED/GREEN.

```bash
pnpm exec vitest run packages/waypoint-cli/src/commands/quests.test.ts
```

Expected: PASS after manifests/docs are present, or FAIL first if ordering/sorting needs implementation.

---

### Task 6: Full validation and push

**Objective:** Verify the complete slice and push a clean `main`.

Run:

```bash
pnpm exec vitest run src/__tests__/agile-delivery-quest.test.ts packages/waypoint-folder-host/src/catalog/bundled.test.ts packages/waypoint-cli/src/commands/quests.test.ts
pnpm test
pnpm typecheck
pnpm build
pnpm verify:built-imports
git diff --check
git status --short --branch
git log --oneline -3
```

Then commit any remaining docs/test updates:

```bash
git add quests/agile-delivery.yaml workflows/agile-delivery.yaml recipes/agile-delivery docs src packages
git commit -m "feat(quests): add agile delivery starter quest"
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Report only the real commit sha and test output visible in that implementation turn.

---

## Safety boundaries

- BMAD source files are read-only inputs during porting.
- Waypoint must not execute BMAD installer/runtime commands as part of the Quest.
- The Quest can create plans, prompts, checklists, tasks, and review artifacts.
- External effects such as publishing, deploying, sending, or filing require explicit human approval and a Waypoint gate.
- Preserve source attribution and MIT license notices.
- Do not use BMAD trademarks as Waypoint product/Quest branding.

---

## Completion definition

This plan is complete when:

- `agile-delivery` loads as a bundled Quest.
- Its public name is `Agile Delivery`.
- It appears in primary starter Quest listing.
- Its Recipe references resolve.
- BMAD attribution/license/trademark metadata is present.
- Docs describe it accurately and avoid implying BMAD endorsement.
- Tests, typecheck, build, built-import verification, and diff-check pass.
- The implementation commit is pushed to `origin/main` and verified by matching local and remote shas.
