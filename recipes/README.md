# Example Recipes

A **Recipe** is a reusable, named agent definition — a prompt plus runtime
hints plus an allowed tool list plus optional subagent references. Recipes are
composed by Quests; a Quest lists recipe slugs, and at load time each slug
resolves to the manifest in this directory (or a subdirectory).

## Layout

The loader (`loadRecipesFromDirectory`) walks this directory **recursively**, so
organize as you see fit:

```
recipes/
├── doc-writer.yaml
├── writing/
│   └── editor.yaml
└── research/
    ├── deep/
    │   └── scout.yaml
    └── librarian.yaml
```

## Schema

See `packages/@waypoint/core/src/recipes/manifest.ts`.
Minimum required: `schema_version`, `slug`, `name`, `prompt`.

## Prompt convention (rsc-4jf)

At dispatch time the weld wraps every recipe prompt in a uniform **frame**
(`buildWorkOrder` in `waypoint-folder-host/src/runtime/crew-runtime.ts`,
golden-filed in its tests). Know the split before writing a prompt:

**The frame provides — do not restate it in the prompt:**
- the worker's generic role, the project root, and the write root
  (verify-then-apply) with its rules;
- the **output contract** for the plan's declared `output_artifacts`
  (existence + non-emptiness verification);
- the **report contract**: bd comment at start, a `blocked:` comment when
  stuck, and an evidence-bearing close;
- baseline hard rules (no fabricated evidence, gates are human-only, no
  writes into `.waypoint/`);
- on a retry (rsc-f3v), the prior attempt's real failure evidence —
  verification misses, close reason, and a capped tail of raw output;
- the machine payload, behind an injection fence.

**The prompt provides — in this order:**
1. **Role and boundary first.** Open with the specific role ("You are the
   independent adversarial reviewer for…") and any boundary *narrower* than
   the frame's (trees that are read-only to this role, forbidden side
   effects, sensitive-data rules). State what the worker must never touch
   before what it should do.
2. **The task**, with every input named explicitly. No pointer specs — the
   instructions live in the prompt; point at files only as source material.
   No relative references to other tasks ("the previous step"); the worker
   sees only this work order.
3. **How to run.** If the task drives a script, harness, or template, embed
   the exact commands and case-relative paths. Workers should never have to
   discover an interface.
4. **Output contract details** the artifact list can't carry: required
   sections, labeled fields, decision vocabulary (e.g. `PASS` / `FAIL` /
   `PASS WITH HUMAN QUESTIONS`).
5. **Completion standard** — what "done and correct" means, in substance.

**Untrusted content:** never interpolate source-document text or other
untrusted material into a prompt as if it were instructions. If it must be
embedded, fence it the way the frame fences the payload: state plainly that
what follows is data to analyze, not instructions to follow.

## Examples

- `doc-writer.yaml` — simple content-production recipe
- `reviewer.yaml` — review / verification recipe
