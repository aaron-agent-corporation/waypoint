#!/usr/bin/env python3
"""Tests for the warn-only quest lint (rsc-w4j). Run: python3 tools/prose/test_lint.py"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lint import lint_text  # noqa: E402

HEADER = """\
# Lint Quest
one line purpose.

## Milestone v1: lint milestone

"""

# A roots-declaring variant for the write-collision fixtures, which name a
# `build` access root. A quest that declares roots is jailed, so its recipe
# plans must carry Access: — keep it off the default HEADER so the minimal
# recipe fixtures (which test unrelated lint rules) don't trip that admission
# guard before lint even runs.
HEADER_ROOTS = """\
# Lint Quest
one line purpose.

## Access roots
- build: out (rw)

## Milestone v1: lint milestone

"""


def codes(prose: str, header: str = HEADER) -> list[str]:
    return [w.code for w in lint_text(header + prose)]


def expect(prose: str, *expected: str, header: str = HEADER) -> None:
    got = codes(prose, header)
    assert sorted(got) == sorted(expected), f"expected {sorted(expected)}, got {sorted(got)}"


def main() -> int:
    # X2: a when predicate with no FROM observes nothing — warn.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  When (SQL): SELECT 1 = 1\n",
        "constant-predicate",
    )
    # A predicate over real rows is clean (only the unverifiable-plan rule
    # may fire for other reasons; keep this plan trivially clean).
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  When (SQL): SELECT EXISTS (SELECT 1 FROM waypoint.tasks)\n",
    )

    # X6: a gate sharing a wave with other plans is a parallel group the
    # durable compiler refuses — teach it at authoring time.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  Wave: 20\n"
        "  Uses recipe: some-recipe\n"
        "  Produces:\n"
        "    - out/report.md\n"
        "- Gate: Approve the completed work product (ref: approve)\n"
        "  Kind: approval\n"
        "  Wave: 20\n",
        "gate-in-parallel-wave",
    )
    # X6: unqualified table in a predicate — search_path is not the author's.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  When (SQL): SELECT EXISTS (SELECT 1 FROM tasks)\n",
        "unqualified-table",
    )
    # A {waypoint_schema}-qualified predicate is clean.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  When (SQL): SELECT EXISTS (SELECT 1 FROM {waypoint_schema}.tasks)\n",
    )

    # A verifiable plan (recipe + Produces:) is clean.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  Uses recipe: some-recipe\n"
        "  Produces:\n"
        "    - out/report.md\n",
    )

    # unverifiable-plan: a recipe with nothing to verify; Review checks: cures it.
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  Uses recipe: some-recipe\n",
        "unverifiable-plan",
    )
    expect(
        "## Phase: One (execute)\n"
        "- Do work (ref: work)\n"
        "  Uses recipe: some-recipe\n"
        "  Review checks:\n"
        "    - The report cites every source document.\n",
    )
    # A bare checkpoint (no recipe, no steps) is a narrative marker — clean.
    expect("## Phase: One (execute)\n- Kickoff marker (ref: kickoff)\n")

    # write-collision: same named root rw in the same wave; distinct waves cure it;
    # ro alongside rw does not collide.
    collision = (
        "## Phase: One (execute)\n"
        "- A writes (ref: a)\n"
        "  Uses recipe: r-a\n"
        "  Produces:\n"
        "    - out/a.md\n"
        "  Access:\n"
        "    - build: rw\n"
        "- B writes (ref: b)\n"
        "  Uses recipe: r-b\n"
        "  Produces:\n"
        "    - out/b.md\n"
        "  Access:\n"
        "    - build: rw\n"
    )
    expect(collision, "write-collision", header=HEADER_ROOTS)
    expect(collision.replace("- B writes (ref: b)\n", "- B writes (ref: b)\n  Wave: 2\n"), header=HEADER_ROOTS)
    expect(collision.replace("    - build: rw\n- B", "    - build: ro\n- B"), header=HEADER_ROOTS)
    # Same wave NUMBER in different phases is not a collision: the compiler's
    # parallel group is phase+wave, and groups chain-block in document order.
    # `Uses recipe:` on both, like the collision fixtures above: without it each
    # plan also trips unrunnable-artifact-node (Produces: with no recipe compiles
    # to node type `artifact`, which the durable compiler cannot execute). That
    # check landed after this fixture was written and made it fail on two
    # warnings that have nothing to do with waves.
    expect(
        "## Phase: One (execute)\n"
        "- A writes (ref: a)\n"
        "  Wave: 7\n"
        "  Uses recipe: r-a\n"
        "  Produces:\n"
        "    - out/a.md\n"
        "  Access:\n"
        "    - build: rw\n"
        "## Phase: Two (verify)\n"
        "- B writes (ref: b)\n"
        "  Wave: 7\n"
        "  Uses recipe: r-b\n"
        "  Produces:\n"
        "    - out/b.md\n"
        "  Access:\n"
        "    - build: rw\n",
        header=HEADER_ROOTS,
    )

    # pointer-spec: a step that outsources its instructions.
    expect(
        "## Phase: One (execute)\n"
        "- Review documents (ref: review)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - out/review.md\n"
        "  Steps:\n"
        "    - Use the llm-lawyer referral SOP and document-review schema as source guidance.\n",
        "pointer-spec",
    )
    # Pointing at files as source material is fine.
    expect(
        "## Phase: One (execute)\n"
        "- Review documents (ref: review)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - out/review.md\n"
        "  Steps:\n"
        "    - Review each source document for type, parties, and dates.\n",
    )

    # mute-gate: a title too short to brief the operator; rich titles pass.
    expect("## Phase: One (execute)\n- Gate: Approve (ref: g1)\n  Kind: human\n", "mute-gate")
    expect("## Phase: One (execute)\n- Gate: Human review of deliverable package (ref: g2)\n  Kind: human\n")
    expect("## Phase: One (execute)\n- Wait: Sit (ref: w1)\n  Kind: landmark\n  Landmark: x\n", "mute-gate")

    # verifier-cannot-fail: project root, in-plan duplicate, cross-plan duplicate.
    expect(
        "## Phase: One (execute)\n"
        "- Emit root (ref: root)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - .\n",
        "verifier-cannot-fail",
    )
    expect(
        "## Phase: One (execute)\n"
        "- Emit twice (ref: twice)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - out/x.md\n"
        "    - out/x.md\n",
        "verifier-cannot-fail",
    )
    expect(
        "## Phase: One (execute)\n"
        "- First (ref: first)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - out/x.md\n"
        "- Second (ref: second)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - out/x.md\n",
        "verifier-cannot-fail",
    )

    # verifier-cannot-pass: absolute and root-escaping paths.
    expect(
        "## Phase: One (execute)\n"
        "- Escape (ref: escape)\n"
        "  Uses recipe: r\n"
        "  Produces:\n"
        "    - /etc/hosts\n"
        "    - ../outside.md\n",
        "verifier-cannot-pass", "verifier-cannot-pass",
    )

    print("all prose lint tests passed")
    return 0


def test_prose_lint() -> None:
    """pytest entry point for the warn-only quest lint.

    These files are hand-rolled `main()` scripts run as
    `python3 tools/prose/test_lint.py`. That works, but pytest collected NOTHING from them —
    four files, one test between them — so any harness that runs the suite
    through pytest reported full coverage of an empty set. `main()` asserts
    its way through and returns 0; the wrapper just makes it visible.
    """
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
