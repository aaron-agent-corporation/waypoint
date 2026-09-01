import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DeterministicRecipeRuntime, registerDeterministicEntrypoint } from './deterministic-runtime.ts'

const MANIFEST_REL = 'handoff/ASSEMBLY_MANIFEST.json'
// WAYPOINT_SEATBELT off: exercise the outcome matrix without the jail (jailing is
// the worker runtime's proven path; here we prove exit-code × artifact verify).
const NO_JAIL_ENV = {} as NodeJS.ProcessEnv

/**
 * A test-local deterministic entrypoint standing in for a host's vetted
 * assembler: reads a placement plan, verifies every source hash, copies the
 * sources into the output tree, and writes the manifest. Exit 1 with the
 * cause on stderr when a hash does not match — the producer-side refusal the
 * runtime must surface as a failed attempt with nothing applied.
 */
const TEST_ASSEMBLER = `
const fs = await import('node:fs/promises')
const path = await import('node:path')
const crypto = await import('node:crypto')
const root = process.argv[2]
const plan = JSON.parse(await fs.readFile(path.join(root, 'build-internal/placement.json'), 'utf8'))
const copied = []
for (const p of plan.accepted_placements ?? []) {
  const bytes = await fs.readFile(path.join(root, p.source.path))
  const hash = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex')
  if (p.source.content_hash !== undefined && hash !== p.source.content_hash) {
    process.stderr.write('source hash mismatch: ' + p.source.path + '\\n')
    process.exit(1)
  }
  const dest = path.join(root, 'handoff', p.folder, p.final_filename)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, bytes)
  copied.push(dest)
}
await fs.mkdir(path.join(root, 'handoff'), { recursive: true })
await fs.writeFile(path.join(root, 'handoff/ASSEMBLY_MANIFEST.json'), JSON.stringify({ copied }, null, 2))
process.exit(0)
`

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

async function writePlacement(root: string, placements: readonly unknown[]): Promise<void> {
  await mkdir(join(root, 'build-internal'), { recursive: true })
  await writeFile(
    join(root, 'build-internal/placement.json'),
    JSON.stringify({ accepted_placements: placements }, null, 2),
    'utf8',
  )
}

function runtimeInput(root: string, overrides: Record<string, unknown> = {}) {
  return {
    routeId: 'route-001',
    taskId: 'task-assemble',
    recipe: 'test-assembler',
    entrypoint: 'test-assembler',
    projectRoot: root,
    outputArtifacts: [MANIFEST_REL],
    ...overrides,
  }
}

describe('DeterministicRecipeRuntime', () => {
  let root: string
  const records = 'source document body\n'

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'det-runtime-'))
    await mkdir(join(root, 'sources'), { recursive: true })
    await writeFile(join(root, 'sources/records.txt'), records)
    await mkdir(join(root, 'build-internal'), { recursive: true })
    await writeFile(join(root, 'build-internal/test-assembler.mjs'), TEST_ASSEMBLER)

    registerDeterministicEntrypoint('test-assembler', (projectRoot) => [
      process.execPath,
      join(projectRoot, 'build-internal/test-assembler.mjs'),
      projectRoot,
    ])
    registerDeterministicEntrypoint('test-noop', () => [process.execPath, '--eval', 'process.exit(0)'])
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const runtime = () => new DeterministicRecipeRuntime({ env: NO_JAIL_ENV })

  it('fails closed on an unknown entrypoint — no spawn', async () => {
    const out = await runtime().runRecipe(runtimeInput(root, { entrypoint: 'no-such-tool' }))
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('unknown deterministic entrypoint')
    expect(out.exit_code).toBeNull()
  })

  it('runs the assembler and reports finished when exit 0 + declared artifacts verify', async () => {
    await writePlacement(root, [
      {
        scope: 'document',
        folder: 'docs',
        final_filename: 'records.txt',
        source: { path: 'sources/records.txt', content_hash: sha256(records) },
      },
    ])
    const out = await runtime().runRecipe(runtimeInput(root))
    expect(out.status).toBe('finished')
    expect(out.exit_code).toBe(0)
    expect(out.applied).toContain(MANIFEST_REL)
    // The tree the gate will review actually exists on disk.
    await expect(stat(join(root, 'handoff/docs/records.txt'))).resolves.toBeDefined()
    await expect(stat(join(root, MANIFEST_REL))).resolves.toBeDefined()
  })

  it('reports failed when the tool refuses (source hash mismatch) — nothing applied', async () => {
    await writePlacement(root, [
      {
        scope: 'document',
        folder: 'docs',
        final_filename: 'records.txt',
        source: { path: 'sources/records.txt', content_hash: 'sha256:deadbeef' },
      },
    ])
    const out = await runtime().runRecipe(runtimeInput(root))
    expect(out.status).toBe('failed')
    expect(out.exit_code).not.toBe(0)
    // The refusal left the project tree untouched.
    await expect(stat(join(root, MANIFEST_REL))).rejects.toThrow()
  })

  it('reports failed when a declared artifact is missing after exit 0', async () => {
    const out = await runtime().runRecipe(
      runtimeInput(root, { entrypoint: 'test-noop', outputArtifacts: ['handoff/NOT_PRODUCED.json'] }),
    )
    expect(out.status).toBe('failed')
    expect(out.close_reason).toContain('failed verification')
    expect(out.missing).toContain('handoff/NOT_PRODUCED.json')
  })
})
