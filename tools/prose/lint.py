#!/usr/bin/env python3
"""Warn-only quest lint — teaching warnings beside the prose gate (rsc-w4j).

From the orchestration research (Ringer's manifest lint): teach at the
moment of use; never block. Every finding is advisory — the lint never
fails a compile or a commit. The audit lens: "a check that cannot fail is
a task that cannot be verified — that's just trusting the worker with
extra steps."

Checks (codes are stable; there is no suppression — fix the prose instead):
  unverifiable-plan     substantive work (a recipe or Steps:) with no
                        Produces: and no Review checks: — nothing an
                        admission step could verify.
  write-collision       two plans in the same phase and wave (the unit the
                        beads compiler parallelizes; groups chain-block in
                        document order) declare rw on the same named root:
                        write-collision risk under parallel dispatch.
                        Binding-name level only — the lint cannot see the
                        paths behind named roots, so distinct bindings over
                        overlapping paths are not caught.
  pointer-spec          a Steps: line that outsources its instructions to
                        an external SOP/guide/README. The worker sees only
                        its work order; instructions live in the prose or
                        the recipe prompt — point at files only as source
                        material.
  mute-gate             a gate or wait whose title is too short to tell
                        the operator what they are deciding or waiting for
                        (the title is all they see).
  verifier-cannot-fail  a declared artifact that verifies trivially: the
                        project root, a duplicate within the plan, or a
                        path already declared by an earlier plan — the
                        earlier plan's work would pass this plan's check.
  verifier-cannot-pass  a declared artifact path the runtime verifier
                        always rejects (absolute, or escaping the case
                        root) — the plan can never verify clean.

Usage:
    tools/prose/lint.py                 # lint the default quest dir
    tools/prose/lint.py FILE [FILE...]  # lint specific .prose files

Exit 0 always (advisory), except 2 when a prose source does not parse.
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile import CompileError, Quest, parse  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_QUESTS = ROOT / "quests"

# A Steps: line matching any of these outsources its instructions. Tuned for
# precision over recall — warn-only, but a lint that cries wolf teaches nothing.
_POINTER_RES = [
    re.compile(r"\bSOP\b|\bstandard operating procedure\b", re.IGNORECASE),
    re.compile(r"\bas (described|specified|defined|documented) in\b", re.IGNORECASE),
    re.compile(r"\bfollow (the|its|their) (instructions|guide|playbook|README)\b", re.IGNORECASE),
    re.compile(r"\bsee\s+\S+\s+for (details|instructions)\b", re.IGNORECASE),
    re.compile(r"\bdo what it says\b", re.IGNORECASE),
]

_MIN_GATE_TITLE_WORDS = 3


@dataclass
class LintWarning:
    code: str
    ref: str | None  # plan ref, or None for quest-level findings
    message: str


def _safe_artifact_path(artifact: str) -> str | None:
    """Mirror the runtime verifier's path rule (work-order.ts
    safeRelativeArtifactPath): absolute or root-escaping paths are always
    rejected. Returns the normalized path, or None when it cannot pass."""
    normalized = posixpath.normpath(artifact.strip())
    if posixpath.isabs(normalized) or normalized == ".." or normalized.startswith("../"):
        return None
    return normalized


def lint_quest(q: Quest) -> list[LintWarning]:
    warnings: list[LintWarning] = []
    declared: dict[str, str] = {}  # normalized artifact -> ref of first declarer
    # (phase index, wave, binding) -> plan refs. Same phase+wave is the unit
    # the beads compiler parallelizes; different phases never share a group.
    rw_by_wave: dict[tuple[int, int, str], list[str]] = {}
    # (phase index, wave) -> [(ref, kind)]: same phase+wave is a parallel
    # group on every backend (X1: the durable compiler joins it with `&`).
    wave_groups: dict[tuple[int, int], list[tuple[str, str]]] = {}
    phase_titles: dict[int, str] = {}

    for phase_idx, phase in enumerate(q.phases, start=1):
        for plan in phase.plans:
            substantive = plan.kind == "step" and (plan.recipe or plan.steps)
            if substantive and not plan.produces and not plan.review_checks:
                warnings.append(LintWarning(
                    "unverifiable-plan", plan.ref,
                    "declares work (recipe/steps) but no Produces: and no Review checks: "
                    "— nothing an admission step could verify; the run can only trust the worker",
                ))

            # A plan with Produces: and no recipe compiles to node type
            # `artifact` (compile.py node_type), and the durable compiler has
            # no execution mapping for it: starting the route throws rather
            # than silently auto-completing. So the node type is unrunnable
            # vocabulary, and the prose is the only place to catch it before
            # a route start does. Eight plans in legal-research.prose sit
            # here today (2026-08-22) — they are host-executed retrieval
            # steps that need deterministic recipes, which is Phase 1's
            # remaining wiring, not an authoring slip.
            if plan.kind == "step" and plan.produces and not plan.recipe:
                warnings.append(LintWarning(
                    "unrunnable-artifact-node", plan.ref,
                    "declares Produces: but names no recipe, so it compiles to node type "
                    "'artifact' — which has no durable execution mapping and makes the route "
                    "fail at start. Give it 'Uses recipe:' (a worker step, or a recipe whose "
                    "runtime is deterministic), or drop Produces: if it is only a marker",
                ))

            if plan.kind in ("gate", "wait") and len(plan.title.split()) < _MIN_GATE_TITLE_WORDS:
                warnings.append(LintWarning(
                    "mute-gate", plan.ref,
                    f"{plan.kind} title {plan.title!r} is too short to tell the operator "
                    f"what they are {'deciding' if plan.kind == 'gate' else 'waiting for'} "
                    "— the title is all they see",
                ))

            if plan.when_sql:
                for m in re.finditer(r"\b(?:from|join)\s+([^\s,()]+)", plan.when_sql, re.IGNORECASE):
                    target = m.group(1)
                    if "." not in target:
                        warnings.append(LintWarning(
                            "unqualified-table", plan.ref,
                            f"'When (SQL):' reads {target!r} without a schema qualifier — the engine "
                            "evaluates predicates in its own session, so search_path is not yours; "
                            "write {waypoint_schema}." + target + " to stay portable",
                        ))

            if plan.when_sql and not re.search(r"\bfrom\b", plan.when_sql, re.IGNORECASE):
                warnings.append(LintWarning(
                    "constant-predicate", plan.ref,
                    f"'When (SQL):' predicate ({plan.when_sql!r}) has no FROM — it observes no "
                    "state, so it decides the same way every run; guard on real rows or drop the guard",
                ))

            for step in plan.steps:
                if any(rx.search(step) for rx in _POINTER_RES):
                    warnings.append(LintWarning(
                        "pointer-spec", plan.ref,
                        f"step outsources its instructions ({step!r}) — the worker sees only "
                        "its work order; put the rules in the prose or the recipe prompt",
                    ))

            seen_in_plan: set[str] = set()
            for artifact in plan.produces:
                normalized = _safe_artifact_path(artifact)
                if normalized is None:
                    warnings.append(LintWarning(
                        "verifier-cannot-pass", plan.ref,
                        f"declared artifact {artifact!r} is absolute or escapes the case root "
                        "— the runtime verifier always rejects it; this plan can never verify clean",
                    ))
                    continue
                if normalized == ".":
                    warnings.append(LintWarning(
                        "verifier-cannot-fail", plan.ref,
                        f"declared artifact {artifact!r} is the project root, which always "
                        "exists non-empty — a check that cannot fail verifies nothing",
                    ))
                    continue
                if normalized in seen_in_plan:
                    warnings.append(LintWarning(
                        "verifier-cannot-fail", plan.ref,
                        f"artifact {artifact!r} is declared twice in this plan — the duplicate "
                        "adds no verification",
                    ))
                    continue
                seen_in_plan.add(normalized)
                if normalized in declared:
                    warnings.append(LintWarning(
                        "verifier-cannot-fail", plan.ref,
                        f"artifact {artifact!r} is already produced by plan "
                        f"{declared[normalized]!r} — the earlier plan's work passes this "
                        "plan's check, so the check cannot fail on this plan's work",
                    ))
                else:
                    declared[normalized] = plan.ref

            wave = plan.wave if plan.wave is not None else phase_idx
            phase_titles[phase_idx] = phase.title
            wave_groups.setdefault((phase_idx, wave), []).append((plan.ref, plan.kind))
            # 'Access: all' expands to every declared root at its base mode, so
            # collision detection must see those rw roots too — otherwise two
            # same-wave 'Access: all' plans would overlap unseen.
            if plan.access_all:
                rw_bindings = [b for b, _, a in q.roots if a == "rw"]
            else:
                rw_bindings = [
                    e.partition(":")[0].strip() for e in plan.access if e.partition(":")[2].strip() == "rw"
                ]
            for binding in rw_bindings:
                rw_by_wave.setdefault((phase_idx, wave, binding), []).append(plan.ref)

    for (phase_idx, wave), members in sorted(wave_groups.items()):
        if len(members) > 1:
            for ref, kind in members:
                if kind == "gate":
                    warnings.append(LintWarning(
                        "gate-in-parallel-wave", ref,
                        f"gate {ref!r} shares wave {wave} with {len(members) - 1} other plan(s) in "
                        f"phase {phase_titles[phase_idx]!r} — same wave = parallel group, and gates "
                        "cannot run inside one (the durable compiler refuses, fail closed); give "
                        "the gate its own wave",
                    ))

    for (phase_idx, wave, binding), refs in sorted(rw_by_wave.items()):
        if len(refs) > 1:
            warnings.append(LintWarning(
                "write-collision", None,
                f"plans {', '.join(refs)} all hold {binding!r} rw in wave {wave} of "
                f"phase {phase_titles[phase_idx]!r} — write-collision risk under "
                "parallel dispatch; stagger the waves or split the root",
            ))
    return warnings


def lint_text(text: str, filename: str = "<prose>") -> list[LintWarning]:
    return lint_quest(parse(text, filename))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help=".prose files (default: all quests)")
    ap.add_argument("--quests", default=str(DEFAULT_QUESTS), help="quest dir for the default sweep")
    args = ap.parse_args()

    paths = [Path(f) for f in args.files] or sorted(Path(args.quests).glob("*.prose"))
    if not paths:
        print(f"prose lint: no .prose sources under {args.quests} — nothing to lint")
        return 0

    total = 0
    flagged = 0
    had_error = False
    for path in paths:
        try:
            warnings = lint_text(path.read_text(encoding="utf-8"), str(path))
        except CompileError as e:
            print(e, file=sys.stderr)
            had_error = True
            continue
        if warnings:
            flagged += 1
            total += len(warnings)
            for wng in warnings:
                where = f"{path.name}:{wng.ref}" if wng.ref else path.name
                print(f"warn({wng.code}) {where} — {wng.message}")

    if had_error:
        return 2
    if total:
        print(f"prose lint: {total} advisory warning(s) across {flagged} of {len(paths)} quest source(s) — warnings never block")
    else:
        print(f"prose lint: {len(paths)} quest source(s), no warnings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
