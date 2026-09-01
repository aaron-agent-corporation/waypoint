#!/usr/bin/env python3
"""Deterministic quest YAML -> .prose decompiler (back-fill tool).

The inverse of compile.py, used to give existing quests an English source.
It refuses (DECOMPILE ERROR) rather than approximate: if a quest uses a
structure the prose convention cannot express losslessly, it must stay YAML
until the convention grows. Round-trip safety is proven by
test_roundtrip.py: compile(decompile(yaml)) must parse deep-equal to the
original.

Provenance metadata (metadata:/handoff_manifests:) is carried as a verbatim
'## Record' block — bookkeeping, not English.

Usage:
    tools/prose/decompile.py <quest.yaml>              # prose to stdout
    tools/prose/decompile.py <quest.yaml> -o out.prose
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compile import initials, kebab  # noqa: E402

try:
    import yaml
except ImportError:  # pragma: no cover
    print("decompile.py needs pyyaml (run via: uv run --with pyyaml ...)", file=sys.stderr)
    raise


class DecompileError(Exception):
    pass


def _err(msg: str) -> DecompileError:
    return DecompileError(f"DECOMPILE ERROR: {msg}")


def _extract_top_level_block(source: str, key: str) -> list[str] | None:
    """Return the verbatim source lines of a top-level ``key:`` block."""
    lines = source.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.startswith(f"{key}:"):
            start = i
            break
    if start is None:
        return None
    end = start + 1
    while end < len(lines):
        line = lines[end]
        # A new top-level KEY ends the block; a column-0 "- item" is still
        # part of the current key's sequence value.
        if line and not line[0].isspace() and not line.startswith("#") and not line.startswith("- "):
            break
        end += 1
    block = lines[start:end]
    while block and not block[-1].strip():
        block.pop()
    return block


def _phase_title(phase_slug: str) -> tuple[str, str | None]:
    """Return (title, slug_annotation). The annotation is None when the
    slug is recoverable from the title (kebab round-trips); slugs with
    underscores etc. carry an explicit [slug: ...] instead."""
    title = re.sub(r"[-_]+", " ", phase_slug).capitalize()
    return title, (None if kebab(title) == phase_slug else phase_slug)


def _check_line(value: str, what: str) -> str:
    if "\n" in value:
        raise _err(f"{what} is multiline; the prose convention keeps it on one line")
    return value


def decompile(source: str, filename: str = "<yaml>") -> str:
    d = yaml.safe_load(source)
    if not isinstance(d, dict):
        raise _err("not a quest manifest")
    name = d.get("name")
    slug = d.get("slug")
    workflow = d.get("workflow")
    description = d.get("description") or ""
    if not isinstance(name, str) or not isinstance(slug, str) or not isinstance(workflow, str):
        raise _err("missing slug/name/workflow")
    if any(line.startswith("#") for line in description.split("\n")):
        raise _err("description contains heading-like lines")

    out: list[str] = []
    w = out.append
    w(f"# {name}")
    for line in description.split("\n"):
        w(line)
    w("")

    catalog: list[str] = []
    if slug != kebab(name):
        catalog.append(f"Slug: {slug}")
    if workflow != slug:
        catalog.append(f"Workflow: {workflow}")
    repeat = d.get("repeat")
    if repeat is not None:
        every = repeat.get("every_days") if isinstance(repeat, dict) else None
        if not isinstance(every, (int, float)) or isinstance(every, bool) or every <= 0:
            raise _err("repeat.every_days must be a positive number of days")
        days = int(every) if every == int(every) else every
        catalog.append(f"Repeat: every {days} days")
    if catalog:
        w("## Catalog details")
        out.extend(catalog)
        w("")

    recipes = d.get("recipes") or []
    if recipes:
        w("## Recipes used")
        for r in recipes:
            w(f"- {r}")
        w("")

    record: list[str] = []
    for key in ("metadata", "handoff_manifests"):
        if key in d:
            block = _extract_top_level_block(source, key)
            if block is None:
                raise _err(f"cannot locate verbatim source of top-level {key!r}")
            if record:
                record.append("")
            record.extend(block)
    if record:
        w("## Record")
        w("```yaml")
        out.extend(record)
        w("```")
        w("")

    scaffolds = d.get("scaffolds") or {}
    workstreams = scaffolds.get("workstreams") or []
    if len(workstreams) != 1:
        raise _err(f"expected exactly one workstream, found {len(workstreams)}")
    ws = workstreams[0]
    if set(ws) - {"key", "name", "milestones"}:
        raise _err(f"workstream has unsupported keys {sorted(set(ws) - {'key', 'name', 'milestones'})}")
    if ws.get("key") != slug or ws.get("name") != name:
        w(f"## Workstream {ws.get('key')}: {_check_line(str(ws.get('name')), 'workstream name')}")
        w("")
    milestones = ws.get("milestones") or []
    if len(milestones) != 1:
        raise _err(f"expected exactly one milestone, found {len(milestones)}")
    ms = milestones[0]
    w(f"## Milestone {ms.get('version_label')}: {_check_line(str(ms.get('title')), 'milestone title')}")
    w("")

    prefix = initials(name)
    for idx, ph in enumerate(ms.get("phases") or [], start=1):
        extra = set(ph) - {"phase_key", "phase_slug", "lifecycle_phase", "plans"}
        if extra:
            raise _err(f"phase has unsupported keys {sorted(extra)}")
        title, slug_ann = _phase_title(str(ph.get("phase_slug")))
        key = str(ph.get("phase_key"))
        pairs = []
        if key != f"{prefix}{idx}":
            pairs.append(f"key: {key}")
        if slug_ann:
            pairs.append(f"slug: {slug_ann}")
        annotation = f" [{', '.join(pairs)}]" if pairs else ""
        w(f"## Phase: {title} ({ph.get('lifecycle_phase')}){annotation}")
        for pl in ph.get("plans") or []:
            w(_plan_bullet(pl, idx))
        w("")
    while out and not out[-1]:
        out.pop()
    return "\n".join(out) + "\n"


def _plan_bullet(pl: dict, phase_idx: int) -> str:
    extra = set(pl) - {"plan_ref", "title", "wave", "metadata"}
    if extra:
        raise _err(f"plan {pl.get('plan_ref')!r} has unsupported keys {sorted(extra)}")
    metadata = pl.get("metadata") or {}
    if set(metadata) - {"runner", "source_port"}:
        raise _err(f"plan {pl.get('plan_ref')!r} metadata has unsupported keys")
    wp = metadata.get("runner") or {}
    source_port = metadata.get("source_port")
    known = {
        "required_when", "when", "recipe", "fanout", "output_artifacts", "artifact_verifier", "artifact_contract",
        "access", "instructions", "review", "gate", "node", "handoff", "wait", "discussion",
    }
    if set(wp) - known:
        raise _err(f"plan {pl.get('plan_ref')!r} uses unsupported runner keys {sorted(set(wp) - known)}")

    ref = pl.get("plan_ref")
    title = _check_line(str(pl.get("title")), f"plan {ref!r} title")
    if re.search(r"\(ref:\s*[a-z0-9-]+\)\s*$", title):
        raise _err(f"plan {ref!r} title ends with a (ref: ...) marker")
    node_type = ((wp.get("node") or {}).get("type"))
    prefix = {"gate": "Gate: ", "handoff": "Handoff: ", "wait": "Wait: ", "discussion": "Discussion: "}.get(
        node_type, ""
    )
    lines = [f"- {prefix}{title} (ref: {ref})"]

    def attr(text: str) -> None:
        lines.append(f"  {text}")

    recipe = wp.get("recipe")
    if node_type == "recipe":
        attr(f"Uses recipe: {recipe['slug']}")
    elif recipe is not None:
        raise _err(f"plan {ref!r} has a recipe block but node type {node_type!r}")

    # `For each:` (rsc-m23.7) — one plan per registry item, expanded at route
    # start. The compiler refuses a fan-out without a recipe (nothing would
    # work an item), so this only ever renders under one.
    fanout = wp.get("fanout")
    if fanout is not None:
        if node_type != "recipe":
            raise _err(f"plan {ref!r} has a fanout block but node type {node_type!r}")
        unknown = set(fanout) - {"dir", "directories", "ends_with", "allow_empty"}
        if unknown:
            raise _err(f"plan {ref!r} fanout has unsupported keys {sorted(unknown)}")
        if "dir" not in fanout:
            raise _err(f"plan {ref!r} fanout has no dir")
        if fanout.get("directories"):
            spec = f"{fanout['dir']}/*/"
        elif "ends_with" in fanout:
            spec = f"{fanout['dir']}/*{fanout['ends_with']}"
        else:
            raise _err(f"plan {ref!r} fanout is neither directories nor ends_with")
        attr(f"For each: {spec}{' (may be empty)' if fanout.get('allow_empty') else ''}")
    if node_type == "artifact" and not wp.get("output_artifacts"):
        raise _err(f"plan {ref!r} is an artifact node without output_artifacts")
    if node_type == "checkpoint" and wp.get("output_artifacts"):
        raise _err(f"plan {ref!r} is a checkpoint with output_artifacts (compiles to artifact)")

    if wp.get("required_when"):
        attr(f"Only when: {wp['required_when']}")
    if wp.get("when"):
        if node_type == "gate":
            raise _err(f"plan {ref!r} is a gate with a when predicate (never machine-skipped)")
        attr(f"When (SQL): {wp['when']}")
    if pl.get("wave") != phase_idx:
        attr(f"Wave: {pl.get('wave')}")

    artifacts = wp.get("output_artifacts") or []
    if artifacts:
        expected_checks = ["exists", "non_empty"] + (
            ["directory_non_empty"] if any(str(a).endswith("/") for a in artifacts) else []
        )
        verifier = wp.get("artifact_verifier")
        if verifier != {"kind": "required_paths", "checks": expected_checks}:
            raise _err(
                f"plan {ref!r} artifact_verifier differs from the convention's derived form"
            )
        attr("Produces:")
        for a in artifacts:
            lines.append(f"    - {a}")
    elif wp.get("artifact_verifier"):
        raise _err(f"plan {ref!r} has artifact_verifier without output_artifacts")

    contract = wp.get("artifact_contract")
    if contract is not None:
        if not isinstance(contract, str) or not contract:
            raise _err(f"plan {ref!r} artifact_contract must be a non-empty string")
        if node_type != "recipe" or not artifacts:
            raise _err(f"plan {ref!r} artifact_contract requires a recipe plan with output_artifacts")
        attr(f"Contract: {contract}")

    access = wp.get("access")
    if access is not None:
        if not isinstance(access, dict) or any(
            m not in ("ro", "rw", "ro?", "rw?") for m in access.values()
        ):
            raise _err(f"plan {ref!r} access must map bindings to 'ro'|'rw'|'ro?'|'rw?'")
        attr("Access:")
        for binding, mode in access.items():
            lines.append(f"    - {binding}: {mode}")

    if wp.get("instructions"):
        attr("Steps:")
        for s in wp["instructions"]:
            lines.append(f"    - {_check_line(str(s), f'plan {ref!r} instruction')}")

    review = wp.get("review")
    if review is not None:
        if set(review) - {"independent", "checks"}:
            raise _err(f"plan {ref!r} review has unsupported keys")
        attr("Review checks (independent):" if review.get("independent") else "Review checks:")
        for c in review.get("checks") or []:
            lines.append(f"    - {c}")

    if node_type == "gate":
        gate = wp.get("gate") or {}
        if gate.get("required") is not True or set(gate) - {"required", "kind", "approves"}:
            raise _err(f"plan {ref!r} gate block is not the convention's shape")
        attr(f"Kind: {gate.get('kind')}")
        if gate.get("approves") is not None:
            if gate["approves"] != "changeset":
                raise _err(f"plan {ref!r} gate approves {gate['approves']!r} — only 'changeset' round-trips")
            attr("Approves: changeset")
    elif wp.get("gate"):
        raise _err(f"plan {ref!r} has a gate block but node type {node_type!r}")

    if node_type == "wait":
        wait = wp.get("wait") or {}
        if set(wait) - {"kind", "landmark", "days", "exit_landmark"}:
            raise _err(f"plan {ref!r} wait block has unsupported keys")
        attr(f"Kind: {wait.get('kind')}")
        if wait.get("days") is not None:
            attr(f"Days: {wait['days']}")
        if wait.get("exit_landmark"):
            attr(f"Exit landmark: {wait['exit_landmark']}")
        if wait.get("landmark"):
            attr(f"Landmark: {wait['landmark']}")
    elif wp.get("wait"):
        raise _err(f"plan {ref!r} has a wait block but node type {node_type!r}")

    disc = wp.get("discussion")
    if disc is not None:
        if disc.get("enabled") is not True or set(disc) - {"enabled", "agent"}:
            raise _err(f"plan {ref!r} discussion block is not the convention's shape")
        attr(f"Agent: {disc.get('agent')}" if node_type == "discussion" else f"Discussion agent: {disc.get('agent')}")
    elif node_type == "discussion":
        raise _err(f"plan {ref!r} is a discussion node without a discussion block")

    if node_type == "handoff":
        handoff = wp.get("handoff") or {}
        if set(handoff) - {"kind", "gate_required", "gate_ref"}:
            raise _err(f"plan {ref!r} handoff block has unsupported keys")
        kind = handoff.get("kind")
        if handoff.get("gate_ref"):
            attr(f"Kind: {kind}, after gate {handoff['gate_ref']}")
        elif handoff.get("gate_required"):
            attr(f"Kind: {kind}, gate required")
        elif handoff.get("gate_required") is False:
            attr(f"Kind: {kind}, no gate")
        else:
            attr(f"Kind: {kind}")
    elif wp.get("handoff"):
        raise _err(f"plan {ref!r} has a handoff block but node type {node_type!r}")

    if source_port is not None:
        allowed = {"workflow_id", "source_node", "source_workflow", "output_landmarks", "supporting_skill"}
        if set(source_port) - allowed:
            raise _err(f"plan {ref!r} source_port has unsupported keys {sorted(set(source_port) - allowed)}")
        attr("Ported from:")
        for pk in ("workflow_id", "source_node", "source_workflow", "output_landmarks", "supporting_skill"):
            if pk not in source_port:
                continue
            pv = source_port[pk]
            if pk == "output_landmarks":
                if not isinstance(pv, list) or any("," in str(x) for x in pv):
                    raise _err(f"plan {ref!r} output_landmarks not comma-joinable")
                lines.append(f"    - {pk}: {', '.join(str(x) for x in pv)}")
            else:
                lines.append(f"    - {pk}: {_check_line(str(pv), f'plan {ref!r} {pk}')}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("quest", help="path to the quest .yaml file")
    ap.add_argument("-o", "--output", help="write prose here instead of stdout")
    args = ap.parse_args()
    try:
        result = decompile(Path(args.quest).read_text(encoding="utf-8"), args.quest)
    except DecompileError as e:
        print(f"{args.quest}: {e}", file=sys.stderr)
        return 2
    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
    else:
        sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
