#!/bin/sh
# Safe-evidence PII guard as a git pre-commit hook.
#
# This runs in the COMMITTED repo (e.g. the case vault), which is a DIFFERENT
# repo from Waypoint where guard.py lives. The guard reads the committed
# repo's git index via the current directory, so it only needs an absolute path
# to guard.py. install-hook.sh writes a copy of this file with __GUARD__
# replaced by that absolute path.
#
# Manual install:
#   sh tools/safe-evidence/install-hook.sh /path/to/case-vault
# or copy this file to <vault>/.git/hooks/pre-commit and replace __GUARD__.

GUARD="__GUARD__"

if [ ! -f "$GUARD" ]; then
  echo "safe-evidence: guard not found at $GUARD — fix the hook path" >&2
  exit 2
fi

exec python3 "$GUARD"
