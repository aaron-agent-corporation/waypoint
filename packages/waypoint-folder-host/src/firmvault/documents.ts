import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

export const FIRMVAULT_DOCUMENT_KINDS = [
  'medical_records',
  'bill',
  'insurance',
  'police_report',
  'correspondence',
  'unknown',
] as const

export type FirmVaultDocumentKind = typeof FIRMVAULT_DOCUMENT_KINDS[number]

export interface AddFirmVaultDocumentInput {
  readonly source: string
  readonly kind: FirmVaultDocumentKind
  readonly note?: string
  readonly now?: Date
}

export interface FirmVaultDocumentIndexEntry {
  readonly id: string
  readonly kind: FirmVaultDocumentKind
  readonly path: string
  readonly original_name: string
  readonly added_at: string
  readonly note?: string
}

export interface AddFirmVaultDocumentResult {
  readonly document: FirmVaultDocumentIndexEntry
  readonly indexPath: string
}

interface FirmVaultDocumentsIndex {
  readonly schema_version: 1
  readonly documents: readonly FirmVaultDocumentIndexEntry[]
}

export async function addFirmVaultDocument(
  projectRoot: string,
  input: AddFirmVaultDocumentInput,
): Promise<AddFirmVaultDocumentResult> {
  validateDocumentKind(input.kind)
  if (!isAbsolute(input.source)) {
    throw new Error('FirmVault document source must be an absolute path')
  }
  const sourceStat = await stat(input.source)
  if (!sourceStat.isFile()) {
    throw new Error(`FirmVault document source must be a file: ${input.source}`)
  }

  const stateDir = firmVaultStateDir(projectRoot)
  const indexPath = join(stateDir, 'documents.yaml')
  const index = await readDocumentsIndex(indexPath)
  const originalName = basename(input.source)
  const relativeDestination = await nextInboxPath(projectRoot, originalName)
  await mkdir(join(projectRoot, 'documents', 'inbox'), { recursive: true })
  await copyFile(input.source, join(projectRoot, relativeDestination))

  const document: FirmVaultDocumentIndexEntry = {
    id: nextDocumentId(index.documents),
    kind: input.kind,
    path: relativeDestination,
    original_name: originalName,
    added_at: timestampFor(input.now),
    ...(input.note ? { note: input.note } : {}),
  }
  const nextIndex: FirmVaultDocumentsIndex = {
    schema_version: 1,
    documents: [...index.documents, document],
  }
  await writeFile(indexPath, yamlStringify(nextIndex), 'utf8')
  await appendFile(join(stateDir, 'events.jsonl'), `${JSON.stringify({
    type: 'firmvault.document.added',
    created_at: document.added_at,
    payload: {
      document_id: document.id,
      path: document.path,
      kind: document.kind,
    },
  })}\n`, 'utf8')

  return { document, indexPath }
}

async function readDocumentsIndex(indexPath: string): Promise<FirmVaultDocumentsIndex> {
  const parsed = yamlParse(await readFile(indexPath, 'utf8'))
  if (!isRecord(parsed) || !Array.isArray(parsed.documents)) {
    return { schema_version: 1, documents: [] }
  }
  return {
    schema_version: 1,
    documents: parsed.documents.filter(isDocumentIndexEntry),
  }
}

async function nextInboxPath(projectRoot: string, originalName: string): Promise<string> {
  const safeName = sanitizeFileName(originalName)
  const extension = extname(safeName)
  const stem = extension ? safeName.slice(0, -extension.length) : safeName
  let candidate = `documents/inbox/${safeName}`
  let suffix = 2
  while (await pathExists(join(projectRoot, candidate))) {
    candidate = `documents/inbox/${stem}-${suffix}${extension}`
    suffix += 1
  }
  return candidate
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '')
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error(`Unsafe FirmVault document file name: ${fileName}`)
  }
  return sanitized
}

function nextDocumentId(documents: readonly FirmVaultDocumentIndexEntry[]): string {
  return `document-${String(documents.length + 1).padStart(3, '0')}`
}

function validateDocumentKind(kind: FirmVaultDocumentKind): void {
  if (!FIRMVAULT_DOCUMENT_KINDS.includes(kind)) {
    throw new Error(`Unsupported FirmVault document kind: ${kind}`)
  }
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isDocumentIndexEntry(value: unknown): value is FirmVaultDocumentIndexEntry {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && FIRMVAULT_DOCUMENT_KINDS.includes(value.kind as FirmVaultDocumentKind)
    && typeof value.path === 'string'
    && typeof value.original_name === 'string'
    && typeof value.added_at === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function firmVaultStateDir(projectRoot: string): string {
  return join(projectRoot, '.waypoint', 'firmvault')
}
