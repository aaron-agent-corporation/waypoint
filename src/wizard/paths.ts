import * as path from 'node:path'

import { isWizardDomain, type WizardDomain } from './types.ts'

const WIZARD_SHADOW_ROOT = '.waypoint/shadows'
const WIZARD_ARTIFACT_ROOT = '.waypoint/wizard'

export function slugifyWizardPathSegment(value: string): string | null {
  if (!isSafeRawSegment(value)) {
    return null
  }

  const slug = value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.length > 0 ? slug : null
}

export function safeShadowRelativePath(domain: WizardDomain, category: string, basename: string): string {
  if (!isWizardDomain(domain)) {
    throw new Error(`Unsupported Wizard domain: ${String(domain)}`)
  }

  const safeCategory = requireSafeWizardPathSegment(category)
  const safeBase = requireSafeWizardPathSegment(stripKnownFileExtension(basename))
  const relativePath = `${WIZARD_SHADOW_ROOT}/${domain}/${safeCategory}/${safeBase}.md`

  assertSafeRelativeNamespacePath(relativePath, `${WIZARD_SHADOW_ROOT}/${domain}/`)
  return relativePath
}

export function safeWizardArtifactPath(name: string): string {
  if (!isSafeRawSegment(name)) {
    throw new Error(`Unsafe Wizard path segment: ${name}`)
  }

  const parsed = path.parse(name.trim())
  const safeStem = requireSafeWizardPathSegment(parsed.name || name)
  const safeExtension = parsed.ext ? requireSafeArtifactExtension(parsed.ext) : ''
  const relativePath = `${WIZARD_ARTIFACT_ROOT}/${safeStem}${safeExtension}`

  assertSafeRelativeNamespacePath(relativePath, `${WIZARD_ARTIFACT_ROOT}/`)
  return relativePath
}

export function assertWithinRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)

  if (relative === '') {
    return
  }

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside root: ${candidate}`)
  }
}

function requireSafeWizardPathSegment(value: string): string {
  const slug = slugifyWizardPathSegment(value)
  if (!slug) {
    throw new Error(`Unsafe Wizard path segment: ${value}`)
  }

  return slug
}

function isSafeRawSegment(value: string): boolean {
  if (!value || value.trim().length === 0) {
    return false
  }

  if (value.includes('/') || value.includes('\\')) {
    return false
  }

  const trimmed = value.trim()
  return trimmed !== '.' && trimmed !== '..'
}

function stripKnownFileExtension(value: string): string {
  const parsed = path.parse(value)
  return parsed.name || value
}

function requireSafeArtifactExtension(extension: string): string {
  if (!/^\.[a-z0-9]+$/i.test(extension)) {
    throw new Error(`Unsafe Wizard path segment: ${extension}`)
  }

  return extension.toLowerCase()
}

function assertSafeRelativeNamespacePath(relativePath: string, expectedPrefix: string): void {
  if (
    !relativePath.startsWith(expectedPrefix) ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe Wizard relative path: ${relativePath}`)
  }
}
