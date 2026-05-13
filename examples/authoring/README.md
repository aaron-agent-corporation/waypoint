# Waypoint authoring examples

This directory contains safe, draft-only inputs for the `waypoint author` wizard.

## FirmVault follow-up fixture

`firmvault-followup.answers.json` is a synthetic FirmVault authoring fixture that drives the Quest draft generator:

```bash
waypoint author quest --answers examples/authoring/firmvault-followup.answers.json --allow-unapproved-draft --json
```

Expected behavior:

- The command prints a valid Quest YAML draft and validation report.
- The output is `draft only: not written or installed` unless `--write-draft <safe-relative-path>` is supplied.
- The fixture keeps FirmVault safety metadata: no external side effects, no legal landmark updates by default, and human review gates before contact.
- The fixture uses local source paths only; it does not reach Mission Control, Forgejo, the document pipeline, or any external service.

The fixture intentionally includes an unapproved design-spec path. Use `--allow-unapproved-draft` for this example, or create an approved design spec before generating drafts without the escape hatch.
