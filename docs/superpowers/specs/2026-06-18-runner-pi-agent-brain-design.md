# Spine Pi Agent Brain (Slice 2) — Design Spec

**Date:** 2026-06-18
**Status:** Brainstorm in progress — Section 1 approved; Sections 2+ drafted for review (persisted ahead of a context compact).
**Author:** Brainstormed with Aaron Whaley
**Builds on:** slice 1 (`@projectrunner/spine-engine-host`, shipped: commit `f01a2c7`). Slice 3 = Tauri shell + UI (later).

---

## Resume breadcrumb (read first if resuming post-compact)

We are in the **brainstorming** phase for slice 2, following the full process:
brainstorm → spec → writing-plans → `/autoplan` → `/mar` → execute (TDD, bd issue per task).
Section 1 was presented and **approved**. This doc captures every decision so far plus
the drafted architecture/testing so review can continue from the written spec.

**Next steps:** user reviews this spec → adjust if needed → invoke `superpowers:writing-plans`
→ then `/autoplan` then `/mar` on the plan → execute. Slice-2 build is gated on Task 0 spikes
(below). The autoplan/MAR reviews are expected to scrutinize the **unrestricted autonomous
execution** decision hardest.

---

## Decisions captured (from brainstorming Q&A)

1. **Brain MVP loop:** start with **author → propose**, but build the tool-exposure layer
   general so growing to a **full conversational orchestrator** (the eventual goal) is
   *additive* (register more tools + broaden the prompt), not a rewrite. *(User: "eventually
   #3, start at #1.")* — slice-2 scope then expanded by decisions 4–5 below.
2. **Tool exposure:** a **Pi extension** registers Spine operations as first-class Pi
   tools that call the engine-host HTTP API with the bearer token. Agent sees only granted
   tools (scoped + safe). **Needs a Task-0 spike** to confirm Pi's extension/tool-registration API.
3. **Brain surface:** exposed as **engine-host command(s)** behind a provider-neutral
   **`BrainAdapter`**; Pi turn/tool-call events stream onto the existing **EventHub** as an
   `agent:<sessionId>` topic. UI + CLI consume the brain through the slice-1 contract.
4. **Tool grant:** author + propose + **run authored** (ad-hoc). Agent may draft, run ad-hoc,
   and propose promotion; it may **not** `approveProposal` (promotion-to-static stays human-gated).
5. **Run model:** **ad-hoc, UNRESTRICTED.** The agent runs its authored draft as an
   **ephemeral route** (no catalog promotion needed) — pulling ad-hoc execution (the
   `runner-j3b` gap) into slice 2 — and is **not** constrained by recipe side-effect policy
   (may run side-effecting recipes). Promotion-to-static remains a separate human-gated proposal.
   *(User accepted the autonomy risk explicitly.)*
6. **Pi integration:** `PiCliBrainAdapter` drives Pi as a **headless child process**
   (`pi -p --mode json`, parsing its JSON event stream). Confirmed live in slice-1 Task 0:
   Pi has **no in-process Node SDK**; the npm `pi-sdk` is unrelated.

---

## Section 1 — Purpose, goals, non-goals (APPROVED)

**Purpose.** Turn natural-language intent into an authored Spine workflow, **run it
ad-hoc**, and **propose promotion** to the static catalog — surfaced as engine-host commands
that stream over the event hub.

**Goals**
- Provider-neutral `BrainAdapter`; first impl `PiCliBrainAdapter` (spawns `pi -p --mode json`).
- A **Pi extension** registering Spine tools that call the engine-host HTTP API with the
  bearer token. Granted: `author.recipe`, `author.quest`, `author.promote`, read-only
  `catalog.*` / `route.*`, and an **ad-hoc run** tool. **Not** granted: `author.approveProposal`.
- An **ad-hoc execution path**: instantiate + run an authored draft as an **ephemeral route**
  without static-catalog promotion (resolves `runner-j3b` for the agent). **Unrestricted.**
- New engine-host command(s) (e.g. `agent.author`) behind the BrainAdapter; **Pi events stream
  onto the EventHub** as `agent:<sessionId>`.
- Designed so a full conversational orchestrator is an additive extension.

**Non-goals (slice 2)**
- No Tauri shell / web UI (slice 3).
- No autonomous promotion-to-static (human-gated proposal, UC4).
- No new model-provider work beyond Pi's own config.

**Explicit risk posture:** the agent performs **autonomous, unrestricted execution** of
workflows it authors (including external side effects). Deliberate choice; guardrails are
minimal in slice 2; primary focus of the adversarial reviews.

---

## Section 2 — Architecture (DRAFT for review)

```
┌──────────────── engine-host (Node sidecar, slice 1) ────────────────┐
│  CommandBus ── agent.author ──▶ BrainAdapter (interface)            │
│      │                              │                                │
│      │                       PiCliBrainAdapter                       │
│      │                              │ spawn: pi -p --mode json       │
│      │                              ▼                                │
│      │                        Pi child process                      │
│      │                              │ loads Spine Pi extension    │
│      │   parse JSON turn events     │ (granted tools only)           │
│      ▼   → EventHub topic           │ tool call → HTTP loopback      │
│   EventHub  agent:<sessionId> ◀─────┘   POST /cmd/<name> (Bearer)    │
│      ▲                                        │                      │
│      └──────────── existing command handlers ◀┘ author.* / run-adhoc │
└─────────────────────────────────────────────────────────────────────┘
```

- **`BrainAdapter` interface** — `runSession({ intent, tools, systemPrompt, onEvent }) →
  Promise<BrainResult>`. Transport/provider-agnostic. `PiCliBrainAdapter` is the first impl;
  others (direct API, etc.) can plug in.
- **`PiCliBrainAdapter`** — spawns `pi -p --mode json` with `--no-skills`/scoped `--tools`,
  the Spine extension (`-e`), a scoped system prompt, and env carrying the engine-host
  `url` + `token`. Parses Pi's JSON event stream (`session/agent_start/message/toolcall/
  tool_execution/turn_end/agent_end`) into normalized `BrainEvent`s.
- **Spine Pi extension** — registers the granted tools; each tool calls the engine-host
  HTTP API (loopback, bearer) and returns the envelope to the agent. The extension is the
  *only* surface the agent can act through (scoping = safety boundary).
- **`agent.author` command** — input `{ intent, kind?, model? }`; mints a `sessionId`, invokes
  the BrainAdapter, republishes `BrainEvent`s onto EventHub topic `agent:<sessionId>`, returns
  a summary `{ sessionId, proposalId?, adhocRouteId?, transcriptRef }`.
- **Ad-hoc run path** — a runtime capability to instantiate + run an authored draft (primarily
  a **recipe** draft, the executable unit) as an ephemeral route not requiring static-catalog
  promotion. This is the slice-2 extension of the runtime (the `j3b` work, agent-scoped).

---

## Section 3 — Components & boundaries (DRAFT)

New package code under `packages/spine-engine-host/src/`:
```
brain/
  brain-adapter.ts        # BrainAdapter interface + BrainEvent/BrainResult types
  pi-cli-adapter.ts       # PiCliBrainAdapter: spawn pi, parse JSON stream → BrainEvent
  fake-adapter.ts         # deterministic test double (no real Pi)
  agent-session.ts        # sessionId, EventHub republish, transcript capture
  commands/agent.ts       # agent.author command registration
core/commands/run.ts      # + run.startAdhoc (ephemeral route from a draft)  [or new file]
```
Plus a **separate installable Pi extension package** (location TBD in plan — likely
`packages/spine-pi-extension/`) that registers the Spine tools against the host HTTP API.

- Each unit independently testable: BrainAdapter behind an interface (fake impl for unit tests);
  the extension tools are thin HTTP callers; `agent.author` maps a session to EventHub.
- Respects slice-1 boundaries: brain lives in the host package (or a sibling), never in core.

---

## Section 4 — Spikes (Task 0 — GATE, before slice-2 build)

1. **Pi extension/tool-registration API.** Confirm how a Pi extension registers custom tools
   the agent can call, how it receives args, and how it returns results — and that an extension
   can read env (host url/token) to call back over HTTP. If the extension API can't register
   custom tools cleanly, fall back to the **bash + scoped CLI** mechanism (documented
   alternative). Throwaway; document findings.
2. **Ad-hoc execution feasibility.** Confirm how to instantiate + run an authored **recipe**
   draft as an ephemeral route via the existing runtime (`IRecipeRuntime` / autopilot / beads
   execution planners) without static-catalog promotion. Identify the minimal seam. If it
   requires deep runtime changes, scope them explicitly. Throwaway; document findings.

Slice-2 build is gated on both spikes (mirrors slice-1 Task 0).

---

## Section 5 — Testing (DRAFT)

- **Unit:** `BrainAdapter` contract via `FakeBrainAdapter` (deterministic) — `agent.author`
  maps a scripted session to EventHub events + a result; tool-grant scoping (agent cannot
  invoke `approveProposal`); ad-hoc run path with a fixture draft.
- **Pi JSON parsing:** unit-test `PiCliBrainAdapter`'s stream parser against captured Pi JSON
  fixtures (from the Task-0 spike) → `BrainEvent`s. No live Pi.
- **Integration (gated, like real-bd):** a real-Pi end-to-end (`piAvailable()` gate, skipped
  without `pi`, required in CI) — intent → authored draft → ad-hoc run → proposal — asserting a
  proposal artifact + ephemeral route exist. Nondeterministic content; assert structure, not prose.
- **Smoke:** extend or add a smoke that drives `agent.author` with the fake adapter.

---

## Open questions / to verify

1. Pi extension tool-registration API (Spike 1) — drives the whole tool-exposure design.
2. Ad-hoc recipe execution seam (Spike 2) — the riskiest new runtime capability.
3. Whether the Pi extension ships as a separate package vs inline `-e` file (plan decision).
4. Transcript persistence location/format for `agent.author` (`.runner/agent/<sessionId>...`).

---

## Risk register (for autoplan/MAR)

- **Unrestricted autonomous execution** (decision 5) — an LLM authoring + running side-effecting
  workflows with minimal guardrails. Reviews should pressure-test blast radius, kill-switch,
  audit trail, and whether a side-effect gate should be reintroduced as a default.
- **Pi capability assumptions** (extension API) — Task-0 spike must retire before building.
- **Ad-hoc execution** reuses/extends runtime internals — correctness + isolation from static catalog.
