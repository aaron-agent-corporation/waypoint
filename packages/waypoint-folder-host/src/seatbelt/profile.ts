import { realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * The Seatbelt (sandbox-exec) write-jail profile compiler — originally the
 * TypeScript port of Crew's `internal/seatbelt` (P3/W2). Go byte-parity is
 * retired: the ro-hole emission below (rsc-w0z) diverges from the deleted Go
 * compiler, which only ever emitted allows.
 *
 * The jail confines BOTH writes and reads.
 *
 * Writes: `(allow default) (deny file-write*)` plus, per root, either an
 * `(allow file-write* (subpath R))` (writable) or a `(deny file-write*
 * (subpath R))` (a read-only HOLE punched into an enclosing writable root).
 *
 * Reads (rsc, 2026-08-06): `(deny file-read*)` over the DATA world, re-opened
 * only for the roots a recipe declared. Until this existed the jail was write
 * confinement alone and every dispatched agent could read every case on the
 * machine — the integrity half without the confidentiality half. That gap
 * mattered directly: a medical-layer extractor told in its prompt to read the
 * faithful shadows was free to ignore that and re-read the source PDFs, which
 * is exactly what the previous generation did, and no instruction can prevent
 * it. A recipe designates a workspace; the kernel now holds the agent to it.
 *
 * Read confinement is scoped to DATA, not to the whole filesystem: an agent CLI
 * must still load its own binary, dylibs, node runtime, and credential store or
 * it cannot start. So the deny covers the case/data roots handed to `dataRoots`
 * and the allows re-open the declared roots beneath them. Denying `/` and
 * allow-listing the system is the stricter end state; it is not what this
 * lands, and calling this a full sandbox would overstate it.
 *
 * SBPL is LAST-MATCH-WINS, not deny-wins (shepherd-jail spike, EVIDENCE E4b
 * Run 1): a broad writable subpath swallows everything beneath it unless a
 * more-specific rule follows it. The ro-hole design leans on exactly that
 * ordering — every emitted rule is sorted ancestor-before-descendant (by path
 * depth, then bytewise), so for any file the DEEPEST matching rule is the last
 * one and therefore wins. A read-only root nested inside a writable root emits
 * a deny that sorts after the enclosing allow and re-closes the hole; a
 * writable scratch nested inside that hole sorts after the deny and re-opens.
 * The load-bearing guarantee (an explicit deny placed after a broad allow
 * actually re-closes the subtree at the kernel) is proven live in
 * `enforcement.test.ts`, not assumed. The only remaining hard refusal is a
 * rw and ro root that resolve to the SAME path — a genuine contradiction with
 * no ordering that resolves it (fail closed).
 */

export type SeatbeltAccess = 'ro' | 'rw'

/**
 * Marks a root the resolver added on its own rather than one an author
 * declared (the mandatory ro holes, rsc-dqj). The SBPL compiler ignores it —
 * a hole is a hole. It matters only to the sandbox mount compiler, where a
 * declared root that is missing on disk is an author error worth failing on,
 * while a mandatory hole that is missing is simply a project without that
 * execution surface.
 */

/**
 * A root binds a name to a filesystem path and its capability. `access` is
 * typed as string because compile validates it at runtime (fail closed on
 * anything but 'ro'/'rw') — the jail must reject bad input, not assume the
 * type system already did. Path may be relative; compile resolves it to an
 * absolute, symlink-resolved form.
 */
export interface SeatbeltRoot {
  readonly name: string
  readonly path: string
  readonly access: string
  /** True for a resolver-added mandatory hole; see SeatbeltAccess above. */
  readonly mandatory?: boolean
}

/**
 * Emit an SBPL profile string for the given roots, or throw if the grant set
 * is contradictory. A writable root emits an allow; a read-only root that is
 * nested inside a writable root emits a deny (a HOLE) that re-closes its
 * subtree. All rules are sorted ancestor-before-descendant so the deepest —
 * most specific — rule matching any file is emitted last and wins under SBPL's
 * last-match-wins semantics.
 *
 * The one hard refusal is a rw and ro root that resolve to the SAME path: no
 * ordering resolves the contradiction, so fail closed.
 *
 * A read-only root that is NOT nested inside any writable root needs no rule:
 * the global `(deny file-write*)` already covers it. A writable root nested
 * inside a read-only root (a narrow carve-out, e.g. med_out inside a read-only
 * case_source) emits its allow and, because the enclosing ro emits no allow,
 * the surrounding area stays denied.
 */
/**
 * Options for read confinement.
 *
 * `dataRoots` are the trees whose reads must be confined — the case directory,
 * the cases root, whatever else holds client data. Each becomes a
 * `(deny file-read* (subpath D))`, and every declared root re-opens itself with
 * an `(allow file-read* (subpath R))` that sorts after it. Omit or leave empty
 * and reads stay unrestricted, which is the pre-2026-08-06 behavior and is
 * retained only so a caller can opt out deliberately rather than by accident.
 */
export interface SeatbeltReadConfinement {
  readonly dataRoots?: readonly string[]
  /**
   * The one directory whose own ENTRY stays readable (`literal`, not
   * `subpath`) so `getcwd()` works — the worker's cwd. Without it a process
   * whose cwd it cannot stat dies at startup: "shell-init: error retrieving
   * current directory". Only this path gets the literal; a data root that is
   * merely an enclosing tree does not, because listing it would disclose the
   * names of every sibling case.
   */
  readonly cwdRoot?: string
}

export async function compileSeatbeltProfile(
  roots: readonly SeatbeltRoot[],
  confine: SeatbeltReadConfinement = {},
): Promise<string> {
  const canon = await canonRoots(roots)

  // The only unresolvable overlap: a writable and a read-only root at the SAME
  // path. Ancestor/descendant nesting is expressible via ordered rules below;
  // an exact-path contradiction is not — fail closed.
  for (const w of canon) {
    if (w.access !== 'rw') continue
    for (const ro of canon) {
      if (ro.access !== 'ro') continue
      if (w.path === ro.path) {
        throw new Error(
          `seatbelt: root ${quote(w.name)} (rw) and root ${quote(ro.name)} (ro) resolve to the same path ${quote(w.path)} — contradictory grant (fail closed)`,
        )
      }
    }
  }

  // Writable roots always emit an allow. A read-only root emits a deny only
  // when it is a HOLE — a proper descendant of some writable root — since only
  // then does an enclosing allow need re-closing; otherwise the global deny
  // suffices and we emit nothing for it.
  const writablePaths = [...new Set(canon.filter((r) => r.access === 'rw').map((r) => r.path))]
  const holePaths = [
    ...new Set(
      canon
        .filter((r) => r.access === 'ro')
        .map((r) => r.path)
        .filter((roPath) => writablePaths.some((w) => w !== roPath && isAncestor(w, roPath))),
    ),
  ]

  const rules: Array<{ path: string; kind: 'allow' | 'deny' }> = [
    ...writablePaths.map((p) => ({ path: p, kind: 'allow' as const })),
    ...holePaths.map((p) => ({ path: p, kind: 'deny' as const })),
  ]
  // Ancestor-before-descendant: shallower paths first, ties broken bytewise.
  // Under SBPL last-match-wins this makes the deepest matching rule win, so a
  // hole re-closes an enclosing allow and a scratch re-opens an enclosing hole.
  // The ordering is total and byte-stable, so the profile is diff-stable.
  rules.sort((a, b) => depth(a.path) - depth(b.path) || Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))

  let profile = '(version 1)\n(allow default)\n(deny file-write*)\n'
  for (const rule of rules) {
    profile += `(${rule.kind} file-write* (subpath ${sbplString(rule.path)}))\n`
  }

  // Read confinement. Same last-match-wins ordering as the write rules: the
  // data-root denies sort ancestor-first, each declared root's allow sorts
  // after the deny that encloses it, so the deepest rule matching any file
  // wins. A declared root outside every data root needs no allow — nothing
  // denied it.
  const dataRoots = [...new Set(await Promise.all((confine.dataRoots ?? []).map(canonicalize)))]
  if (dataRoots.length > 0) {
    const readAllows = [...new Set(canon.map((r) => r.path))].filter((p) =>
      dataRoots.some((d) => isAncestor(d, p)),
    )
    const readRules: Array<{ path: string; kind: 'allow' | 'deny' }> = [
      ...dataRoots.map((p) => ({ path: p, kind: 'deny' as const })),
      ...readAllows.map((p) => ({ path: p, kind: 'allow' as const })),
    ]
    readRules.sort(
      (a, b) => depth(a.path) - depth(b.path) || Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    )
    for (const rule of readRules) {
      profile += `(${rule.kind} file-read* (subpath ${sbplString(rule.path)}))\n`
    }
    // Traversal. A denied ENCLOSING root (the cases directory) blocks not just
    // its contents but the path INTO the project — `cd` fails with "Not a
    // directory" and the worker never starts. `file-read-metadata` on the bare
    // directory entry is the minimal grant that resolves a path through it:
    // stat succeeds, readdir does not, so sibling case NAMES stay hidden. A
    // full `file-read*` literal here would make `ls` of the cases directory
    // list every client on the machine.
    const cwdRoot = confine.cwdRoot ? await canonicalize(confine.cwdRoot) : undefined
    for (const root of dataRoots) {
      if (root === cwdRoot) continue
      profile += `(allow file-read-metadata (literal ${sbplString(root)}))\n`
    }
    // The worker's own cwd entry, readable so getcwd() works. Its top-level
    // names become listable; their contents stay closed by the deny above.
    if (cwdRoot !== undefined) {
      profile += `(allow file-read* (literal ${sbplString(cwdRoot)}))\n`
    }
  }
  return profile
}

/** Path-segment depth of a cleaned absolute path, used to order rules
 * ancestor-before-descendant. */
function depth(p: string): number {
  return p.split(path.sep).length
}

interface CanonRoot {
  readonly name: string
  readonly path: string
  readonly access: SeatbeltAccess
}

/** Validate and canonicalize each root. A root with no path or an invalid
 * access is a hard error (fail closed) rather than a silent skip. */
async function canonRoots(roots: readonly SeatbeltRoot[]): Promise<CanonRoot[]> {
  const out: CanonRoot[] = []
  for (const r of roots) {
    if (r.path === '') {
      throw new Error(`seatbelt: root ${quote(r.name)} has no path (fail closed)`)
    }
    if (r.access !== 'ro' && r.access !== 'rw') {
      throw new Error(`seatbelt: root ${quote(r.name)} has invalid access ${quote(r.access)} (want ro|rw)`)
    }
    out.push({ name: r.name, path: await canonicalize(r.path), access: r.access })
  }
  return out
}

/** Whether ancestor's subtree contains descendant. Operates on cleaned
 * absolute paths; the trailing-separator guard stops "/foo" from matching
 * "/foobar". */
function isAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  return descendant.startsWith(ancestor + path.sep)
}

/**
 * Absolute, symlink-resolved, cleaned path. Seatbelt matches on real paths
 * (the spike's symlink-escape probe P3 confirmed it) and on macOS /tmp ->
 * /private/tmp, so the emitted subpath MUST be the real path or the rule
 * silently fails to match. Paths need not exist yet (a build dir may be
 * created later): resolve the longest existing prefix and re-append the
 * non-existent tail lexically.
 */
async function canonicalize(p: string): Promise<string> {
  const abs = path.resolve(p)
  let rest = ''
  let cur = abs
  for (;;) {
    try {
      const resolved = await realpath(cur)
      return rest === '' ? resolved : path.join(resolved, rest)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(cur)
      if (parent === cur) {
        // Reached the filesystem root without resolving; use lexical form.
        return abs
      }
      rest = rest === '' ? path.basename(cur) : path.join(path.basename(cur), rest)
      cur = parent
    }
  }
}

/** Render a path as an SBPL string literal, escaping backslashes and double
 * quotes so a crafted path cannot break out of the quoted token. */
function sbplString(p: string): string {
  return `"${p.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/** Mirror Go's %q for the plain-ASCII names/paths in diagnostics, keeping
 * error strings byte-identical to the Go compiler's (golden-compared). */
function quote(value: string): string {
  return JSON.stringify(value)
}
