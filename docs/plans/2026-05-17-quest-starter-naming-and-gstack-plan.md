# Quest Starter Naming and gstack Product Sprint Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Cleanly separate Spine as the product/runtime name from bundled Quest names, then add a gstack-derived project-management Quest as a formal folder-settable starter Quest.

**Architecture:** Spine remains the system name. Bundled starter Quests carry independent method names: `firmvault`, `project-delivery`, and a new gstack-derived Quest such as `product-sprint`. The first gstack integration ports methodology and role prompts into Quest/Recipe manifests; it does not embed or execute gstack's Claude Code/browser/runtime machinery.

**Tech Stack:** TypeScript, YAML Quest/Recipe manifests, folder-host catalog loader, CLI catalog commands, Vitest, direct Node CLI smokes.

---

## Source evidence inspected

- Spine repo: `/Users/aaronwhaley/Github/active projects/runner`
- gstack source folder: `/Users/aaronwhaley/Github/gstack-main`
- Spine current starter Quest manifest: `quests/runner.yaml`
- FirmVault starter metadata: `quests/firmvault.yaml`
- Catalog listing command: `packages/spine-cli/src/commands/quests.ts`
- Catalog test: `packages/spine-cli/src/commands/catalog.test.ts`
- gstack source files:
  - `README.md`
  - `package.json`
  - `LICENSE`
  - core `*/SKILL.md` manifests including `office-hours`, `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `plan-devex-review`, `review`, `qa-only`, `qa`, `ship`, `land-and-deploy`, `canary`, `retro`, `investigate`, `health`, `document-release`, `careful`, `freeze`, and `guard`.

Observed facts:

- gstack `package.json` names the package `gstack`, version `1.40.0.0`, license `MIT`, and describes it as “Garry's Stack — Claude Code skills + fast headless browser.”
- gstack `README.md` frames the process as “Think → Plan → Build → Review → Test → Ship → Reflect.”
- gstack `README.md` describes a virtual engineering team: CEO, eng manager, designer, reviewer, QA lead, security officer, and release engineer.
- Local `/Users/aaronwhaley/Github/gstack-main` is not a git repository, so source attribution should cite folder path + package/license data, not a local commit hash.

---

## Product naming rule

**Spine is the product/system/runtime name. It must not be the public name of any Quest.**

Correct public model:

- **Spine** — the product/runtime/repo.
- **Quest** — a selectable workflow framework installed into a folder.
- **Recipe** — a reusable agent/operator role used by a Quest.

Starter Quest menu should become:

1. **FirmVault** — personal-injury legal case workflow.
2. **Project Delivery** — general GSD-derived delivery workflow.
3. **Product Sprint** — gstack-derived founder/product/team-style software sprint workflow.

Do not present “Spine” as a Quest name. In prose, say “a Spine Quest named Project Delivery,” not “the Spine Quest.”

---

## Assessment: is gstack a good Quest candidate?

Yes.

It is not just a bag of commands. Its README explicitly defines a sprint process:

```text
Think → Plan → Build → Review → Test → Ship → Reflect
```

That maps naturally to a Spine Quest scaffold. The useful portable unit is the methodology and specialist-role prompts, not gstack's host-specific runtime.

### What to port

Port these as source-backed Recipes in the first pass:

- `office-hours` — discovery / product interrogation.
- `plan-ceo-review` — founder/CEO strategy review.
- `plan-eng-review` — architecture/execution review.
- `plan-design-review` — design/taste review.
- `plan-devex-review` — developer-experience review.
- `autoplan` — multi-review coordination recipe.
- `review` — pre-landing diff review.
- `qa-only` — report-only QA.
- `ship` — release preparation workflow, gated before external side effects.
- `retro` — reflection/learning.

Candidate second-wave Recipes:

- `investigate`
- `health`
- `document-release`
- `qa`
- `land-and-deploy`
- `canary`
- `cso`
- `codex`
- `careful` / `freeze` / `guard`

### What not to port in the first pass

Do not port these into the first Quest slice:

- gstack installation/update machinery.
- Claude Code host setup.
- Bun browser daemon implementation.
- compiled browser/design/pdf CLIs.
- networked deploy/canary execution.
- model benchmarking/evals.
- persistent gbrain/memory setup.

Those are host/runtime adapters or later optional capabilities, not required for the first folder-settable Quest.

---

## Target Quest design

### Public Quest name

Recommended:

- slug: `product-sprint`
- name: `Product Sprint`
- source/provenance: gstack / Garry Tan, MIT

Acceptable alternative if we want the AI/team positioning explicit:

- slug: `ai-product-sprint`
- name: `AI Product Sprint`

I recommend `product-sprint` because it is cleaner and less dated; metadata can include aliases like `gstack`, `AI product sprint`, `founder sprint`, and `virtual engineering team`.

### Quest scaffold

```yaml
scaffolds:
  workstreams:
    - key: product
      name: Product Sprint
      milestones:
        - version_label: v1
          title: Product sprint loop
          phases:
            - phase_key: "00"
              phase_slug: think
              lifecycle_phase: think
            - phase_key: "10"
              phase_slug: plan
              lifecycle_phase: plan
            - phase_key: "20"
              phase_slug: build
              lifecycle_phase: build
            - phase_key: "30"
              phase_slug: review
              lifecycle_phase: review
            - phase_key: "40"
              phase_slug: test
              lifecycle_phase: test
            - phase_key: "50"
              phase_slug: ship
              lifecycle_phase: ship
            - phase_key: "60"
              phase_slug: reflect
              lifecycle_phase: reflect
```

### Phase-to-Recipe mapping

- **Think**
  - `product-sprint-office-hours`
  - discussion enabled; one-question-at-a-time if ambiguous.

- **Plan**
  - `product-sprint-ceo-review`
  - `product-sprint-eng-review`
  - `product-sprint-design-review`
  - `product-sprint-devex-review`
  - optional coordinator: `product-sprint-autoplan`
  - human approval gate before build.

- **Build**
  - checkpoint or existing generic executor Recipe initially.
  - Do not invent a gstack executor unless a source skill explicitly supports it.

- **Review**
  - `product-sprint-review`
  - human gate for high-risk fixes.

- **Test**
  - `product-sprint-qa-only` first.
  - `product-sprint-qa` later only if auto-fix behavior is explicitly enabled.

- **Ship**
  - `product-sprint-ship`
  - required human approval gate before push/PR/deploy side effects.
  - `product-sprint-document-release` can be second-wave or included as a post-ship docs task.

- **Reflect**
  - `product-sprint-retro`
  - optional `product-sprint-learn` later.

### Safety model

- Source files are read-only unless a user starts an explicit execution task.
- Plan/review/QA/ship steps can produce recommendations, diffs, tasks, or checklists.
- External side effects are gated:
  - pushing branches
  - creating PRs
  - deploys
  - live canary monitoring
  - browser automation against production
- The first Quest port should mark deploy/canary/live browser actions as deferred or gated in metadata.

---

## Implementation slices

### Task 1: Rename the current GSD-derived starter Quest away from `runner`

**Objective:** Remove the product-name collision before adding another starter Quest.

**Files:**

- Modify: `quests/runner.yaml`
- Rename/create if supported: `quests/project-delivery.yaml`
- Modify: `docs/quests/runner.md` → `docs/quests/project-delivery.md`
- Modify: `README.md`
- Modify: `docs/spine-folder-host.md`
- Modify: `docs/runner-quest-catalog.md`
- Modify: `docs/runner-core-integration.md`
- Modify tests that assert `runner` Quest slug/name:
  - `packages/spine-cli/src/commands/catalog.test.ts`
  - folder-host tests currently installing `quest: 'runner'`

**TDD / docs-first checks:**

1. Add/modify a catalog test asserting primary starters include:
   - `firmvault: FirmVault`
   - `project-delivery: Project Delivery`
   - no primary starter with slug `runner`
2. Run:

```bash
pnpm exec vitest run packages/spine-cli/src/commands/catalog.test.ts
```

Expected RED: test fails because current catalog still prints `- runner: Project Delivery (GSD)`.

3. Rename manifest slug and docs references.
4. Run targeted tests again.
5. Run broader catalog/folder-host tests.

**Compatibility note:** If too many internal tests or user folders assume `--quest runner`, do this in two commits:

- Commit A: public name becomes `Project Delivery`; metadata marks `runner` as deprecated alias.
- Commit B: add first-class alias resolution if needed, then migrate slug to `project-delivery`.

Do not leave public docs saying the `runner` Quest is the starter.

---

### Task 2: Add source-backed Product Sprint recipe-port tests

**Objective:** Define the gstack-derived Recipe set before writing manifests.

**Files:**

- Create: `src/__tests__/product-sprint-quest.test.ts` or `src/__tests__/product-sprint-recipe-port.test.ts`
- Later create: `recipes/product-sprint/*.yaml`

**Test expectations:**

- Bundled catalog includes the expected `product-sprint-*` Recipe slugs.
- Each Recipe has:
  - `schema_version: 1`
  - source metadata pointing to `/Users/aaronwhaley/Github/gstack-main/<skill>/SKILL.md`
  - license metadata `MIT`
  - prompt text present
  - external side-effect policy metadata for `ship`, `qa`, `land-and-deploy`, and `canary`

**Command:**

```bash
pnpm exec vitest run src/__tests__/product-sprint-recipe-port.test.ts
```

Expected RED: missing product-sprint Recipes.

---

### Task 3: Port first-wave gstack Recipes

**Objective:** Add portable Recipe manifests for the core Product Sprint roles.

**Files:**

- Create:
  - `recipes/product-sprint/office-hours.yaml`
  - `recipes/product-sprint/ceo-review.yaml`
  - `recipes/product-sprint/eng-review.yaml`
  - `recipes/product-sprint/design-review.yaml`
  - `recipes/product-sprint/devex-review.yaml`
  - `recipes/product-sprint/autoplan.yaml`
  - `recipes/product-sprint/review.yaml`
  - `recipes/product-sprint/qa-only.yaml`
  - `recipes/product-sprint/ship.yaml`
  - `recipes/product-sprint/retro.yaml`

**Porting rules:**

- Preserve source intent from gstack SKILL.md.
- Rewrite host-specific commands into Spine Recipe guidance.
- Remove or quarantine install/update/Claude-specific preamble.
- Add metadata:

```yaml
metadata:
  source:
    project: gstack
    local_reference: /Users/aaronwhaley/Github/gstack-main/<skill>/SKILL.md
    license: MIT
  runner:
    external_side_effects: forbidden|gated|none
    source_port_scope: methodology_recipe
```

**Verification:**

```bash
pnpm exec vitest run src/__tests__/product-sprint-recipe-port.test.ts
pnpm typecheck
```

---

### Task 4: Add Product Sprint Quest manifest

**Objective:** Make Product Sprint a formal folder-settable Quest.

**Files:**

- Create: `quests/product-sprint.yaml`
- Create or reuse workflow stub: `workflows/product-sprint.yaml` if required by schema/runtime
- Extend: `src/__tests__/product-sprint-quest.test.ts`

**Manifest requirements:**

```yaml
schema_version: 1
slug: product-sprint
name: Product Sprint
description: >
  gstack-derived product/software sprint Quest for founder-led product work:
  think, plan, build, review, test, ship, and reflect.
workflow: workflows/product-sprint.yaml
recipes:
  - product-sprint-office-hours
  - product-sprint-ceo-review
  - product-sprint-eng-review
  - product-sprint-design-review
  - product-sprint-devex-review
  - product-sprint-autoplan
  - product-sprint-review
  - product-sprint-qa-only
  - product-sprint-ship
  - product-sprint-retro
metadata:
  runner:
    quest_family: primary_starter
    user_prompt_names:
      - Product Sprint
      - gstack
      - AI Product Sprint
      - founder sprint
      - product management
      - virtual engineering team
```

**Verification:**

- Quest loads.
- Every Recipe reference resolves.
- Product Sprint appears in primary starter list.
- No Quest named `Spine` appears in the starter list.

```bash
pnpm exec vitest run src/__tests__/product-sprint-quest.test.ts packages/spine-cli/src/commands/catalog.test.ts
```

---

### Task 5: Add folder setup smoke

**Objective:** Prove Product Sprint can be installed and started in a temp folder.

**Files:**

- Add test under `packages/spine-folder-host/src/routes/start.test.ts` or a new `src/__tests__/product-sprint-folder-smoke.test.ts`.

**Smoke shape:**

```bash
tmp=$(mktemp -d)
cd "$tmp"
node /Users/aaronwhaley/Github/active\ projects/runner/packages/spine-cli/src/bin.ts init --quest product-sprint
node /Users/aaronwhaley/Github/active\ projects/runner/packages/spine-cli/src/bin.ts start --quest product-sprint
node /Users/aaronwhaley/Github/active\ projects/runner/packages/spine-cli/src/bin.ts tasks --route-id route-001
```

**Assertions:**

- `.runner/quests/product-sprint.yaml` exists.
- `.runner/tasks/tasks.yaml` exists.
- tasks include Product Sprint phases.
- no repo-root `.runner/` contamination.

---

### Task 6: Update docs and Quest chooser language

**Objective:** Document the user-facing setup flow.

**Files:**

- Create: `docs/quests/product-sprint.md`
- Rename/update: `docs/quests/project-delivery.md`
- Modify: `docs/spine-folder-host.md`
- Modify: `docs/runner-quest-catalog.md`
- Modify: `README.md`

**Required language:**

```text
Set up a Spine Quest for this folder:

1. FirmVault — legal case workflow for personal-injury matters.
2. Project Delivery — general GSD-derived planning/execution workflow.
3. Product Sprint — gstack-derived founder/product/team sprint workflow.
```

Avoid:

```text
Spine Quest — Project Delivery
```

Use instead:

```text
Project Delivery Quest
```

---

### Task 7: Final verification

Run:

```bash
pnpm exec vitest run src/__tests__/product-sprint-quest.test.ts src/__tests__/product-sprint-recipe-port.test.ts packages/spine-cli/src/commands/catalog.test.ts
pnpm test
pnpm typecheck
pnpm build
pnpm verify:built-imports
git diff --check
```

If all green, commit and push.

---

## Final acceptance criteria

- `runner quests` shows primary starters with independent Quest names:
  - `firmvault: FirmVault`
  - `project-delivery: Project Delivery`
  - `product-sprint: Product Sprint`
- No public docs call `runner` a Quest name.
- `product-sprint` can be installed and started in a temp folder.
- Product Sprint Recipes resolve from the bundled catalog.
- gstack source attribution and MIT license are recorded.
- gstack runtime/browser/deploy side effects are not executed by default.
- Tests, typecheck, build, built imports, and diff-check pass.
