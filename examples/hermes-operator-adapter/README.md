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

This keeps H1 read-only. H2 will build a command runner on top of the resolved project record, but H1 does not run shell commands.

## Verification

```bash
pnpm exec vitest run examples/hermes-operator-adapter/src/project-registry.test.ts
pnpm exec vitest run src/__tests__/hermes-integration-plan.test.ts
```
