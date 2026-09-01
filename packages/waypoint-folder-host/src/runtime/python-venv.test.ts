import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensurePythonVenv } from './python-venv.ts'

// Real `python3 -m venv` + pip against an EMPTY requirements file — proves the
// bootstrap/marker/reuse mechanics without touching the network.
describe('ensurePythonVenv', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'python-venv-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('bootstraps a venv, writes the ready marker, and reuses it on the second call', async () => {
    const requirementsPath = join(root, 'requirements.txt')
    await writeFile(requirementsPath, '', 'utf8')
    const venvDir = join(root, '.venv')

    const python = await ensurePythonVenv({ venvDir, requirementsPath })
    expect(python).toBe(join(venvDir, 'bin', 'python'))
    await expect(stat(python)).resolves.toBeDefined()
    await expect(readFile(join(venvDir, '.waypoint-ready'), 'utf8')).resolves.toContain('requirements.txt')

    // Second call: marker short-circuits (no rebuild — proven by it being fast
    // and by the marker mtime staying put).
    const before = (await stat(join(venvDir, '.waypoint-ready'))).mtimeMs
    const again = await ensurePythonVenv({ venvDir, requirementsPath })
    expect(again).toBe(python)
    expect((await stat(join(venvDir, '.waypoint-ready'))).mtimeMs).toBe(before)
  }, 120_000)

  it('fails loud when pip cannot satisfy the requirements', async () => {
    const requirementsPath = join(root, 'requirements.txt')
    await writeFile(requirementsPath, 'waypoint-no-such-package-ever==999.999.999\n', 'utf8')
    const venvDir = join(root, '.venv-bad')

    await expect(ensurePythonVenv({ venvDir, requirementsPath })).rejects.toThrow(/pip install/)
    // No ready marker — a later call retries instead of trusting a broken venv.
    await expect(stat(join(venvDir, '.waypoint-ready'))).rejects.toThrow()
  }, 120_000)
})
