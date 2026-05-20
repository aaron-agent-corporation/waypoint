# Waypoint Package Distribution Hardening Plan

> **For Hermes:** Use test-driven-development skill to implement this plan task-by-task.

**Goal:** Make Waypoint packages publish-ready for Mission Control consumption by exact pinned package versions, with an automated preflight that catches private-package flags, leaked `workspace:*` dependencies, and clean-consumer import failures.

**Architecture:** Keep Waypoint as the portable runtime. Add a release/prepublish verification script that exercises the actual packed artifacts for `@waypoint/core`, `@waypoint/folder-host`, and `@waypoint/cli` in a clean temp project without local workspace overrides. Update package metadata only as needed so private registry publishing is possible while preserving the existing monorepo workspace development flow.

**Tech Stack:** Node.js ESM scripts, pnpm pack/install, package.json metadata, TypeScript build output, existing Waypoint package entrypoints.

---

## Context

Mission Control P0.2 found that local tarball install only worked with a consumer-side `pnpm.overrides` workaround for `@waypoint/core`. That is acceptable for spike/debug but not for merge-ready Mission Control integration.

The next Waypoint-side requirement is to make the package artifacts publishable and self-consistent so Mission Control can consume exact private-registry versions such as:

```json
{
  "dependencies": {
    "@waypoint/core": "0.1.0-mc.0",
    "@waypoint/folder-host": "0.1.0-mc.0"
  }
}
```

## Non-negotiables

1. Do not add Mission Control assumptions to core runtime code.
2. Do not commit registry tokens or auth config.
3. Do not rely on local path dependencies or consumer-side overrides for the merge-ready path.
4. Verify the packed artifacts, not just source package.json files.
5. Preserve existing workspace development (`workspace:*`) if possible.

## Task P0 — Commit this plan

**Objective:** Record the package-distribution hardening slice before code changes.

**Files:**
- Create: `docs/plans/2026-05-20-package-distribution-hardening-plan.md`

**Verification:**

```bash
git diff --check
git status --short --branch
```

**Commit:**

```bash
git add docs/plans/2026-05-20-package-distribution-hardening-plan.md
git commit -m "docs: plan package distribution hardening"
```

## Task P1 — Add RED package publishability preflight

**Objective:** Add an executable release preflight that currently fails because packages are still marked private and clean install without overrides is not proven.

**Files:**
- Create: `scripts/verify-package-distribution.mjs`
- Modify: `package.json` scripts

**Expected checks:**

1. Run `pnpm build`.
2. Pack `@waypoint/core`, `@waypoint/folder-host`, and `@waypoint/cli` into a temp directory.
3. Inspect each packed `package/package.json`.
4. Fail if any packed package has `private: true`.
5. Fail if any packed package dependency contains `workspace:`.
6. Create a clean temp project with dependencies pointing to the packed tarballs.
7. Use local-only `pnpm.overrides` inside that temp project to simulate private-registry resolution of exact transitive `@waypoint/*` dependencies; do not use this override shape in Mission Control.
8. Run `pnpm install --ignore-scripts`.
9. Import and assert core/folder-host/cli exports.
10. Run `pnpm exec waypoint --version`.

**Run RED:**

```bash
pnpm verify:package-distribution
```

Expected initial failure: at least one packed package reports `private: true`.

## Task P2 — Make package metadata publishable

**Objective:** Remove metadata blockers while keeping workspace development intact.

**Files:**
- Modify: `package.json`
- Modify: `packages/waypoint-folder-host/package.json`
- Modify: `packages/waypoint-cli/package.json`

**Implementation notes:**

- Remove or set `private: false` for packages intended for private registry publication.
- Keep `workspace:*` source dependencies if `pnpm pack` rewrites them to exact versions in packed artifacts.
- Do not add registry URLs or auth tokens in this slice.

**Run GREEN:**

```bash
pnpm verify:package-distribution
pnpm verify:built-imports
pnpm typecheck
```

## Task P3 — Update package consumption docs

**Objective:** Make the existing package consumption strategy match the new preflight.

**Files:**
- Modify: `docs/plans/waypoint-package-consumption-strategy.md`

**Required doc updates:**

- Note that package-distribution preflight is required before Mission Control cutover.
- State that clean tarball install must work without consumer-side overrides.
- Keep private registry exact-version packages as the preferred Mission Control integration mode.

**Verification:**

```bash
git diff --check
pnpm verify:package-distribution
```

## Definition of done

This slice is complete when:

1. `pnpm verify:package-distribution` passes from a clean temp install that uses local-only tarball overrides to simulate private-registry resolution.
2. Packed package manifests contain no `private: true` and no `workspace:` dependencies.
3. Core/folder-host/CLI exports import from the installed tarballs.
4. `pnpm verify:built-imports` passes.
5. `pnpm typecheck` passes.
6. The plan and package consumption docs are committed with the implementation.
