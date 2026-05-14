import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'

import { assertWithinRoot } from './paths'
import { isWizardDomain, type WizardDomain, type WizardScanResult, type WizardSourceFile } from './types'

export interface ScanWizardSourceInput {
  sourceRoot: string
  domain: WizardDomain
}

const MEDIA_HINT_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function scanWizardSource(input: ScanWizardSourceInput): Promise<WizardScanResult> {
  if (!isWizardDomain(input.domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(input.domain)}`)
  }

  const sourceRoot = path.resolve(input.sourceRoot)
  const rootStat = await stat(sourceRoot)
  if (!rootStat.isDirectory()) {
    throw new Error(`Wizard source root must be a directory: ${input.sourceRoot}`)
  }

  const files = await inventoryFiles(sourceRoot, sourceRoot)
  files.sort((left, right) => compareStablePath(left.root_relative_path ?? '', right.root_relative_path ?? ''))

  return {
    schema_version: 1,
    domain: input.domain,
    source_root: sourceRoot,
    files_found: files.length,
    files,
    warnings: [],
  }
}

async function inventoryFiles(sourceRoot: string, currentDirectory: string): Promise<WizardSourceFile[]> {
  assertWithinRoot(sourceRoot, currentDirectory)

  const entries = await readdir(currentDirectory, { withFileTypes: true })
  const files: WizardSourceFile[] = []

  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name)
    assertWithinRoot(sourceRoot, absolutePath)

    if (entry.isDirectory()) {
      files.push(...(await inventoryFiles(sourceRoot, absolutePath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const fileStat = await stat(absolutePath)
    const contents = await readFile(absolutePath)
    const extension = path.extname(entry.name).toLowerCase()
    const mediaHint = MEDIA_HINT_BY_EXTENSION[extension] ?? 'application/octet-stream'

    files.push({
      path: absolutePath,
      root_relative_path: toPosixRelativePath(path.relative(sourceRoot, absolutePath)),
      sha256: createHash('sha256').update(contents).digest('hex'),
      size_bytes: fileStat.size,
      media_type: mediaHint,
      media_hint: mediaHint,
      extension,
      discovered_at: new Date().toISOString(),
    })
  }

  return files
}

function toPosixRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function compareStablePath(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}
