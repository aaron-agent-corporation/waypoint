#!/usr/bin/env node
/**
 * Drop `waypoint_*` schemas on the Console-managed Postgres that belong to no
 * project on disk.
 *
 * WHY THIS EXISTS. Every project gets one schema, named deterministically from
 * its absolute path (`deriveProjectSchemaName`). Test suites build project
 * roots with `mkdtemp`, so every test file that starts a route mints schemas
 * that outlive it. `testing/schema-reaper.ts` drops them per file — but it only
 * drops what ITS OWN PROCESS recorded, it was installed after years of runs,
 * and a suite that dies at collection or times out in `afterAll` never reaches
 * it. By 2026-08-24 the instance held 2,034 `waypoint_*` schemas and 448,151
 * relations. That catalog pressure is what turns the suite's failure count into
 * noise — the same suite reported 15 failures idle and 294 under load.
 *
 * The per-file reaper is the fix going forward. This is the backstop that
 * clears what accumulated before it, and the thing to run when a run dies hard.
 *
 * SAFETY. This enumerates the catalog, which the in-process reaper deliberately
 * refuses to do, so the keep-set has to be earned rather than assumed:
 *
 *   - Roots are discovered by finding `.waypoint/config.yaml` on disk. A root's
 *     schema name is derived exactly as the product derives it, and an explicit
 *     `backend.postgres.schema:` in the config overrides the derivation.
 *   - A schema is a DROP CANDIDATE only if it is (a) absent from the keep-set
 *     AND (b) its name matches the mkdtemp shape a temp project produces. A
 *     schema that is unaccounted for but does NOT look like a temp project is
 *     reported as UNKNOWN and never dropped — an unrecognized schema is a
 *     question for a human, not a target. Silence about it would be the
 *     dangerous outcome, so unknowns are counted and printed.
 *   - Dry-run is the default. `--apply` is required to drop anything.
 *
 * Usage (from the waypoint checkout root):
 *   pnpm reap:schemas -- [--apply] [--search <dir>]... [--json]
 *
 * It lives under this package rather than `waypoint/scripts/` for the same
 * reason the reaper is a `setupFiles` entry and not a `globalSetup`: pnpm's
 * strict layout puts `pg` out of reach of the workspace root, so a script that
 * needs a Postgres client has to sit where that dependency is declared.
 *
 * `--search` may be repeated; it defaults to the roots below. Widen it before
 * `--apply` if projects live somewhere unusual, because a root this script
 * cannot see looks exactly like a residue to it — which is why the temp-shape
 * test in (b) is the actual guard, not the disk scan.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import pg from 'pg'
import { parse as yamlParse } from 'yaml'

import { deriveProjectSchemaName, DEFAULT_POSTGRES_URL } from '../src/project/backend.ts'

const DEFAULT_SEARCH_ROOTS = [
  join(homedir(), '.waypoint'),
  join(homedir(), 'Agent-Corporation'),
  join(homedir(), 'runner_cases'),
]

/**
 * The shape `mkdtemp` leaves in a schema name: `<prefix>XXXXXX` where the six
 * trailing characters are mkdtemp's, slugified into
 * `waypoint_<slug-of-prefix><6+ alnum>_<8 hex>`.
 *
 * A first cut at this required the random group to hold both a letter and a
 * digit, on the theory that a real word would not. mkdtemp draws from an
 * alphabet that produces all-letter runs perfectly often — `aeqpqm`, `dcshis` —
 * so that test misfiled 708 obvious residues as UNKNOWN. Shape alone cannot
 * separate a temp project from a case folder, so it is only half the rule; the
 * other half is `testPrefixes()` below.
 */
const TEMP_TAIL = /_[a-z0-9]{6}_[0-9a-f]{8}$/

/**
 * The prefixes the test suites actually pass to `mkdtemp` / `mkProjectRoot`,
 * read out of this repo's own source.
 *
 * This is the part that makes dropping safe. A schema is a candidate only if
 * its name is one of THESE prefixes followed by a random tail — so the rule is
 * derived from the code that creates the schemas, not guessed from what the
 * catalog happens to contain, and it keeps working as suites are added or
 * renamed. Anything else is UNKNOWN and survives.
 */
function testPrefixes(packageRoot) {
  const repoRoot = resolve(packageRoot, '../..')
  let out = ''
  try {
    out = execFileSync(
      'grep',
      [
        // `[^']*` and not `([^)]*,)?`: the common call is
        // `mkdtemp(join(tmpdir(), 'fv-reconcile-'))`, and a class that excludes
        // `)` cannot cross `tmpdir()`. That earlier pattern silently missed the
        // single largest family in the catalog — 471 schemas from one suite —
        // and they landed in UNKNOWN, which is the right place for something
        // unrecognized but the wrong answer for something the source declares.
        '-rhoE', "(mkdtemp|mkProjectRoot)\\([^']*'[a-zA-Z0-9._-]+'",
        join(repoRoot, 'packages'), join(repoRoot, 'src'), join(repoRoot, 'scripts'),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (error) {
    out = error.stdout ?? ''
  }
  const prefixes = new Set()
  for (const match of out.matchAll(/'([a-zA-Z0-9._-]+)'/g)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (slug !== '') prefixes.add(slug)
  }
  return [...prefixes].sort((a, b) => b.length - a.length)
}

function parseArgs(argv) {
  const searches = []
  let apply = false
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') continue // pnpm forwards its own separator
    if (arg === '--apply') apply = true
    else if (arg === '--json') json = true
    else if (arg === '--search') {
      const value = argv[i + 1]
      if (value === undefined) throw new Error('--search needs a directory')
      searches.push(resolve(value))
      i += 1
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return { apply, json, searches: searches.length > 0 ? searches : DEFAULT_SEARCH_ROOTS }
}

/** Every `.waypoint/config.yaml` under the search roots, as project roots. */
function discoverProjectRoots(searchRoots) {
  const roots = new Set()
  for (const searchRoot of searchRoots) {
    if (!existsSync(searchRoot)) continue
    let out = ''
    try {
      out = execFileSync(
        'find',
        [
          searchRoot, '-maxdepth', '8', '-type', 'f', '-name', 'config.yaml', '-path', '*/.waypoint/*',
          '-not', '-path', '*/node_modules/*',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    } catch (error) {
      // find exits non-zero on unreadable subtrees but still prints what it
      // found. Never swallow it silently — a partial scan shrinks the keep-set.
      out = error.stdout ?? ''
      process.stderr.write(`warn: scan of ${searchRoot} was incomplete (${error.code ?? 'error'})\n`)
    }
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue
      roots.add(line.replace(/\/\.waypoint\/config\.yaml$/, ''))
    }
  }
  return [...roots].sort()
}

/** The schema a root uses: an explicit one from its config, else the derived one. */
function schemaForRoot(root) {
  const derived = deriveProjectSchemaName(root)
  try {
    const config = yamlParse(readFileSync(join(root, '.waypoint/config.yaml'), 'utf8'))
    const explicit = config?.backend?.postgres?.schema
    if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  } catch {
    // An unreadable config means we cannot rule the derived name out; keep it.
  }
  return derived
}

async function main() {
  const { apply, json, searches } = parseArgs(process.argv.slice(2))
  const url = process.env.WAYPOINT_POSTGRES_URL ?? DEFAULT_POSTGRES_URL

  const roots = discoverProjectRoots(searches)
  const keep = new Map()
  for (const root of roots) keep.set(schemaForRoot(root), root)

  const pool = new pg.Pool({ connectionString: url, allowExitOnIdle: true })
  const { rows } = await pool.query(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'waypoint\\_%' ORDER BY nspname`,
  )
  const all = rows.map((row) => row.nspname)

  const prefixes = testPrefixes(resolve(import.meta.dirname, '..'))
  const kept = []
  const candidates = []
  const unknown = []
  for (const schema of all) {
    if (keep.has(schema)) {
      kept.push(schema)
      continue
    }
    const body = schema.slice('waypoint_'.length)
    const fromTestSuite = TEMP_TAIL.test(schema) && prefixes.some((prefix) => body.startsWith(`${prefix}_`))
    if (fromTestSuite) candidates.push(schema)
    else unknown.push(schema)
  }

  const dropped = []
  const failed = []
  if (apply) {
    for (const schema of candidates) {
      try {
        // One statement per transaction. Dropping many under one transaction
        // exhausts the lock table — the same "out of shared memory" this is
        // meant to relieve.
        await pool.query(`DROP SCHEMA IF EXISTS "${schema.replace(/"/g, '""')}" CASCADE`)
        dropped.push(schema)
      } catch (error) {
        failed.push({ schema, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  const after = (await pool.query('SELECT count(*)::int AS n FROM pg_class')).rows[0].n
  await pool.end().catch(() => undefined)

  const report = {
    url,
    applied: apply,
    projectRootsFound: roots.length,
    testPrefixes: prefixes.length,
    schemasTotal: all.length,
    kept: kept.length,
    candidates: candidates.length,
    unknown: unknown.length,
    dropped: dropped.length,
    failed: failed.length,
    relationsAfter: after,
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...report, keptSchemas: kept, unknownSchemas: unknown, failed }, null, 2)}\n`)
  } else {
    process.stdout.write(`postgres: ${url}\n`)
      process.stdout.write(`projects on disk: ${roots.length}   test prefixes in source: ${prefixes.length}   waypoint_ schemas: ${all.length}\n`)
    process.stdout.write(`  kept (a project on disk owns it): ${kept.length}\n`)
    for (const schema of kept) process.stdout.write(`    ${schema}  <- ${keep.get(schema)}\n`)
    process.stdout.write(`  ${apply ? 'dropped' : 'droppable'} (temp-project shape, no owner): ${apply ? dropped.length : candidates.length}\n`)
    process.stdout.write(`  UNKNOWN (no owner, not a temp shape — left alone, decide by hand): ${unknown.length}\n`)
    for (const schema of unknown.slice(0, 20)) process.stdout.write(`    ${schema}\n`)
    if (unknown.length > 20) process.stdout.write(`    … and ${unknown.length - 20} more\n`)
    if (failed.length > 0) {
      process.stdout.write(`  FAILED to drop: ${failed.length}\n`)
      for (const entry of failed.slice(0, 5)) process.stdout.write(`    ${entry.schema}: ${entry.error}\n`)
    }
    process.stdout.write(`relations now: ${after}\n`)
    if (!apply) process.stdout.write('\ndry run — pass --apply to drop the droppable set.\n')
  }

  // A failure to drop is not a failure of the sweep, but it must not read as
  // success either.
  process.exitCode = failed.length > 0 ? 1 : 0
}

await main()
