import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { WaypointProjectRootConfig } from '../project/config.ts'
import { resolveAccessRoots, type AccessRoot } from '../seatbelt/jail.ts'

/**
 * The access-map-honoring in-process filesystem tools for the pi runtime
 * (rsc-bhc). The pi loop runs its tools IN the host process, OUTSIDE the
 * Seatbelt/microsandbox write jail that confines a `claude -p` worker — so for a
 * pi worker THE TOOL GUARD IS THE BOUNDARY. These tools resolve the plan's
 * `access:` map through the SAME {@link resolveAccessRoots} the jail uses (one
 * resolver, so the two paths cannot disagree about a privilege boundary), then
 * confine every read/write to the resulting root set, symlink-safe and
 * fail-closed.
 *
 * HONEST POSTURE — this is a SOFTWARE boundary, not an OS one. A jailed
 * `claude -p` worker is confined by the kernel: a tool bug still cannot write
 * past the profile. Here a bug in {@link PathGuard} would be an escape. So the
 * fs tools are OPT-IN per recipe (a recipe that grants none stays a
 * reason-and-report worker), the guard is written to be conservative
 * (most-specific-root-wins, real-path resolution so a symlink cannot escape,
 * deny on any ambiguity), and OS-jailing the in-process loop itself (subprocess
 * -izing it, or running the host inside the sandbox) is the residual second half
 * of rsc-bhc, deferred. Write-heavy work stays on the jailed `claude -p` path.
 */

/** The vetted fs tool names a recipe may grant. Anything else fails closed. */
export const PI_FS_TOOL_NAMES = ['read_file', 'write_file', 'list_dir'] as const
export type PiFsToolName = (typeof PI_FS_TOOL_NAMES)[number]

export function isPiFsTool(name: string): name is PiFsToolName {
  return (PI_FS_TOOL_NAMES as readonly string[]).includes(name)
}

/** Is `candidate` the same path as `ancestor`, or nested beneath it? Mirrors the
 *  seatbelt's own containment test (jail.ts) so the two agree byte-for-byte. */
function isAtOrUnder(candidate: string, ancestor: string): boolean {
  if (candidate === ancestor) return true
  const rel = relative(ancestor, candidate)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Canonicalize a path that may not fully exist yet (a write target): real-path
 * the longest existing prefix, then re-append the missing tail. This is what
 * makes a symlink escape impossible — a symlink anywhere in the existing prefix
 * resolves to its real target BEFORE containment is checked, so a link inside a
 * granted root pointing outside it lands outside every root and is denied.
 */
async function realpathWithMissingTail(abs: string): Promise<string> {
  let current = resolve(abs)
  const tail: string[] = []
  for (;;) {
    try {
      const real = await realpath(current)
      return tail.length === 0 ? real : join(real, ...tail.slice().reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) return join(current, ...tail.slice().reverse())
      tail.push(basename(current))
      current = parent
    }
  }
}

export type PathGuardMode = 'ro' | 'rw'
export interface PathGuardRoot {
  readonly path: string
  readonly access: PathGuardMode
}
export type PathCheck = { readonly ok: true; readonly real: string } | { readonly ok: false; readonly reason: string }

/**
 * The confinement boundary for one task's in-process fs tools. Built from the
 * resolved access roots (canonicalized). Read is granted on ANY root (ro or rw);
 * write only where the MOST-SPECIFIC containing root is rw — the same
 * nesting semantics the seatbelt gets from ordered SBPL denies and the sandbox
 * from nested read-only mounts (a ro hole punched into a broad rw grant, e.g. a
 * `MANDATORY_RO_HOLES` `.git/hooks` under a rw case root, wins for paths under
 * it). Every candidate is resolved to a real path first.
 */
export class PathGuard {
  private readonly projectRoot: string
  private readonly roots: readonly PathGuardRoot[]

  constructor(projectRoot: string, roots: readonly PathGuardRoot[]) {
    this.projectRoot = projectRoot
    this.roots = roots
  }

  /** Canonicalize the project root and every access root once, up front. */
  static async create(projectRoot: string, roots: readonly AccessRoot[]): Promise<PathGuard> {
    const realRoot = await realpathWithMissingTail(projectRoot)
    const canon: PathGuardRoot[] = []
    for (const r of roots) {
      canon.push({ path: await realpathWithMissingTail(r.path), access: r.access === 'rw' ? 'rw' : 'ro' })
    }
    return new PathGuard(realRoot, canon)
  }

  /** The root with the longest path that contains `real`; on a length tie, the
   *  ro one wins (deny-biased). Undefined = `real` is outside every root. */
  private mostSpecific(real: string): PathGuardRoot | undefined {
    let best: PathGuardRoot | undefined
    let bestLen = -1
    for (const r of this.roots) {
      if (!isAtOrUnder(real, r.path)) continue
      if (r.path.length > bestLen || (r.path.length === bestLen && r.access === 'ro')) {
        best = r
        bestLen = r.path.length
      }
    }
    return best
  }

  private async resolveReal(candidate: string): Promise<string> {
    // A candidate is relative to the project root (the system prompt says so);
    // an absolute path is honored as-is but still confined by the roots below.
    return realpathWithMissingTail(isAbsolute(candidate) ? candidate : resolve(this.projectRoot, candidate))
  }

  async checkRead(candidate: string): Promise<PathCheck> {
    const real = await this.resolveReal(candidate)
    const root = this.mostSpecific(real)
    if (root === undefined) {
      return { ok: false, reason: `path ${JSON.stringify(candidate)} is outside every granted access root` }
    }
    return { ok: true, real }
  }

  async checkWrite(candidate: string): Promise<PathCheck> {
    const real = await this.resolveReal(candidate)
    const root = this.mostSpecific(real)
    if (root === undefined) {
      return { ok: false, reason: `path ${JSON.stringify(candidate)} is outside every granted access root` }
    }
    if (root.access !== 'rw') {
      return {
        ok: false,
        reason: `path ${JSON.stringify(candidate)} is inside a READ-ONLY root (${root.path}) — writes are denied there`,
      }
    }
    return { ok: true, real }
  }
}

const READ_LIMIT_BYTES = 2 * 1024 * 1024

function textResult(text: string, details: Record<string, unknown>): { content: { type: 'text'; text: string }[]; details: Record<string, unknown> } {
  return { content: [{ type: 'text' as const, text }], details }
}

/** read_file: UTF-8 read, confined to a granted root (ro or rw). */
function readFileTool(guard: PathGuard): AgentTool {
  return {
    name: 'read_file',
    label: 'Read file',
    description:
      'Read a UTF-8 text file. The path is relative to the project root (an absolute path is allowed but must fall inside a granted access root). ' +
      'You may read any file inside a granted root; a path outside your roots is refused.',
    parameters: Type.Object({ path: Type.String() }),
    async execute(_toolCallId: string, params: { path: string }) {
      const v = await guard.checkRead(params.path)
      if (!v.ok) throw new Error(`read_file denied: ${v.reason}`)
      const info = await stat(v.real)
      if (info.isDirectory()) throw new Error(`read_file: ${JSON.stringify(params.path)} is a directory (use list_dir)`)
      if (info.size > READ_LIMIT_BYTES) {
        throw new Error(`read_file: ${JSON.stringify(params.path)} is ${info.size} bytes, over the ${READ_LIMIT_BYTES}-byte limit`)
      }
      const text = await readFile(v.real, 'utf8')
      return textResult(text, { path: v.real, bytes: info.size })
    },
  } as AgentTool
}

/** list_dir: directory listing, confined to a granted root (ro or rw). */
function listDirTool(guard: PathGuard): AgentTool {
  return {
    name: 'list_dir',
    label: 'List directory',
    description:
      'List the entries of a directory (relative to the project root, or absolute within a granted access root). ' +
      'Each entry is marked file/dir. A directory outside your granted roots is refused.',
    parameters: Type.Object({ path: Type.String() }),
    async execute(_toolCallId: string, params: { path: string }) {
      const v = await guard.checkRead(params.path)
      if (!v.ok) throw new Error(`list_dir denied: ${v.reason}`)
      const entries = await readdir(v.real, { withFileTypes: true })
      const lines = entries
        .map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`)
        .sort()
      return textResult(lines.length > 0 ? lines.join('\n') : '(empty)', { path: v.real, count: entries.length })
    },
  } as AgentTool
}

/** write_file: create/overwrite a UTF-8 file, confined to a granted READ-WRITE root. */
function writeFileTool(guard: PathGuard): AgentTool {
  return {
    name: 'write_file',
    label: 'Write file',
    description:
      'Create or overwrite a UTF-8 text file. The path is relative to the project root (or absolute within a granted root), ' +
      'and MUST fall inside a granted read-write root — writing to a read-only root or outside your roots is refused. ' +
      'Parent directories are created as needed.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(_toolCallId: string, params: { path: string; content: string }) {
      const v = await guard.checkWrite(params.path)
      if (!v.ok) throw new Error(`write_file denied: ${v.reason}`)
      await mkdir(dirname(v.real), { recursive: true })
      await writeFile(v.real, params.content, 'utf8')
      return textResult(`wrote ${Buffer.byteLength(params.content, 'utf8')} bytes to ${params.path}`, { path: v.real })
    },
  } as AgentTool
}

const FS_TOOL_FACTORIES: Readonly<Record<PiFsToolName, (guard: PathGuard) => AgentTool>> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_dir: listDirTool,
}

export interface BuildPiFsToolsInput {
  readonly projectRoot: string
  readonly roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
  readonly access: Readonly<Record<string, string>> | undefined
  /** The task's scratch write root — always granted rw, like the seatbelt path. */
  readonly scratchDir: string
  /** The fs tool names this recipe granted (already filtered to {@link isPiFsTool}). */
  readonly names: readonly PiFsToolName[]
}

/**
 * Build the granted fs tools for one task, confined to its access map. Throws
 * (fail-closed) exactly where the seatbelt jail refuses to spawn: no access map,
 * an unknown binding, an rw-on-ro escalation, or a bad mode — {@link
 * resolveAccessRoots} raises those, and here they must abort the attempt rather
 * than hand the agent an unconfined tool. The scratch dir is appended rw so the
 * pi worker has a writable staging area, mirroring `assembleSeatbeltJailRoots`.
 */
export async function buildPiFsTools(input: BuildPiFsToolsInput): Promise<Readonly<Record<string, AgentTool>>> {
  const resolved = resolveAccessRoots({
    projectRoot: input.projectRoot,
    roots: input.roots,
    access: input.access,
    scratchDir: input.scratchDir,
  })
  resolved.push({ name: 'scratch', path: resolve(input.scratchDir), access: 'rw' })
  const guard = await PathGuard.create(input.projectRoot, resolved)
  const tools: Record<string, AgentTool> = {}
  for (const name of input.names) {
    tools[name] = FS_TOOL_FACTORIES[name](guard)
  }
  return tools
}
