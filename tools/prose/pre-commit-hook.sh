#!/bin/sh
# Prose drift gate as a git pre-commit hook.
# Install:  cp tools/prose/pre-commit-hook.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# (or append the exec line to an existing hook)

# Only run when quest sources, recipes, or the prose tooling are in the commit.
if git diff --cached --name-only | grep -qE '((quests|recipes)/|tools/prose/)'; then
  exec python3 "$(git rev-parse --show-toplevel)/tools/prose/gate.py"
fi
exit 0
