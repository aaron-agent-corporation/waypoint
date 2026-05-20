# Waypoint Package Consumption Strategy

**Status:** Track 5 / B4 decision record  
**Date:** 2026-05-07  
**Purpose:** Define how downstream consumers, especially Mission Control, should consume Waypoint after the build/install readiness work.

---

## Ground truth

Waypoint currently ships from a private pnpm workspace:

- root package: `@waypoint/core`
- workspace package: `@waypoint/folder-host`
- workspace package / CLI bin: `@waypoint/cli` with `waypoint`

Track 5 has added:

- emitted JS and declaration output via `pnpm build`
- package entrypoints targeting `dist` output
- built import verification via `pnpm verify:built-imports`
- local tarball install smoke via `pnpm smoke:install`

The repo is still private. This document does not claim public npm publication.

---

## Recommended short-term strategy

Use a **Git tag / GitHub dependency** for Mission Control cutover, then move to a private registry once versioning pressure justifies it.

Why:

- It avoids npm/GitHub Packages registry setup as a blocker.
- It gives Mission Control an immutable reference instead of a mutable local path.
- It supports fast rollback by pinning Mission Control back to the previous tag or commit.
- It keeps the first cutover honest: Mission Control consumes the built package shape, not a source alias hidden by repo adjacency.

Recommended first candidate shape:

```json
{
  "dependencies": {
    "@waypoint/core": "github:Whaleylaw/waypoint#<tag-or-sha>"
  }
}
```

If Mission Control needs the folder-host or CLI packages directly, add explicit dependencies for the same tag/sha once package manager behavior is verified against this monorepo layout. Do not rely on an unpinned branch name for production cutover.

---

## Option: Git tag / GitHub dependency

Use when:

- Waypoint is private and only Mission Control needs it.
- The team wants a low-friction first integration.
- A rollback can be expressed as “restore the prior package ref.”

Required gates before use:

1. `pnpm build`
2. `pnpm verify:built-imports`
3. `pnpm smoke:install`
4. `pnpm verify:package-distribution`
5. `pnpm test`
6. `pnpm typecheck`
7. tag the verified commit

Risks:

- Monorepo subpackage behavior must be verified by the consuming package manager.
- Private GitHub access must be available in the environment that installs Mission Control.
- Git dependencies can be slower than registry installs.

Rollback rule:

- Mission Control must pin an exact tag or commit SHA.
- Rollback means reverting that package ref to the prior known-good tag/SHA and reinstalling.
- Do not roll forward by force-moving a tag.

---

## Option: Private npm/GitHub Packages

Use when:

- More than one system consumes Waypoint.
- Install speed/reproducibility matters more than setup simplicity.
- Semver release metadata is needed.

Required gates before use:

1. Create package registry auth and `.npmrc` strategy.
2. Publish `@waypoint/core`, `@waypoint/folder-host`, and `@waypoint/cli` in dependency order.
3. Verify install from a clean temp project with registry auth only, no local filesystem paths.
4. Run `pnpm verify:package-distribution` before publish to prove packed manifests have no `private: true` flags and no leaked `workspace:` dependencies.
5. Record published versions and immutable package URLs.

Risks:

- Registry auth failures can break deploys.
- Private package permissions must be maintained.
- Package names may need scope/registry configuration.

Rollback rule:

- Do not unpublish rollback targets.
- Roll back by pinning Mission Control to the previous version.
- Publish a corrective patch version rather than mutating a published artifact.

---

## Option: Local path dependency

Use only for:

- development while both repos are on the same machine
- temporary debugging
- pre-cutover experiments

Example:

```json
{
  "dependencies": {
    "@waypoint/core": "file:../waypoint"
  }
}
```

Risks:

- Not portable to CI/deploy systems unless filesystem layout is duplicated.
- Can accidentally consume source state that was never built, tagged, or pushed.
- Makes rollback ambiguous because the dependency target is mutable.

Rollback rule:

- Local path dependencies are not acceptable as the Mission Control release rollback mechanism.
- If local path is used during development, replace it with a tag/SHA before release sign-off.

---

## Mission Control cutover rule

Mission Control cutover should not start until a Waypoint commit has passed:

```bash
pnpm build
pnpm verify:built-imports
pnpm smoke:install
pnpm verify:package-distribution
pnpm test
pnpm typecheck
```

The cutover branch should record:

- the exact Waypoint package tag/SHA/version
- the install strategy used
- the rollback tag/SHA/version
- the verification output from Mission Control after dependency replacement

---

## Current recommendation

For the first Mission Control cutover:

1. Complete Track 5 / B5 release candidate gate.
2. Tag the verified Waypoint commit, e.g. `waypoint-package-rc.1` or a semver pre-release tag.
3. Consume that tag from Mission Control.
4. Keep the previous Mission Control dependency state as the rollback point.
5. Move to Private npm/GitHub Packages only after the Git-tag dependency proves the integration shape.
