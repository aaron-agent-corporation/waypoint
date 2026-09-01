#!/usr/bin/env python3
"""Deterministic .prose -> quest YAML compiler.

Implements docs/PROSE-CONVENTION.md as plain code: the
compiler translates, it never authors. Every free-text value in the output
is copied verbatim from the prose; every judgment call is a fixed rule; any
ambiguity is a compile error. No LLM anywhere — byte-reproducible forever.

Usage:
    tools/prose/compile.py <file.prose>            # YAML to stdout
    tools/prose/compile.py <file.prose> -o out.yaml
Exit 0 on success; exit 2 with "COMPILE ERROR: ..." on stderr otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field

# Closed vocabulary: prose ground-rule sentence -> (yaml_key, yaml_value).
# Emission order is this table's order, regardless of prose order.
GROUND_RULES = [
    ("Source files are read-only.", ("source_files_read_only", "true")),
    ("No external side effects.", ("external_side_effects", "forbidden")),
]


class CompileError(Exception):
    pass


def kebab(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def initials(name: str) -> str:
    return "".join(w[0].upper() for w in name.split() if w)


def scalar(value: str) -> str:
    """Quote a YAML scalar only when YAML syntax forces it (single quotes)."""
    forces = (
        value != value.strip()
        or value == ""
        or re.search(r": |^[-?#&*!|>%@`\"'{}\[\],]| #", value)
        or value.endswith(":")
        or re.fullmatch(r"-?\d+(\.\d+)?", value) is not None
        or value.lower() in ("true", "false", "null", "~", "yes", "no", "on", "off")
    )
    if forces:
        return "'" + value.replace("'", "''") + "'"
    return value


# Quest sets: the at-a-glance taxonomy for the quests menu. Waypoint ships
# one internal set (`core`) for the bundled scaffold quests; a host embedding
# the runner declares its own sets via `metadata.runner.quest_set` on its
# authored quest manifests (see packages/waypoint-cli/src/commands/quest-set.ts).
QUEST_SETS = ("core",)

# D5 (2026-08-24): a quest that has never been proven end to end is real code
# with an unknown failure surface. Declaring it keeps the quest visible and
# editable while `waypoint start` refuses it. Omitting the line means available.
AVAILABILITY = {
    "available": "available",
    "not yet available": "not_yet_available",
}

@dataclass
class Plan:
    ref: str
    title: str
    kind: str  # step | gate | handoff | wait | discussion (pre node-inference bucket)
    recipe: str | None = None
    only_when: str | None = None
    when_sql: str | None = None  # machine predicate (X2): compiled verbatim into df.if
    wave: int | None = None
    produces: list[str] = field(default_factory=list)
    contract: str | None = None  # vetted content-contract name (rsc-6al); copied verbatim, registry-checked at durable admission
    fanout_dir: str | None = None  # "For each:" (rsc-m23.7): one plan per item, expanded at route start
    fanout_ends_with: str | None = None
    fanout_directories: bool = False
    fanout_allow_empty: bool = False
    access: list[str] = field(default_factory=list)  # "<binding>: ro|rw" entries (rsc-8ip)
    access_all: bool = False  # "Access: all" shorthand (rsc-w0z): grant every declared root at its base mode
    steps: list[str] = field(default_factory=list)
    review_checks: list[str] = field(default_factory=list)
    review_independent: bool = False
    gate_kind: str | None = None
    gate_approves: str | None = None  # 'changeset' pins approval to reviewed bytes (rsc-7rw); absent = completion
    handoff_kind: str | None = None
    handoff_gate_required: bool = False
    handoff_no_gate: bool = False
    handoff_gate_ref: str | None = None
    wait_kind: str | None = None
    wait_landmark: str | None = None
    wait_days: int | None = None
    wait_exit_landmark: str | None = None
    discussion_agent: str | None = None
    port: list[str] = field(default_factory=list)

    def node_type(self) -> str:
        if self.kind in ("gate", "handoff", "wait", "discussion"):
            return self.kind
        if self.recipe:
            return "recipe"
        if self.produces:
            return "artifact"
        return "checkpoint"


@dataclass
class Phase:
    title: str
    lifecycle: str
    key: str | None = None
    slug: str | None = None
    plans: list[Plan] = field(default_factory=list)


@dataclass
class Quest:
    name: str = ""
    description: str = ""
    slug_override: str | None = None
    repeat_days: float | None = None  # X4: whole-quest repeat interval (loops on the durable engine)
    workflow_override: str | None = None
    family: str | None = None
    availability: str | None = None
    quest_set: str | None = None
    summary: str | None = None
    source_project: str | None = None
    source_path: str | None = None
    source_snapshot: str | None = None
    source_ported: str | None = None
    safety: list[tuple[str, str]] = field(default_factory=list)
    # Quest-level seatbelt roots (rsc-w0z): binding -> (path, base access).
    # `waypoint init` materializes these into `.waypoint/config.yaml` roots so a
    # jailed dispatch resolves every plan `Access:` binding instead of failing
    # closed at "config declares no such root".
    roots: list[tuple[str, str, str]] = field(default_factory=list)
    recipes: list[str] = field(default_factory=list)
    record_block: list[str] | None = None
    workstream_key: str | None = None
    workstream_name: str | None = None
    milestone_label: str | None = None
    milestone_title: str | None = None
    phases: list[Phase] = field(default_factory=list)


_REF_RE = re.compile(r"^(?P<title>.*?)\s*\(ref:\s*(?P<ref>[a-z0-9-]+)\)\s*$")
_PHASE_RE = re.compile(r"^Phase:\s*(.+?)\s*\(([\w-]+)\)(?:\s*\[(.+?)\])?$")
_HANDOFF_KIND_RE = re.compile(r"^(\S+?)(?:,\s*(?:after gate\s+(\S+)|(gate required)|(no gate)))?$")


def _when_sql_problems(predicate: str) -> list[str]:
    """Fail-closed admission for the machine predicate (X2). Mirrors    packages/waypoint-folder-host/src/pgdurable/when.ts — the df
    compiler re-checks, but authoring must refuse first. Raw SQL is the one
    place prose could smuggle an invalid node into the compiled graph."""
    problems: list[str] = []
    trimmed = predicate.strip()
    if not trimmed:
        return ["predicate is empty"]
    if not re.match(r"select\b", trimmed, re.IGNORECASE):
        problems.append("predicate must be a single SELECT statement (read-only)")
    if ";" in trimmed:
        problems.append("';' is not allowed (single statement only)")
    if "$" in trimmed:
        problems.append("'$' is not allowed (no result-variable substitution, no dollar quoting)")
    known_vars = (
        "waypoint_schema", "waypoint_route_id", "waypoint_quest",
        "waypoint_subject_type", "waypoint_subject_id",
    )
    without_known = re.sub(r"\{(?:" + "|".join(known_vars) + r")\}", "", trimmed)
    if "{" in without_known or "}" in without_known:
        problems.append(
            "'{' and '}' are allowed only as the start-time variables "
            + ", ".join("{" + v + "}" for v in known_vars)
            + " (anything else is unspecified substitution; build JSON with jsonb_build_object)"
        )
    if "--" in trimmed or "/*" in trimmed:
        problems.append("SQL comments are not allowed")
    if re.search(r"\bdf\s*\.", trimmed, re.IGNORECASE):
        problems.append("'df.' calls are not allowed (predicates must not touch the engine)")
    return problems


def _split_title(text: str) -> tuple[str, str]:
    """Return (title, ref) from a bullet's title line."""
    m = _REF_RE.match(text)
    if m:
        return m.group("title").rstrip(), m.group("ref")
    return text.rstrip(), kebab(text)


def parse(text: str, filename: str = "<prose>") -> Quest:
    q = Quest()
    lines = text.splitlines()
    i = 0
    n = len(lines)
    section = None  # current ## section handler name
    phase: Phase | None = None
    plan: Plan | None = None
    list_target: list[str] | None = None  # Produces:/Steps:/Review checks: sink

    def err(msg: str) -> CompileError:
        return CompileError(f"COMPILE ERROR: {msg} ({filename} line {i + 1})")

    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if line.startswith("# ") and not line.startswith("## "):
            q.name = line[2:].strip()
            # Purpose block: every line until the next section heading.
            j = i + 1
            block: list[str] = []
            while j < n and not lines[j].startswith("## "):
                block.append(lines[j].rstrip())
                j += 1
            while block and not block[0]:
                block.pop(0)
            while block and not block[-1]:
                block.pop()
            if not block:
                raise err("quest name must be followed by a purpose line or block")
            q.description = "\n".join(block)
            i = j
            continue

        if line.startswith("## "):
            heading = line[3:].strip()
            plan = None
            list_target = None
            if heading == "Catalog details":
                section = "catalog"
            elif heading == "Ground rules":
                section = "ground"
            elif heading == "Access roots":
                section = "roots"
            elif heading == "Recipes used":
                section = "recipes"
            elif heading == "Record":
                section = "record"
            elif heading.startswith("Workstream "):
                m = re.match(r"^Workstream\s+(\S+):\s*(.+)$", heading)
                if not m:
                    raise err("workstream heading must be '## Workstream <key>: <Name>'")
                q.workstream_key, q.workstream_name = m.group(1), m.group(2)
                section = None
            elif heading.startswith("Milestone "):
                m = re.match(r"^Milestone\s+(\S+):\s*(.+)$", heading)
                if not m:
                    raise err("milestone heading must be '## Milestone <label>: <Title>'")
                q.milestone_label, q.milestone_title = m.group(1), m.group(2)
                section = None
            elif heading.startswith("Phase:"):
                m = _PHASE_RE.match(heading)
                if not m:
                    raise err(
                        "phase heading must be '## Phase: <Title> (<lifecycle>)[ [key: <key>]]'"
                    )
                phase = Phase(title=m.group(1), lifecycle=m.group(2))
                if m.group(3):
                    for pair in m.group(3).split(","):
                        pk, _, pv = pair.partition(":")
                        pk, pv = pk.strip(), pv.strip()
                        if pk == "key" and pv:
                            phase.key = pv
                        elif pk == "slug" and pv:
                            phase.slug = pv
                        else:
                            raise err(f"unknown phase annotation {pair.strip()!r}")
                q.phases.append(phase)
                section = "phase"
            else:
                raise err(f"unknown section {heading!r}")
            i += 1
            continue

        if section == "record":
            if stripped.startswith("```"):
                if q.record_block is not None:
                    raise err("only one fenced block is allowed in '## Record'")
                block: list[str] = []
                i += 1
                while i < n and not lines[i].startswith("```"):
                    block.append(lines[i].rstrip())
                    i += 1
                if i >= n:
                    raise err("unterminated fenced block in '## Record'")
                q.record_block = block
                i += 1
                continue
            raise err("'## Record' holds exactly one fenced ``` block of verbatim YAML")

        if section == "catalog":
            if stripped.startswith("Slug:"):
                q.slug_override = stripped[len("Slug:") :].strip()
            elif stripped.startswith("Workflow:"):
                q.workflow_override = stripped[len("Workflow:") :].strip()
            elif stripped.startswith("Family:"):
                q.family = stripped[len("Family:") :].strip()
            elif stripped.startswith("Availability:"):
                value = stripped[len("Availability:") :].strip()
                if value not in AVAILABILITY:
                    raise err(
                        "Availability must be one of "
                        f"{', '.join(sorted(AVAILABILITY))} (got {value!r})"
                    )
                q.availability = AVAILABILITY[value]
            elif stripped.startswith("Set:"):
                value = stripped[len("Set:") :].strip()
                if value not in QUEST_SETS:
                    raise err(
                        f"Set must be one of {', '.join(QUEST_SETS)} (got {value!r})"
                    )
                q.quest_set = value
            elif stripped.startswith("Summary:"):
                q.summary = stripped[len("Summary:") :].strip()
            elif stripped.startswith("Repeat:"):
                rest = stripped[len("Repeat:") :].strip()
                m = re.match(r"^every\s+(\d+(?:\.\d+)?)\s+days?$", rest)
                if not m:
                    raise err("Repeat line must be 'every <number> day(s)'")
                q.repeat_days = float(m.group(1))
                if q.repeat_days <= 0:
                    raise err("Repeat interval must be a positive number of days")
            elif stripped.startswith("Source:"):
                rest = stripped[len("Source:") :].strip()
                m = re.match(
                    r"^(\S+)\s+(\S+)(?:\s+snapshot\s+(\S+))?(?:\s+ported\s+(\S+))?$", rest
                )
                if not m:
                    raise err("Source line must be '<project> <path> [snapshot <path>] [ported <date>]'")
                q.source_project, q.source_path = m.group(1), m.group(2)
                q.source_snapshot, q.source_ported = m.group(3), m.group(4)
            else:
                raise err(f"unknown catalog detail {stripped!r}")
            i += 1
            continue

        if section == "ground":
            if not stripped.startswith("- "):
                raise err("ground rules must be bullets")
            sentence = stripped[2:].strip()
            match = next((kv for s, kv in GROUND_RULES if s == sentence), None)
            if match is None:
                raise err(
                    f"ground rule {sentence!r} is not in the closed vocabulary "
                    "(amend PROSE-CONVENTION.md to add it)"
                )
            q.safety.append(match)
            i += 1
            continue

        if section == "roots":
            if not stripped.startswith("- "):
                raise err("access roots must be bullets")
            entry = stripped[2:].strip()
            m = re.match(r"^([a-z_][a-z0-9_]*):\s*(.+?)\s*\((ro|rw)\)$", entry)
            if not m:
                raise err(
                    f"access root {entry!r} must be '<binding>: <path> (ro|rw)'"
                )
            binding, rpath, access = m.group(1), m.group(2).strip(), m.group(3)
            if not rpath:
                raise err(f"access root {binding!r} has an empty path")
            if any(b == binding for b, _, _ in q.roots):
                raise err(f"duplicate access root {binding!r}")
            q.roots.append((binding, rpath, access))
            i += 1
            continue

        if section == "recipes":
            if not stripped.startswith("- "):
                raise err("recipes must be bullets")
            q.recipes.append(stripped[2:].strip())
            i += 1
            continue

        if section == "phase":
            assert phase is not None
            indent = len(raw) - len(raw.lstrip(" "))

            if indent == 0 and stripped.startswith("- "):
                body = stripped[2:].strip()
                list_target = None
                for prefix, kind in (
                    ("Gate:", "gate"),
                    ("Handoff:", "handoff"),
                    ("Wait:", "wait"),
                    ("Discussion:", "discussion"),
                ):
                    if body.startswith(prefix):
                        title, ref = _split_title(body[len(prefix) :].strip())
                        plan = Plan(ref=ref, title=title, kind=kind)
                        break
                else:
                    title, ref = _split_title(body)
                    plan = Plan(ref=ref, title=title, kind="step")
                phase.plans.append(plan)
                i += 1
                continue

            if plan is None:
                raise err(f"unexpected line outside a plan bullet: {stripped!r}")

            if indent >= 4 and stripped.startswith("- ") and list_target is not None:
                list_target.append(stripped[2:].strip())
                i += 1
                continue

            # 2-space attribute lines on the current plan.
            if stripped.startswith("Uses recipe:"):
                plan.recipe = stripped[len("Uses recipe:") :].strip()
                list_target = None
            elif stripped.startswith("Only when:"):
                plan.only_when = stripped[len("Only when:") :].strip()
                list_target = None
            elif stripped.startswith("For each:"):
                # "For each: sources/*.md" — one plan per entry, one
                # worker per item, expanded at route start. The whole point is
                # that coverage stops being something a worker remembers, so an
                # unparseable pattern must refuse rather than quietly cover one
                # directory-shaped thing.
                value = stripped[len("For each:") :].strip()
                if value.endswith(" (may be empty)"):
                    plan.fanout_allow_empty = True
                    value = value[: -len(" (may be empty)")].strip()
                if value.endswith("/*/"):
                    # One item per SUBDIRECTORY — the shape the case's provider
                    # registry actually has (one directory per provider).
                    plan.fanout_dir = value[: -len("/*/")]
                    plan.fanout_directories = True
                else:
                    head, sep, tail = value.rpartition("/")
                    if not sep or not tail.startswith("*") or len(tail) < 2:
                        raise err(
                            "For each must be '<dir>/*<suffix>' or '<dir>/*/', "
                            "e.g. 'sources/*/' or 'documents/*.md'"
                        )
                    plan.fanout_dir = head
                    plan.fanout_ends_with = tail[1:]
                list_target = None
            elif stripped.startswith("When (SQL):"):
                plan.when_sql = stripped[len("When (SQL):") :].strip()
                list_target = None
            elif stripped.startswith("Wave:"):
                try:
                    plan.wave = int(stripped[len("Wave:") :].strip())
                except ValueError:
                    raise err("Wave must be an integer")
                list_target = None
            elif stripped == "Produces:":
                list_target = plan.produces
            elif stripped.startswith("Contract:"):
                value = stripped[len("Contract:") :].strip()
                if not value:
                    raise err("Contract requires a contract name")
                plan.contract = value
                list_target = None
            elif stripped == "Access: all":
                # Shorthand for a plan that touches the whole case: grant every
                # declared root at its base mode. Recipes write across
                # ~24 case areas under one broad rw root, so per-binding maps
                # would be noise; the base modes keep the ro holes ro.
                plan.access_all = True
                list_target = None
            elif stripped == "Access:":
                list_target = plan.access
            elif stripped == "Steps:":
                list_target = plan.steps
            elif stripped in ("Review checks (independent):", "Review checks:"):
                plan.review_independent = "(independent)" in stripped
                list_target = plan.review_checks
            elif stripped.startswith("Days:") and plan.kind == "wait":
                try:
                    plan.wait_days = int(stripped[len("Days:") :].strip())
                except ValueError:
                    raise err("Days must be an integer")
                list_target = None
            elif stripped.startswith("Exit landmark:") and plan.kind == "wait":
                plan.wait_exit_landmark = stripped[len("Exit landmark:") :].strip()
                list_target = None
            elif stripped.startswith("Landmark:") and plan.kind == "wait":
                plan.wait_landmark = stripped[len("Landmark:") :].strip()
                list_target = None
            elif stripped.startswith("Agent:") and plan.kind == "discussion":
                plan.discussion_agent = stripped[len("Agent:") :].strip()
                list_target = None
            elif stripped.startswith("Discussion agent:"):
                plan.discussion_agent = stripped[len("Discussion agent:") :].strip()
                list_target = None
            elif stripped == "Ported from:":
                list_target = plan.port
            elif stripped.startswith("Approves:"):
                if plan.kind != "gate":
                    raise err("Approves: is only valid on Gate bullets")
                rest = stripped[len("Approves:") :].strip()
                if rest != "changeset":
                    raise err(
                        "Approves must be 'changeset' (completion is the default; omit the line)"
                    )
                plan.gate_approves = rest
                list_target = None
            elif stripped.startswith("Kind:"):
                rest = stripped[len("Kind:") :].strip()
                if plan.kind == "gate":
                    plan.gate_kind = rest
                elif plan.kind == "wait":
                    plan.wait_kind = rest
                elif plan.kind == "handoff":
                    m = _HANDOFF_KIND_RE.match(rest)
                    if not m:
                        raise err(
                            "handoff Kind must be '<kind>[, after gate <ref>|, gate required]'"
                        )
                    plan.handoff_kind = m.group(1)
                    plan.handoff_gate_ref = m.group(2)
                    if m.group(4):
                        plan.handoff_gate_required = False
                        plan.handoff_no_gate = True
                    else:
                        plan.handoff_gate_required = rest != m.group(1)
                else:
                    raise err("Kind: is only valid on Gate/Handoff/Wait bullets")
                list_target = None
            else:
                raise err(f"unknown plan attribute {stripped!r}")
            i += 1
            continue

        raise err(f"unexpected line {stripped!r}")

    # ── Whole-file checks ───────────────────────────────────────────
    if not q.name:
        raise CompileError("COMPILE ERROR: missing quest name heading")
    if q.milestone_label is None:
        raise CompileError("COMPILE ERROR: missing '## Milestone <label>: <Title>'")
    if q.record_block is not None and (
        q.family or q.availability or q.quest_set or q.summary or q.source_project or q.safety
    ):
        raise CompileError(
            "COMPILE ERROR: '## Record' carries metadata verbatim — remove the "
            "Family/Availability/Set/Summary/Source lines and Ground rules, or drop the Record block"
        )
    refs: set[str] = set()
    for ph in q.phases:
        for p in ph.plans:
            if p.ref in refs:
                raise CompileError(
                    f"COMPILE ERROR: duplicate plan ref {p.ref!r} — refs are never auto-renamed"
                )
            refs.add(p.ref)
            if p.kind == "gate" and not p.gate_kind:
                raise CompileError(f"COMPILE ERROR: gate {p.ref!r} is missing 'Kind:'")
            if p.kind == "gate" and p.gate_approves == "changeset":
                # A changeset gate over an empty gated set would bind an
                # approval to nothing — a verifier that cannot fail. Refuse
                # unless some earlier plan declares Produces:.
                preceding_produces = False
                for ph2 in q.phases:
                    for pp in ph2.plans:
                        if pp is p:
                            break
                        if pp.produces:
                            preceding_produces = True
                    else:
                        continue
                    break
                if not preceding_produces:
                    raise CompileError(
                        f"COMPILE ERROR: gate {p.ref!r} declares 'Approves: changeset' but no "
                        "earlier plan declares 'Produces:' — the gated changeset would be empty"
                    )
            if p.when_sql is not None:
                if p.kind == "gate":
                    raise CompileError(
                        f"COMPILE ERROR: gate {p.ref!r} has 'When (SQL):' — gates are human "
                        "decision points and are never machine-skipped (fail closed)"
                    )
                for problem in _when_sql_problems(p.when_sql):
                    raise CompileError(
                        f"COMPILE ERROR: plan {p.ref!r} 'When (SQL):' is inadmissible — {problem}"
                    )
            if p.kind == "handoff" and not p.handoff_kind:
                raise CompileError(f"COMPILE ERROR: handoff {p.ref!r} is missing 'Kind:'")
            if p.kind == "wait" and not p.wait_kind:
                raise CompileError(f"COMPILE ERROR: wait {p.ref!r} is missing 'Kind:'")
            if p.kind == "wait" and p.wait_days is None and not (
                p.wait_landmark or p.wait_exit_landmark
            ):
                raise CompileError(
                    f"COMPILE ERROR: wait {p.ref!r} has neither 'Days:' nor a landmark — "
                    "a wait must be endable by the clock or an observed exit (fail closed)"
                )
            if q.repeat_days is not None:
                offense = None
                if p.recipe:
                    offense = "a recipe dispatch would re-enqueue a worker run every iteration"
                elif p.kind == "gate":
                    offense = "a gate parks on a human signal, and consumed signals are lost on iteration"
                elif p.kind == "wait" and (p.wait_landmark or p.wait_exit_landmark):
                    offense = "a landmark wait parks on a signal, and consumed signals are lost on iteration"
                if offense:
                    raise CompileError(
                        f"COMPILE ERROR: repeating quest contains {p.kind} {p.ref!r} — {offense}; "
                        "loop iterations re-execute the whole graph (ContinuedAsNew, fail closed)"
                    )
            if p.kind == "discussion" and not p.discussion_agent:
                raise CompileError(f"COMPILE ERROR: discussion {p.ref!r} is missing 'Agent:'")
            if p.handoff_gate_ref and p.handoff_gate_ref not in {
                pp.ref for pph in q.phases for pp in pph.plans if pp.kind == "gate"
            }:
                raise CompileError(
                    f"COMPILE ERROR: handoff {p.ref!r} references unknown gate {p.handoff_gate_ref!r}"
                )
    # Seatbelt roots admission (rsc-w0z): every binding a plan's Access: names
    # must be declared in '## Access roots', and no plan may ask rw past a
    # root's ro base. The jail re-checks at spawn, but authoring refuses first
    # so a quest that would fail closed at dispatch never ships. Skipped when a
    # verbatim '## Record' block carries the metadata (the machine back-fill
    # path): roots then live opaquely in the record, not a parsed section.
    root_base = {b: a for b, _, a in q.roots}
    # A verbatim '## Record' block is trusted machine back-fill — skip admission
    # UNLESS the quest ALSO declares '## Access roots'. In that case roots are a
    # live single source (injected into the record block at emit) and every
    # recipe plan must carry an access map, same as any rooted quest.
    if q.record_block is not None and not q.roots:
        return q
    for ph in q.phases:
        for p in ph.plans:
            # A quest that declares roots is jailed by default (rsc-w0z:
            # seatbeltEnabledForProject), so every recipe dispatch must carry an
            # access map — a recipe plan with none would fail closed at the
            # jail with no spawn. Refuse at authoring so declaring roots is a
            # jail-readiness guarantee, not a runtime surprise.
            if q.roots and p.node_type() == "recipe" and not p.access and not p.access_all:
                raise CompileError(
                    f"COMPILE ERROR: plan {p.ref!r} runs a recipe but declares no 'Access:' — "
                    "a quest with '## Access roots' is jailed, so every recipe plan needs an "
                    "access map ('Access: all' or per-binding; fail closed at dispatch otherwise)"
                )
            for entry in p.access:
                binding, _, mode = entry.partition(":")
                binding, mode = binding.strip(), mode.strip()
                if mode.endswith("?"):
                    # Optional binding (rsc-rvz two-tree seam): an OPERATOR-
                    # granted external root (user_case, from onboarding) the
                    # quest cannot declare — its path is per-operator. The jail
                    # grants it when the project config carries it and skips it
                    # when absent; admission has nothing to check here.
                    continue
                if binding not in root_base:
                    raise CompileError(
                        f"COMPILE ERROR: plan {p.ref!r} binds access root {binding!r} but no "
                        "'## Access roots' declares it (jail fails closed at dispatch)"
                    )
                if mode == "rw" and root_base[binding] == "ro":
                    raise CompileError(
                        f"COMPILE ERROR: plan {p.ref!r} asks rw on access root {binding!r} whose "
                        "base is ro — escalation past the base capability (fail closed)"
                    )
    return q


def emit(q: Quest) -> str:
    slug = q.slug_override or kebab(q.name)
    workflow = q.workflow_override or slug
    prefix = initials(q.name)
    out: list[str] = []
    w = out.append

    w("schema_version: 1")
    w(f"slug: {slug}")
    w(f"name: {scalar(q.name)}")
    w(f"workflow: {workflow}")
    if "\n" in q.description:
        w("description: |-")
        for line in q.description.split("\n"):
            w(f"  {line}".rstrip())
    else:
        w(f"description: {scalar(q.description)}")
    w("")
    if q.repeat_days is not None:
        days = int(q.repeat_days) if q.repeat_days == int(q.repeat_days) else q.repeat_days
        w("repeat:")
        w(f"  every_days: {days}")
        w("")
    if q.recipes:
        w("recipes:")
        for r in q.recipes:
            w(f"  - {r}")
        w("")
    if q.record_block is not None:
        block = list(q.record_block)
        if q.roots:
            # Single source of truth: '## Access roots' feeds both the plan-level
            # 'Access: all' expansion AND the quest-level metadata.runner.roots
            # (which init reads into config.roots). Inject it into the verbatim
            # record block under 'runner:' so a record-block quest never declares
            # roots twice. The record block keeps the fields prose has no syntax
            # for (user_prompt_names, source_port, handoff_manifests).
            try:
                ridx = next(k for k, ln in enumerate(block) if ln.rstrip() == "  runner:")
            except StopIteration:
                raise CompileError(
                    "'## Access roots' needs a 'runner:' map in the '## Record' block to hold roots"
                )
            if any(ln.rstrip() == "    roots:" for ln in block):
                raise CompileError(
                    "roots are declared in '## Access roots'; remove the duplicate 'roots:' from the '## Record' block"
                )
            inject = ["    roots:"]
            for binding, rpath, access in q.roots:
                inject.append(f"      {binding}:")
                inject.append(f"        path: {scalar(rpath)}")
                inject.append(f"        access: {access}")
            block[ridx + 1 : ridx + 1] = inject
        for line in block:
            w(line)
        w("")
    else:
        meta: list[str] = []
        if q.family or q.availability or q.quest_set or q.summary or q.roots:
            meta.append("  runner:")
            if q.family:
                meta.append(f"    quest_family: {q.family}")
            if q.availability:
                meta.append(f"    availability: {q.availability}")
            if q.quest_set:
                meta.append(f"    quest_set: {q.quest_set}")
            if q.summary:
                meta.append(f"    selection_summary: {scalar(q.summary)}")
            if q.roots:
                meta.append("    roots:")
                for binding, rpath, access in q.roots:
                    meta.append(f"      {binding}:")
                    meta.append(f"        path: {scalar(rpath)}")
                    meta.append(f"        access: {access}")
        if q.source_project:
            meta.append("  source:")
            meta.append(f"    project: {q.source_project}")
            meta.append(f"    path: {q.source_path}")
            if q.source_snapshot:
                meta.append(f"    local_snapshot: {q.source_snapshot}")
            if q.source_ported:
                meta.append(f"    ported_at: '{q.source_ported}'")
        if q.safety:
            meta.append("  safety:")
            emitted = set()
            for key, value in [kv for _, kv in GROUND_RULES]:
                if (key, value) in q.safety and key not in emitted:
                    meta.append(f"    {key}: {value}")
                    emitted.add(key)
        if meta:
            w("metadata:")
            out.extend(meta)
            w("")
    w("scaffolds:")
    w("  workstreams:")
    w(f"    - key: {q.workstream_key or slug}")
    w(f"      name: {scalar(q.workstream_name or q.name)}")
    w("      milestones:")
    w(f"        - version_label: {q.milestone_label}")
    w(f"          title: {scalar(q.milestone_title or '')}")
    w("          phases:")
    for idx, ph in enumerate(q.phases, start=1):
        w(f"            - phase_key: {scalar(ph.key) if ph.key else prefix + str(idx)}")
        w(f"              phase_slug: {ph.slug or kebab(ph.title)}")
        w(f"              lifecycle_phase: {ph.lifecycle}")
        if not ph.plans:
            continue
        w("              plans:")
        for p in ph.plans:
            w(f"                - plan_ref: {p.ref}")
            w(f"                  title: {scalar(p.title)}")
            w(f"                  wave: {p.wave if p.wave is not None else idx}")
            w("                  metadata:")
            w("                    runner:")
            pad = "                      "
            if p.only_when:
                w(f"{pad}required_when: {p.only_when}")
            if p.when_sql:
                w(f"{pad}when: {scalar(p.when_sql)}")
            if p.recipe:
                w(f"{pad}recipe:")
                w(f"{pad}  slug: {p.recipe}")
            if p.fanout_dir:
                # A fan-out without a recipe has no worker to hand items to —
                # it would expand into N plans that auto-complete having done
                # nothing, which is precisely the silent no-coverage this
                # closes. Refuse at compile.
                if not p.recipe:
                    raise CompileError(f"plan {p.ref}: 'For each:' requires 'Uses recipe:' — nothing else works an item")
                if "{item}" not in p.title and "{item_slug}" not in p.title:
                    raise CompileError(
                        f"plan {p.ref}: 'For each:' needs {{item}} in the plan title so each arm names its own item"
                    )
                w(f"{pad}fanout:")
                w(f"{pad}  dir: {p.fanout_dir}")
                if p.fanout_directories:
                    w(f"{pad}  directories: true")
                else:
                    w(f"{pad}  ends_with: {scalar(p.fanout_ends_with)}")
                if p.fanout_allow_empty:
                    w(f"{pad}  allow_empty: true")
            if p.produces:
                w(f"{pad}output_artifacts:")
                for a in p.produces:
                    w(f"{pad}  - {a}")
                w(f"{pad}artifact_verifier:")
                w(f"{pad}  kind: required_paths")
                w(f"{pad}  checks:")
                w(f"{pad}    - exists")
                w(f"{pad}    - non_empty")
                if any(a.endswith("/") for a in p.produces):
                    w(f"{pad}    - directory_non_empty")
            if p.contract:
                # Content-level contract on the produced artifacts (rsc-6al):
                # a Contract without a recipe (or without Produces) could never
                # run — refuse rather than emit a mute verifier.
                if not p.recipe:
                    raise CompileError(f"plan {p.ref}: Contract requires 'Uses recipe:' — nothing else executes it")
                if not p.produces:
                    raise CompileError(f"plan {p.ref}: Contract requires Produces: — it judges declared artifacts")
                w(f"{pad}artifact_contract: {p.contract}")
            if p.access_all:
                # Expand to every declared root at its base mode. Refuse if the
                # quest declares no roots — 'Access: all' over nothing is a
                # silent no-jail, exactly what the admission guard prevents.
                if not q.roots:
                    raise CompileError(
                        f"plan {p.ref}: 'Access: all' but the quest declares no '## Access roots'"
                    )
                w(f"{pad}access:")
                for binding, _rpath, access in q.roots:
                    w(f"{pad}  {binding}: {access}")
            elif p.access:
                w(f"{pad}access:")
                for entry in p.access:
                    binding, _, mode = entry.partition(":")
                    binding, mode = binding.strip(), mode.strip()
                    # 'ro?'/'rw?' are optional bindings (rsc-rvz): operator-
                    # granted external roots the jail skips when absent.
                    if mode not in ("ro", "rw", "ro?", "rw?"):
                        raise CompileError(f"Access entry must be '<binding>: ro|rw|ro?|rw?', got {entry!r}")
                    w(f"{pad}  {binding}: {mode}")
            if p.steps:
                w(f"{pad}instructions:")
                for s in p.steps:
                    w(f"{pad}  - {scalar(s)}")
            if p.review_checks:
                w(f"{pad}review:")
                if p.review_independent:
                    w(f"{pad}  independent: true")
                w(f"{pad}  checks:")
                for c in p.review_checks:
                    w(f"{pad}    - {c}")
            if p.kind == "gate":
                w(f"{pad}gate:")
                w(f"{pad}  required: true")
                w(f"{pad}  kind: {p.gate_kind}")
                if p.gate_approves:
                    w(f"{pad}  approves: {p.gate_approves}")
            if p.kind == "wait":
                w(f"{pad}wait:")
                w(f"{pad}  kind: {p.wait_kind}")
                if p.wait_landmark:
                    w(f"{pad}  landmark: {p.wait_landmark}")
                if p.wait_days is not None:
                    w(f"{pad}  days: {p.wait_days}")
                if p.wait_exit_landmark:
                    w(f"{pad}  exit_landmark: {p.wait_exit_landmark}")
            if p.discussion_agent:
                w(f"{pad}discussion:")
                w(f"{pad}  enabled: true")
                w(f"{pad}  agent: {p.discussion_agent}")
            w(f"{pad}node:")
            w(f"{pad}  type: {p.node_type()}")
            if p.kind == "handoff":
                w(f"{pad}handoff:")
                w(f"{pad}  kind: {p.handoff_kind}")
                if p.handoff_no_gate:
                    w(f"{pad}  gate_required: false")
                elif p.handoff_gate_required:
                    w(f"{pad}  gate_required: true")
                if p.handoff_gate_ref:
                    w(f"{pad}  gate_ref: {p.handoff_gate_ref}")
            if p.port:
                w("                    source_port:")
                for entry in p.port:
                    pk, _, pv = entry.partition(":")
                    pk, pv = pk.strip(), pv.strip()
                    if pk == "output_landmarks":
                        w(f"                      {pk}:")
                        for lm in pv.split(", "):
                            w(f"                        - {lm}")
                    else:
                        w(f"                      {pk}: {pv}")
    return "\n".join(out) + "\n"


def compile_text(text: str, filename: str = "<prose>") -> str:
    return emit(parse(text, filename))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prose", help="path to the .prose file")
    ap.add_argument("-o", "--output", help="write YAML here instead of stdout")
    args = ap.parse_args()
    try:
        with open(args.prose, encoding="utf-8") as f:
            result = compile_text(f.read(), args.prose)
    except CompileError as e:
        print(e, file=sys.stderr)
        return 2
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
    else:
        sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
