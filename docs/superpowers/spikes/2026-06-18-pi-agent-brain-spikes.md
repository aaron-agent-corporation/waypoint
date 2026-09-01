# Slice 2 (Pi Agent Brain) — Task 0 Spike Findings

**Date:** 2026-06-19 · **Issue:** runner-r66 · **Status:** both spikes resolved; build gate cleared.
**Pinned:** `pi 0.55.3` (package `@mariozechner/pi-coding-agent`) → `PI_PINNED_RANGE`.

These spikes retire the two gating unknowns for the slice-2 plan
(`docs/superpowers/plans/2026-06-18-runner-pi-agent-brain.md`). Throwaway scratch was under
`/tmp/pi-spike`; the durable outputs are the captured fixtures in
`packages/spine-engine-host/src/brain/__fixtures__/pi-stream/` and this doc.

---

## Spike 1 — Pi extension / tool-registration API (RESOLVED; Lock 9 STOP **not** triggered)

### Custom tools are first-class
Pi extensions register LLM-callable tools via `pi.registerTool(...)` (authoritative:
`@mariozechner/pi-coding-agent/docs/extensions.md`). A `.ts`/`.js` extension default-exports
`(pi: ExtensionAPI) => void` and calls:

```ts
pi.registerTool({
  name: "runner_author_recipe",
  label: "...",
  description: "...",                         // shown to the LLM
  parameters: Type.Object({ ... }),           // @sinclair/typebox; use StringEnum (from @mariozechner/pi-ai) for enums (Google compat)
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return { content: [{ type: "text", text: "..." }], details: {} }  // content → LLM
  },
})
```

Loaded with `-e <path>` (repeatable). **`pi --no-tools -e <ext>` gives the agent ONLY the
extension's tools** — no `read`/`bash`/`edit`/`write` — which is exactly the scoped, no-shell
surface slice 2 wants. `execute` receives an `AbortSignal` (cancellation-aware). Confirmed end to
end: a `runner_ping` tool read `process.env.SPINE_HOST_URL` and the agent called it, returning
`pong world url=http://127.0.0.1:9999/` (real session, `tool-session.jsonl`). So env-injected
loopback callback creds + custom tools both work — the planned Pi-extension design is feasible as-is.

### Operational gotcha (important, already mitigated by the plan)
`pi -p -e <ext>` **blocks on stdin** if stdin is an open pipe/TTY without EOF: every `-p --mode json
-e ...` run hung (timeout, zero output — even a no-op extension, both `.ts` and `.js`) until stdin
was closed. Closing stdin fixes it deterministically (verified: `</dev/null` alone, no `--offline`
needed). **The plan's Task 7 already spawns with `stdio: ['ignore', 'pipe', 'pipe']` (stdin =
/dev/null), so `PiCliBrainAdapter` is unaffected** — this was purely a manual-shell artifact. Action:
keep `stdio[0]: 'ignore'` as a load-bearing requirement (add a comment + an adapter test asserting
the child is spawned with stdin ignored). Plain `pi -p` (no `-e`) does not exhibit the hang.

### JSON event schema (`--mode json`) — captured real
First line is a `session` header, then one JSON object per line for each `AgentSessionEvent`. Real
top-level `type` values observed (fixtures `basic-session.jsonl`, `tool-session.jsonl`):

```
session            # { type, version, id, timestamp, cwd }   ← header
agent_start
turn_start
message_start      # { message: { role: 'user'|'assistant', content, ... } }
message_update     # { assistantMessageEvent: { type: 'text_start'|'text_delta'|'text_end'
                   #   | 'toolcall_start'|'toolcall_delta'|'toolcall_end', ... }, message }
message_end
tool_execution_start  # { toolCallId, toolName, ... }
tool_execution_end    # { toolCallId, toolName, result: { content:[{type:'text',text}], details }, isError }
turn_end           # { message, toolResults: [...] }
agent_end          # { messages: [...] }
```

Decoder map for `PiStreamDecoder` (Task 7):
- `tool_execution_start` → `BrainEvent.kind = 'agent.toolcall'` (carry `toolName`)
- `tool_execution_end` → `'agent.tool_result'` (carry `toolName`, `result.content[].text`, `isError`) — **this is where the adapter extracts `proposalId`/`adhocRouteId`** from the Spine tool's returned content.
- `message_end` (assistant) → `'agent.message'` (text)
- `agent_end` → `'agent.end'` (terminal; `extractBrainResult` keys off this)
- `agent_start`/`turn_start`/`turn_end` → pass-through `agent.<type>`
- tool-call *arguments* stream as nested `toolcall_start`/`toolcall_delta`/`toolcall_end` inside
  `message_update.assistantMessageEvent` — the decoder can ignore the deltas and rely on the
  top-level `tool_execution_*` pair (simpler, sufficient).

Fixtures saved: `basic-session.jsonl` (12 lines, no tools), `tool-session.jsonl` (25 lines, full
tool-call lifecycle), `ping-ext.reference.ts` (the extension used). For the decoder's split-chunk /
multi-record / trailing-no-newline tests (Task 7), derive variants by re-chunking these real lines
at arbitrary byte boundaries — no new live capture needed. The Task-7 snapshot test asserts decoded
`BrainEvent[]` against a committed snapshot so a future `pi` bump fails loud.

**Lock 9:** json-mode cleanly registers a custom tool and streams the tool call + result. The
STOP-and-surface condition does NOT fire. No RPC, no bash fallback.

---

## Spike 2 — session-overlay ad-hoc execution + abort (RESOLVED)

### Recipe resolution is disk-based and easy to overlay
`runSpineAutopilot` (`packages/spine-folder-host/src/autopilot/run.ts`) resolves a recipe via
`loadRecipeManifest(projectRoot, slug)` which walks **one hardcoded directory**:
`join(getSpineProjectPaths(projectRoot).runnerDir, 'recipes')` (`run.ts:393-399`). The route is
materialized from the local quest manifest (`.runner/quests/<slug>.yaml`) — `startQuestRoute`'s
bundled-catalog `resolveQuestRecipes` is only a validation gate, the executable recipes come from disk.

**Minimal overlay seam (pins Task 6):**
1. Add `catalogDir?: string` to `RunSpineAutopilotOptions`; thread it into `loadRecipeManifest`
   (default `<runnerDir>/recipes`, overlay `<runnerDir>/agent/<sessionId>/catalog/recipes`).
2. New `startAdhocRoute(projectRoot, { sessionId, questYaml, recipeYamls, dryRun?, signal? })`
   (`routes/start-adhoc.ts`): write the draft quest+recipes under
   `.runner/agent/<sessionId>/catalog/{quests,recipes}/`, materialize the route + tasks from the
   parsed quest (reusing `applyQuestScaffold` + `materializeQuestTasks`), tag metadata
   `{ adhoc:true, sessionId, overlay:'<dir>' }`. Do **not** call the bundled resolver. If `!dryRun`,
   call `runSpineAutopilot(projectRoot, { routeId, catalogDir: overlayRecipesParent, signal })`.
   No writes to the live `.runner/quests|recipes` → no collision/shadowing (Lock 3).

### AbortSignal threading is localized
`LocalRecipeRuntime.runRecipe` (`runtime/local-runtime.ts`) → `runCommand(cmd, args, stdin)` spawns a
child via `node:child_process.spawn` with **no signal** today. Minimal change:
1. Add `signal?: AbortSignal` to `LocalRecipeRuntimeInput` (and the `IRecipeRuntime` recipe-run input).
2. `runCommand(cmd, args, stdin, { signal })`: on `signal.abort`, `child.kill('SIGTERM')` then a
   timer escalates to `SIGKILL` (kill the process **group** — spawn with `detached:true` + `kill(-pid)`
   — so a recipe's own children die too). Resolve as a cancelled outcome.
3. `runSpineAutopilot({ signal })` passes `signal` into each `runRecipe` call and stops the loop
   when aborted.

This makes `agent.cancel` → `AbortController.abort()` → autopilot stops + in-flight child is killed.
Best-effort per Lock: it cannot roll back side effects already committed before the kill.

**No deep runtime surgery required** — both changes are additive options on existing functions.

---

## Net

Both gates cleared; the plan's architecture stands unchanged. Two findings fold into the build:
- **Task 7:** keep/comment `stdio: ['ignore', …]` (stdin must be closed) + add an adapter test for it; decoder map + snapshot per the schema above.
- **Task 6:** `catalogDir` option on autopilot + `signal` through `runRecipe`/`runCommand` (process-group kill) — both additive.
