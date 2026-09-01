#!/usr/bin/env python3
"""Round-trip proof for the back-fill: compile(decompile(yaml)) must parse
deep-equal to the original for every bundled quest.

Run: uv run --with pyyaml python3 tools/prose/test_roundtrip.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile import CompileError, compile_text  # noqa: E402

try:
    import yaml  # noqa: E402
    from decompile import DecompileError, decompile  # noqa: E402
except ModuleNotFoundError:  # pyyaml is optional: the compiler itself is stdlib-only
    yaml = None  # type: ignore[assignment]
    DecompileError = CompileError  # type: ignore[assignment,misc]

    def decompile(source: str, name: str) -> str:  # type: ignore[misc]
        raise CompileError("pyyaml not installed")

QUESTS = Path(__file__).resolve().parents[2] / "quests"


def deep_diff(a, b, path="$"):
    if type(a) is not type(b):
        return [f"{path}: type {type(a).__name__} vs {type(b).__name__} ({a!r} vs {b!r})"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}.{k}: only in roundtrip")
            elif k not in b:
                out.append(f"{path}.{k}: only in original")
            else:
                out.extend(deep_diff(a[k], b[k], f"{path}.{k}"))
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: list len {len(a)} vs {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(deep_diff(x, y, f"{path}[{i}]"))
        return out
    return [] if a == b else [f"{path}: {a!r} vs {b!r}"]


def synthetic_when_roundtrip() -> None:
    """A when-bearing plan (X2) survives compile→decompile byte-stably —
    no bundled quest carries one yet, so pin the path synthetically."""
    prose = (
        "# Tiny Quest\n"
        "one line purpose.\n\n"
        "## Ground rules\n"
        "- Source files are read-only.\n\n"
        "## Milestone v1: Tiny milestone\n\n"
        "## Phase: Only phase (execute)\n"
        "- Do the thing (ref: do-thing)\n"
        "  When (SQL): SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE status = 'done')\n"
    )
    regenerated = decompile(compile_text(prose, "when.prose"), "when.yaml")
    assert "When (SQL): SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE status = 'done')" in regenerated, (
        "decompile lost the when predicate:\n" + regenerated
    )
    assert compile_text(regenerated, "when-2.prose") == compile_text(prose, "when.prose"), (
        "when-bearing quest does not round-trip"
    )


def synthetic_repeat_roundtrip() -> None:
    """A repeating quest (X4) survives compile→decompile byte-stably."""
    prose = (
        "# Tiny Quest\n"
        "one line purpose.\n\n"
        "## Catalog details\n"
        "Repeat: every 3 days\n\n"
        "## Ground rules\n"
        "- Source files are read-only.\n\n"
        "## Milestone v1: Tiny milestone\n\n"
        "## Phase: Only phase (execute)\n"
        "- Do the thing (ref: do-thing)\n"
    )
    regenerated = decompile(compile_text(prose, "repeat.prose"), "repeat.yaml")
    assert "Repeat: every 3 days" in regenerated, "decompile lost the repeat:\n" + regenerated
    assert compile_text(regenerated, "repeat-2.prose") == compile_text(prose, "repeat.prose"), (
        "repeating quest does not round-trip"
    )


def main() -> int:
    if yaml is None:
        print("round-trip: skipped (pyyaml not installed)")
        return 0
    synthetic_when_roundtrip()
    synthetic_repeat_roundtrip()
    files = sorted(QUESTS.glob("*.yaml"))
    ok, failed = 0, []
    for f in files:
        source = f.read_text(encoding="utf-8")
        try:
            prose = decompile(source, f.name)
            regenerated = compile_text(prose, f.name + ".prose")
        except (DecompileError, CompileError) as e:
            failed.append((f.name, str(e)))
            continue
        original = yaml.safe_load(source)
        result = yaml.safe_load(regenerated)
        # The one accepted canonicalization: trailing whitespace in the
        # display-only description is dropped by the decompiler.
        for doc in (original, result):
            if isinstance(doc.get("description"), str):
                doc["description"] = "\n".join(
                    l.rstrip() for l in doc["description"].split("\n")
                ).rstrip("\n")
        diffs = deep_diff(original, result)
        if diffs:
            failed.append((f.name, f"{len(diffs)} diff(s): " + "; ".join(diffs[:4])))
        else:
            ok += 1
    print(f"round-trip: {ok}/{len(files)} quests clean")
    for name, why in failed:
        print(f"  FAIL {name}: {why}")
    return 1 if failed else 0


def test_prose_roundtrip() -> None:
    """pytest entry point for compile(decompile(yaml)) for every bundled quest.

    These files are hand-rolled `main()` scripts run as
    `python3 tools/prose/test_roundtrip.py`. That works, but pytest collected NOTHING from them —
    four files, one test between them — so any harness that runs the suite
    through pytest reported full coverage of an empty set. `main()` asserts
    its way through and returns 0; the wrapper just makes it visible.
    """
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
