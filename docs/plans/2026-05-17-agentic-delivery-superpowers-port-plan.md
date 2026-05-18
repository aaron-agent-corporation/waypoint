# Agentic Delivery Superpowers Port Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add an attributed Superpowers-derived Agentic Delivery starter Quest to Waypoint, backed by source-derived Recipes and catalog/docs coverage.

**Architecture:** Treat Superpowers as source methodology/provenance, not Waypoint branding. Port each Superpowers skill into a namespaced Recipe (`agentic-delivery-*`) and compose them into one end-to-end Quest (`agentic-delivery`) for AI-assisted software delivery. Keep route nodes safe by default: planning/review/gate/checkpoint behavior only; no external publishing, merge, PR, or filesystem branch side effects without later explicit host wiring.

**Tech Stack:** Waypoint Quest/Recipe YAML manifests, existing recursive Quest/Recipe loaders, Vitest catalog/docs tests, TypeScript CLI catalog surface.

---

## Source authority

Primary source folder: `/Users/aaronwhaley/Github/superpowers-main`

Grounded source facts observed before this plan:

- `README.md` describes Superpowers as a "complete software development methodology for your coding agents" and lists the basic workflow from brainstorming through finishing a development branch.
- `package.json` identifies package `superpowers`, version `5.1.0`.
- `LICENSE` is MIT, Copyright (c) 2025 Jesse Vincent.
- `skills/` contains 14 `SKILL.md` files:
  - `brainstorming`
  - `dispatching-parallel-agents`
  - `executing-plans`
  - `finishing-a-development-branch`
  - `receiving-code-review`
  - `requesting-code-review`
  - `subagent-driven-development`
  - `systematic-debugging`
  - `test-driven-development`
  - `using-git-worktrees`
  - `using-superpowers`
  - `verification-before-completion`
  - `writing-plans`
  - `writing-skills`

## Naming rules

- Waypoint remains the runtime/system name only.
- Quest slug: `agentic-delivery`.
- Quest public name: `Agentic Delivery`.
- Source attribution: `Superpowers` / package `superpowers` / version `5.1.0` / MIT / Jesse Vincent.
- Recipe slugs are namespaced as `agentic-delivery-<skill-slug>` to avoid collisions with existing Waypoint skills or Recipes.

## Safety rules

- Ported Recipes are instructions and process guidance only.
- Do not enable external side effects from the Quest itself.
- Branch merge, PR creation, package publishing, external review posting, and filesystem worktree creation are modeled as gated/review/checklist steps unless a future host adapter explicitly implements them.
- Keep attribution metadata on every ported manifest.

## Task 1 — RED catalog/Quest tests

**Objective:** Add failing tests proving the new Quest and Recipe set are absent.

**Files:**

- Create: `src/__tests__/agentic-delivery-quest.test.ts`
- Modify: `packages/waypoint-cli/src/commands/catalog.test.ts`
- Modify: `src/__tests__/folder-host-docs.test.ts`

**Steps:**

1. Add a test that loads bundled Quests/Recipes and expects:
   - Quest `agentic-delivery` exists.
   - Name is `Agentic Delivery`.
   - `metadata.waypoint.quest_family === 'primary_starter'`.
   - `metadata.waypoint.selection_summary === 'disciplined AI-assisted software delivery from idea through verified branch finish'`.
   - `metadata.source.project === 'Superpowers'`.
   - `metadata.source.package === 'superpowers'`.
   - `metadata.source.version === '5.1.0'`.
   - `metadata.source.license === 'MIT'`.
   - 14 required `agentic-delivery-*` Recipes resolve.
   - Each Recipe has source metadata and prompt length > 100.
   - Side-effect-sensitive Recipes declare `external_side_effects: gated` or `forbidden`.
2. Extend CLI catalog test to expect `- agentic-delivery: Agentic Delivery` and its Best-for summary.
3. Extend folder-host docs test to expect the same starter Quest guidance.
4. Run targeted tests and verify they fail because the Quest/doc entries do not yet exist:

```bash
pnpm exec vitest run src/__tests__/agentic-delivery-quest.test.ts packages/waypoint-cli/src/commands/catalog.test.ts src/__tests__/folder-host-docs.test.ts
```

Expected RED: missing `agentic-delivery` Quest and missing catalog/docs strings.

## Task 2 — Port Recipes and Quest manifests

**Objective:** Add source-backed Recipe manifests and the Agentic Delivery Quest.

**Files:**

- Create: `recipes/agentic-delivery/*.yaml`
- Create: `quests/agentic-delivery.yaml`

**Steps:**

1. Generate/author one Recipe YAML per source skill.
2. Preserve the source skill body in `prompt: |` with a short Waypoint wrapper header only if needed.
3. Record metadata:

```yaml
metadata:
  source:
    project: Superpowers
    package: superpowers
    version: 5.1.0
    path: /Users/aaronwhaley/Github/superpowers-main
    source_file: skills/<skill>/SKILL.md
    license: MIT
    copyright: Copyright (c) 2025 Jesse Vincent
  waypoint:
    source_port_scope: methodology_recipe
    external_side_effects: forbidden|gated
```

4. Add `quests/agentic-delivery.yaml` with phases:
   - discover
   - design
   - plan
   - execute
   - verify
   - ship
   - improve
5. Use gate/checkpoint nodes around any side-effect-sensitive step.

## Task 3 — Docs/catalog updates

**Objective:** Surface Agentic Delivery as a starter Quest without renaming Waypoint or Superpowers.

**Files:**

- Modify: `docs/waypoint-folder-host.md`
- Modify as needed: `docs/waypoint-quest-catalog.md`
- Modify as needed: `docs/plans/waypoint-source-port-status.md`
- Modify as needed: `WAYPOINT_RESUME_PLAN.md`

**Steps:**

1. Add `agentic-delivery` to the starter Quest selection section.
2. Regenerate or update loader-backed catalog/count docs if tests require it.
3. Keep attribution language explicit: Superpowers-derived, MIT, Jesse Vincent.
4. Do not present Superpowers as Waypoint-owned branding.

## Task 4 — GREEN verification and commit

**Objective:** Prove the port loads, resolves, and appears in user-facing catalog/docs.

**Commands:**

```bash
pnpm exec vitest run src/__tests__/agentic-delivery-quest.test.ts packages/waypoint-cli/src/commands/catalog.test.ts src/__tests__/folder-host-docs.test.ts src/__tests__/waypoint-docs.test.ts
pnpm typecheck
pnpm test
pnpm build
pnpm verify:built-imports
git diff --check
```

**Commit:**

```bash
git add docs/plans/2026-05-17-agentic-delivery-superpowers-port-plan.md src/__tests__/agentic-delivery-quest.test.ts packages/waypoint-cli/src/commands/catalog.test.ts src/__tests__/folder-host-docs.test.ts docs/waypoint-folder-host.md docs/waypoint-quest-catalog.md docs/plans/waypoint-source-port-status.md WAYPOINT_RESUME_PLAN.md quests/agentic-delivery.yaml recipes/agentic-delivery
git commit -m "feat(quests): add agentic delivery starter quest"
git push origin main
```

Verify remote:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

## Out of scope

- No automatic import from Superpowers at runtime.
- No new plugin installer.
- No direct branch creation, merge, PR, or external review side effects.
- No legal/FirmVault state changes.
