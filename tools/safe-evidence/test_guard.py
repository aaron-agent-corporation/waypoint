#!/usr/bin/env python3
"""End-to-end tests for the safe-evidence pre-commit guard. Hermetic: each test
builds a throwaway git repo, stages files, and runs guard.py against the index.
Run: python3 tools/safe-evidence/test_guard.py

Proves the design-doc gate: a seeded leak (fake client name + fake SSN) in a
staged sensitive file is REFUSED with the right category, no value is ever
printed, clean content passes, and non-sensitive paths are out of scope.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

GUARD = str(Path(__file__).parent / "guard.py")

MANIFEST = {
    "schema_version": 1,
    "entries": [
        {"type": "PERSON", "value": "Abigail Example", "variants": ["Abby"], "label": "client"},
        {"type": "SSN", "value": "078-05-1120", "variants": [], "label": "client"},
        {"type": "ADDRESS", "value": "3421 Heatherfield Dr, Louisville KY 40202", "variants": [], "label": "client"},
    ],
}
# A synthetic value that must NEVER appear in guard output.
SECRET_NAME = "Abigail Example"
SECRET_SSN = "078-05-1120"

# FABRICATED credentials, assembled at runtime so this source file carries no
# contiguous credential literal and stays clean under its own guard (the same
# construction test_credentials.py uses and explains).
FAKE_KEY = "sk-ant-api03-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
FAKE_GH = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def _init(repo: Path, *, manifest: bool) -> None:
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    if manifest:
        d = repo / ".safe-evidence"
        d.mkdir()
        (d / "protected.json").write_text(json.dumps(MANIFEST), encoding="utf-8")


def _stage(repo: Path, relpath: str, content: str) -> None:
    p = repo / relpath
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    _git(repo, "add", relpath)


def _run(repo: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, GUARD], cwd=str(repo), capture_output=True, text=True
    )


def main() -> int:
    failures = 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal failures
        if not cond:
            failures += 1
            print(f"FAIL {name}: {detail}")

    with tempfile.TemporaryDirectory() as tmp:
        # 1. Seeded leak in a staged sensitive file → refused with categories, no value.
        repo = Path(tmp) / "leak"
        repo.mkdir()
        _init(repo, manifest=True)
        _stage(
            repo,
            "sensitive-records/note.md",
            f"Patient {SECRET_NAME} (SSN {SECRET_SSN}) seen 03/03/2024 by Dr. Kessler.\n",
        )
        r = _run(repo)
        check("leak-blocks", r.returncode == 1, f"rc={r.returncode}")
        check("leak-name-category", "client name" in r.stderr, r.stderr)
        check("leak-ssn-category", "SSN" in r.stderr, r.stderr)
        check("no-value-leaked", SECRET_NAME not in r.stderr and SECRET_SSN not in r.stderr,
              "guard printed the raw PII value!")
        check("provider-not-flagged", "Kessler" not in r.stderr, "provider name appeared in output")

    with tempfile.TemporaryDirectory() as tmp:
        # 2. Clean sensitive file with a manifest → passes.
        repo = Path(tmp) / "clean"
        repo.mkdir()
        _init(repo, manifest=True)
        _stage(repo, "sensitive-records/note.md",
               "Patient PERSON_1 presented with lumbar strain. PT x6 weeks. RTC 2 weeks.\n")
        r = _run(repo)
        check("clean-passes", r.returncode == 0, f"rc={r.returncode}: {r.stderr}")

    with tempfile.TemporaryDirectory() as tmp:
        # 3. A leak in a NON-sensitive path is out of scope (not scanned).
        repo = Path(tmp) / "scope"
        repo.mkdir()
        _init(repo, manifest=True)
        _stage(repo, "insurance/letter.md", f"Adjuster note re {SECRET_NAME}, {SECRET_SSN}.\n")
        r = _run(repo)
        check("non-sensitive-out-of-scope", r.returncode == 0, f"rc={r.returncode}: {r.stderr}")

    with tempfile.TemporaryDirectory() as tmp:
        # 4. Sensitive file, NO manifest → structured SSN still blocks; a warning is emitted.
        repo = Path(tmp) / "nomani"
        repo.mkdir()
        _init(repo, manifest=False)
        _stage(repo, "sensitive-records/note.md", f"chart lists {SECRET_SSN} today\n")
        r = _run(repo)
        check("no-manifest-structured-blocks", r.returncode == 1, f"rc={r.returncode}: {r.stderr}")
        check("no-manifest-warns", "no protected manifest" in r.stderr, r.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        # 5. --require-manifest turns a no-manifest sensitive file into a hard failure
        #    even when its content is otherwise clean.
        repo = Path(tmp) / "req"
        repo.mkdir()
        _init(repo, manifest=False)
        _stage(repo, "sensitive-records/note.md", "Patient PERSON_1 stable.\n")
        r = subprocess.run(
            [sys.executable, GUARD, "--require-manifest"], cwd=str(repo), capture_output=True, text=True
        )
        check("require-manifest-fails-closed", r.returncode == 1, f"rc={r.returncode}: {r.stderr}")

    # ── Credentials (rsc-889) ────────────────────────────────────────────────
    # The scope contrast with test 3 is the point of the whole bead: PII in a
    # non-sensitive path is deliberately OUT of scope, while a credential in that
    # same path is IN scope. A key does not respect the folder layout.
    with tempfile.TemporaryDirectory() as tmp:
        # 6. THE SCENARIO. An agent prints its env into a run dossier. The dossier
        #    is not a sensitive record, so the PII scope would never look at it.
        repo = Path(tmp) / "cred"
        repo.mkdir()
        _init(repo, manifest=True)
        _stage(
            repo,
            ".waypoint/reports/route-001/dossier.md",
            "# Run dossier\n\n$ env\nPATH=/usr/bin\n"
            f"ANTHROPIC_API_KEY={FAKE_KEY}\n",
        )
        r = _run(repo)
        check("credential-in-non-sensitive-path-blocks", r.returncode == 1, f"rc={r.returncode}: {r.stderr}")
        check("credential-category-named", "Anthropic API key" in r.stderr, r.stderr)
        check(
            "credential-value-never-printed",
            FAKE_KEY not in r.stderr and FAKE_KEY[10:] not in r.stderr,
            "guard printed the raw credential!",
        )
        check("credential-tells-you-to-rotate", "rotate" in r.stderr.lower(), r.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        # 7. No manifest needed: a credential is a credential in any repo. Contrast
        #    with test 4, where the client name could not be checked without one.
        repo = Path(tmp) / "credmani"
        repo.mkdir()
        _init(repo, manifest=False)
        _stage(repo, "scripts/deploy.sh", f"#!/bin/sh\nexport GH_TOKEN={FAKE_GH}\n")
        r = _run(repo)
        check("credential-needs-no-manifest", r.returncode == 1, f"rc={r.returncode}: {r.stderr}")
        check("credential-github-category", "GitHub token" in r.stderr, r.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        # 8. The guard must not cry wolf on ordinary source. A repo full of docs and
        #    code with placeholder tokens has to pass, or the hook gets removed.
        repo = Path(tmp) / "credclean"
        repo.mkdir()
        _init(repo, manifest=True)
        _stage(repo, "README.md", "Auth: `Authorization: Bearer <your-token>`\nSet `ANTHROPIC_API_KEY` in your env.\n")
        _stage(repo, "src/client.ts", "const auth = `Bearer ${process.env.TOKEN}`\n")
        _stage(repo, "docs/notes.md", "The bearer of the letter is the document's author.\n")
        r = _run(repo)
        check("no-false-alarm-on-ordinary-source", r.returncode == 0, f"rc={r.returncode}: {r.stderr}")

    if failures == 0:
        print("all safe-evidence guard tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
