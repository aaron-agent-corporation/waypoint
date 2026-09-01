import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'

import type { WaypointFolderTask } from '../tasks/types.ts'

/**
 * `sha256-manifest-v1` (docs/designs/changeset-gate-mode.md §3): one line
 * `<repo-relative-path> <sha256(bytes)>` per gated file, directories expanded
 * recursively, lines sorted bytewise; the changeset digest is the sha256 of
 * the joined lines. The manifest is retained alongside the digest so a later
 * mismatch can name the file that moved, not just that something did.
 */
export const CHANGESET_ALGORITHM = 'sha256-manifest-v1'

export interface ChangesetManifestEntry {
  readonly path: string
  readonly sha256: string
}

export interface ChangesetDigest {
  readonly algorithm: typeof CHANGESET_ALGORITHM
  readonly digest: string
  readonly manifest: readonly ChangesetManifestEntry[]
}

/**
 * The gated set (design §2): the union of `output_artifacts` of every plan
 * task that precedes the gate task on the same route. Task ids are minted in
 * graph order at scaffold time (task-001…), so id order IS precedence order.
 * Paths ride through the same safety filter as missingOutputArtifacts —
 * absolute or escaping paths are dropped rather than hashed.
 */
export function gatedArtifactPaths(tasks: readonly WaypointFolderTask[], gateTask: WaypointFolderTask): string[] {
  return collectGatedPaths(tasks, gateTask).filter((path) => !isDerivedJournal(path))
}

/**
 * The case's own logbook is not a reviewed artifact.
 *
 * `activity/index.md` is REGENERATED on every activity write — a route
 * starting, a gate being decided, a worker leaving an entry — and the case
 * quest's phase gates gate it, because the case-shell task lists it among its
 * outputs. On a case running work concurrently the digest therefore went stale
 * within minutes, and an operator's first click on a phase gate failed with
 * "the bytes changed during review" while the second, after the page refetched,
 * succeeded (Aaron 2026-07-28). A tamper check that fires on its own logbook
 * teaches the operator to click twice, which is precisely the habit it exists
 * to prevent.
 */
function isDerivedJournal(path: string): boolean {
  return (
    path === 'activity/index.md' ||
    path === 'workflow-log/index.md' ||
    path.startsWith('activity/') ||
    path.startsWith('workflow-log/')
  )
}

function collectGatedPaths(tasks: readonly WaypointFolderTask[], gateTask: WaypointFolderTask): string[] {
  const gateOrd = taskOrdinal(gateTask.id)
  const preceding = tasks.filter(
    (task) => task.route_id === gateTask.route_id && task.id !== gateTask.id && taskOrdinal(task.id) < gateOrd,
  )
  const paths = new Set<string>()
  for (const task of preceding) {
    for (const artifact of taskOutputArtifacts(task)) {
      const safe = safeRelativePath(artifact)
      if (safe) paths.add(safe)
    }
  }
  return [...paths].sort()
}

/** Numeric ordinal from a scaffold-minted id (task-012 → 12); ids without a
 * numeric suffix sort last so they never count as "preceding" a real gate. */
function taskOrdinal(id: string): number {
  const match = /(\d+)$/.exec(id)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function taskOutputArtifacts(task: WaypointFolderTask): string[] {
  const runner = isRecord(task.metadata?.runner) ? task.metadata.runner : {}
  if (!Array.isArray(runner.output_artifacts)) return []
  return runner.output_artifacts.flatMap((artifact): string[] => {
    if (typeof artifact === 'string' && artifact.trim().length > 0) return [artifact]
    if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.trim().length > 0) return [artifact.path]
    return []
  })
}

/** The gate mode declared on a gate task's compiled metadata, if any. */
export function gateApprovesChangeset(gateTask: WaypointFolderTask): boolean {
  const runner = isRecord(gateTask.metadata?.runner) ? gateTask.metadata.runner : {}
  const gate = isRecord(runner.gate) ? runner.gate : {}
  return gate.approves === 'changeset'
}

/**
 * Compute the digest over the artifact paths as they exist NOW. Missing
 * files contribute no line (design §3: absence is detectable — the digest
 * differs from one computed when the file existed). Directories expand
 * recursively to their files.
 */
export async function computeChangesetDigest(
  projectRoot: string,
  artifactPaths: readonly string[],
): Promise<ChangesetDigest> {
  const files = new Set<string>()
  for (const artifact of artifactPaths) {
    const safe = safeRelativePath(artifact)
    if (!safe) continue
    await collectFiles(projectRoot, safe, files)
  }
  const manifest: ChangesetManifestEntry[] = []
  for (const path of [...files]) {
    manifest.push({ path, sha256: await sha256File(join(projectRoot, path)) })
  }
  manifest.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const lines = manifest.map((entry) => `${entry.path} ${entry.sha256}`)
  const digest = createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')
  return { algorithm: CHANGESET_ALGORITHM, digest, manifest }
}

async function collectFiles(projectRoot: string, relPath: string, out: Set<string>): Promise<void> {
  let info
  try {
    info = await stat(join(projectRoot, relPath))
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
  if (info.isFile()) {
    out.add(relPath)
    return
  }
  if (!info.isDirectory()) return
  const entries = await readdir(join(projectRoot, relPath), { withFileTypes: true })
  for (const entry of entries) {
    // Symlinks are neither followed nor hashed: a link's target can change
    // without the gated tree changing, which would make the digest lie.
    if (entry.isSymbolicLink()) continue
    await collectFiles(projectRoot, join(relPath, entry.name), out)
  }
}

function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function safeRelativePath(artifact: string): string | null {
  const normalized = normalize(artifact.trim()).replace(/[\\/]+$/, '')
  if (normalized === '' || isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) return null
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
