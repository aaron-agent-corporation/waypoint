import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CHANGESET_ALGORITHM, computeChangesetDigest, gateApprovesChangeset, gatedArtifactPaths } from './changeset'

import type { WaypointFolderTask } from '../tasks/types'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'changeset-digest-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function task(id: string, overrides: Partial<WaypointFolderTask> & { metadata?: WaypointFolderTask['metadata'] } = {}): WaypointFolderTask {
  return {
    id,
    route_id: 'route-001',
    plan_ref: overrides.plan_ref ?? id,
    title: id,
    phase: 'phase',
    wave: 1,
    kind: 'step',
    status: 'done',
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
    ...overrides,
  } as WaypointFolderTask
}

function withArtifacts(id: string, artifacts: readonly unknown[]): WaypointFolderTask {
  return task(id, { metadata: { runner: { output_artifacts: artifacts } } })
}

describe('computeChangesetDigest (sha256-manifest-v1)', () => {
  it('is deterministic and independent of input path order', async () => {
    await mkdir(join(root, 'a'), { recursive: true })
    await writeFile(join(root, 'a', 'one.txt'), 'one', 'utf8')
    await writeFile(join(root, 'two.txt'), 'two', 'utf8')

    const forward = await computeChangesetDigest(root, ['a/one.txt', 'two.txt'])
    const reversed = await computeChangesetDigest(root, ['two.txt', 'a/one.txt'])
    expect(forward.algorithm).toBe(CHANGESET_ALGORITHM)
    expect(forward.digest).toBe(reversed.digest)
    expect(forward.manifest).toEqual(reversed.manifest)
    expect(forward.manifest.map((entry) => entry.path)).toEqual(['a/one.txt', 'two.txt'])
  })

  it('expands directories recursively to their files', async () => {
    await mkdir(join(root, 'pkg', 'nested'), { recursive: true })
    await writeFile(join(root, 'pkg', 'index.md'), 'index', 'utf8')
    await writeFile(join(root, 'pkg', 'nested', 'deep.md'), 'deep', 'utf8')

    const result = await computeChangesetDigest(root, ['pkg'])
    expect(result.manifest.map((entry) => entry.path)).toEqual(['pkg/index.md', 'pkg/nested/deep.md'])
  })

  it('changes when a file is edited and when a file goes missing', async () => {
    await writeFile(join(root, 'mut.txt'), 'v1', 'utf8')
    const v1 = await computeChangesetDigest(root, ['mut.txt'])
    await writeFile(join(root, 'mut.txt'), 'v2', 'utf8')
    const v2 = await computeChangesetDigest(root, ['mut.txt'])
    expect(v2.digest).not.toBe(v1.digest)

    const missing = await computeChangesetDigest(root, ['mut.txt', 'never-written.txt'])
    // The absent file contributes no line — same digest as without it, and
    // NOT the digest of a set where it existed.
    expect(missing.digest).toBe(v2.digest)
    expect(missing.manifest.map((entry) => entry.path)).toEqual(['mut.txt'])
  })

  it('an empty gated set digests deterministically', async () => {
    const a = await computeChangesetDigest(root, [])
    const b = await computeChangesetDigest(root, ['not-there-at-all.bin'])
    expect(a.digest).toBe(b.digest)
    expect(a.manifest).toEqual([])
  })
})

describe('gatedArtifactPaths', () => {
  it('unions artifacts of plans preceding the gate, in numeric task order', () => {
    const gate = task('task-010', { kind: 'gate', plan_ref: 'approval-gate' })
    const tasks = [
      withArtifacts('task-002', ['build/a.json']),
      withArtifacts('task-009', ['build/b.json', { path: 'build/c/' }]),
      // task-011 follows the gate: its artifact is NOT gated.
      withArtifacts('task-011', ['build/late.json']),
      gate,
    ]
    expect(gatedArtifactPaths(tasks, gate)).toEqual(['build/a.json', 'build/b.json', 'build/c'])
  })

  it('orders numerically, not lexicographically', () => {
    const gate = task('task-1000', { kind: 'gate' })
    const tasks = [withArtifacts('task-999', ['early.json']), gate]
    expect(gatedArtifactPaths(tasks, gate)).toEqual(['early.json'])
  })

  it('drops escaping and absolute paths, dedupes, ignores other routes', () => {
    const gate = task('task-005', { kind: 'gate' })
    const tasks = [
      withArtifacts('task-001', ['../outside.txt', '/abs/path.txt', 'ok.txt']),
      withArtifacts('task-002', ['ok.txt']),
      { ...withArtifacts('task-003', ['other-route.txt']), route_id: 'route-002' } as WaypointFolderTask,
      gate,
    ]
    expect(gatedArtifactPaths(tasks, gate)).toEqual(['ok.txt'])
  })

  it('does not gate the case\'s own logbook', () => {
    // activity/index.md is regenerated on EVERY activity write, and the case
    // quest's phase gates listed it among the shell task's outputs — so an
    // operator's first click failed with "the bytes changed during review"
    // and the second, after a refetch, worked (Aaron 2026-07-28).
    const gate = task('task-005', { kind: 'gate' })
    const tasks = [
      withArtifacts('task-001', [
        'activity/index.md',
        'workflow-log/index.md',
        'activity/2026-07-28-1043-system.md',
        'demand/readiness.md',
      ]),
      gate,
    ]
    expect(gatedArtifactPaths(tasks, gate)).toEqual(['demand/readiness.md'])
  })
})

describe('gateApprovesChangeset', () => {
  it('reads the compiled gate mode; absent means completion', () => {
    expect(gateApprovesChangeset(task('task-001', { metadata: { runner: { gate: { required: true, kind: 'x', approves: 'changeset' } } } }))).toBe(true)
    expect(gateApprovesChangeset(task('task-002', { metadata: { runner: { gate: { required: true, kind: 'x' } } } }))).toBe(false)
    expect(gateApprovesChangeset(task('task-003'))).toBe(false)
  })
})
