# Example Quests

A **Quest** is a reusable, named workflow template — the journey a project takes
from intake to ship. Each file in this directory is one Quest manifest.

Quest manifests reference recipes by slug. The referenced recipes must exist in
the `recipes/` directory when a Quest is loaded into a runtime.

## Layout

The loader (`loadQuestsFromDirectory`) walks this directory **recursively**, so
you can organize Quests into subdirectories however you want:

```
quests/
├── waypoint.yaml           # top-level
├── dev/
│   └── bugfix.yaml
└── research/
    └── spike.yaml
```

## Schema

See `packages/@waypoint/core/src/quests/manifest.ts` for the full type.
Minimum required: `schema_version`, `slug`, `name`, `workflow`.

## Example

See `example.yaml` in this directory for a worked example.
