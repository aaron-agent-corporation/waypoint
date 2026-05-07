# Hermes operator adapter reference

This example documents the first Track 3 bridge point: a read-only Hermes project registry.

H1 status: complete.

## Purpose

Hermes needs to map friendly project names to trusted local paths before it can run Waypoint commands safely from Telegram/operator requests.

The registry is intentionally not a natural-language path resolver. It supports this narrow lookup only:

```text
project name → absolute path + CLI entrypoint
```

Unknown project names fail closed. No arbitrary path execution from natural language is allowed.

## Registry shape

```yaml
projects:
  waypoint:
    path: /Users/aaronwhaley/Github/waypoint
    waypoint_cli: /Users/aaronwhaley/Github/waypoint/packages/waypoint-cli/src/bin.ts
```

Fields:

- `projects`: mapping of safe lowercase project names to project records.
- `path`: absolute project root path.
- `waypoint_cli`: optional absolute CLI entrypoint. If omitted, the reference parser defaults to `<path>/packages/waypoint-cli/src/bin.ts`.

Safe project names use lowercase letters, numbers, `_`, and `-`, and must start with a lowercase letter or number.

## Reference module

The H1 reference parser lives at:

```text
examples/hermes-operator-adapter/src/project-registry.ts
```

It exports:

- `parseHermesProjectRegistry(source)` — parse YAML registry text into a typed registry.
- `resolveHermesProject(registry, name)` — resolve a known project name or throw.
- `HermesProjectRegistry` / `HermesProjectRecord` types.

## Safety behavior

The parser rejects:

- project names like `../waypoint`;
- relative project paths;
- relative `waypoint_cli` paths;
- unknown project lookup requests.

This keeps H1 read-only. H2 builds a command runner on top of the resolved project record, but still never accepts arbitrary shell text.

## H2 safe Waypoint command runner

H2 status: complete.

The safe Waypoint command runner lives at:

```text
examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts
```

It exports:

- `buildSafeWaypointCommand(project, args)` — validate an explicit Waypoint argument array and return the exact Node command spec to run from the registered project root.
- `runSafeWaypointCommand(project, args, options)` — run the validated command through either the real child-process executor or an injected executor for tests/Hermes wiring.
- `SafeWaypointCommandSpec`, `WaypointCommandResult`, and `WaypointCommandExecutor` types.

The runner accepts only explicit `waypoint` argument arrays. Natural-language operator text must be parsed by Hermes before this layer is called.

Allowed read-only commands:

```text
waypoint status
waypoint routes
waypoint route --route-id <id>
waypoint route-events --route-id <id> [--limit N] [--offset N]
waypoint tasks [--route-id <id>]
waypoint auto status [--limit N] [--offset N]
```

Allowed mutation commands are explicitly marked in results:

```text
waypoint discuss --task-id <id> --message <text>
waypoint auto --route-id <id> [--max-iterations N]
waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
waypoint pause --route-id <id> [--reason <text>]
waypoint resume --route-id <id>
```

Safety behavior:

- command allowlist rejects non-Waypoint shell commands;
- command allowlist rejects Waypoint commands outside H2 scope, including `init`, `start`, `quests`, `recipes`, and `lifecycle`;
- each command has a narrow flag allowlist;
- missing required flag values fail before execution;
- `gate` requires exactly one of `--approve` or `--reject`;
- Mutation commands are explicitly marked;
- outputs are summarized without dropping route/task IDs by preserving raw stdout and stderr.

## Verification

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/project-registry.test.ts
pnpm exec vitest run examples/hermes-operator-adapter/src/safe-waypoint-command-runner.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```
