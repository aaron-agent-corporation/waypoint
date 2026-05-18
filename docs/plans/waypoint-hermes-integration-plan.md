# Track 3 — Hermes Runtime + Operator Bridge Implementation Plan

> **For Gary/Hermes:** Use grounded, phase-by-phase execution. Do not claim a phase is complete without same-turn git/test/file evidence.

**Goal:** Make Hermes the real runtime and conversational operator layer for standalone Waypoint folders before bridging Waypoint back into Mission Control.

**Architecture:** Track 3 is folder host first. The project-local `.waypoint/` directory remains the durable source of truth; Hermes is the operator shell and Recipe execution runtime; Telegram is the human approval and review surface. Mission Control bridge remains later: after this track proves the portable contract, Mission Control can become a rich UI and database adapter over the same concepts.

**Tech stack:** Waypoint folder host, `@waypoint/core` Quest/Recipe manifests, `@waypoint/cli` source-run CLI, Hermes Agent skills/scripts/config, Telegram gateway, JSON stdin/stdout Recipe runtime payloads, YAML/JSONL `.waypoint/` state.

---

## H0 decision

Aaron chose Hermes integration before Mission Control cutover.

Reasoning:

1. Folder host already proves Waypoint can run without Mission Control.
2. Hermes integration should next prove real agent execution and human operator interaction without Mission Control UI, Kanban boards, or MC database assumptions.
3. Mission Control bridge becomes easier afterward because MC can reuse the same Hermes Recipe/discussion contract while swapping `.waypoint/` persistence for MC database/API/UI persistence.

No Mission Control UI is assumed for Track 3. Kanban boards are not required for this track. The equivalents already exist locally:

- task cards → `.waypoint/tasks/tasks.yaml`
- task discussion → `.waypoint/tasks/<task-id>-discussion.jsonl`
- route state → `.waypoint/routes/<route-id>.yaml`
- audit timeline → `.waypoint/events/<route-id>.jsonl`
- autopilot history → `.waypoint/autopilot/runs.jsonl`

---

## Contract boundary

### Durable truth

`.waypoint/ remains the source of truth` for the standalone track.

Hermes is not the durable database. Hermes should read current state from Waypoint, run an allowed command or Recipe agent, write the result back through Waypoint, then summarize to Aaron.

```text
Folder host adapter: state → `.waypoint/`
Mission Control adapter: state → MC database/API/UI
Hermes runtime: Recipe/discussion execution contract shared by both
```

### Human interface

Telegram is the human approval and review surface for the standalone path.

Examples:

```text
Aaron: show blocked routes in waypoint
Hermes: runs waypoint routes/tasks/route-events, summarizes blocked route/gate

Aaron: approve the plan gate
Hermes: runs waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute
```

### Runtime interface

Track 1 F10 already created an opt-in local command runtime. Track 3 should build the Hermes adapter on top of that contract first, not invent a new server protocol before it is needed.

Recipe execution payload over stdin:

```json
{
  "schema_version": 1,
  "recipe_slug": "waypoint-planner",
  "prompt": "Recipe prompt text from the local manifest",
  "task_id": "task-003",
  "route_id": "route-001",
  "project_root": "/Users/aaronwhaley/Github/some-project"
}
```

Required fields:

- `schema_version: 1`
- `recipe_slug`
- `prompt`
- `task_id`
- `route_id`
- `project_root`

Initial Hermes runtime output should be plain stdout captured by the existing local runtime. H3 can add a structured JSON convention, but Waypoint must still persist stdout/stderr/exit code/signal exactly as the F10 local runtime does today.

### Discussion interface

Discussion messages must remain task-scoped.

Rules:

- User messages append to the task discussion JSONL.
- Agent replies append as `agent-authored` messages.
- Agent-authored messages must use loop prevention and never recursively request another auto-response.
- The adapter should load recent discussion history before invoking a Recipe agent, so Hermes can remain mostly stateless.

### Safety boundary

Hermes-side command execution must start with an operator command allowlist, not arbitrary shell execution.

Allowed command family for H2:

```text
waypoint status
waypoint routes
waypoint route --route-id
waypoint route-events --route-id
waypoint tasks --route-id
waypoint discuss --task-id
waypoint auto --route-id
waypoint auto status
waypoint gate --route-id
waypoint pause --route-id
waypoint resume --route-id
```

Local Recipe runtime remains opt-in through `runtime.recipe: local`. No project should execute commands from `.waypoint/config.yaml` unless the operator controls and trusts that config.

The required rollback switches are:

1. Remove or change `.waypoint/config.yaml` `runtime.recipe: local` to disable local Recipe command execution.
2. Disable the Hermes project registry entry for a project to stop operator command routing.
3. Disable the Hermes runtime adapter script/skill to stop Recipe execution while preserving folder-host CLI use.
4. Use `waypoint pause --route-id <id>` for route-level stop.
5. Delete or move `.waypoint/` only as an explicit project-local reset/rollback action.

---

## North-star standalone Hermes journey

From Telegram:

```text
Aaron: Gary, start the Waypoint Quest in the waypoint repo.
Gary: runs waypoint init/start as needed, reports route-001.

Aaron: Continue until you need me.
Gary: runs waypoint auto --route-id route-001.
Gary: executes Recipe tasks through Hermes when local runtime is enabled.
Gary: stops at plan-approval-gate and summarizes the plan.

Aaron: Approve.
Gary: runs waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute.
Gary: reports route state and next task.
```

End-state proof for Track 3:

- at least one Recipe task executes through Hermes, not the null runtime;
- at least one task discussion round-trip is written to `.waypoint/tasks/*-discussion.jsonl`;
- at least one gate is prompted over Telegram and decided by natural language response;
- `.waypoint/routes/`, `.waypoint/events/`, `.waypoint/tasks/`, and `.waypoint/autopilot/runs.jsonl` contain the durable audit trail;
- no Mission Control UI/API/database is required for the standalone smoke.

---

## Phases

## H1 — Project registry

**Objective:** Give Hermes a safe way to map friendly project names to local folder paths without guessing.

**H1 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `examples/hermes-operator-adapter/README.md`
  - `examples/hermes-operator-adapter/src/project-registry.ts`
  - `examples/hermes-operator-adapter/src/project-registry.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

**Deliverables:**

- Registry shape documented, for example:

```yaml
projects:
  waypoint:
    path: /Users/aaronwhaley/Github/waypoint
    waypoint_cli: /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts
```

- Read-only lookup behavior: project name → absolute path + CLI entrypoint.
- Reference module: `examples/hermes-operator-adapter/src/project-registry.ts`.
- Friendly project names to trusted local paths, with safe project-name validation.
- Unknown project names fail closed.
- No arbitrary path execution from natural language.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/project-registry.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```

Hermes-side operational registry wiring remains a later environment-specific step; H1 defines and tests the portable registry contract in the Waypoint repo.

---

## H2 — Safe Waypoint command runner

**Objective:** Let Hermes operate a folder-host project through a narrow Waypoint command allowlist.

**H2 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `docs/plans/waypoint-remaining-roadmap.md`
  - `examples/hermes-operator-adapter/README.md`
  - `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`
  - `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

**Behavior:**

The H2 reference adapter exports a safe Waypoint command runner at `examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts`.

Natural-language operator requests must be converted by Hermes into explicit allowlisted Waypoint argument arrays before execution. H2 does not execute arbitrary shell strings.

Allowed read-only commands include:

```bash
waypoint status
waypoint quests
waypoint recipes --quest <slug>
waypoint routes
waypoint route --route-id route-001
waypoint tasks --route-id route-001
waypoint route-events --route-id route-001 --limit 20
waypoint auto status
```

Allowed mutation commands are explicitly marked and require clear command intent:

```bash
waypoint init --quest <slug>
waypoint start --quest <slug>
waypoint discuss --task-id task-003 --message "..."
waypoint auto --route-id route-001 --max-iterations 10
waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute
waypoint pause --route-id route-001 --reason "..."
waypoint resume --route-id route-001
```

Another agent can translate “start a Quest” into catalog inspection plus explicit init/start commands: first resolve the trusted project record, run `waypoint quests` and optionally `waypoint recipes --quest <slug>` to confirm the requested Quest, then run `waypoint init --quest <slug>` if the folder is not initialized and `waypoint start --quest <slug>` to create the route. The runner still receives explicit argv arrays only; it does not execute arbitrary natural-language text.

Safety behavior:

- command allowlist rejects non-Waypoint shell commands;
- command allowlist accepts only catalog inspection (`quests`, `recipes`), Quest start/init, route/task inspection, discussion, autopilot, gate, pause/resume, and safe FirmVault operator commands;
- each command has a narrow flag allowlist;
- missing required flag values fail before execution;
- `gate` requires exactly one of `--approve` or `--reject`;
- outputs are summarized without dropping route/task IDs by preserving raw stdout and stderr in the command result.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```

Hermes-side operational command parsing remains a later environment-specific step. H2 defines and tests the portable command-runner contract in the Waypoint repo.

---

## H3 — Hermes Recipe runtime adapter

**Objective:** Make `runtime.recipe: local` invoke a Hermes adapter that receives the F10 Recipe execution payload and runs the matching agent/Recipe behavior.

**H3 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `docs/plans/waypoint-remaining-roadmap.md`
  - `examples/hermes-runtime-adapter/README.md`
  - `examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs`
  - `examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

The H3 reference adapter lives at `examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs`.

Hermes profile operational wiring remains environment-specific. H3 defines and tests the portable stdin/stdout adapter contract in the Waypoint repo.

**Routing rule:**

```text
waypoint-planner → planner-capable Hermes/Gary execution
waypoint-verifier → verifier-capable Hermes/Gary execution
waypoint-doc-writer → doc-writer-capable Hermes/Gary execution
unknown recipe_slug → Gary/orchestrator fallback with explicit uncertainty
```

**Input:** F10 Recipe execution payload with `schema_version: 1`.

**Output:** The reference adapter emits structured JSON stdout:

```json
{
  "ok": true,
  "adapter": "hermes-recipe-runtime-reference",
  "schema_version": 1,
  "recipe_slug": "waypoint-doc-writer",
  "task_id": "task-003",
  "route_id": "route-001",
  "project_root": "/tmp/waypoint-project",
  "routed_to": "doc-writer-capable Hermes/Gary execution",
  "summary": "What the agent did",
  "artifacts": [],
  "messages": []
}
```

Waypoint must still persist stdout/stderr/exit code/signal exactly as the F10 local runtime does today.

**Failure behavior:** non-zero adapter exit should be persisted by the existing local runtime as task/route failure.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```

Smoke expectation: configure `runtime.recipe: local` to call `node examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs`; a Recipe task records `runtime: local` and Hermes-flavored structured JSON stdout, while invalid payload/non-zero adapter exits mark the task/route failed through the existing local runtime.

---

## H4 — Discussion loop

**Objective:** Support task-scoped user↔agent discussion through Hermes without Mission Control comments or UI panels.

**H4 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `docs/plans/waypoint-remaining-roadmap.md`
  - `examples/hermes-operator-adapter/README.md`
  - `examples/hermes-operator-adapter/src/discussion-loop.ts`
  - `examples/hermes-operator-adapter/src/discussion-loop.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

The H4 reference adapter lives at `examples/hermes-operator-adapter/src/discussion-loop.ts`.

**Behavior:**

1. Hermes reads task and discussion state from `.waypoint/`.
2. Hermes appends user messages through `waypoint discuss --task-id`.
3. Hermes invokes the selected Recipe/agent when requested.
4. Hermes appends agent-authored replies through `waypoint discuss --task-id --author agent`.
5. Loop prevention ensures agent-authored replies do not recursively trigger more replies.

The reference loop uses the H2 safe Waypoint command runner instead of shelling out through arbitrary commands. It reads the `conversation_id` and selected task discussion agent from the existing `waypoint discuss` output, passes the latest operator message to the injected Hermes discussion runtime, then persists the reply as an agent-authored message. Agent-authored messages retain the folder-host `auto_response.reason: agent_authored` boundary.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/discussion-loop.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```

Smoke expectation: a temp project started with `waypoint init --quest waypoint` and `waypoint start --quest waypoint` can append an operator message to `task-003`, invoke a `waypoint-doc-writer` discussion runtime, append an agent reply, and list both messages with the same `conversation_id`. No recursive auto-response event is requested for agent-authored messages.

---

## H5 — Telegram gate loop

**Objective:** Make human gates usable from Telegram as the standalone replacement for Mission Control gate buttons.

**H5 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `docs/plans/waypoint-remaining-roadmap.md`
  - `examples/hermes-operator-adapter/README.md`
  - `examples/hermes-operator-adapter/src/telegram-gate-loop.ts`
  - `examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

The H5 reference adapter lives at `examples/hermes-operator-adapter/src/telegram-gate-loop.ts`.

**Behavior:**

When autopilot blocks at a gate, Hermes sends a concise prompt:

```text
route-001 is blocked at plan-approval-gate.
Summary: ...
Reply: approve, reject, revise, show tasks, or show events.
```

Natural replies map to safe Waypoint command-runner calls:

```bash
waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute
waypoint gate --route-id route-001 --node plan-approval-gate --reject --note "..."
waypoint tasks --route-id route-001
waypoint route-events --route-id route-001 --limit 20
```

`revise` is treated as a rejection with a revision note so the route remains blocked and the requested changes are persisted in the existing `route.gate.rejected` event payload. `show tasks` and `show events` are read-only inspection actions through the same H2 allowlist.

**Verification:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/telegram-gate-loop.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```

Smoke expectation: a temp project started with `waypoint init --quest waypoint`, `waypoint start --quest waypoint`, and `waypoint auto --route-id route-001 --max-iterations 10` blocks at `plan-approval-gate`; a Telegram `approve` reply maps to `waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute`, route state changes from blocked to active, event JSONL contains `route.gate.approved`, and the Hermes response quotes updated route status.

---

## H6 — End-to-end Hermes smoke

**Objective:** Prove Track 3 as an operator-visible workflow, not just isolated adapters.

**H6 status: complete.**

**Files changed:**

- Waypoint repo:
  - `docs/plans/waypoint-hermes-integration-plan.md`
  - `docs/plans/waypoint-remaining-roadmap.md`
  - `examples/hermes-operator-adapter/README.md`
  - `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`
  - `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts`
  - `src/__tests__/hermes-integration-plan.test.ts`

The H6 reference smoke lives at `examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.ts`.

**Smoke script/user journey:**

1. Register a temp or fixture project through the H1 project registry.
2. Initialize and start `waypoint` in that temp folder.
3. Use H2 safe Waypoint commands for operator-visible route/task/event operations.
4. Configure `runtime.recipe: local` to call the Hermes runtime adapter.
5. Run autopilot until the local Recipe runtime executes through the Hermes runtime adapter and emits `route.autopilot.task.executed` evidence.
6. Run the H4 discussion loop so the discussion loop appends user and agent-authored messages with loop prevention.
7. Continue to a human gate.
8. Prompt for gate decision over Telegram/Hermes through the H5 Telegram gate loop.
9. Approve `plan-approval-gate` through `waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute`.
10. Inspect durable `.waypoint/` route/task/event/discussion evidence, including `route.autopilot.task.executed` and `route.gate.approved`.

Implementation note: the current Waypoint scaffold includes early plan refs that are not one-to-one Recipe manifest slugs. The H6 smoke uses the null runtime to advance through those scaffold-only tasks, switches to the local Recipe runtime for the discussion agent task that has a real Recipe slug (`waypoint-doc-writer`), then switches back to null runtime to reach the human gate. This keeps H6 honest about the present catalog/runtime boundary instead of inventing Recipe manifests for scaffold plan refs.

**Verification gate:**

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/end-to-end-hermes-smoke.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
pnpm smoke:folder-host
pnpm test
pnpm typecheck
```

Smoke expectation: a temp project proves the H1 registry, H2 safe command runner, H3 Hermes Recipe runtime adapter, H4 discussion loop, and H5 Telegram gate loop in one operator-visible flow. The proof includes local runtime stdout containing `hermes-recipe-runtime-reference`, route events containing `route.autopilot.task.executed` and `route.gate.approved`, a discussion agent message with loop-prevention metadata, and a final route inspection showing `status: active`.

---

## Out of scope for Track 3

- Mission Control database cutover.
- Mission Control Kanban/UI implementation.
- Public/global CLI publication.
- Network sync or multi-user collaboration.
- A new Waypoint server.
- Treating Hermes as the source-of-truth database.

Mission Control can later become a rich UI and database adapter. That belongs to Track 2 or a later bridge track after the Hermes runtime/operator contract works standalone.

---

## H0 verification

H0 is complete when:

- this plan exists at `docs/plans/waypoint-hermes-integration-plan.md`;
- `docs/plans/waypoint-remaining-roadmap.md` marks Track 3 active and points here;
- docs tests cover the contract boundary and MC-later decision;
- targeted test passes;
- full `pnpm test` and `pnpm typecheck` pass before committing.
