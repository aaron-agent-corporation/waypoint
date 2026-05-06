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

## Examples

- `doc-writer.yaml` — simple content-production recipe
- `reviewer.yaml` — review / verification recipe
