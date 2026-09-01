#!/usr/bin/env python3
"""Tests for the deterministic prose compiler. Run: python3 tools/prose/test_compile.py"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile import CompileError, compile_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

MINIMAL = """\
# Tiny Quest
one line purpose.

## Ground rules
- Source files are read-only.

## Milestone v1: Tiny milestone

## Phase: Only phase (execute)
- Do the thing (ref: do-thing)
"""


def expect_error(prose: str, needle: str) -> None:
    try:
        compile_text(prose)
    except CompileError as e:
        assert needle in str(e), f"expected {needle!r} in {e}"
        return
    raise AssertionError(f"expected COMPILE ERROR containing {needle!r}")


def main() -> int:
    # Determinism trivially holds for code, but keep the invariant pinned.
    assert compile_text(MINIMAL) == compile_text(MINIMAL)

    # Minimal quest compiles and infers a checkpoint node.
    out = compile_text(MINIMAL)
    assert "type: checkpoint" in out and "phase_key: TQ1" in out and "wave: 1" in out

    # Error paths — ambiguity fails closed, loudly.
    expect_error(MINIMAL.replace("- Source files are read-only.", "- Be careful."),
                 "closed vocabulary")
    expect_error(MINIMAL + "- Do the thing again (ref: do-thing)\n", "duplicate plan ref")
    expect_error(MINIMAL + "- Gate: Stop here (ref: stop)\n", "missing 'Kind:'")
    # X3: a wait must be endable — by the clock (Days:) or an observed landmark.
    expect_error(
        MINIMAL + "- Wait: Sit forever (ref: sit)\n  Kind: passive\n",
        "neither 'Days:' nor a landmark",
    )
    expect_error(
        MINIMAL + "- Handoff: Ship it (ref: ship)\n  Kind: pkg, after gate nonexistent\n",
        "unknown gate",
    )
    expect_error("# NoPurpose\n\n## Ground rules\n", "purpose line")

    # When (SQL): the machine predicate (X2) is copied verbatim into the YAML
    # `when:` field — and admission fails closed on anything that could
    # produce an invalid df node.
    guarded = MINIMAL + "  When (SQL): SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE status = 'done')\n"
    out = compile_text(guarded)
    assert "when: SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE status = 'done')" in out
    expect_error(MINIMAL + "  When (SQL): DELETE FROM waypoint.tasks\n", "single SELECT")
    expect_error(MINIMAL + "  When (SQL): SELECT 1; DROP TABLE x\n", "';' is not allowed")
    expect_error(MINIMAL + "  When (SQL): SELECT $sig_1 IS NOT NULL\n", "'$' is not allowed")
    expect_error(MINIMAL + "  When (SQL): SELECT '{sys_instance_id}'\n", "allowed only as the start-time variables")
    # X5: the five start-time variables are admissible in predicates.
    out = compile_text(
        MINIMAL
        + "  When (SQL): SELECT EXISTS (SELECT 1 FROM {waypoint_schema}.tasks WHERE route_id = '{waypoint_route_id}')\n"
    )
    assert "route_id = ''{waypoint_route_id}''" in out or "{waypoint_route_id}" in out
    expect_error(MINIMAL + "  When (SQL): SELECT 1 -- always\n", "SQL comments are not allowed")
    expect_error(MINIMAL + "  When (SQL): SELECT df.cancel('x')\n", "'df.' calls are not allowed")
    expect_error(
        MINIMAL + "- Gate: Stop here (ref: stop)\n  Kind: approval\n  When (SQL): SELECT 1 FROM waypoint.tasks\n",
        "never machine-skipped",
    )

    # X4: quest-level Repeat compiles to the YAML repeat block, guardrailed —
    # a repeating quest may not dispatch or park on signals (ContinuedAsNew).
    repeating = MINIMAL.replace(
        "## Ground rules",
        "## Catalog details\nRepeat: every 3 days\n\n## Ground rules",
    )
    out = compile_text(repeating)
    assert "repeat:\n  every_days: 3\n" in out
    expect_error(
        repeating.replace("every 3 days", "every soon days"), "Repeat line must be"
    )
    expect_error(
        repeating.replace("every 3 days", "every 0 days"), "positive number of days"
    )
    expect_error(
        repeating + "  Uses recipe: some-recipe\n", "re-enqueue a worker run"
    )
    expect_error(
        repeating + "- Gate: Stop here (ref: stop)\n  Kind: approval\n",
        "consumed signals are lost",
    )
    expect_error(
        repeating
        + "- Wait: Window (ref: win)\n  Kind: duration_or_landmark\n  Days: 7\n  Landmark: seen\n",
        "consumed signals are lost",
    )

    # rsc-6al: Contract compiles verbatim to artifact_contract on a
    # recipe-backed plan with Produces; anything else could never run the
    # contract (a mute verifier) and refuses.
    contracted = MINIMAL + (
        "  Uses recipe: some-recipe\n"
        "  Produces:\n"
        "    - build/plan.json\n"
        "  Contract: example-placement-plan\n"
    )
    out = compile_text(contracted)
    assert "artifact_contract: example-placement-plan" in out
    expect_error(MINIMAL + "  Contract: x\n", "Contract requires 'Uses recipe:'")
    expect_error(
        MINIMAL + "  Uses recipe: some-recipe\n  Contract: x\n",
        "Contract requires Produces:",
    )
    expect_error(
        contracted.replace("Contract: example-placement-plan", "Contract:"),
        "Contract requires a contract name",
    )

    # Access roots (rsc-w0z): quest-level seatbelt roots emit under
    # metadata.runner.roots, and the fail-closed guards refuse a plan that
    # binds an undeclared root or escalates rw past an ro base.
    rooted = (
        "# Rooted Quest\n"
        "one line purpose.\n\n"
        "## Access roots\n"
        "- inputs: . (ro)\n"
        "- build: example-build (rw)\n\n"
        "## Milestone v1: Rooted milestone\n\n"
        "## Phase: Only phase (execute)\n"
        "- Do the thing (ref: do-thing)\n"
        "  Uses recipe: some-recipe\n"
        "  Produces:\n"
        "    - out/x.md\n"
        "  Access:\n"
        "    - inputs: ro\n"
        "    - build: rw\n"
    )
    rooted_yaml = compile_text(rooted)
    assert "    roots:" in rooted_yaml, rooted_yaml
    assert "      inputs:\n        path: .\n        access: ro" in rooted_yaml, rooted_yaml
    assert "      build:\n        path: example-build\n        access: rw" in rooted_yaml, rooted_yaml
    # A plan binding a root the quest never declares fails closed at authoring.
    expect_error(
        rooted.replace("    - build: rw\n", "    - build: rw\n    - extra_out: rw\n"),
        "binds access root 'extra_out' but no '## Access roots' declares it",
    )
    # A plan asking rw on an ro-base root is escalation — refused.
    expect_error(
        rooted.replace("    - inputs: ro\n", "    - inputs: rw\n"),
        "asks rw on access root 'inputs' whose base is ro",
    )
    # Malformed root declaration.
    expect_error(
        rooted.replace("- build: example-build (rw)\n", "- build: example-build\n"),
        "must be '<binding>: <path> (ro|rw)'",
    )
    # A roots-declaring quest is jailed, so a recipe plan with no Access: fails
    # closed at dispatch — refuse it at authoring.
    expect_error(
        rooted.replace("  Access:\n    - inputs: ro\n    - build: rw\n", ""),
        "runs a recipe but declares no 'Access:'",
    )
    # 'Access: all' (rsc-w0z): shorthand that grants every declared root at its
    # base mode — satisfies the admission guard and expands to the same map a
    # per-binding block would. The ro base stays ro (no escalation).
    all_access = compile_text(
        rooted.replace("  Access:\n    - inputs: ro\n    - build: rw\n", "  Access: all\n")
    )
    assert "access:\n                        inputs: ro\n                        build: rw" in all_access, all_access
    # 'Access: all' over a quest with no declared roots is a silent no-jail — refuse.
    expect_error(
        "# No Roots\none line purpose.\n\n"
        "## Milestone v1: m\n\n"
        "## Phase: Only (execute)\n"
        "- Do it (ref: do)\n"
        "  Uses recipe: some-recipe\n"
        "  Produces:\n    - out/x.md\n"
        "  Access: all\n",
        "'Access: all' but the quest declares no '## Access roots'",
    )

    # Approves: changeset (rsc-7rw) — gate-only, one valid value, and it
    # refuses when the gated set would be empty (no earlier Produces:).
    expect_error(
        MINIMAL + "  Approves: changeset\n",
        "Approves: is only valid on Gate bullets",
    )
    expect_error(
        MINIMAL + "- Gate: Stop (ref: stop)\n  Kind: check\n  Approves: completion\n",
        "Approves must be 'changeset'",
    )
    expect_error(
        MINIMAL + "- Gate: Stop (ref: stop)\n  Kind: check\n  Approves: changeset\n",
        "no earlier plan declares 'Produces:'",
    )
    with_artifact = MINIMAL.replace(
        "- Do the thing (ref: do-thing)\n",
        "- Do the thing (ref: do-thing)\n  Produces:\n    - build/out.md\n",
    )
    out_changeset = compile_text(
        with_artifact + "- Gate: Stop (ref: stop)\n  Kind: check\n  Approves: changeset\n"
    )
    assert "approves: changeset" in out_changeset
    # Default stays completion: no approves key without the attribute.
    out_plain = compile_text(
        with_artifact + "- Gate: Stop (ref: stop)\n  Kind: check\n"
    )
    assert "approves:" not in out_plain

    # D5 (2026-08-24): Availability is a closed two-value vocabulary; the
    # emitted key is what `waypoint start` and the Console both read.
    catalog = (
        "# Tiny Quest\none line purpose.\n\n"
        "## Catalog details\nFamily: example_workstream\n{extra}\n"
        "## Milestone v1: Tiny milestone\n\n"
        "## Phase: Only phase (execute)\n- Do the thing (ref: do-thing)\n"
    )
    out_unproven = compile_text(catalog.format(extra="Availability: not yet available\n"))
    assert "availability: not_yet_available" in out_unproven
    out_proven = compile_text(catalog.format(extra="Availability: available\n"))
    assert "availability: available" in out_proven
    # Omitted means available — no key, so the 20 proven quests are untouched.
    assert "availability:" not in compile_text(catalog.format(extra=""))
    expect_error(
        catalog.format(extra="Availability: soon\n"),
        "Availability must be one of",
    )

    print("all prose compiler tests passed")
    return 0


def test_prose_compiler() -> None:
    """pytest entry point for the deterministic prose compiler.

    These files are hand-rolled `main()` scripts run as
    `python3 tools/prose/test_compile.py`. That works, but pytest collected NOTHING from them —
    four files, one test between them — so any harness that runs the suite
    through pytest reported full coverage of an empty set. `main()` asserts
    its way through and returns 0; the wrapper just makes it visible.
    """
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
