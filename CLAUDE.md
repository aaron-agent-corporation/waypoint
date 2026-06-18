# Waypoint — Agent Instructions

## Code-KG: query the knowledge graph before searching source

This repo has a Code-KG knowledge graph at `lat.md/`. **Before reaching for
`grep`, `ls`, `find`, or raw file reads to understand the codebase, query the
graph first** — it is a curated, persistent map and is faster and higher-signal
than re-deriving structure by hand.

Preferred order when locating or understanding code:

1. **Search** — MCP `codekg_search` with `backend: "auto-semantic"`, or
   `code-kg search "<question>" --backend auto-semantic`.
2. **Read a section** — `code-kg context <file-or-symbol>` (or MCP
   `codekg_section "<section-id>"`) to see the relevant sections, their
   relationships, and tests before opening raw source.
3. **Only then** open raw files for the specific lines you need.

After changing code, keep the graph in sync:

- `code-kg check` and `code-kg drift` to compare source against the graph.
- `code-kg update` to refresh generated sections + semantic index. The
  pre-commit hook runs this automatically and stages `lat.md/`, so the graph
  update rides the same commit as the code (bypass once with
  `git commit --no-verify`).
- Hand-edited/curated sections are never overwritten — changes land in
  `.code-kg/cache/merge-proposals/` for manual review. Surface those rather
  than forcing them.

Never hand-edit source backlinks or curated knowledge sections directly; use
`code-kg apply-backlinks --preview` then `--write` for edit-safe sections only.
