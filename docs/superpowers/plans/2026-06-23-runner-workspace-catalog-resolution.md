# Workspace-Local Catalog Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved workspace catalog entries under `.runner/quests|recipes/` first-class runtime inputs so authored quests/recipes are runnable and discoverable.

**Architecture:** Add one `loadWorkspaceSpineCatalog(projectRoot)` loader that overlays workspace entries on the bundled package catalog (workspace-wins on slug collision) and returns the existing `BundledSpineCatalog` interface, making it a drop-in at every resolution site. Wire it into route start (folder + beads), engine-host `catalog.*`, the CLI `quests`/`recipes` commands (via upward `.runner/` discovery), and autopilot's default recipe lookup.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Node `fs/promises`, `yaml`, vitest. pnpm workspace.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-23-runner-workspace-catalog-resolution-design.md` (MAR-reviewed, run `20260623-BFSAj8`).
- `loadBundledSpineCatalog` behavior is **unchanged** (D4) — it stays the bundled primitive the new loader composes.
- Overlay precedence (D1): on slug collision, **workspace wins** over bundled.
- Autopilot precedence (D5): when an ad-hoc `catalogDir` is supplied, the recipe lookup is **`catalogDir`-only and unchanged**; only the default (no-`catalogDir`) path becomes workspace-aware (workspace > bundled). There is **no three-way merge**.
- Merged entries are **slug-sorted and filesystem-order-independent** (determinism).
- Reuse symbol is `createCatalogRegistry` (not `createSpineCatalog`).
- Out of scope: provenance/source badges; workflow-file loading; beads ad-hoc parity.
- Import specifiers in this codebase include the `.ts` extension (e.g. `'./bundled.ts'`). Match the surrounding files.
- Test runner: `npx vitest run <path>` from repo root. Typecheck: `pnpm typecheck`.
- Commit after every task. Use `git commit --no-verify` only if the code-kg pre-commit hook blocks; otherwise let it run.

---

### Task 1: Extract a reusable catalog factory + entry loaders from `bundled.ts` (no behavior change)

Refactor so both the bundled loader and the new workspace loader build the `BundledSpineCatalog` value (registries + `resolveQuestRecipes`) through one shared factory, and so the workspace loader can reuse the entry parsers and a dir-exists check. Pure refactor — existing behavior and the existing `bundled.test.ts` must stay green.

**Files:**
- Modify: `packages/spine-folder-host/src/catalog/bundled.ts`
- Test: `packages/spine-folder-host/src/catalog/bundled.test.ts` (existing — must still pass)

**Interfaces:**
- Produces (new exports from `bundled.ts`):
  - `loadQuestEntries(root: string): Promise<SpineCatalogEntry<CatalogQuestManifest>[]>`
  - `loadRecipeEntries(root: string): Promise<SpineCatalogEntry<CatalogRecipeManifest>[]>`
  - `isDirectory(path: string): Promise<boolean>`
  - `buildSpineCatalog(params: { root: string; questsDir: string; recipesDir: string; questEntries: readonly SpineCatalogEntry<CatalogQuestManifest>[]; recipeEntries: readonly SpineCatalogEntry<CatalogRecipeManifest>[] }): BundledSpineCatalog`

- [ ] **Step 1: Add the `buildSpineCatalog` factory and export the helpers**

In `packages/spine-folder-host/src/catalog/bundled.ts`, replace the body of `loadBundledSpineCatalog` (the part from `const quests = createCatalogRegistry(...)` through the returned object literal, lines ~78-124) with a call to a new factory. Add the factory and flip `isDirectory`, `loadQuestEntries`, `loadRecipeEntries` to `export`. The new code:

```ts
export async function loadBundledSpineCatalog(
  options: LoadBundledSpineCatalogOptions = {},
): Promise<BundledSpineCatalog> {
  const root = options.root ?? (await findBundledCatalogRoot())
  const questsDir = join(root, 'quests')
  const recipesDir = join(root, 'recipes')

  const questEntries = await loadQuestEntries(questsDir)
  const recipeEntries = await loadRecipeEntries(recipesDir)

  return buildSpineCatalog({ root, questsDir, recipesDir, questEntries, recipeEntries })
}

/**
 * Build a BundledSpineCatalog value from already-loaded entries. Shared by
 * the bundled loader and the workspace-overlay loader so resolveQuestRecipes
 * lives in exactly one place.
 */
export function buildSpineCatalog(params: {
  readonly root: string
  readonly questsDir: string
  readonly recipesDir: string
  readonly questEntries: readonly SpineCatalogEntry<CatalogQuestManifest>[]
  readonly recipeEntries: readonly SpineCatalogEntry<CatalogRecipeManifest>[]
}): BundledSpineCatalog {
  const { root, questsDir, recipesDir, questEntries, recipeEntries } = params
  const quests = createCatalogRegistry(questEntries.map((entry) => entry.manifest))
  const recipes = createCatalogRegistry(recipeEntries.map((entry) => entry.manifest))

  return {
    root,
    questsDir,
    recipesDir,
    quests,
    recipes,
    questEntries,
    recipeEntries,
    resolveQuestRecipes(questSlug) {
      const quest = quests.get(questSlug)
      const questEntry = questEntries.find((entry) => entry.slug === questSlug)
      if (!quest || !questEntry) {
        return { ok: false, message: `unknown Quest: ${questSlug}` }
      }

      const recipeSlugs = quest.recipes ?? []
      const resolvedRecipes: CatalogRecipeManifest[] = []
      const resolvedEntries: SpineCatalogEntry<CatalogRecipeManifest>[] = []
      const unresolved: string[] = []

      for (const slug of recipeSlugs) {
        const recipe = recipes.get(slug)
        const entry = recipeEntries.find((candidate) => candidate.slug === slug)
        if (!recipe || !entry) {
          unresolved.push(slug)
        } else {
          resolvedRecipes.push(recipe)
          resolvedEntries.push(entry)
        }
      }

      if (unresolved.length > 0) {
        return { ok: false, message: `unresolved recipe slug(s): ${unresolved.join(', ')}` }
      }

      return { ok: true, quest, questEntry, recipes: resolvedRecipes, recipeEntries: resolvedEntries }
    },
  }
}
```

Then change the three existing private declarations to exported:
```ts
export async function isDirectory(path: string): Promise<boolean> {
```
```ts
export async function loadQuestEntries(root: string): Promise<SpineCatalogEntry<CatalogQuestManifest>[]> {
```
```ts
export async function loadRecipeEntries(root: string): Promise<SpineCatalogEntry<CatalogRecipeManifest>[]> {
```

- [ ] **Step 2: Run the existing bundled tests to verify no behavior change**

Run: `npx vitest run packages/spine-folder-host/src/catalog/bundled.test.ts`
Expected: PASS (same as before the refactor).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/spine-folder-host/src/catalog/bundled.ts
git commit -m "refactor(folder-host): extract buildSpineCatalog + export catalog entry loaders (no behavior change)"
```

---

### Task 2: `loadWorkspaceSpineCatalog` loader + unit tests

The core deliverable: a loader that overlays `.runner/quests|recipes` onto the bundled catalog, workspace-wins, tolerant of missing dirs, slug-sorted.

**Files:**
- Create: `packages/spine-folder-host/src/catalog/workspace.ts`
- Create: `packages/spine-folder-host/src/catalog/workspace.test.ts`
- Modify: `packages/spine-folder-host/src/index.ts`

**Interfaces:**
- Consumes: `buildSpineCatalog`, `loadQuestEntries`, `loadRecipeEntries`, `isDirectory`, `loadBundledSpineCatalog` (Task 1); `getSpineProjectPaths` from `../project/root.ts`.
- Produces: `loadWorkspaceSpineCatalog(projectRoot: string): Promise<BundledSpineCatalog>`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/spine-folder-host/src/catalog/workspace.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadBundledSpineCatalog } from './bundled.ts'
import { loadWorkspaceSpineCatalog } from './workspace.ts'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wp-ws-catalog-'))
}

async function writeWorkspaceQuest(root: string, slug: string, recipes: string[]): Promise<void> {
  const dir = join(root, '.runner', 'quests')
  await mkdir(dir, { recursive: true })
  const recipeLines = recipes.length ? `recipes:\n${recipes.map((r) => `  - ${r}`).join('\n')}\n` : ''
  await writeFile(
    join(dir, `${slug}.yaml`),
    `schema_version: 1\nslug: ${slug}\nname: ${slug} quest\nworkflow: workflows/${slug}.md\n${recipeLines}`,
    'utf8',
  )
}

async function writeWorkspaceRecipe(root: string, slug: string, name = `${slug} recipe`): Promise<void> {
  const dir = join(root, '.runner', 'recipes')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${slug}.yaml`), `schema_version: 1\nslug: ${slug}\nname: ${name}\n`, 'utf8')
}

describe('loadWorkspaceSpineCatalog', () => {
  it('resolves an authored-only quest + recipe not present in the bundle', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'authored-quest', ['authored-recipe'])
    await writeWorkspaceRecipe(root, 'authored-recipe')

    const catalog = await loadWorkspaceSpineCatalog(root)
    const resolved = catalog.resolveQuestRecipes('authored-quest')

    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(resolved.recipes.map((r) => r.slug)).toEqual(['authored-recipe'])
    }
  })

  it('lets a workspace recipe shadow a bundled recipe of the same slug', async () => {
    const root = await tempProject()
    const bundled = await loadBundledSpineCatalog()
    const bundledSlug = bundled.recipes.list()[0].slug // a real bundled recipe slug
    await writeWorkspaceRecipe(root, bundledSlug, 'SHADOWED name')

    const catalog = await loadWorkspaceSpineCatalog(root)
    const entry = catalog.recipeEntries.find((e) => e.slug === bundledSlug)

    expect(entry?.manifest.name).toBe('SHADOWED name')
    expect(catalog.recipes.size).toBe(bundled.recipes.size) // shadow, not add
    expect(entry?.path).toContain(join('.runner', 'recipes')) // winning entry points at the workspace file
  })

  it('falls back to bundled-only when .runner dirs are missing (no throw)', async () => {
    const root = await tempProject() // no .runner/ at all
    const catalog = await loadWorkspaceSpineCatalog(root)
    expect(catalog.quests.size).toBeGreaterThan(0) // bundled quests still present
  })

  it('treats an empty-but-present .runner/quests dir as bundled-only', async () => {
    const root = await tempProject()
    await mkdir(join(root, '.runner', 'quests'), { recursive: true })

    const catalog = await loadWorkspaceSpineCatalog(root)
    expect(catalog.quests.size).toBeGreaterThan(0)
  })

  it('throws the existing parse error (with the workspace path) on a malformed authored manifest', async () => {
    const root = await tempProject()
    const dir = join(root, '.runner', 'recipes')
    await mkdir(dir, { recursive: true })
    const badPath = join(dir, 'broken.yaml')
    await writeFile(badPath, 'schema_version: 2\nslug: broken\n', 'utf8') // wrong schema_version

    await expect(loadWorkspaceSpineCatalog(root)).rejects.toThrow(/invalid Recipe manifest/)
  })

  it('produces slug-sorted merged quest entries including authored + bundled', async () => {
    const root = await tempProject()
    await writeWorkspaceQuest(root, 'zzz-authored', [])

    const catalog = await loadWorkspaceSpineCatalog(root)
    const slugs = catalog.questEntries.map((e) => e.slug)

    expect(slugs).toContain('zzz-authored')
    expect(slugs).toContain('runner') // a bundled quest
    expect([...slugs]).toEqual([...slugs].sort((a, b) => a.localeCompare(b)))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/spine-folder-host/src/catalog/workspace.test.ts`
Expected: FAIL — `loadWorkspaceSpineCatalog` is not defined / module not found.

- [ ] **Step 3: Implement the loader**

Create `packages/spine-folder-host/src/catalog/workspace.ts`:

```ts
import { join } from 'node:path'

import { getSpineProjectPaths } from '../project/root.ts'
import {
  buildSpineCatalog,
  isDirectory,
  loadBundledSpineCatalog,
  loadQuestEntries,
  loadRecipeEntries,
  type BundledSpineCatalog,
  type CatalogQuestManifest,
  type CatalogRecipeManifest,
  type SpineCatalogEntry,
} from './bundled.ts'

/** Overlay bundled + workspace catalogs; on a slug collision the workspace entry wins. */
export async function loadWorkspaceSpineCatalog(projectRoot: string): Promise<BundledSpineCatalog> {
  const bundled = await loadBundledSpineCatalog()
  const runnerDir = getSpineProjectPaths(projectRoot).runnerDir
  const questsDir = join(runnerDir, 'quests')
  const recipesDir = join(runnerDir, 'recipes')

  const workspaceQuestEntries = (await isDirectory(questsDir)) ? await loadQuestEntries(questsDir) : []
  const workspaceRecipeEntries = (await isDirectory(recipesDir)) ? await loadRecipeEntries(recipesDir) : []

  const questEntries = mergeEntries(bundled.questEntries, workspaceQuestEntries)
  const recipeEntries = mergeEntries(bundled.recipeEntries, workspaceRecipeEntries)

  // root/questsDir/recipesDir reflect the workspace overlay's home.
  return buildSpineCatalog({ root: runnerDir, questsDir, recipesDir, questEntries, recipeEntries })
}

/** Merge entries by slug — workspace (second arg) wins — then slug-sort for determinism. */
function mergeEntries<TManifest>(
  bundled: readonly SpineCatalogEntry<TManifest>[],
  workspace: readonly SpineCatalogEntry<TManifest>[],
): SpineCatalogEntry<TManifest>[] {
  const bySlug = new Map<string, SpineCatalogEntry<TManifest>>()
  for (const entry of bundled) bySlug.set(entry.slug, entry)
  for (const entry of workspace) bySlug.set(entry.slug, entry)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
```

If `CatalogQuestManifest`/`CatalogRecipeManifest`/`SpineCatalogEntry` are not already exported from `bundled.ts`, add them to the existing `export type { ... } from './bundled.ts'` blocks (they are declared there). Remove unused imports if the typechecker flags them.

- [ ] **Step 4: Export the loader from the package index**

In `packages/spine-folder-host/src/index.ts`, beside the existing bundled export (line ~36), add:

```ts
export { loadWorkspaceSpineCatalog } from './catalog/workspace.ts'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/spine-folder-host/src/catalog/workspace.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/spine-folder-host/src/catalog/workspace.ts packages/spine-folder-host/src/catalog/workspace.test.ts packages/spine-folder-host/src/index.ts packages/spine-folder-host/src/catalog/bundled.ts
git commit -m "feat(folder-host): loadWorkspaceSpineCatalog overlay loader (workspace-wins)"
```

---

### Task 3: Wire `startQuestRoute` (folder + beads) through the workspace loader

`run.start` → `startQuestRoute` currently resolves from the bundled catalog and throws for authored quests. Switch it to the workspace loader, loaded **once** and reused for both recipe resolution and beads instantiation.

**Files:**
- Modify: `packages/spine-folder-host/src/routes/start.ts` (lines 44, 75)
- Test: `packages/spine-folder-host/src/routes/start.workspace.test.ts` (new)

**Interfaces:**
- Consumes: `loadWorkspaceSpineCatalog` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `packages/spine-folder-host/src/routes/start.workspace.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { startQuestRoute } from './start.ts'

async function initFolderProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-start-ws-'))
  await mkdir(join(root, '.runner'), { recursive: true })
  await writeFile(join(root, '.runner', 'config.yaml'), 'schema_version: 1\nbackend:\n  route: folder\n', 'utf8')
  return root
}

async function writeAuthored(root: string, questSlug: string, recipeSlug: string): Promise<void> {
  const qDir = join(root, '.runner', 'quests')
  const rDir = join(root, '.runner', 'recipes')
  await mkdir(qDir, { recursive: true })
  await mkdir(rDir, { recursive: true })
  await writeFile(
    join(qDir, `${questSlug}.yaml`),
    `schema_version: 1\nslug: ${questSlug}\nname: ${questSlug}\nworkflow: workflows/${questSlug}.md\nrecipes:\n  - ${recipeSlug}\n`,
    'utf8',
  )
  await writeFile(join(rDir, `${recipeSlug}.yaml`), `schema_version: 1\nslug: ${recipeSlug}\nname: ${recipeSlug}\n`, 'utf8')
}

describe('startQuestRoute with an authored quest', () => {
  it('starts a folder route for a workspace-authored quest not in the bundle', async () => {
    const root = await initFolderProject()
    await writeAuthored(root, 'authored-quest', 'authored-recipe')

    const route = await startQuestRoute(root, { quest: 'authored-quest' })

    expect(route.backend).toBe('folder')
    expect(route.quest).toBe('authored-quest')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/spine-folder-host/src/routes/start.workspace.test.ts`
Expected: FAIL — `startQuestRoute` throws `unknown Quest: authored-quest` (bundled-only resolution).

- [ ] **Step 3: Switch the resolver to the workspace loader**

In `packages/spine-folder-host/src/routes/start.ts`:

Change the import (line 6) from:
```ts
import { loadBundledSpineCatalog } from '../catalog/bundled.ts'
```
to:
```ts
import { loadWorkspaceSpineCatalog } from '../catalog/workspace.ts'
```

Change the load (line 44) from:
```ts
  const catalog = await loadBundledSpineCatalog()
```
to:
```ts
  // Resolve once; reuse for both recipe resolution and beads instantiation.
  const catalog = await loadWorkspaceSpineCatalog(projectRoot)
```

The existing `catalog.resolveQuestRecipes(options.quest)` (line 45) and `instantiateSpineRouteInBeads(catalog, …)` (line 75) now use the merged catalog unchanged.

- [ ] **Step 4: Run the new test + the existing start tests**

Run: `npx vitest run packages/spine-folder-host/src/routes/start.workspace.test.ts packages/spine-folder-host/src/routes/start.test.ts`
Expected: PASS (new test passes; existing start tests unaffected — bundled quests still resolve through the overlay, which includes the bundle).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/spine-folder-host/src/routes/start.ts packages/spine-folder-host/src/routes/start.workspace.test.ts
git commit -m "feat(folder-host): startQuestRoute resolves via the workspace overlay catalog"
```

---

### Task 4: Wire engine-host `catalog.quests` / `catalog.recipes` through the workspace loader, and add the approve→run e2e

Make the engine-host catalog commands workspace-aware, and add the headline regression: author.promote → approveProposal → run.start succeeds, and the authored quest shows up in `catalog.quests`.

**Files:**
- Modify: `packages/spine-engine-host/src/core/commands/catalog.ts`
- Test: `packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts` (new)

**Interfaces:**
- Consumes: `loadWorkspaceSpineCatalog` (Task 2); engine-host command bus + session from existing test helpers.

- [ ] **Step 1: Confirm the engine-host test harness pattern**

Read one existing engine-host command test (e.g. `packages/spine-engine-host/src/__tests__/author.test.ts`) to copy its host-bootstrap + `workspace.open` + dispatch pattern. Match its imports and setup verbatim; do not invent a new harness.

- [ ] **Step 2: Write the failing e2e test**

Create `packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts`. Use the same host setup as `author.test.ts`; the body asserts the flow (adapt the bootstrap lines to match that file):

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost, FakeBrainAdapter } from '../index.ts'

async function openHost() {
  const host = createEngineHost({ brainAdapter: new FakeBrainAdapter({ events: [], result: { status: 'completed' } }) })
  const root = await mkdtemp(join(tmpdir(), 'wp-eh-wscat-'))
  await host.dispatch('workspace.open', { root, backend: 'folder' })
  return { host, root }
}

const QUEST_YAML = `schema_version: 1
slug: authored-quest
name: Authored Quest
workflow: workflows/authored-quest.md
recipes:
  - authored-recipe
`
const RECIPE_YAML = `schema_version: 1
slug: authored-recipe
name: Authored Recipe
`

describe('workspace catalog resolution (engine-host)', () => {
  it('approves authored quest+recipe, then run.start + catalog.* see them', async () => {
    const { host } = await openHost()

    // Promote + approve a recipe, then a quest (author.promote writes a pending proposal).
    await host.dispatch('author.promote', { draft: { kind: 'recipe', path: 'recipes/authored-recipe.yaml', yaml: RECIPE_YAML } })
    await host.dispatch('author.approveProposal', { id: 'recipe/authored-recipe' })
    await host.dispatch('author.promote', { draft: { kind: 'quest', path: 'quests/authored-quest.yaml', yaml: QUEST_YAML } })
    await host.dispatch('author.approveProposal', { id: 'quest/authored-quest' })

    const quests = (await host.dispatch('catalog.quests')) as { ok: boolean; quests: { slug: string }[] }
    expect(quests.quests.map((q) => q.slug)).toContain('authored-quest')

    const recipes = (await host.dispatch('catalog.recipes', { quest: 'authored-quest' })) as { ok: boolean; recipes: { slug: string }[] }
    expect(recipes.recipes.map((r) => r.slug)).toEqual(['authored-recipe'])

    const started = (await host.dispatch('run.start', { quest: 'authored-quest' })) as { ok: boolean; route: { quest: string } }
    expect(started.ok).toBe(true)
    expect(started.route.quest).toBe('authored-quest')

    await host.stop?.()
  })
})
```

> Adjust `createEngineHost`/`dispatch`/`workspace.open` calls to match the exact API in `author.test.ts` (e.g. whether it uses `host.dispatch` vs a client, and how it stops the host). The assertions are the contract; the bootstrap mirrors the existing test.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts`
Expected: FAIL — `catalog.quests` omits `authored-quest` and/or `run.start` throws `unknown Quest`.

- [ ] **Step 4: Switch the catalog commands to the workspace loader**

In `packages/spine-engine-host/src/core/commands/catalog.ts`, replace the import and both command bodies:

```ts
import { loadWorkspaceSpineCatalog } from '@projectrunner/spine-folder-host'

import { EngineError, ok } from '../../envelope.ts'
import type { CommandBus } from '../command-bus.ts'
import type { EngineContext } from '../engine-host.ts'

export function registerCatalogCommands(bus: CommandBus, ctx: EngineContext): void {
  bus.register('catalog.quests', async () => {
    const { root } = ctx.session.requireActive()
    const catalog = await loadWorkspaceSpineCatalog(root)
    return ok('catalog.quests', { quests: catalog.quests.list() })
  })

  bus.register('catalog.recipes', async (payload) => {
    const { root } = ctx.session.requireActive()
    const input = (payload ?? {}) as { quest?: string }
    const catalog = await loadWorkspaceSpineCatalog(root)
    if (input.quest) {
      const resolved = catalog.resolveQuestRecipes(input.quest)
      if (resolved.ok === false) {
        throw new EngineError(resolved.message, { code: 'NOT_FOUND', field: 'quest' })
      }
      return ok('catalog.recipes', { quest: input.quest, recipes: resolved.recipes })
    }
    return ok('catalog.recipes', { recipes: catalog.recipes.list() })
  })
}
```

Confirm `loadWorkspaceSpineCatalog` is exported from `@projectrunner/spine-folder-host` (added in Task 2 Step 4).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/spine-engine-host/src/core/commands/catalog.ts packages/spine-engine-host/src/__tests__/workspace-catalog.test.ts
git commit -m "feat(engine-host): catalog.* + approve->run resolve workspace-authored entries"
```

---

### Task 5: Upward `.runner/` root-finder + wire CLI `quests`/`recipes`

Add a project-root finder that walks up from a start dir to the nearest `.runner/` ancestor, and switch the CLI catalog commands to the workspace loader using it. Fall back to bundled-only when no workspace is found.

**Files:**
- Modify: `packages/spine-folder-host/src/project/root.ts`
- Modify: `packages/spine-folder-host/src/index.ts` (export the finder)
- Modify: `packages/spine-cli/src/commands/quests.ts`
- Modify: `packages/spine-cli/src/commands/recipes.ts`
- Test: `packages/spine-folder-host/src/project/root.test.ts` (new or existing)
- Test: `packages/spine-cli/src/commands/catalog-workspace.test.ts` (new)

**Interfaces:**
- Produces: `findSpineProjectRoot(startDir: string): Promise<string | null>` — nearest ancestor (inclusive) containing a `.runner/` directory, else `null`.

- [ ] **Step 1: Write the failing finder test**

Create (or append to) `packages/spine-folder-host/src/project/root.test.ts`:

```ts
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findSpineProjectRoot } from './root.ts'

describe('findSpineProjectRoot', () => {
  it('finds the nearest ancestor containing .runner/ from a subdirectory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-find-'))
    await mkdir(join(root, '.runner'), { recursive: true })
    const sub = join(root, 'a', 'b')
    await mkdir(sub, { recursive: true })

    expect(await findSpineProjectRoot(sub)).toBe(root)
  })

  it('returns null when no .runner/ ancestor exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-find-none-'))
    expect(await findSpineProjectRoot(root)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/spine-folder-host/src/project/root.test.ts`
Expected: FAIL — `findSpineProjectRoot` is not defined.

- [ ] **Step 3: Implement the finder**

In `packages/spine-folder-host/src/project/root.ts`, add (use the existing `access`, `join`, `resolve` imports; add `dirname` to the `node:path` import):

```ts
import { dirname, join, resolve } from 'node:path'
```
```ts
/** Walk up from startDir (inclusive) to the nearest ancestor containing a `.runner/` dir; null if none. */
export async function findSpineProjectRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir)
  for (;;) {
    try {
      await access(join(current, SPINE_DIR_NAME))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}
```

Export it from `packages/spine-folder-host/src/index.ts` by adding `findSpineProjectRoot` to the existing `export { getSpineProjectPaths, ... } from './project/root.ts'` (line 21).

- [ ] **Step 4: Run the finder test to verify it passes**

Run: `npx vitest run packages/spine-folder-host/src/project/root.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing CLI test**

Create `packages/spine-cli/src/commands/catalog-workspace.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runQuestsCommand } from './quests.ts'

async function projectWithAuthoredQuest(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-cli-ws-'))
  const qDir = join(root, '.runner', 'quests')
  await mkdir(qDir, { recursive: true })
  await writeFile(
    join(qDir, 'authored-quest.yaml'),
    'schema_version: 1\nslug: authored-quest\nname: Authored Quest\nworkflow: workflows/authored-quest.md\n',
    'utf8',
  )
  return root
}

describe('runner quests CLI with workspace entries', () => {
  it('lists workspace-approved quests when run from a project subdirectory', async () => {
    const root = await projectWithAuthoredQuest()
    const sub = join(root, 'nested', 'dir')
    await mkdir(sub, { recursive: true })

    const out: string[] = []
    const code = await runQuestsCommand([], { stdout: (l) => out.push(l), stderr: () => {}, cwd: sub })

    expect(code).toBe(0)
    expect(out.join('\n')).toContain('authored-quest')
  })
})
```

- [ ] **Step 6: Run the CLI test to verify it fails**

Run: `npx vitest run packages/spine-cli/src/commands/catalog-workspace.test.ts`
Expected: FAIL — bundled-only listing omits `authored-quest`.

- [ ] **Step 7: Switch the CLI commands to the workspace loader with root discovery**

In `packages/spine-cli/src/commands/quests.ts`, replace the import and the catalog load:

```ts
import { findSpineProjectRoot, loadBundledSpineCatalog, loadWorkspaceSpineCatalog } from '@projectrunner/spine-folder-host'
```
Replace `const catalog = await loadBundledSpineCatalog()` with:
```ts
  const projectRoot = await findSpineProjectRoot(io.cwd ?? process.cwd())
  const catalog = projectRoot ? await loadWorkspaceSpineCatalog(projectRoot) : await loadBundledSpineCatalog()
```

In `packages/spine-cli/src/commands/recipes.ts`, make the identical import + load change (replace `const catalog = await loadBundledSpineCatalog()`).

- [ ] **Step 8: Run both new tests + existing CLI tests to verify they pass**

Run: `npx vitest run packages/spine-cli/src/commands/catalog-workspace.test.ts packages/spine-folder-host/src/project/root.test.ts`
Expected: PASS. Then run any existing CLI catalog test (e.g. `npx vitest run packages/spine-cli`) and confirm green (running outside a workspace still lists bundled entries — `findSpineProjectRoot` returns null there).

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/spine-folder-host/src/project/root.ts packages/spine-folder-host/src/project/root.test.ts packages/spine-folder-host/src/index.ts packages/spine-cli/src/commands/quests.ts packages/spine-cli/src/commands/recipes.ts packages/spine-cli/src/commands/catalog-workspace.test.ts
git commit -m "feat(cli): quests/recipes resolve workspace entries via upward .runner discovery"
```

---

### Task 6: Wire autopilot default recipe lookup through the workspace catalog (D5)

`autopilot/run.ts`'s `loadRecipeManifest` reads `.runner/recipes` only on its default path, so an authored quest referencing a bundled recipe would start but fail at execution. Route the **default** path through the workspace catalog to *locate the winning file*, then parse it with the existing parser. The ad-hoc `catalogDir` path stays unchanged.

**Files:**
- Modify: `packages/spine-folder-host/src/autopilot/run.ts` (function `loadRecipeManifest`, lines ~425-434)
- Test: `packages/spine-folder-host/src/autopilot/load-recipe-manifest.test.ts` (new)

**Interfaces:**
- Consumes: `loadWorkspaceSpineCatalog` (Task 2), existing `parseRecipeManifest` from `@projectrunner/spine`.

- [ ] **Step 1: Export `loadRecipeManifest` for direct testing**

`loadRecipeManifest` is currently a private function in `autopilot/run.ts`. Add `export` to its declaration so it can be unit-tested:
```ts
export async function loadRecipeManifest(projectRoot: string, recipeSlug: string, catalogDir?: string): Promise<RecipeManifest> {
```

- [ ] **Step 2: Write the failing test**

Create `packages/spine-folder-host/src/autopilot/load-recipe-manifest.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRecipeManifest } from './run.ts'
import { loadBundledSpineCatalog } from '../catalog/bundled.ts'

describe('autopilot loadRecipeManifest default path', () => {
  it('loads a bundled recipe slug not copied into .runner/recipes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wp-autopilot-recipe-')) // no .runner/recipes
    const bundled = await loadBundledSpineCatalog()
    const someBundledSlug = bundled.recipes.list()[0].slug

    const manifest = await loadRecipeManifest(root, someBundledSlug)
    expect(manifest.slug).toBe(someBundledSlug)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/spine-folder-host/src/autopilot/load-recipe-manifest.test.ts`
Expected: FAIL — `Recipe not found in local catalog: <slug>` (default path scans `.runner/recipes` only).

- [ ] **Step 4: Route the default path through the workspace catalog**

In `packages/spine-folder-host/src/autopilot/run.ts`, add the import:
```ts
import { loadWorkspaceSpineCatalog } from '../catalog/workspace.ts'
```
Replace the body of `loadRecipeManifest` (lines ~425-434) with:

```ts
export async function loadRecipeManifest(projectRoot: string, recipeSlug: string, catalogDir?: string): Promise<RecipeManifest> {
  if (catalogDir) {
    // Ad-hoc overlay path — unchanged: scan the supplied catalogDir only (D5).
    const recipeDirectory = join(catalogDir, 'recipes')
    for (const filePath of await walkYamlFiles(recipeDirectory)) {
      const parsed = parseRecipeManifest(await readFile(filePath, 'utf8'))
      if (parsed.ok && parsed.manifest.slug === recipeSlug) return parsed.manifest
    }
    throw new Error(`Recipe not found in local catalog: ${recipeSlug}`)
  }

  // Default path (D5): locate the winning recipe file via the workspace overlay
  // (workspace > bundled), then parse it with the existing parser.
  const catalog = await loadWorkspaceSpineCatalog(projectRoot)
  const entry = catalog.recipeEntries.find((candidate) => candidate.slug === recipeSlug)
  if (!entry) throw new Error(`Recipe not found in local catalog: ${recipeSlug}`)
  const parsed = parseRecipeManifest(await readFile(entry.path, 'utf8'))
  if (!parsed.ok) throw new Error(`invalid Recipe manifest: ${entry.path}`)
  return parsed.manifest
}
```

Confirm `readFile` is already imported (it is, line 1). Keep `walkYamlFiles` (still used by the `catalogDir` branch).

- [ ] **Step 5: Run the new test + the existing autopilot tests**

Run: `npx vitest run packages/spine-folder-host/src/autopilot/load-recipe-manifest.test.ts packages/spine-folder-host/src/autopilot`
Expected: PASS — the new test passes; existing autopilot tests (which use `.runner/recipes` or a `catalogDir`) stay green (workspace overlay still finds local recipes; `catalogDir` branch is byte-for-byte the old behavior).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/spine-folder-host/src/autopilot/run.ts packages/spine-folder-host/src/autopilot/load-recipe-manifest.test.ts
git commit -m "feat(folder-host): autopilot default recipe lookup resolves via the workspace overlay (D5)"
```

---

### Task 7: Full-suite verification + knowledge-graph sync

Run the whole suite, typecheck, and sync the Code-KG graph so the change is recorded.

**Files:** none (verification only).

- [ ] **Step 1: Re-confirm the narrowing finding (implementation checklist item)**

Run: `grep -rn "workflow" packages/spine-folder-host/src/autopilot/run.ts packages/spine-folder-host/src/runtime/local-runtime.ts`
Expected: no path reads the quest `workflow` field as a file (it is only carried as a metadata string). If any path *does* read it as a file, STOP and open a separate tracked sub-task — do not expand this work.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all pass. (Note any pre-existing unrelated failures — e.g. the known `firmvault-recipe-port.test.ts` path-drift — and confirm they are unchanged by this work, not new.)

- [ ] **Step 3: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Sync the knowledge graph**

Run: `code-kg check` then `code-kg drift`; if drift is reported, run `code-kg update`. Surface any merge proposals in `.code-kg/cache/merge-proposals/` rather than forcing them.

- [ ] **Step 5: Final commit (graph + any cleanup)**

```bash
git add -A
git commit -m "chore(folder-host): code-kg sync for workspace catalog resolution (runner-j3b)"
```

---

## Notes for the implementer

- The overlay loader reloads the bundled catalog on every call (including per-recipe in autopilot). That matches the existing per-call cost and is acceptable; a cache is out of scope.
- `startQuestRoute` still reads the local quest manifest via `readLocalQuestManifest` — that is unchanged. The only behavioral change there is that *recipe resolution* now succeeds for authored quests.
- When adapting Task 4's e2e bootstrap, mirror `author.test.ts` exactly for host creation, `workspace.open`, dispatch, and teardown — the assertions are the contract, the harness is copied.
