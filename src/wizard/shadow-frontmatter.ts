import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { WizardShadowDocumentFrontmatter } from './types'

export interface SerializeWizardShadowMarkdownInput {
  frontmatter: WizardShadowDocumentFrontmatter
  body: string
}

export interface ParsedWizardShadowMarkdown {
  frontmatter: WizardShadowDocumentFrontmatter
  body: string
}

export function serializeWizardShadowMarkdown(input: SerializeWizardShadowMarkdownInput): string {
  const yaml = stringifyYaml(input.frontmatter).trimEnd()
  const body = input.body.startsWith('\n') ? input.body.slice(1) : input.body

  return `---\n${yaml}\n---\n${body}`
}

export function parseWizardShadowMarkdown(markdown: string): ParsedWizardShadowMarkdown {
  if (!markdown.startsWith('---\n')) {
    throw new Error('Wizard frontmatter opening delimiter is missing')
  }

  const closingDelimiterIndex = markdown.indexOf('\n---\n', 4)
  if (closingDelimiterIndex === -1) {
    throw new Error('Wizard frontmatter closing delimiter is missing')
  }

  const rawFrontmatter = markdown.slice(4, closingDelimiterIndex)
  const parsedFrontmatter = parseYaml(rawFrontmatter) as unknown

  assertWizardShadowDocumentFrontmatter(parsedFrontmatter)

  return {
    frontmatter: parsedFrontmatter,
    body: markdown.slice(closingDelimiterIndex + '\n---\n'.length),
  }
}

function assertWizardShadowDocumentFrontmatter(
  value: unknown,
): asserts value is WizardShadowDocumentFrontmatter {
  if (!isRecord(value)) {
    throw new Error('Wizard frontmatter must be a YAML object')
  }

  if (value.schema_version !== 1 || value.shadow_type !== 'document' || typeof value.domain !== 'string') {
    throw new Error('Wizard frontmatter has invalid shadow identity fields')
  }

  if (!isRecord(value.source) || typeof value.source.path !== 'string' || typeof value.source.sha256 !== 'string') {
    throw new Error('Wizard frontmatter source pointer is invalid')
  }

  if (!isRecord(value.pii) || typeof value.pii.masked !== 'boolean' || typeof value.pii.strategy !== 'string') {
    throw new Error('Wizard frontmatter PII metadata is invalid')
  }

  if (!isRecord(value.classification) || typeof value.classification.kind !== 'string') {
    throw new Error('Wizard frontmatter classification is invalid')
  }

  if (!isRecord(value.waypoint) || typeof value.waypoint.canonical_path !== 'string') {
    throw new Error('Wizard frontmatter Waypoint metadata is invalid')
  }

  if (!isRecord(value.review) || typeof value.review.status !== 'string') {
    throw new Error('Wizard frontmatter review metadata is invalid')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
