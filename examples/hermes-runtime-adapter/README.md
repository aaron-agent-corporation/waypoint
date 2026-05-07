# Hermes Recipe runtime adapter reference

H3 status: complete.

This example documents the Track 3/H3 Recipe runtime bridge for standalone Waypoint folders.

The reference adapter lives at:

```text
examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs
```

## Purpose

Track 1/F10 made local Recipe execution opt-in through `runtime.recipe: local`. H3 provides the first Hermes-facing command that can receive the F10 Recipe execution payload over stdin and return Hermes-flavored output on stdout.

This is still a reference adapter. It does not call a live Telegram thread or remote Hermes gateway by itself. The operational Hermes profile wiring remains environment-specific.

## Input

The adapter accepts the F10 Recipe execution payload:

```json
{
  "schema_version": 1,
  "recipe_slug": "waypoint-doc-writer",
  "prompt": "Recipe prompt text from the local manifest",
  "task_id": "task-003",
  "route_id": "route-001",
  "project_root": "/tmp/waypoint-project"
}
```

Required fields:

- `schema_version: 1`
- `recipe_slug`
- `prompt`
- `task_id`
- `route_id`
- `project_root`

## Routing

Current routing contract:

```text
waypoint-planner → planner-capable Hermes/Gary execution
waypoint-verifier → verifier-capable Hermes/Gary execution
waypoint-doc-writer → doc-writer-capable Hermes/Gary execution
unknown recipe_slug → Gary/orchestrator fallback with explicit uncertainty
```

Unknown slugs are accepted only as an explicit fallback route. The adapter does not pretend that a specialist recipe handler exists when it does not.

## Output

The adapter emits structured JSON stdout:

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
  "summary": "...",
  "artifacts": [],
  "messages": []
}
```

Waypoint's existing local runtime still persists raw stdout, stderr, exit code, and signal on the task runtime metadata.

## Failure behavior

Invalid JSON or missing required payload fields exit non-zero and write the validation error to stderr. That means non-zero adapter exit should be persisted by the existing local runtime as task/route failure.

## Example command

```bash
printf '%s\n' '{"schema_version":1,"recipe_slug":"waypoint-doc-writer","prompt":"Draft docs","task_id":"task-003","route_id":"route-001","project_root":"/tmp/project"}' \
  | node examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs
```

## Verification

```bash
pnpm exec vitest run examples/hermes-runtime-adapter/hermes-recipe-runtime.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```
