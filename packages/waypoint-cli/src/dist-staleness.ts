import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * rsc-2ff — the published `runner` bin runs BUILT dist (dist/bin.js), and
 * waypoint-folder-host / waypoint core imports resolve dist too. In a dev checkout,
 * editing a `src/*.ts` without `pnpm build` leaves dist stale: the CLI silently
 * runs old code and fails with an error pointing nowhere near the cause. That
 * happened on 2026-07-14 — the deterministic-recipes merge landed in src at
 * 12:33, dist was a day old, and start-time validation used the pre-merge
 * recipe parser, so a valid `assembler.yaml` failed with "prompt is required".
 *
 * This makes that state LOUD instead of silent. It only fires in a dev checkout
 * (a `src/` sibling of the running `dist/` exists) — a published install ships
 * dist-only and skips silently — and it goes to STDERR so it never corrupts a
 * `--json` stdout. Warns by default; WAYPOINT_STALE_DIST_GUARD=refuse makes it a
 * hard stop. The guard is best-effort: any error scanning the tree is swallowed
 * so it can never itself break the CLI.
 */

export interface DistStalenessResult {
  /** False when the check was skipped (published install, unknown layout, error). */
  readonly checked: boolean
  readonly stale: boolean
  /** Newest non-test src file, when stale — named in the warning. */
  readonly newestSrc?: string
  readonly srcMtimeMs?: number
  readonly distMtimeMs?: number
  /**
   * How the CLI itself was loaded. `src` still gets checked: a source run's
   * CROSS-PACKAGE imports resolve through each package's `main`, which is
   * dist. Only the running package is exempt.
   */
  readonly entry?: 'dist' | 'src'
}

const SKIPPED: DistStalenessResult = { checked: false, stale: false }

interface NewestFile {
  readonly ms: number
  readonly path?: string
}

/** Newest mtime (ms) of a matching file under `dir`, recursively; 0 if none. */
function newestMtimeMs(dir: string, keep: (name: string) => boolean): NewestFile {
  let best = 0
  let bestPath: string | undefined
  const walk = (current: string): void => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full)
      } else if (entry.isFile() && keep(entry.name)) {
        const ms = statSync(full).mtimeMs
        if (ms > best) {
          best = ms
          bestPath = full
        }
      }
    }
  }
  walk(dir)
  return { ms: best, path: bestPath }
}

const isBuiltSource = (name: string): boolean =>
  name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')
const isEmittedJs = (name: string): boolean => name.endsWith('.js')

/**
 * Compare the newest built `src/*.ts` against the newest emitted `dist/*.js`
 * across the workspace packages this run actually loads from dist.
 *
 * `entryPath` may be `<root>/packages/<pkg>/dist/bin.js` OR
 * `<root>/packages/<pkg>/src/bin.ts`. **Both are checked**, and the source run
 * is the one that matters most in practice: `~/.waypoint/bin/runner` — the shim
 * on every worker's PATH, and the way the deployed bridge starts — execs
 * `waypoint-cli/src/bin.ts` under `--experimental-strip-types`. That looks like a
 * source run, so this guard skipped it entirely. But a source run only loads
 * the RUNNING package from source; every `@waypoint/*` import resolves
 * through that package's `main`, which is dist. So the deployed bridge runs
 * src for the CLI and stale dist for the folder host — the exact split the
 * guard was written to catch, in the exact configuration it declined to look at.
 *
 * The running package is excluded from the src side of a source run, because
 * its own sources genuinely are what executes. Editing only `waypoint-cli/src` and
 * running from source is safe and must not warn.
 *
 * An unexpected layout or a published install (dist only, no src sibling)
 * returns `checked: false`.
 */
export function evaluateDistStaleness(entryPath: string): DistStalenessResult {
  try {
    const entryDir = dirname(entryPath)
    const kind = basename(entryDir)
    if (kind !== 'dist' && kind !== 'src') return SKIPPED
    const entry: 'dist' | 'src' = kind
    const pkgRoot = dirname(entryDir)
    const runningPkg = basename(pkgRoot)
    const packagesDir = dirname(pkgRoot)
    if (basename(packagesDir) !== 'packages') return SKIPPED
    if (!existsSync(join(pkgRoot, 'src'))) return SKIPPED // published install — dist only

    let newestSrc: NewestFile = { ms: 0 }
    let newestDist: NewestFile = { ms: 0 }
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      // A source run executes the running package's own src, so changes there
      // cannot be stale relative to anything.
      if (!(entry === 'src' && pkg.name === runningPkg)) {
        const src = newestMtimeMs(join(packagesDir, pkg.name, 'src'), isBuiltSource)
        if (src.ms > newestSrc.ms) newestSrc = src
      }
      const dist = newestMtimeMs(join(packagesDir, pkg.name, 'dist'), isEmittedJs)
      if (dist.ms > newestDist.ms) newestDist = dist
    }

    if (newestSrc.ms === 0 || newestDist.ms === 0) return SKIPPED // nothing to compare
    return {
      checked: true,
      stale: newestSrc.ms > newestDist.ms,
      newestSrc: newestSrc.path,
      srcMtimeMs: newestSrc.ms,
      distMtimeMs: newestDist.ms,
      entry,
    }
  } catch {
    return SKIPPED
  }
}

/**
 * Emit the staleness warning (or a refusal) for the running bin. Returns true
 * when the CLI should ABORT before dispatching — only under
 * WAYPOINT_STALE_DIST_GUARD=refuse. Best-effort: never throws.
 */
export function guardDistFreshness(
  entryUrl: string,
  stderr: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let entryPath: string
  try {
    entryPath = fileURLToPath(entryUrl)
  } catch {
    return false
  }
  const result = evaluateDistStaleness(entryPath)
  if (!result.checked || !result.stale) return false

  const rel = result.newestSrc ? result.newestSrc.replace(`${dirname(dirname(dirname(entryPath)))}/`, '') : 'a source file'
  const refuse = env.WAYPOINT_STALE_DIST_GUARD === 'refuse'
  const how = result.entry === 'src'
    ? 'You are running the CLI from source, but its cross-package imports resolve to BUILT dist'
    : 'The CLI runs BUILT dist'
  stderr(
    `${refuse ? 'ERROR' : 'WARNING'}: waypoint dist is STALE — ${rel} is newer than the built dist. ` +
      `${how}, so it may execute old code and fail with a misleading error (rsc-2ff). ` +
      `Run \`pnpm build\` in the waypoint checkout.${refuse ? '' : ' Set WAYPOINT_STALE_DIST_GUARD=refuse to make this a hard stop.'}`,
  )
  return refuse
}
