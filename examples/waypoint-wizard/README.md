# Waypoint Wizard FirmVault messy fixture

This directory contains a synthetic messy source corpus for Waypoint Wizard smoke tests and examples.

- It is synthetic and contains no real PII.
- The files are intentionally named like user-owned exports, scans, and loose documents.
- Treat `firmvault-messy-source/` as a read-only input fixture.
- Waypoint Wizard should create organized markdown shadows under `.waypoint/shadows` in a separate case folder.
- The fixture supports `pnpm smoke:waypoint-wizard-firmvault` and related documentation/tests.

The files use `.txt` content with messy PDF-like names so repository tests can run without binary documents or private client material.
