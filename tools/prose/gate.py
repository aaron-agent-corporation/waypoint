#!/usr/bin/env python3
"""Prose drift gate — keeps English sources and quest YAML from lying to
each other, with no LLM anywhere.

For every `<name>.prose` sitting next to a `<name>.yaml` under the quest
directories, recompile the prose with the deterministic compiler and
byte-compare against the committed YAML. Also verify that every recipe slug
referenced by a prose-sourced quest exists in the recipe catalog.

Exit codes: 0 clean; 1 drift or missing recipes (message says which file and
what to run); 2 compile error in a prose source.

Usage:
    tools/prose/gate.py                # check the default quest dirs
    tools/prose/gate.py --quests DIR --recipes DIR
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile import CompileError, compile_text  # noqa: E402
from lint import lint_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_QUESTS = ROOT / "quests"
DEFAULT_RECIPES = ROOT / "recipes"

_SLUG_RE = re.compile(r"^slug:\s*(\S+)\s*$", re.MULTILINE)


def catalog_recipe_slugs(recipes_dir: Path) -> set[str]:
    slugs: set[str] = set()
    for path in recipes_dir.rglob("*.yaml"):
        m = _SLUG_RE.search(path.read_text(encoding="utf-8"))
        if m:
            slugs.add(m.group(1))
    return slugs


def referenced_recipes(prose_text: str) -> set[str]:
    refs: set[str] = set()
    in_roster = False
    for line in prose_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            in_roster = stripped == "## Recipes used"
            continue
        if in_roster and stripped.startswith("- "):
            refs.add(stripped[2:].strip())
        if stripped.startswith("Uses recipe:"):
            refs.add(stripped[len("Uses recipe:") :].strip())
    return refs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quests", default=str(DEFAULT_QUESTS))
    ap.add_argument("--recipes", default=str(DEFAULT_RECIPES))
    args = ap.parse_args()
    quests_dir = Path(args.quests)
    recipes_dir = Path(args.recipes)

    prose_files = sorted(quests_dir.glob("*.prose"))
    if not prose_files:
        print(f"prose gate: no .prose sources under {quests_dir} — nothing to check")
        return 0

    known_slugs = catalog_recipe_slugs(recipes_dir)
    failures = 0
    lint_warnings = 0
    lint_flagged = 0
    for prose_path in prose_files:
        yaml_path = prose_path.with_suffix(".yaml")
        text = prose_path.read_text(encoding="utf-8")
        try:
            compiled = compile_text(text, str(prose_path))
        except CompileError as e:
            print(e, file=sys.stderr)
            return 2

        if not yaml_path.exists():
            print(f"DRIFT: {yaml_path.name} is missing — compile it:\n"
                  f"  tools/prose/compile.py {prose_path} -o {yaml_path}", file=sys.stderr)
            failures += 1
        elif yaml_path.read_text(encoding="utf-8") != compiled:
            print(f"DRIFT: {yaml_path.name} does not match its prose source "
                  f"{prose_path.name}.\n"
                  f"  If the prose is the intended change: tools/prose/compile.py {prose_path} -o {yaml_path}\n"
                  f"  If the YAML was hand-edited: port the edit into the prose instead — "
                  f"the prose is the source of truth.", file=sys.stderr)
            failures += 1

        missing = referenced_recipes(text) - known_slugs
        if missing:
            print(f"MISSING RECIPES: {prose_path.name} references recipes not in "
                  f"{recipes_dir}: {', '.join(sorted(missing))}", file=sys.stderr)
            failures += 1

        # Advisory lint (rsc-w4j): teach at the moment of use, never block.
        # The gate prints one summary line; details live in tools/prose/lint.py.
        found = lint_text(text, str(prose_path))
        if found:
            lint_warnings += len(found)
            lint_flagged += 1

    checked = len(prose_files)
    if lint_warnings:
        print(f"prose lint (advisory): {lint_warnings} warning(s) across {lint_flagged} "
              f"quest source(s) — tools/prose/lint.py for details; warnings never block")
    if failures:
        print(f"prose gate: {failures} problem(s) across {checked} prose source(s)", file=sys.stderr)
        return 1
    print(f"prose gate: {checked} prose source(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
