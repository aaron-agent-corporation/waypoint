# Waypoint folder-host Quest example

This example is a minimal project folder for trying the Waypoint folder host against the bundled `waypoint` Quest.

The example intentionally does not check in `.waypoint/` state. Run the commands below to generate it locally.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm typecheck
```

## Run from scratch

```bash
cd examples/folder-host-quest
node ../../packages/waypoint-cli/src/bin.ts --help
node ../../packages/waypoint-cli/src/bin.ts --version
node ../../packages/waypoint-cli/src/bin.ts init --quest waypoint
node ../../packages/waypoint-cli/src/bin.ts status
node ../../packages/waypoint-cli/src/bin.ts quests
node ../../packages/waypoint-cli/src/bin.ts recipes --quest waypoint
node ../../packages/waypoint-cli/src/bin.ts start --quest waypoint
node ../../packages/waypoint-cli/src/bin.ts routes
node ../../packages/waypoint-cli/src/bin.ts route --route-id route-001
node ../../packages/waypoint-cli/src/bin.ts route-events --route-id route-001
node ../../packages/waypoint-cli/src/bin.ts tasks --route-id route-001
node ../../packages/waypoint-cli/src/bin.ts discuss --task-id task-003 --message "Clarify the goal."
node ../../packages/waypoint-cli/src/bin.ts auto --route-id route-001
node ../../packages/waypoint-cli/src/bin.ts auto status
```

After autopilot reaches the plan gate, decide it explicitly:

```bash
node ../../packages/waypoint-cli/src/bin.ts gate --route-id route-001 --node plan-approval-gate --approve --note "Example approval."
```

Pause and resume are also available:

```bash
node ../../packages/waypoint-cli/src/bin.ts pause --route-id route-001 --reason "Example pause."
node ../../packages/waypoint-cli/src/bin.ts resume --route-id route-001
```

## Generated state

Running the walkthrough creates `.waypoint/` in this example folder. Expected files include:

```text
.waypoint/config.yaml
.waypoint/quests/waypoint.yaml
.waypoint/recipes/
.waypoint/lifecycle/workstreams.yaml
.waypoint/lifecycle/milestones.yaml
.waypoint/lifecycle/phases.yaml
.waypoint/lifecycle/plans.yaml
.waypoint/routes/route-001.yaml
.waypoint/events/route-001.jsonl
.waypoint/tasks/tasks.yaml
.waypoint/tasks/task-003-discussion.jsonl
.waypoint/autopilot/runs.jsonl
```

## Reset the example

```bash
rm -rf .waypoint
```

Then rerun:

```bash
node ../../packages/waypoint-cli/src/bin.ts init --quest waypoint
node ../../packages/waypoint-cli/src/bin.ts start --quest waypoint
```

## Runtime safety

The default null runtime is safe and simulated. Do not enable `runtime.recipe: local` unless you intentionally want Waypoint to execute a configured local command from this folder.
