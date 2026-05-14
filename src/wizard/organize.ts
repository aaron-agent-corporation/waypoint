import { isSafeWizardRelativePath, isWizardDomain, type WizardOrganizedDocumentEntry } from './types'

export type CreateWizardOrganizedDocumentEntryInput = WizardOrganizedDocumentEntry

export function createWizardOrganizedDocumentEntry(
  input: CreateWizardOrganizedDocumentEntryInput,
): WizardOrganizedDocumentEntry {
  if (!isWizardDomain(input.domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(input.domain)}`)
  }

  assertSafeOrganizeRelativePath(input.canonical_document_path, 'canonical document path')

  if (!isSafeWizardRelativePath(input.shadow_path)) {
    throw new Error(`Unsafe Wizard shadow path: ${input.shadow_path}`)
  }

  if (input.copy_decision.destination_path) {
    assertSafeOrganizeRelativePath(input.copy_decision.destination_path, 'copy destination path')
  }

  return {
    ...input,
    source: { ...input.source },
    classification: { ...input.classification },
    copy_decision: { ...input.copy_decision },
    legal_boundary: { ...input.legal_boundary },
  }
}

function assertSafeOrganizeRelativePath(value: string, label: string): void {
  if (!value || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  if (value.includes('\\')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe ${label}: ${value}`)
  }

  if (!value.startsWith('documents/')) {
    throw new Error(`Organized document paths must live under documents/: ${value}`)
  }
}
