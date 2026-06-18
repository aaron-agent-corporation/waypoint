# Engine Host — Task 0 De-Risk Spikes (findings)

**Date:** 2026-06-18 · **Gate for:** slice-1 build (Tasks 1-15) · **Beads:** waypoint-al4
Throwaway spikes; no spike code retained. Environment: Pi 0.55.3, bd 1.0.4 (Homebrew), Dolt 2.0.8, Node 22, macOS arm64.

---

## Spike A — Pi SDK reachability → GREEN (with architecture correction)

**Question:** Can the orchestrator brain run an in-process Pi tool-calling agent loop in Node (the spec/UC assumed a "Pi SDK / library")?

**Finding: there is NO in-process Node SDK for Pi — but Pi's headless CLI is a fully usable programmatic surface.**
- The npm package `pi-sdk` (0.0.16) is unrelated ("Pay Insights SDK") — a red herring. `@pi-dev/sdk` does not exist.
- Pi (`/opt/homebrew/bin/pi` 0.55.3) is an AI coding-assistant CLI with a **machine-drivable headless mode**: `--print/-p` (non-interactive), `--mode text|json|rpc`, `--provider`/`--model`/`--api-key`, `--tools`, `--skill`, `--system-prompt`, `--session-dir`/`--no-session`, `--no-tools`.
- **Verified live:** `pi -p --mode json --tools bash "...echo PI_SPIKE_OK...DONE"` ran a full tool-calling agent loop end to end — agent emitted a `bash` toolCall, Pi executed it (`tool_execution_start/end`, result `PI_SPIKE_OK`), then produced final text `DONE`. Output is a clean structured JSON event stream (`session → agent_start → message/toolcall deltas → tool_execution_* → turn_end → agent_end` with full message history + usage/cost). Ran on provider `anthropic` / `claude-opus-4-6`, ~$0.04.

**Decision / impact (consistent with resolved-decision response-codex-1-issue-4):**
- A NO/unusable-*SDK* result blocks only **Pi-dependent integration**, not the transport-agnostic engine-host core. **Slice 1 is unaffected** and proceeds.
- Slice 2's brain should drive Pi as a **child process** (`pi -p --mode json` or `--mode rpc` over stdio) parsing the event stream — behind a **provider-neutral `BrainAdapter`** (vindicates the CEO reviewers). `--mode rpc` is the candidate for a persistent in-process-feeling connection; evaluate in slice 2.
- Exposing Waypoint authoring/runtime ops as Pi tools = Pi **extensions** or an rpc tool-bridge (slice 2).
- **⚠️ This contradicts the earlier "Pi SDK / library" selection.** The realistic integration is CLI-spawn (json/rpc), not an imported library. Surfaced to the user; does not block slice 1.

---

## Spike B — real bd/Dolt resident-process contention → GREEN

**Question:** Does a resident process spawning `bd` per operation hit Dolt lock contention?

**Method:** Throwaway script: `bd init` (embedded Dolt) in a temp workspace, seed 5 issues, then 25 sequential + 12 concurrent mixed `bd` ops (list/ready/stats/create/list--status), precise failure detection (non-zero exit OR exact `database is locked`/connection/dolt/panic phrases — first pass had false positives matching "lock" inside "b**lock**ed").

**Result: 0 real failures.** Sequential(25) ~11s, concurrent(12) ~4s. All 13 writes landed (no lost writes); concurrent was *faster* per-op than sequential. Embedded Dolt + bd 1.0.4 handled concurrent invocations against one workspace gracefully at this load.

**Caveats / decisions:**
- Moderate load only (12 concurrent). Keep the **per-workspace serialized mutation queue** (Task 5 layer (a)) as cheap defense-in-depth AND because it also guarantees event-ID-diff ordering — it is **not** a correctness emergency, downgrade from "hard requirement on contention" to "adopt for ordering + safety."
- `bd` spawn latency ~0.3-0.4s/op → minimize spawns and prefer the session-owned client; perf matters at scale.
- The **real-`bd` CI lane (Task 14) remains required** to keep "Beads first-class" honest under heavier concurrency than this spike exercised.

### Client-injection seam (Spike B sub-question) → EXISTS (no folder-host change needed)
The seam is present across every folder-host entry point, under **four field names** (all satisfied by one `WaypointBeadsCliIssueClient`):
- `startQuestRoute` → `beadsClient` (`WaypointBeadsIssueClient`)
- read-model (`listWaypointRuntimeRoutes`/`getWaypointRuntimeRoute`/`listWaypointRuntimeTasks`) → `beadsReader` (`WaypointBeadsIssueSnapshotReader`)
- transitions (`approveRouteGate`/`rejectRouteGate`/`pauseWaypointRoute`/`resumeWaypointRoute`/`resolveWaypointRouteBlocker`, via `WaypointBeadsTransitionOptions`) → `beadsMutator` (`WaypointBeadsIssueMutationClient`)
- events + discussion read-model → `beadsReader` + `beadsCommentReader`

**Task 5 impact:** WorkspaceSession constructs **one** `WaypointBeadsCliIssueClient` per workspace and threads it through every call under the matching field name. **No folder-host modification required** (better than the plan's contingency of adding the seam). Confirm `WaypointBeadsCliIssueClient` implements all four interfaces (it is the default fallback for each, so it does).

---

## Gate verdict: PASS — Task 1 unblocked
- Spike A: Pi reachable via headless CLI (json/rpc); slice 1 unaffected; Pi-integration model corrected to CLI-spawn behind a BrainAdapter (slice 2). **User decision flagged** (was "SDK/library").
- Spike B: no lock contention at tested load; injection seam exists (one client, four field names); serialized queue kept for ordering/safety; real-bd CI lane still required.
