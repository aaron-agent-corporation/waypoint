#!/usr/bin/env python3
"""Safe-evidence pre-commit guard (rsc-w0z S5-D1; credentials rsc-889).

Refuses a commit that would introduce either
  (a) unmasked PII into sensitive content — the five-category
      masking policy (masking.py), or
  (b) a CREDENTIAL, in any file at all (credentials.py).
Deterministic, allowlist-based, no model. Mirrors the prose gate's contract:
exit 0 = clean, 1 = leak(s) found, 2 = hard error; findings go to stderr naming
the file, category, and line — NEVER the offending value.

THE TWO SCOPES DIFFER, and that is the point (rsc-889):

  PII is scanned only in sensitive paths (--hint / --all to adjust),
  because that is where personal identifiers live and the policy scopes masking
  there.

  CREDENTIALS are scanned in EVERY staged text file, with no path scope and no
  manifest. A leaked key does not respect the folder layout: the worker prints
  its environment into a run dossier, a report, a scratch note, a test fixture, a
  shell script. Scoping credentials to `sensitive/` would have meant the guard was
  blind exactly where the leak actually lands — the dossier is not a sensitive
  record. There is also nothing project-specific to allowlist: a credential is a
  credential in any repo, belonging to anyone.

Personal name and mailing address are checked when a per-project `protected.json`
manifest is found by walking up from the file. A staged sensitive file with NO
manifest is a loud WARNING by default (structured leaks still block);
--require-manifest turns that into a hard failure.

Usage:
  guard.py                         scan staged files (pre-commit mode)
  guard.py --paths a.md b.md       scan specific working-tree files
  guard.py --all                   ignore the sensitive-path scope for PII too
  guard.py --require-manifest      fail (not warn) on a sensitive file with no manifest
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from credentials import scan_credentials  # noqa: E402
from masking import ManifestError, build_terms, load_manifest, scan_text  # noqa: E402

# Path substrings (case-insensitive) that mark sensitive, PII-bearing content.
# The policy scopes masking to those paths; the defaults are generic folder
# signals and every host adds its own via --hint (repeatable).
DEFAULT_SENSITIVE_HINTS = ("sensitive", "confidential", "pii")

# Manifest lives under this marker dir at (or above) the project folder.
MANIFEST_DIRS = (".safe-evidence",)
MANIFEST_FILE = "protected.json"


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout


def _repo_root() -> Path:
    return Path(_git("rev-parse", "--show-toplevel").strip())


def staged_files() -> list[str]:
    # ACM = added / copied / modified (not deletions); repo-relative paths.
    out = _git("diff", "--cached", "--name-only", "--diff-filter=ACM")
    return [line for line in out.splitlines() if line.strip()]


def staged_blob(path: str) -> str | None:
    """Staged content of a path, or None if it is binary / not valid UTF-8."""
    raw = subprocess.run(
        ["git", "show", f":{path}"], capture_output=True
    ).stdout
    if b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def worktree_text(path: Path) -> str | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in raw:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def is_sensitive(relpath: str, hints: tuple[str, ...]) -> bool:
    low = relpath.lower()
    return any(h in low for h in hints)


def find_manifest(start: Path, ceiling: Path) -> Path | None:
    """Walk up from `start` (a file's directory) to `ceiling` inclusive, looking
    for a protected.json under any MANIFEST_DIRS marker. Nearest wins."""
    cur = start.resolve()
    ceiling = ceiling.resolve()
    while True:
        for d in MANIFEST_DIRS:
            candidate = cur / d / MANIFEST_FILE
            if candidate.is_file():
                return candidate
        if cur == ceiling or cur.parent == cur:
            return None
        cur = cur.parent


def main() -> int:
    ap = argparse.ArgumentParser(description="Safe-evidence PII leak guard")
    ap.add_argument("--paths", nargs="*", help="scan these working-tree files instead of the git index")
    ap.add_argument("--all", action="store_true", help="scan every staged text file (ignore sensitive-path scope)")
    ap.add_argument("--hint", action="append", default=[], help="extra sensitive-path substring (repeatable)")
    ap.add_argument("--require-manifest", action="store_true", help="fail on a sensitive file with no protected manifest")
    ap.add_argument("--root", help="repo root (defaults to `git rev-parse --show-toplevel`)")
    args = ap.parse_args()

    hints = DEFAULT_SENSITIVE_HINTS + tuple(args.hint)

    try:
        root = Path(args.root).resolve() if args.root else _repo_root()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("safe-evidence: not a git repository (or git unavailable)", file=sys.stderr)
        return 2

    # Build the (relpath, read-content) work list from either mode.
    work: list[tuple[str, Path]] = []
    if args.paths is not None:
        for p in args.paths:
            path = Path(p).resolve()
            try:
                rel = str(path.relative_to(root))
            except ValueError:
                rel = p
            work.append((rel, path))
    else:
        try:
            names = staged_files()
        except subprocess.CalledProcessError as e:
            print(f"safe-evidence: git diff failed: {e}", file=sys.stderr)
            return 2
        work = [(rel, root / rel) for rel in names]

    failures = 0
    warnings = 0
    manifest_cache: dict[Path, list] = {}

    for rel, abspath in work:
        content = worktree_text(abspath) if args.paths is not None else staged_blob(rel)
        if content is None:
            continue  # binary / unreadable — nothing to scan (raw PDFs, etc.)

        # CREDENTIALS: every file, no scope, no manifest (rsc-889). A key lands
        # wherever it was printed — a dossier, a log, a script — and none of
        # those are sensitive paths.
        for c in scan_credentials(content):
            print(f"safe-evidence: LEAK {rel}:{c.line}: {c.category}", file=sys.stderr)
            failures += 1

        # PII: sensitive paths only — that is where personal
        # identifiers live, and the masking policy scopes it there.
        if not args.all and not is_sensitive(rel, hints):
            continue

        manifest_path = find_manifest(abspath.parent, root)
        terms: list = []
        if manifest_path is not None:
            if manifest_path not in manifest_cache:
                try:
                    manifest_cache[manifest_path] = build_terms(load_manifest(manifest_path))
                except ManifestError as e:
                    print(f"safe-evidence: {e}", file=sys.stderr)
                    return 2
            terms = manifest_cache[manifest_path]
        else:
            # No manifest: structured shapes still checked; name/address cannot be.
            msg = (
                f"safe-evidence: WARNING {rel}: sensitive, but no protected "
                f"manifest found (looked for {'/'.join(MANIFEST_DIRS)}/{MANIFEST_FILE} up to "
                f"the repo root) — personal name/address are NOT checked for this file"
            )
            if args.require_manifest:
                print(msg.replace("WARNING", "FAIL"), file=sys.stderr)
                failures += 1
            else:
                print(msg, file=sys.stderr)
                warnings += 1

        for f in scan_text(content, terms):
            print(f"safe-evidence: LEAK {rel}:{f.line}: unmasked {f.category}", file=sys.stderr)
            failures += 1

    if failures:
        print(
            f"\nsafe-evidence: {failures} finding(s) — commit refused. Mask the "
            f"flagged content (or correct the protected manifest) and re-stage. "
            f"A CREDENTIAL finding is not a masking problem: rotate the secret and "
            f"remove it — it is already in your reflog. "
            f"No values are printed; see file:line above.",
            file=sys.stderr,
        )
        return 1
    scanned = "staged" if args.paths is None else "given"
    suffix = f" ({warnings} manifest warning(s))" if warnings else ""
    print(f"safe-evidence: {scanned} content clean — no credentials, no unmasked PII{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
