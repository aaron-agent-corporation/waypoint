#!/usr/bin/env python3
"""Generate the TypeScript credential patterns from credential-patterns.json.

The JSON is the single source of truth; this emits the TS the waypoint package
compiles against. The alternative — hand-maintaining the same shapes in Python and
TypeScript — drifts, and drifts SILENTLY: the pre-commit guard keeps passing while
the evidence mask quietly stops covering a category, and nothing fails.

Same shape as the prose convention: one source, a deterministic translation, and a
gate that recompiles and byte-diffs (credential-mask.test.ts) so the
generated file cannot be edited by hand and survive.

    python3 tools/safe-evidence/gen-ts-patterns.py            # write
    python3 tools/safe-evidence/gen-ts-patterns.py --check    # exit 1 on drift
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
SOURCE = HERE / "credential-patterns.json"
TARGET = (
    HERE.parent.parent
    / "packages/waypoint-folder-host/src/runtime/credential-patterns.generated.ts"
)


def ts_string(value: str) -> str:
    """A TS single-quoted literal. json.dumps gives us correct escaping for the
    backslash-heavy regex bodies; we only re-quote."""
    return json.dumps(value)


def render(spec: dict) -> str:
    def entry(s: dict) -> str:
        flags = s.get("flags", "")
        return f"  {{ category: {ts_string(s['category'])}, regex: {ts_string(s['regex'])}, flags: {ts_string(flags)} }},"

    lines = [
        "// GENERATED FILE — DO NOT EDIT.",
        "//",
        "// Source:    tools/safe-evidence/credential-patterns.json",
        "// Generator: tools/safe-evidence/gen-ts-patterns.py",
        "//",
        "// The Python pre-commit guard (tools/safe-evidence/credentials.py) reads the",
        "// same JSON. Hand-editing this file makes the two engines disagree, which is a",
        "// SILENT failure — the guard keeps passing while this mask stops covering a",
        "// category. credential-mask.test.ts regenerates and byte-compares to stop",
        "// that, the way the prose gate does for quest YAML.",
        "//",
        "// Edit the JSON and re-run the generator.",
        "",
        "export interface CredentialPattern {",
        "  readonly category: string",
        "  /** Source text for a RegExp. Kept dialect-clean: no named groups, no inline flags. */",
        "  readonly regex: string",
        "  readonly flags: string",
        "}",
        "",
        "/** Shapes where the whole match is the secret. */",
        "export const SIMPLE_PATTERNS: readonly CredentialPattern[] = [",
        *[entry(s) for s in spec["simple"]],
        "]",
        "",
        "/** Three base64url segments. Skipped inside a URL — see credential-mask.ts. */",
        f"export const JWT_PATTERN: CredentialPattern = {{ category: {ts_string(spec['jwt']['category'])}, regex: {ts_string(spec['jwt']['regex'])}, flags: {ts_string(spec['jwt'].get('flags', ''))} }}",
        "",
        "/** Shapes where GROUP 1 is the secret and the match spans its anchor too. */",
        "export const VALUED_PATTERNS: readonly CredentialPattern[] = [",
        *[entry(s) for s in spec["valued"]],
        "]",
        "",
        "/** A captured value that is obviously a stand-in. Tested against the value ALONE. */",
        f"export const PLACEHOLDER_PATTERN: CredentialPattern = {{ category: 'placeholder', regex: {ts_string(spec['placeholder']['regex'])}, flags: {ts_string(spec['placeholder'].get('flags', ''))} }}",
        "",
        f"export const PLACEHOLDER_CHARS = {ts_string(spec['placeholder_chars'])}",
        f"export const URL_SCHEME = {ts_string(spec['url_scheme'])}",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    spec = json.loads(SOURCE.read_text(encoding="utf-8"))
    rendered = render(spec)

    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != rendered:
            print(
                f"DRIFT: {TARGET.relative_to(HERE.parent.parent)} does not match "
                f"{SOURCE.name}.\nRun: python3 tools/safe-evidence/gen-ts-patterns.py",
                file=sys.stderr,
            )
            return 1
        print("credential patterns: generated TS matches the JSON")
        return 0

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(rendered, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(HERE.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
