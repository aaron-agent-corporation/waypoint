import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { initFirmVaultCaseState } from './state.ts'
import { addFirmVaultDocument } from './documents'

async function tempCaseRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-firmvault-documents-'))
}

describe('addFirmVaultDocument', () => {
  it('copies a local document into the FirmVault inbox and indexes it', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, {
      caseType: 'personal_injury',
      caseSlug: 'smith-v-acme',
      now: new Date('2026-05-08T10:00:00.000Z'),
    })
    const source = join(root, '..', `${basename(root)}-police-report.pdf`)
    await writeFile(source, 'fake pdf bytes')

    const result = await addFirmVaultDocument(root, {
      source,
      kind: 'police_report',
      note: 'uploaded by client',
      now: new Date('2026-05-08T11:00:00.000Z'),
    })

    expect(result.document.id).toBe('document-001')
    expect(result.document.kind).toBe('police_report')
    expect(result.document.original_name).toBe(basename(source))
    expect(result.document.path).toBe(`documents/inbox/${basename(source)}`)
    expect(result.document.note).toBe('uploaded by client')
    expect(existsSync(join(root, result.document.path))).toBe(true)
    await expect(readFile(join(root, result.document.path), 'utf8')).resolves.toBe('fake pdf bytes')

    const documentsYaml = yamlParse(await readFile(join(root, '.waypoint', 'firmvault', 'documents.yaml'), 'utf8'))
    expect(documentsYaml.documents).toEqual([result.document])

    const events = (await readFile(join(root, '.waypoint', 'firmvault', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.at(-1)).toEqual({
      type: 'firmvault.document.added',
      created_at: '2026-05-08T11:00:00.000Z',
      payload: {
        document_id: 'document-001',
        path: `documents/inbox/${basename(source)}`,
        kind: 'police_report',
      },
    })
  })

  it('rejects unsupported document kinds and unsafe source paths', async () => {
    const root = await tempCaseRoot()
    await initFirmVaultCaseState(root, { caseType: 'personal_injury', caseSlug: 'smith-v-acme' })
    const source = join(root, 'example.txt')
    await writeFile(source, 'example')

    await expect(addFirmVaultDocument(root, { source, kind: 'bad_kind' as never })).rejects.toThrow('Unsupported FirmVault document kind')
    await expect(addFirmVaultDocument(root, { source: 'relative.txt', kind: 'unknown' })).rejects.toThrow('FirmVault document source must be an absolute path')
  })
})
