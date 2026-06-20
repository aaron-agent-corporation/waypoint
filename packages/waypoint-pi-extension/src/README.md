# @waypoint/pi-extension

A [Pi coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
extension that exposes the Waypoint authoring/run tools to an LLM agent, routed
over the engine-host loopback HTTP API with a per-session **scoped** bearer
token.

This package is loaded by the `PiCliBrainAdapter` (in `@waypoint/engine-host`),
which spawns:

```
pi -p --mode json --no-tools -e <path-to-this-extension> --system <prompt> <intent>
```

`--no-tools -e <ext>` scopes the agent to *only* the Waypoint tools this
extension registers.

## Environment

The extension reads two variables that the adapter injects into the Pi child
process. Both are required; activation throws if either is missing.

| Variable               | Meaning                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `WAYPOINT_HOST_URL`    | Loopback base URL of the engine host (e.g. `http://127.0.0.1:PORT/`). |
| `WAYPOINT_HOST_TOKEN`  | The **scoped** session token. The host enforces the grant on it.  |

## Tools

Each tool maps to one engine-host command and is named `waypoint_<command>` in
snake_case. The set is kept equal to the host's `AGENT_TOOL_GRANT` (a test
asserts parity):

- `waypoint_author_recipe`, `waypoint_author_quest`, `waypoint_author_design_spec`,
  `waypoint_author_handoff`, `waypoint_author_promote`
- `waypoint_run_adhoc`
- `waypoint_catalog_quests`, `waypoint_catalog_recipes`
- `waypoint_routes_list`, `waypoint_route_get`, `waypoint_route_events`, `waypoint_tasks_list`
- `waypoint_meta_commands`, `waypoint_meta_version`

**Not** exposed (and rejected by the host even over direct loopback):
`author.approveProposal` (proposals are landed only by a human) and
`workspace.open`. The agent authors and proposes; it never approves or switches
workspaces.

## Errors

`401` → an actionable authentication error (scoped token rejected/expired).
`403` → "tool not permitted by this session's grant". Other failures surface the
host's coded error envelope as an `isError` tool result so the agent can react.
