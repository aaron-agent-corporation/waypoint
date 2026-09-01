# OpenSwarm Pattern Adoption for Spine Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Use test-driven-development for every code-producing slice. Ground all completion claims in primary-source outputs from this repo.

**Goal:** Borrow the useful OpenSwarm/GSD-style orchestration patterns into Spine without importing OpenSwarm as a runtime dependency: operator manifests, layered instructions, safe tool discovery, handoff graphs, readiness doctoring, and a Quest/Recipe authoring wizard.

**Architecture:** Spine remains the lifecycle/state/proof runtime. OpenSwarm is treated as design input only: agent folders become Spine operator manifests; shared/agent instructions become layered instructions; PRD creation becomes a Spine-native authoring wizard; Composio-style tool search becomes a safe Spine tool registry; communication flows become explicit handoff manifests/gates. No generic external tool executor is introduced for FirmVault.

**Tech Stack:** TypeScript, YAML manifests, existing `@projectrunner/spine` parser patterns, `packages/spine-folder-host`, `packages/spine-cli`, Vitest, existing FirmVault CLI/state/adoption/guidance surfaces.

---

## Primary-source inputs already inspected

- OpenSwarm folder: `/Users/aaronwhaley/Github/OpenSwarm-main`
- Key OpenSwarm files inspected:
  - `README.md`
  - `swarm.py`
  - `server.py`
  - `shared_instructions.md`
  - `orchestrator/orchestrator.py`
  - `orchestrator/instructions.md`
  - `.cursor/rules/agency-swarm-workflow.mdc`
  - `.cursor/commands/create-prd.md`
  - `.cursor/commands/write-instructions.md`
  - `.claude/agents/agent-creator.md`
  - `.codex/agents/agent-creator.toml`
  - `shared_tools/FindTools.py`
  - `shared_tools/SearchTools.py`
  - `shared_tools/ExecuteTool.py`
  - `shared_tools/ManageConnections.py`
  - `patches/patch_agency_swarm_dual_comms.py`
  - `run_utils.py`
  - `onboard.py`
  - `config.py`
- Spine files inspected:
  - `src/recipes/manifest.ts`
  - `src/quests/manifest.ts`
  - `packages/spine-cli/src/bin.ts`
  - `packages/spine-cli/src/commands/doctor.ts`
  - existing `recipes/runner/*.yaml` and `recipes/firmvault/*.yaml` inventory
- Superpowers brainstorming source inspected from GitHub: `https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md` (10,634 bytes fetched on 2026-05-13). Core pattern to borrow: explore context → ask one question at a time → propose 2-3 approaches → present design → write/commit design spec → self-review → user approval → only then write the implementation plan.
- GSD/Spine lifecycle pattern inspected in committed Spine docs: `docs/runner-core-integration.md` shows the recursive intent hierarchy `workstreams → milestones → phases → plans`, with Quests/Recipes as reusable manifests and host adapters kept thin. The authoring wizard must preserve that intent-first structure instead of generating route tasks first.

---

## Non-goals and safety boundaries

- Do **not** add Agency Swarm as a dependency.
- Do **not** add a generic Composio executor to Spine or the FirmVault paralegal flow.
- Do **not** add automatic installs/downloads during normal Spine operation.
- Do **not** allow FirmVault legal landmarks to be satisfied by document ingestion, PR state, external tool state, or agent self-report.
- Do **not** create a second runtime model competing with Quests/Recipes/routes/tasks.
- Do **not** mutate legacy `FirmVault/cases` during doctoring, authoring, or wizard flows.

---

## Final user journey

### 1. Operator readiness

```bash
runner doctor firmvault --profile paralegal --json
```

Returns whether the paralegal operator environment is ready:

- Spine CLI present.
- FirmVault `runner_cases` root exists.
- legacy `cases` root exists if adoption/export is expected.
- paralegal profile skill exists.
- safe command runner docs/allowlist are present.
- document pipeline path is configured or clearly absent.
- relevant smoke scripts exist.
- next actions are explicit.

### 2. Operator manifest discovery

```bash
runner operators list --json
runner operators show firmvault-paralegal --json
```

Shows the role, layered instruction refs, allowed Spine commands, workspace roots, handoff capabilities, and safety constraints.

### 3. Tool discovery/explain, narrowed to Spine-safe commands

```bash
runner tools list --operator firmvault-paralegal --json
runner tools explain firmvault.state.set --json
```

Shows schemas and examples for safe Spine-native operations only.

### 4. Authoring wizard: the important borrowed brainstorming/PRD/GSD pattern

```bash
runner author brainstorm --kind quest --domain firmvault --json
runner author design --answers examples/authoring/firmvault-followup.answers.json --write-spec docs/plans/generated-firmvault-followup-design.md --json
runner author plan --design docs/plans/generated-firmvault-followup-design.md --write-draft docs/plans/generated-firmvault-followup-plan.md --json
runner author recipe --role paralegal --task "Prepare demand package review" --json
```

The wizard is not just a YAML generator. It should enforce the Superpowers brainstorming gate and the GSD/Spine lifecycle hierarchy:

1. inspect current project/Quest/Recipe context;
2. capture or ask one question at a time;
3. propose 2-3 approaches with trade-offs;
4. produce a design spec for review;
5. self-review the spec for placeholders/contradictions/scope ambiguity;
6. require explicit approval before producing the implementation plan or installable manifests;
7. keep generated workflows as drafts until a separate explicit install/apply command exists.

This keeps authoring aligned with Aaron’s road-building preference: choose the destination and lifecycle map before generating route tasks.

### 5. Handoff graph

```bash
runner handoffs list --quest firmvault --json
runner handoffs explain firmvault.paralegal_to_attorney_review --json
```

Shows role-to-role and role-to-human gates, required artifacts, and allowed state transitions.

---

## Milestone WPO1 — Spine operator manifest model

**Objective:** Add a first-class, Spine-native representation of an operator/agent role, inspired by OpenSwarm agent folders and GSD recipes, without adding a new runtime.

### Task WPO1.1: Add failing parser tests for operator manifests

**Files:**
- Create: `src/operators/manifest.test.ts`
- Create later: `src/operators/manifest.ts`
- Modify later: `src/index.ts`

**Test cases:**

- Parses a valid operator manifest with:
  - `schema_version: 1`
  - `slug`
  - `name`
  - `role`
  - `instructions.layers[]`
  - `allowed_tools[]`
  - `workspace.cases_root_key`
  - `handoffs[]`
  - `metadata`
- Rejects missing `slug`.
- Rejects non-array `allowed_tools`.
- Rejects an unsafe command entry for FirmVault if it contains shell metacharacters or an unrecognized prefix.

**Run to verify RED:**

```bash
pnpm exec vitest run src/operators/manifest.test.ts
```

Expected: fails because `src/operators/manifest.ts` does not exist yet.

### Task WPO1.2: Implement operator manifest parser

**Files:**
- Create: `src/operators/manifest.ts`
- Modify: `src/index.ts`

**Implementation notes:**

Follow the existing parser style in:

- `src/recipes/manifest.ts`
- `src/quests/manifest.ts`

Suggested type shape:

```ts
export type OperatorManifest = {
  readonly schema_version: 1
  readonly slug: string
  readonly name: string
  readonly role: string
  readonly description?: string
  readonly instructions?: {
    readonly layers?: readonly OperatorInstructionLayer[]
  }
  readonly allowed_tools?: readonly OperatorToolRef[]
  readonly workspace?: Readonly<Record<string, unknown>>
  readonly handoffs?: readonly OperatorHandoffRef[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type OperatorInstructionLayer = {
  readonly kind: 'shared' | 'domain' | 'role' | 'task' | 'skill' | 'runbook'
  readonly ref: string
  readonly required?: boolean
}

export type OperatorToolRef = {
  readonly slug: string
  readonly command?: string
  readonly description?: string
}

export type OperatorHandoffRef = {
  readonly slug: string
  readonly to: string
  readonly gate?: string
}
```

**Run to verify GREEN:**

```bash
pnpm exec vitest run src/operators/manifest.test.ts
```

Expected: pass.

### Task WPO1.3: Add bundled FirmVault paralegal operator manifest

**Files:**
- Create: `operators/firmvault/paralegal.yaml`
- Create: `src/operators/loader.ts`
- Create: `src/operators/loader.test.ts`

**Manifest content requirements:**

- Slug: `firmvault-paralegal`
- Role: `Paralegal Case Operator`
- Instruction layers:
  - shared Spine safety rules
  - FirmVault paralegal state operator runbook
  - paralegal profile skill path or skill name
  - document ingestion runbook
  - case folder blueprint
- Allowed tools must include only safe Spine operations:
  - `runner firmvault guidance --json`
  - `runner firmvault adopt preview --json`
  - `runner firmvault adopt init --apply-safe --json`
  - `runner firmvault evidence check --path <path> --json`
  - `runner firmvault state show --json`
  - `runner firmvault state set ... --json`
  - `runner firmvault add-document ... --json`
  - `runner firmvault document-handoff ... --json`
  - `runner firmvault landmarks --json`
- No generic shell or external tool execution.

**Run to verify:**

```bash
pnpm exec vitest run src/operators/loader.test.ts src/operators/manifest.test.ts
```

### Task WPO1.4: CLI operator discovery

**Files:**
- Create: `packages/spine-cli/src/commands/operators.ts`
- Create: `packages/spine-cli/src/commands/operators.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Commands:**

```bash
runner operators list [--json]
runner operators show <slug> [--json]
```

**Verification:**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/operators.test.ts
node packages/spine-cli/src/bin.ts operators list --json
node packages/spine-cli/src/bin.ts operators show firmvault-paralegal --json
```

---

## Milestone WPO2 — Instruction layering from OpenSwarm shared/agent instructions

**Objective:** Make instruction layering explicit and inspectable so Spine can tell an agent which shared, domain, role, skill, runbook, and task instructions apply.

### Task WPO2.1: Add instruction resolver tests

**Files:**
- Create: `src/operators/instructions.test.ts`
- Create later: `src/operators/instructions.ts`

**Behavior:**

- Given `firmvault-paralegal`, returns ordered layers.
- Marks missing optional layers as warnings.
- Marks missing required layers as errors.
- Does not read secrets or `.env` files.

**Run RED:**

```bash
pnpm exec vitest run src/operators/instructions.test.ts
```

### Task WPO2.2: Implement instruction resolver

**Files:**
- Create: `src/operators/instructions.ts`
- Modify: `src/operators/index.ts` if created, or `src/index.ts`

**Resolver output:**

```ts
export type OperatorInstructionResolution = {
  readonly operator_slug: string
  readonly layers: readonly {
    readonly kind: string
    readonly ref: string
    readonly exists: boolean
    readonly required: boolean
  }[]
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}
```

**Run GREEN:**

```bash
pnpm exec vitest run src/operators/instructions.test.ts src/operators/loader.test.ts
```

### Task WPO2.3: CLI command to inspect instructions

**Files:**
- Modify: `packages/spine-cli/src/commands/operators.ts`
- Modify: `packages/spine-cli/src/commands/operators.test.ts`

**Command:**

```bash
runner operators instructions firmvault-paralegal --json
```

Expected: ordered instruction layers with missing/present status and warnings.

---

## Milestone WPO3 — Safe Spine tool registry and explain surface

**Objective:** Borrow OpenSwarm’s tool discovery UX but keep it Spine-native and allowlist-based.

### Task WPO3.1: Add tool registry tests

**Files:**
- Create: `src/tools/registry.test.ts`
- Create later: `src/tools/registry.ts`

**Test cases:**

- Lists tool definitions for `firmvault-paralegal`.
- Explains `firmvault.state.set` with required args and safety notes.
- Rejects unknown operator.
- Rejects unknown tool slug.

**Run RED:**

```bash
pnpm exec vitest run src/tools/registry.test.ts
```

### Task WPO3.2: Implement registry

**Files:**
- Create: `src/tools/registry.ts`
- Modify: `src/index.ts`

**Suggested registry entries:**

- `firmvault.guidance`
- `firmvault.adopt.preview`
- `firmvault.adopt.init_safe`
- `firmvault.evidence.check`
- `firmvault.state.show`
- `firmvault.state.set`
- `firmvault.document.add`
- `firmvault.document.handoff`
- `firmvault.landmarks`
- `firmvault.export.runner_cases`

Each entry should include:

- command template
- inputs
- required evidence behavior
- side-effect class: `read_only`, `local_state_mutation`, `local_file_copy`, or `external_handoff_metadata`
- whether it can affect legal landmarks

**Run GREEN:**

```bash
pnpm exec vitest run src/tools/registry.test.ts
```

### Task WPO3.3: CLI command

**Files:**
- Create: `packages/spine-cli/src/commands/tools.ts`
- Create: `packages/spine-cli/src/commands/tools.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Commands:**

```bash
runner tools list --operator firmvault-paralegal --json
runner tools explain firmvault.state.set --json
```

**Verification:**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/tools.test.ts src/tools/registry.test.ts
```

---

## Milestone WPO4 — Authoring wizard, borrowed from OpenSwarm PRD/GSD patterns

**Objective:** Build a Spine-native authoring wizard that helps create Quest/Recipe/operator drafts from structured questions, modeled after OpenSwarm’s PRD command, Superpowers’ brainstorming gate, and GSD’s intent hierarchy.

This is the most important “steal.” It turns “I need a workflow” into a reviewable design spec and draft plan without requiring Aaron to hand-write YAML. It must not jump directly from a vague request to generated Quest/Recipe files; the wizard’s first-class outputs are: brainstorm capture, approach comparison, approved design spec, implementation plan, then draft manifests.

### Task WPO4.1: Define authoring draft schema tests

**Files:**
- Create: `src/authoring/draft.test.ts`
- Create later: `src/authoring/draft.ts`

**Draft model:**

```ts
export type SpineAuthoringDraft = {
  readonly schema_version: 1
  readonly kind: 'quest' | 'recipe' | 'operator' | 'handoff_graph'
  readonly title: string
  readonly source: 'questionnaire' | 'prompt' | 'existing_plan'
  readonly answers: Readonly<Record<string, unknown>>
  readonly generated_files: readonly AuthoringGeneratedFile[]
  readonly warnings: readonly string[]
  readonly next_actions: readonly string[]
}

export type AuthoringGeneratedFile = {
  readonly path: string
  readonly purpose: string
  readonly content: string
  readonly install_default: false
}
```

**Key rule:** generated files are drafts and have `install_default: false`.

**Brainstorming gate fields:** add tests that require the draft to preserve:

- `brainstorm_context.inspected_paths[]`
- `questions[]` with one-question-at-a-time ordering
- `approaches[]` with at least two alternatives before a recommendation
- `design_spec_path` when a spec has been written
- `approval.required: true` before plan/manifest generation
- `approval.status: 'pending' | 'approved' | 'changes_requested'`


**Run RED:**

```bash
pnpm exec vitest run src/authoring/draft.test.ts
```

### Task WPO4.2: Implement questionnaire templates

**Files:**
- Create: `src/authoring/questionnaires.ts`
- Create: `src/authoring/questionnaires.test.ts`

**Questionnaire groups:**

0. Brainstorming/context:
   - Which existing Quest/Recipe/docs should be inspected first?
   - Is this one workflow or multiple independent subsystems that need decomposition?
   - What is the user trying to accomplish in plain language?
   - What constraints are non-negotiable?
1. Quest/lifecycle:
   - What is the workflow goal?
   - What workstreams are involved?
   - Which milestones prove meaningful product/user progress?
   - What phases sit under each milestone?
   - Which plans/tasks belong under each phase?
   - What counts as done?
   - What human gates are required?
2. Roles/operators:
   - Who operates this workflow?
   - What tools may they use?
   - What must they never do?
3. Recipes/tasks:
   - What repeatable tasks exist?
   - What evidence/artifacts are required?
   - Which tasks are automated vs human gate?
4. Integrations:
   - Local-only?
   - External services?
   - Required credentials?
   - Are side effects allowed?
5. Verification:
   - Which tests/smokes prove success?
   - Which source-of-truth files should be checked?

**GSD pattern to preserve:** lifecycle intent first, execution substrate second. The wizard should ask about workstreams/milestones/phases/plans before generating route tasks.

**Superpowers brainstorming pattern to preserve:** after context exploration, the wizard should store questions as discrete answer records, support one-at-a-time interactive questioning later, produce 2-3 approaches with trade-offs, and write a design spec before writing an implementation plan.

### Task WPO4.3: Implement brainstorm/design spec generator

**Files:**
- Create: `src/authoring/design-spec-generator.ts`
- Create: `src/authoring/design-spec-generator.test.ts`

**Behavior:**

- Takes structured brainstorming answers and inspected context summaries.
- Emits a markdown design spec with sections:
  - current context inspected;
  - user goal;
  - constraints/non-goals;
  - 2-3 approaches and trade-offs;
  - recommendation;
  - lifecycle map using workstreams/milestones/phases/plans;
  - roles/operators;
  - tool/safety boundaries;
  - verification strategy;
  - approval status.
- Performs self-review checks for `TBD`, `TODO`, empty approach list, missing recommendation, missing verification, and contradictory install/apply language.
- Does not generate installable Quest/Recipe YAML.

**Verification:**

```bash
pnpm exec vitest run src/authoring/design-spec-generator.test.ts
```

### Task WPO4.4: CLI `runner author brainstorm` and `runner author design`

**Files:**
- Create/modify: `packages/spine-cli/src/commands/author.ts`
- Create/modify: `packages/spine-cli/src/commands/author.test.ts`

**Commands:**

```bash
runner author brainstorm --kind quest --domain firmvault --json
runner author design --answers examples/authoring/firmvault-followup.answers.json --write-spec docs/plans/generated-firmvault-followup-design.md --json
```

**Rules:**

- `brainstorm` prints the required question groups and approach-comparison shape; no file writes.
- `design` may write a spec only under safe relative paths such as `docs/plans/`.
- `design` returns `approval.status: pending`.
- `design` output must state that implementation planning and manifest generation are blocked until approval.

**Verification:**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/author.test.ts src/authoring/design-spec-generator.test.ts
```

### Task WPO4.5: Implement recipe draft generator

**Files:**
- Create: `src/authoring/recipe-generator.ts`
- Create: `src/authoring/recipe-generator.test.ts`

**Behavior:**

- Takes structured answers and produces a valid draft `RecipeManifest` YAML string.
- Uses existing parser `parseRecipeManifest` to validate generated YAML.
- Includes safety metadata when domain is `firmvault`.
- Does not write files by default.

**Verification:**

```bash
pnpm exec vitest run src/authoring/recipe-generator.test.ts src/recipes/__tests__/manifest.test.ts
```

### Task WPO4.6: Implement quest draft generator

**Files:**
- Create: `src/authoring/quest-generator.ts`
- Create: `src/authoring/quest-generator.test.ts`

**Behavior:**

- Takes workflow phases/human gates/tasks and produces a draft `QuestManifest` YAML string.
- Uses `parseQuestManifest` to validate generated YAML.
- Keeps generated quest in draft output until explicitly written.

**Verification:**

```bash
pnpm exec vitest run src/authoring/quest-generator.test.ts src/quests/__tests__/manifest.test.ts
```

### Task WPO4.7: CLI `runner author` dry-run output

**Files:**
- Create: `packages/spine-cli/src/commands/author.ts`
- Create: `packages/spine-cli/src/commands/author.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Commands:**

```bash
runner author brainstorm --kind quest --domain firmvault --json
runner author design --answers <path> --write-spec docs/plans/generated-design.md --json
runner author plan --design docs/plans/generated-design.md --json
runner author recipe --answers <path> --json
runner author quest --answers <path> --json
```

**Design:**

- First slice uses JSON answer files, not an interactive prompt. This keeps tests deterministic.
- Later slice can add interactive prompts that ask one question at a time.
- Command writes nothing unless `--write-spec` or `--write-draft` is supplied.
- `plan`, `recipe`, and `quest` generation require an approved design spec or an explicit `--allow-unapproved-draft` escape hatch for tests/examples only.

**Verification:**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/author.test.ts src/authoring/*.test.ts
```

### Task WPO4.8: Optional write-draft mode

**Files:**
- Modify: `packages/spine-cli/src/commands/author.ts`
- Modify: `packages/spine-cli/src/commands/author.test.ts`

**Command:**

```bash
runner author quest --answers examples/authoring/firmvault-followup.answers.json --write-draft docs/plans/generated-firmvault-followup-draft.md --json
```

**Rules:**

- May write only under `docs/plans/`, `examples/authoring/`, or a caller-provided safe relative path inside cwd.
- Must refuse absolute output paths unless a later explicit trusted-root system is built.
- Must include validation report.

### Task WPO4.9: Example authoring fixture

**Files:**
- Create: `examples/authoring/firmvault-followup.answers.json`
- Create: `examples/authoring/README.md`
- Modify: `src/__tests__/runner-docs.test.ts` if docs inventory is enforced

**Verification:**

```bash
node packages/spine-cli/src/bin.ts author quest --answers examples/authoring/firmvault-followup.answers.json --json
```

Expected: valid draft with generated quest/recipe/operator suggestions and warnings that it is not installed.

---

## Milestone WPO5 — FirmVault/paralegal doctor upgrade

**Objective:** Borrow OpenSwarm onboarding/readiness ideas and turn them into a safe local readiness report.

### Task WPO5.1: Add doctor API tests

**Files:**
- Create: `packages/spine-folder-host/src/firmvault/doctor.test.ts`
- Create later: `packages/spine-folder-host/src/firmvault/doctor.ts`

**Checks:**

- `runner_cases` root exists.
- source `cases` root exists or warning if absent.
- paralegal skill path exists if configured.
- operator manifest exists.
- case export script exists.
- smoke scripts exist.
- no external side-effect check attempts network or sends anything.

**Run RED:**

```bash
pnpm exec vitest run packages/spine-folder-host/src/firmvault/doctor.test.ts
```

### Task WPO5.2: Implement doctor API

**Files:**
- Create: `packages/spine-folder-host/src/firmvault/doctor.ts`
- Modify: `packages/spine-folder-host/src/index.ts`

**Output shape:**

```ts
export type FirmVaultOperatorDoctorResult = {
  readonly profile: string
  readonly ready: boolean
  readonly checks: readonly {
    readonly slug: string
    readonly status: 'pass' | 'warn' | 'fail'
    readonly message: string
    readonly path?: string
    readonly next_action?: string
  }[]
}
```

### Task WPO5.3: Extend CLI doctor

**Files:**
- Modify: `packages/spine-cli/src/commands/doctor.ts`
- Modify: `packages/spine-cli/src/commands/doctor.test.ts`
- Modify: `packages/spine-cli/src/bin.ts` help text if needed

**Command:**

```bash
runner doctor firmvault --profile paralegal --json
```

Existing `runner doctor firmvault --json` behavior should remain backward-compatible for case-folder inspection. Add profile mode only when `--profile` is supplied.

**Verification:**

```bash
pnpm exec vitest run packages/spine-cli/src/commands/doctor.test.ts packages/spine-folder-host/src/firmvault/doctor.test.ts
```

---

## Milestone WPO6 — Handoff graph manifests

**Objective:** Borrow OpenSwarm communication-flow ideas as explicit Spine handoff definitions that can be displayed, validated, and later tied to gates.

### Task WPO6.1: Add handoff manifest parser tests

**Files:**
- Create: `src/handoffs/manifest.test.ts`
- Create later: `src/handoffs/manifest.ts`

**YAML draft:**

```yaml
schema_version: 1
slug: firmvault-paralegal-handoffs
name: FirmVault Paralegal Handoffs
handoffs:
  - slug: paralegal-to-attorney-demand-review
    from: firmvault-paralegal
    to: attorney-review
    trigger: demand_package_ready
    required_artifacts:
      - docs/demand-summary.md
      - .runner/firmvault/case.yaml
    gate: human_attorney_review
```

**Run RED:**

```bash
pnpm exec vitest run src/handoffs/manifest.test.ts
```

### Task WPO6.2: Implement handoff parser and FirmVault handoff manifest

**Files:**
- Create: `src/handoffs/manifest.ts`
- Create: `handoffs/firmvault/paralegal.yaml`
- Create: `src/handoffs/loader.ts`
- Create: `src/handoffs/loader.test.ts`
- Modify: `src/index.ts`

**FirmVault handoffs to model first:**

- paralegal → attorney review for demand package
- paralegal → human send gate for letters/final notices
- document pipeline → paralegal PR review
- paralegal → settlement approval gate
- paralegal → final archive/close gate

### Task WPO6.3: CLI handoff discovery

**Files:**
- Create: `packages/spine-cli/src/commands/handoffs.ts`
- Create: `packages/spine-cli/src/commands/handoffs.test.ts`
- Modify: `packages/spine-cli/src/bin.ts`

**Commands:**

```bash
runner handoffs list --quest firmvault --json
runner handoffs explain paralegal-to-attorney-demand-review --json
```

---

## Milestone WPO7 — Docs and paralegal skill update

**Objective:** Make the new operator/authoring concepts usable by the paralegal agent and visible to humans.

### Task WPO7.1: Add Spine operator docs

**Files:**
- Create: `docs/runner-operators-and-authoring.md`
- Modify: `docs/runner-quest-catalog.md` if catalog docs require mention
- Modify: `src/__tests__/runner-docs.test.ts` if docs tests enumerate docs

**Content:**

- What was borrowed from OpenSwarm.
- What was intentionally not borrowed.
- How operators differ from Recipes.
- How authoring drafts differ from installed Quests/Recipes.
- How FirmVault paralegal uses the safe tool registry.

### Task WPO7.2: Patch paralegal skill to reference new commands

**Files outside Spine repo:**
- Patch: `/Users/aaronwhaley/.hermes/profiles/paralegal/skills/case-management/firmvault-runner-case-operations/SKILL.md`

**New sections:**

- Start with `runner doctor firmvault --profile paralegal --json`.
- Use `runner operators show firmvault-paralegal --json` to inspect role contract.
- Use `runner tools explain <tool> --json` before unfamiliar state changes.
- Use authoring wizard only for draft creation; do not install drafts without human review.

**Verification:**

Use `wc -l`/`read_file` on the skill after patching. Do not claim this file is committed; it lives outside the Spine git repo.

---

## Milestone WPO8 — Verification and commit gates

**Objective:** Ensure all borrowed patterns are proven by tests and do not break existing FirmVault behavior.

### Task WPO8.1: Targeted tests by subsystem

Run:

```bash
pnpm exec vitest run \
  src/operators/manifest.test.ts \
  src/operators/loader.test.ts \
  src/operators/instructions.test.ts \
  src/tools/registry.test.ts \
  src/authoring/draft.test.ts \
  src/authoring/questionnaires.test.ts \
  src/authoring/recipe-generator.test.ts \
  src/authoring/quest-generator.test.ts \
  src/handoffs/manifest.test.ts \
  src/handoffs/loader.test.ts \
  packages/spine-cli/src/commands/operators.test.ts \
  packages/spine-cli/src/commands/tools.test.ts \
  packages/spine-cli/src/commands/author.test.ts \
  packages/spine-cli/src/commands/handoffs.test.ts \
  packages/spine-cli/src/commands/doctor.test.ts \
  packages/spine-folder-host/src/firmvault/doctor.test.ts
```

Expected: all targeted tests pass.

### Task WPO8.2: Existing FirmVault regression gate

Run:

```bash
pnpm exec vitest run \
  packages/spine-folder-host/src/firmvault/state.test.ts \
  packages/spine-folder-host/src/firmvault/adoption.test.ts \
  packages/spine-cli/src/commands/firmvault.test.ts \
  src/__tests__/firmvault-recipe-port.test.ts \
  src/__tests__/firmvault-quest-skeleton.test.ts \
  src/__tests__/runner-docs.test.ts
```

Expected: existing FirmVault state/adoption/manifest/docs behavior remains green.

### Task WPO8.3: Smoke commands

Run:

```bash
node packages/spine-cli/src/bin.ts operators list --json
node packages/spine-cli/src/bin.ts operators show firmvault-paralegal --json
node packages/spine-cli/src/bin.ts tools list --operator firmvault-paralegal --json
node packages/spine-cli/src/bin.ts tools explain firmvault.state.set --json
node packages/spine-cli/src/bin.ts author questionnaire --kind quest --domain firmvault --json
node packages/spine-cli/src/bin.ts handoffs list --quest firmvault --json
node packages/spine-cli/src/bin.ts doctor firmvault --profile paralegal --json
```

Expected: exit code 0 for each and JSON output.

### Task WPO8.4: Full test/build attempt

Run:

```bash
pnpm test
pnpm build
```

If pre-existing TypeScript/module-resolution noise appears, capture the exact output and separate pre-existing failures from new failures. Do not call the gate green unless the command exits 0 in the current turn.

### Task WPO8.5: Commit sequence

Commit by milestone, not one giant commit:

```bash
git add src/operators operators packages/spine-cli/src/commands/operators.ts packages/spine-cli/src/commands/operators.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(runner): add operator manifests"

git add src/tools packages/spine-cli/src/commands/tools.ts packages/spine-cli/src/commands/tools.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(runner): add safe tool registry"

git add src/authoring packages/spine-cli/src/commands/author.ts packages/spine-cli/src/commands/author.test.ts examples/authoring packages/spine-cli/src/bin.ts
git commit -m "feat(runner): add authoring wizard drafts"

git add src/handoffs handoffs packages/spine-cli/src/commands/handoffs.ts packages/spine-cli/src/commands/handoffs.test.ts packages/spine-cli/src/bin.ts
git commit -m "feat(runner): add handoff manifests"

git add packages/spine-folder-host/src/firmvault/doctor.ts packages/spine-folder-host/src/firmvault/doctor.test.ts packages/spine-folder-host/src/index.ts packages/spine-cli/src/commands/doctor.ts packages/spine-cli/src/commands/doctor.test.ts docs/runner-operators-and-authoring.md src/__tests__/runner-docs.test.ts
git commit -m "feat(firmvault): add paralegal operator readiness doctor"
```

After every commit, run:

```bash
git log --oneline -1
```

and quote the actual SHA in the implementation report.

---

## Implementation order summary

1. WPO1 — operator manifests and `runner operators`.
2. WPO2 — instruction layering resolver.
3. WPO3 — safe tool registry and `runner tools`.
4. WPO4 — authoring wizard drafts. **This is the highest-value OpenSwarm/GSD borrow.**
5. WPO5 — FirmVault/paralegal doctor upgrade.
6. WPO6 — handoff graph manifests and `runner handoffs`.
7. WPO7 — docs + paralegal skill update.
8. WPO8 — verification + milestone commits.

---

## Open questions for implementation, not blockers for plan approval

- Should operator manifests live at repo root `operators/` or under `recipes/operators/`? Plan currently chooses root `operators/` to avoid confusing operators with executable Recipes.
- Should authoring eventually be interactive, or should Hermes remain the interactive layer and CLI stay JSON-answer-file based? Plan starts with deterministic JSON files for testability.
- Should handoff manifests eventually materialize route gates automatically? Plan starts with discovery/explain only to avoid accidental workflow mutation.
- Should generic non-FirmVault operators be added now? Plan starts with `firmvault-paralegal` only.

---

## Definition of done

- Spine can inspect a `firmvault-paralegal` operator manifest.
- Spine can resolve layered instructions for that operator.
- Spine can list/explain safe tools available to that operator.
- Spine can generate draft Quest/Recipe/operator artifacts from structured authoring answers without installing them.
- Spine can list/explain FirmVault handoffs.
- Spine doctor can report paralegal/FirmVault operator readiness.
- Existing FirmVault legal state behavior remains unchanged: facts/evidence drive landmarks; document pipeline handoff metadata does not satisfy legal landmarks.
- Targeted tests and smoke commands pass, with primary-source output captured in the implementation report.
