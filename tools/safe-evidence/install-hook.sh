#!/bin/sh
# Install the safe-evidence PII guard as a pre-commit hook in a target repo
# (the case vault). Bakes the absolute path to guard.py — which lives here in
# Waypoint — into the hook, since the vault is a separate repo.
#
# Usage:  sh tools/safe-evidence/install-hook.sh <target-repo-dir>
#
# Idempotent and non-destructive: refuses to clobber an existing pre-commit
# hook. If one already exists, it prints the one line to add and exits.

set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GUARD="$HERE/guard.py"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: sh install-hook.sh <target-repo-dir>" >&2
  exit 2
fi

if [ ! -f "$GUARD" ]; then
  echo "install: guard.py not found at $GUARD" >&2
  exit 2
fi

# Resolve the target's git dir (handles worktrees; requires a real git repo).
GITDIR=$(git -C "$TARGET" rev-parse --absolute-git-dir 2>/dev/null) || {
  echo "install: $TARGET is not a git repository" >&2
  exit 2
}
HOOK="$GITDIR/hooks/pre-commit"

if [ -e "$HOOK" ]; then
  echo "install: a pre-commit hook already exists at $HOOK — not overwriting." >&2
  echo "Add this line to it to chain the guard:" >&2
  echo "  exec python3 \"$GUARD\"" >&2
  exit 1
fi

mkdir -p "$GITDIR/hooks"
sed "s#__GUARD__#$GUARD#g" "$HERE/pre-commit-hook.sh" > "$HOOK"
chmod +x "$HOOK"
echo "safe-evidence: installed pre-commit hook at $HOOK"
echo "  guard: $GUARD"
echo "  scans staged sensitive files; blocks unmasked PII."
