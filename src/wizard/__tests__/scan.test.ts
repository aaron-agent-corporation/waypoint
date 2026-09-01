import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { scanWizardSource } from '../scan.ts'

describe('scanWizardSource', () => {
  it('recursively inventories files read-only with stable metadata and hashes', async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), 'waypoint-wizard-scan-'))
    await mkdir(path.join(sourceRoot, 'Medical'), { recursive: true })
    await mkdir(path.join(sourceRoot, 'Photos'), { recursive: true })
    await mkdir(path.join(sourceRoot, 'nested'), { recursive: true })

    await writeFile(path.join(sourceRoot, 'Intake Docs.pdf'), 'intake packet')
    await writeFile(path.join(sourceRoot, 'Medical', 'Dr Smith Records.pdf'), 'medical records')
    await writeFile(path.join(sourceRoot, 'Photos', 'image.jpg'), 'fake image bytes')
    await writeFile(path.join(sourceRoot, 'nested', 'duplicate-name.pdf'), 'duplicate name')

    const beforeTopLevel = await readdir(sourceRoot)

    const scan = await scanWizardSource({ sourceRoot, domain: 'documents' })

    expect(scan).toMatchObject({
      schema_version: 1,
      domain: 'documents',
      source_root: path.resolve(sourceRoot),
      files_found: 4,
      warnings: [],
    })
    expect(scan.files.map((file) => file.root_relative_path)).toEqual([
      'Intake Docs.pdf',
      'Medical/Dr Smith Records.pdf',
      'Photos/image.jpg',
      'nested/duplicate-name.pdf',
    ])
    expect(scan.files.map((file) => file.path)).toEqual(
      scan.files.map((file) => path.join(sourceRoot, file.root_relative_path ?? '')),
    )
    expect(scan.files.map((file) => file.sha256)).toEqual([
      '452638da93844c835de21ec23a4d4d2c3450ebdfa7dbaf2e8461e0abfa698b7c',
      'ffd824281affa65ecb74fe340418c21debe392e87c21bfe4cc197f3f3c7888ec',
      '43044b9f977ef333aa328b242d0e9ff0f9fed13e1c77abdd5ff12dd8edac5dd5',
      '0621b5eb4cd878af0d2a59249c40c0b8d51864e0fd64dac96f467219b41b8454',
    ])
    expect(scan.files.map((file) => file.size_bytes)).toEqual([13, 15, 16, 14])
    expect(scan.files.map((file) => file.extension)).toEqual(['.pdf', '.pdf', '.jpg', '.pdf'])
    expect(scan.files.map((file) => file.media_hint)).toEqual([
      'application/pdf',
      'application/pdf',
      'image/jpeg',
      'application/pdf',
    ])
    expect(scan.files.every((file) => Date.parse(file.discovered_at) > 0)).toBe(true)

    await expect(readFile(path.join(sourceRoot, '.waypoint'))).rejects.toThrow()
    await expect(readdir(sourceRoot)).resolves.toEqual(beforeTopLevel)
  })
})