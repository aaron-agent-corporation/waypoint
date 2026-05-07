# Waypoint Package + Install Readiness Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the standalone Waypoint repo consumable as installable built packages, with a built CLI that can be packed, installed into a temp project, and used for the folder-host journey.

**Architecture:** Keep the current private workspace shape, but stop relying on TypeScript source files as runtime package entrypoints. Add emitted JavaScript and declaration output, point package exports/bin at `dist/`, verify built-output imports, then prove local package installation with `pnpm pack` / temp install smokes before Mission Control consumes it.

**Tech Stack:** TypeScript, pnpm workspaces, Node ESM, Vitest, package tarball install smokes.

---

## Current package facts to preserve

Verified on 2026-05-07 before this plan was written:

- Root package: `@waypoint/core`, `private: true`, current exports point at `./src/index.ts`.
- Internal packages: `@waypoint/folder-host` and `@waypoint/cli`, both `private: true`, current exports/bin point at `src/*.ts`.
- Root `tsconfig.json` currently has `noEmit: true`, `allowImportingTsExtensions: true`, and `outDir: ./dist`.
- Root scripts currently include `pnpm test`, `pnpm typecheck`, `pnpm cli`, and `pnpm smoke:folder-host`.
- Mission Control cutover remains later; this track proves package/install shape first.

## Non-goals

- Do not publish public npm packages in this track.
- Do not cut Mission Control over in this track.
- Do not add a server/gateway or network sync.
- Do not globally install `waypoint` on Aaron's machine as the primary proof; use temp-project install smokes.
- Do not remove source-run development scripts until built CLI behavior is proven.

---

## B0 — Commit this roadmap/plan refresh

**Objective:** Record the selected destination before implementation.

**Files:**
- Modify: `docs/plans/waypoint-remaining-roadmap.md`
- Create: `docs/plans/waypoint-package-install-readiness-plan.md`

**Steps:**
1. Mark Cleanup Track complete.
2. Mark Track 3/H6 complete as a finished reference bridge.
3. Make Package + Install Readiness the active destination.
4. Commit the roadmap and plan.

**Verification:**

```bash
git diff --check
git status --short --branch
git log --oneline -3
```

---

## B1 — Build pipeline and package entrypoints

**Objective:** Add emitted JS/declaration output and make package metadata point at built files.

**Files:**
- Modify: `tsconfig.json`
- Create: `tsconfig.build.json`
- Modify: `package.json`
- Modify: `packages/waypoint-folder-host/package.json`
- Modify: `packages/waypoint-cli/package.json`
- Possibly create: `packages/waypoint-cli/src/bin-built-shim.ts` only if the existing CLI entrypoint cannot compile cleanly as the bin.

**Step 1: Write failing package-build test or script assertion**

Add a small verification script under `scripts/verify-built-packages.mjs` or a Vitest test under `src/__tests__/package-build.test.ts` that expects the built entrypoints to exist after build:

- `dist/src/index.js`
- `dist/packages/waypoint-folder-host/src/index.js`
- `dist/packages/waypoint-cli/src/index.js`
- `dist/packages/waypoint-cli/src/bin.js`
- declaration files for exported entrypoints.

Run before implementation:

```bash
pnpm build
pnpm exec vitest run src/__tests__/package-build.test.ts
```

Expected initial failure: no `build` script / no emitted `dist` files.

**Step 2: Add build config**

Create `tsconfig.build.json` extending root config but overriding:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "declaration": true,
    "emitDeclarationOnly": false,
    "outDir": "./dist"
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

If `.ts` extension imports block emitted JS, fix imports or use a proven postbuild rewrite strategy. Prefer real runtime-compatible imports over a brittle text rewrite.

**Step 3: Add scripts and exports**

Root `package.json` should gain at least:

```json
"build": "tsc -p tsconfig.build.json",
"clean": "rm -rf dist",
"prepack": "pnpm clean && pnpm build"
```

Package metadata should move runtime fields toward built JS:

- Root `@waypoint/core`: `main`, `types`, and `exports` point to `dist/src/index.js` / `.d.ts`.
- `@waypoint/folder-host`: `main`, `types`, and `exports` point to built files relative to that package or to a package-local dist strategy chosen in B1.
- `@waypoint/cli`: `bin.waypoint` points at built `bin.js` and exports point at built `index.js`.

**Step 4: Verify**

```bash
pnpm build
node -e "import('./dist/src/index.js').then(m => console.log(Boolean(m.parseQuestManifest)))"
node dist/packages/waypoint-cli/src/bin.js --help
pnpm typecheck
```

**Commit:**

```bash
git add package.json packages/waypoint-folder-host/package.json packages/waypoint-cli/package.json tsconfig.build.json tsconfig.json scripts/verify-built-packages.mjs src/__tests__/package-build.test.ts
git commit -m "feat(package): add build pipeline for waypoint packages"
```

---

## B2 — Built-output boundary tests

**Objective:** Prove consumers can import the built packages without Vitest aliases or TypeScript source execution.

**Files:**
- Create: `src/__tests__/built-package-boundaries.test.ts`
- Possibly create: `scripts/verify-built-package-imports.mjs`

**Tests should assert:**

1. Built core import exposes parser/registry APIs.
2. Built folder-host import exposes init/status/start APIs.
3. Built CLI import exposes `runWaypointCli`.
4. Built CLI bin prints help and version from `node dist/.../bin.js`.
5. No built import requires Vitest alias resolution.

**Verification:**

```bash
pnpm build
pnpm exec vitest run src/__tests__/built-package-boundaries.test.ts
pnpm typecheck
```

**Commit:**

```bash
git add src/__tests__/built-package-boundaries.test.ts scripts/verify-built-package-imports.mjs
git commit -m "test(package): verify built waypoint package boundaries"
```

---

## B3 — Local tarball install smoke

**Objective:** Prove the CLI and package can be installed into a temp project from packed artifacts.

**Files:**
- Create: `scripts/package-install-smoke.mjs`
- Modify: `package.json`
- Create or modify docs test if needed: `src/__tests__/package-install-docs.test.ts`

**Smoke design:**

1. Create temp directory.
2. Run package pack commands from the repo.
3. Install the CLI/package tarball into the temp directory using pnpm.
4. Run the installed `waypoint` bin, not the source-run Node path:

```bash
waypoint --help
waypoint init --quest waypoint
waypoint status
waypoint start --quest waypoint
waypoint tasks --route-id route-001
```

5. Assert `.waypoint/config.yaml`, route YAML, events JSONL, and task YAML exist in the temp project.
6. Delete the temp project unless `WAYPOINT_KEEP_PACKAGE_SMOKE_PROJECT=1`.

Root script:

```json
"smoke:package-install": "node scripts/package-install-smoke.mjs"
```

**Verification:**

```bash
pnpm smoke:package-install
pnpm smoke:folder-host
pnpm test
pnpm typecheck
```

**Commit:**

```bash
git add package.json scripts/package-install-smoke.mjs src/__tests__/package-install-docs.test.ts docs/waypoint-folder-host.md
git commit -m "test(package): add install smoke for waypoint cli"
```

---

## B4 — Private consumption decision and release docs

**Objective:** Document exactly how Mission Control should consume the standalone Waypoint package next.

**Files:**
- Create: `docs/plans/waypoint-package-consumption.md`
- Modify: `docs/plans/waypoint-remaining-roadmap.md`
- Modify: `docs/waypoint-folder-host.md` if operator install guidance changes.

**Document these decisions:**

- Current package is still private.
- Recommended near-term consumption mode for Mission Control:
  - private GitHub package, or
  - Git dependency pinned to a commit/tag, or
  - local path during development only.
- Versioning rule for package readiness candidates.
- Rollback rule: Mission Control can pin the previous package tag/commit.
- What must be true before public/global CLI docs are written.

**Verification:**

```bash
pnpm exec vitest run src/__tests__/folder-host-docs.test.ts src/__tests__/waypoint-docs.test.ts
pnpm typecheck
```

**Commit:**

```bash
git add docs/plans/waypoint-package-consumption.md docs/plans/waypoint-remaining-roadmap.md docs/waypoint-folder-host.md
git commit -m "docs(package): define waypoint consumption strategy"
```

---

## B5 — Release candidate tag gate

**Objective:** Produce a verifiable package-readiness checkpoint for later Mission Control cutover.

**Files:**
- Create: `docs/plans/waypoint-package-readiness-closeout.md`
- Modify: `docs/plans/waypoint-remaining-roadmap.md`

**Required verification:**

```bash
pnpm clean
pnpm build
pnpm test
pnpm typecheck
pnpm smoke:folder-host
pnpm smoke:package-install
git diff --check
git status --short --branch
```

**Closeout doc must record:**

- Exact package shape.
- Exact smoke commands.
- Whether package was pushed/tagged.
- Any remaining blockers before Mission Control cutover.

**Tag rule:**

Only create a tag after all B5 commands pass:

```bash
git tag waypoint-package-rc-YYYYMMDD
```

Then push only after verifying local tag and user-approved remote target if needed:

```bash
git show --no-patch --oneline waypoint-package-rc-YYYYMMDD
git push origin main --tags
```

**Commit:**

```bash
git add docs/plans/waypoint-package-readiness-closeout.md docs/plans/waypoint-remaining-roadmap.md
git commit -m "docs(package): close package install readiness track"
```

---

## Acceptance criteria for the full track

The Package + Install Readiness track is complete when:

- `pnpm build` emits runtime JS and declarations.
- Built core/folder-host/CLI imports work without TypeScript source execution.
- Built CLI bin runs from `dist`.
- `pnpm smoke:package-install` installs the package into a temp project and runs the Waypoint folder-host journey from the installed `waypoint` bin.
- `pnpm smoke:folder-host`, `pnpm test`, and `pnpm typecheck` pass.
- Roadmap says Package + Install Readiness is complete and Track 2 Mission Control cutover is the next destination.
- Any pushed commit/tag is verified by `git log`, `git status`, and remote read-back before reporting.
