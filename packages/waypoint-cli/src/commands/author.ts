import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'

import type {
  AuthoringKind,
  GenerateAuthoringDesignSpecInput,
  GenerateAuthoringHandoffDraftInput,
  GenerateAuthoringQuestDraftInput,
  GenerateAuthoringRecipeDraftInput,
} from '@waypoint/core'

import type { WaypointCliIo } from '../bin.ts'

const usage = `Waypoint authoring wizard

Usage:
  waypoint author brainstorm --kind quest|recipe|operator|handoff_graph [--domain <domain>] [--json]
  waypoint author design --answers <path> --write-spec docs/plans/<file>.md [--json]
  waypoint author plan --design docs/plans/<file>.md [--allow-unapproved-draft] [--json]
  waypoint author recipe --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
  waypoint author quest --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
  waypoint author handoff --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
`

export async function runAuthorCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args
  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.stdout(usage.trimEnd())
    return 0
  }

  if (subcommand === 'brainstorm') return runBrainstorm(args.slice(1), io)
  if (subcommand === 'design') return runDesign(args.slice(1), io)
  if (subcommand === 'plan') return runPlan(args.slice(1), io)
  if (subcommand === 'recipe') return runRecipeDraft(args.slice(1), io)
  if (subcommand === 'quest') return runQuestDraft(args.slice(1), io)
  if (subcommand === 'handoff') return runHandoffDraft(args.slice(1), io)

  io.stderr(`Unknown author command: ${subcommand}`)
  io.stderr(usage.trimEnd())
  return 1
}

async function runBrainstorm(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const kind = valueAfter(args, '--kind') as AuthoringKind | undefined
  const domain = valueAfter(args, '--domain') ?? 'general'
  if (!kind) {
    io.stderr('Missing required option: --kind <quest|recipe|operator|handoff_graph>')
    return 1
  }
  if (!isAuthoringKind(kind)) {
    io.stderr(`Invalid authoring kind: ${kind}`)
    return 1
  }
  const consumedOptions = new Set(['--kind', '--domain'])
  const unknown = findUnknownOptions(args, consumedOptions, new Set(['--json']))
  if (unknown.length > 0) {
    io.stderr(`Unknown option(s): ${unknown.join(', ')}`)
    return 1
  }

  const { getAuthoringQuestionnaire } = await import('@waypoint/core')
  const questionnaire = getAuthoringQuestionnaire({ kind, domain })
  if (json) {
    io.stdout(JSON.stringify(questionnaire, null, 2))
    return 0
  }

  io.stdout(`Waypoint authoring questionnaire: ${kind} (${domain})`)
  for (const group of questionnaire.groups) {
    io.stdout(`\n${group.order}. ${group.title}`)
    for (const question of group.questions) io.stdout(`- ${question.prompt}`)
  }
  io.stdout('\nCompare at least two approaches and get approval before implementation planning or manifest generation.')
  return 0
}

async function runDesign(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const answersPath = valueAfter(args, '--answers')
  const writeSpec = valueAfter(args, '--write-spec')
  if (!answersPath) {
    io.stderr('Missing required option: --answers <path>')
    return 1
  }
  if (!writeSpec) {
    io.stderr('Missing required option: --write-spec docs/plans/<file>.md')
    return 1
  }
  if (!isSafeAuthoringOutputPath(writeSpec)) {
    io.stderr('Refusing to write outside a safe relative authoring path')
    return 1
  }

  const cwd = io.cwd ?? process.cwd()
  const raw = await readFile(resolve(cwd, answersPath), 'utf8')
  const answers = JSON.parse(raw) as Partial<GenerateAuthoringDesignSpecInput>
  const { generateAuthoringDesignSpec } = await import('@waypoint/core')
  const generated = generateAuthoringDesignSpec(normalizeDesignInput(answers))
  const targetPath = resolve(cwd, writeSpec)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, generated.markdown)

  const response = {
    approval: generated.approval,
    written_path: normalize(writeSpec),
    review: generated.review,
    blocked_next_steps: ['implementation_plan', 'quest_manifest', 'recipe_manifest', 'operator_manifest'],
    message: 'Implementation planning and manifest generation are blocked until this design is approved.',
  }

  if (json) {
    io.stdout(JSON.stringify(response, null, 2))
    return generated.review.ok ? 0 : 1
  }

  io.stdout(`Wrote authoring design spec draft: ${response.written_path}`)
  io.stdout(`approval: ${response.approval.status}`)
  io.stdout(response.message)
  return generated.review.ok ? 0 : 1
}

async function runPlan(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const designPath = valueAfter(args, '--design')
  if (!designPath) {
    io.stderr('Missing required option: --design docs/plans/<file>.md')
    return 1
  }
  if (!isSafeAuthoringOutputPath(designPath)) {
    io.stderr('Refusing to read outside a safe relative authoring path')
    return 1
  }

  const cwd = io.cwd ?? process.cwd()
  const markdown = await readFile(resolve(cwd, designPath), 'utf8')
  if (!isDraftGenerationAllowed(args, markdown)) {
    io.stderr('Draft generation requires an approved design spec or --allow-unapproved-draft')
    return 1
  }

  const result = {
    kind: 'implementation_plan',
    source_design: normalize(designPath),
    markdown: generateImplementationPlanDraft(normalize(designPath), markdown),
    write_default: false,
    warnings: ['draft only: not written or installed', 'approval required before implementation unless explicitly waived'],
  }

  if (json) {
    io.stdout(JSON.stringify(result, null, 2))
    return 0
  }

  io.stdout(result.markdown)
  return 0
}

async function runRecipeDraft(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const answersPath = valueAfter(args, '--answers')
  if (!answersPath) {
    io.stderr('Missing required option: --answers <path>')
    return 1
  }

  const cwd = io.cwd ?? process.cwd()
  const input = JSON.parse(await readFile(resolve(cwd, answersPath), 'utf8')) as GenerateAuthoringRecipeDraftInput
  if (!(await isManifestDraftGenerationAllowed(args, input.source?.design_spec_path, cwd))) {
    io.stderr('Draft generation requires an approved design spec or --allow-unapproved-draft')
    return 1
  }

  const { generateAuthoringRecipeDraft } = await import('@waypoint/core')
  const draft = generateAuthoringRecipeDraft(input)
  return printDraftResult(draft, args, io)
}

async function runQuestDraft(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const answersPath = valueAfter(args, '--answers')
  if (!answersPath) {
    io.stderr('Missing required option: --answers <path>')
    return 1
  }

  const cwd = io.cwd ?? process.cwd()
  const input = JSON.parse(await readFile(resolve(cwd, answersPath), 'utf8')) as GenerateAuthoringQuestDraftInput
  if (!(await isManifestDraftGenerationAllowed(args, input.source?.design_spec_path, cwd))) {
    io.stderr('Draft generation requires an approved design spec or --allow-unapproved-draft')
    return 1
  }

  const { generateAuthoringQuestDraft } = await import('@waypoint/core')
  const draft = generateAuthoringQuestDraft(input)
  return printDraftResult(draft, args, io)
}

async function runHandoffDraft(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const answersPath = valueAfter(args, '--answers')
  if (!answersPath) {
    io.stderr('Missing required option: --answers <path>')
    return 1
  }

  const cwd = io.cwd ?? process.cwd()
  const input = JSON.parse(await readFile(resolve(cwd, answersPath), 'utf8')) as GenerateAuthoringHandoffDraftInput
  if (!(await isManifestDraftGenerationAllowed(args, input.source?.design_spec_path, cwd))) {
    io.stderr('Draft generation requires an approved design spec or --allow-unapproved-draft')
    return 1
  }

  const { generateAuthoringHandoffDraft } = await import('@waypoint/core')
  const draft = generateAuthoringHandoffDraft(input)
  return printDraftResult(draft, args, io)
}

async function printDraftResult(
  draft: { readonly kind: string; readonly yaml: string; readonly validation: { readonly ok: boolean }; readonly path: string; readonly write_default: boolean },
  args: readonly string[],
  io: WaypointCliIo,
): Promise<number> {
  const writeDraft = valueAfter(args, '--write-draft')
  if (writeDraft !== undefined) {
    if (!isSafeDraftOutputPath(writeDraft)) {
      io.stderr('Refusing to write outside a safe relative authoring path')
      return 1
    }
    if (!draft.validation.ok) {
      io.stderr(`Draft validation failed for ${draft.path}`)
      return 1
    }
    const cwd = io.cwd ?? process.cwd()
    const targetPath = resolve(cwd, writeDraft)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, draft.yaml)
    const response = { ...draft, written_path: normalize(writeDraft) }
    if (args.includes('--json')) {
      io.stdout(JSON.stringify(response, null, 2))
      return 0
    }
    io.stdout(`Wrote authoring draft: ${normalize(writeDraft)}`)
    return 0
  }

  if (args.includes('--json')) {
    io.stdout(JSON.stringify(draft, null, 2))
    return draft.validation.ok ? 0 : 1
  }
  if (!draft.validation.ok) {
    io.stderr(`Draft validation failed for ${draft.path}`)
    return 1
  }
  io.stdout(draft.yaml)
  return 0
}

function normalizeDesignInput(input: Partial<GenerateAuthoringDesignSpecInput>): GenerateAuthoringDesignSpecInput {
  return {
    title: requireString(input.title, 'title'),
    kind: isAuthoringKind(input.kind) ? input.kind : 'quest',
    domain: typeof input.domain === 'string' ? input.domain : 'general',
    inspected_paths: asStringArray(input.inspected_paths),
    goal: requireString(input.goal, 'goal'),
    constraints: asStringArray(input.constraints),
    approaches: Array.isArray(input.approaches) ? input.approaches : [],
    lifecycle: input.lifecycle ?? { workstreams: [] },
    roles: asStringArray(input.roles),
    tool_boundaries: asStringArray(input.tool_boundaries),
    verification: asStringArray(input.verification),
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`Missing required answer: ${field}`)
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function valueAfter(args: readonly string[], option: string): string | undefined {
  const index = args.indexOf(option)
  return index === -1 ? undefined : args[index + 1]
}

function isAuthoringKind(value: unknown): value is AuthoringKind {
  return value === 'quest' || value === 'recipe' || value === 'operator' || value === 'handoff_graph'
}

function isSafeAuthoringOutputPath(path: string): boolean {
  if (isAbsolute(path)) return false
  const normalized = normalize(path)
  if (normalized.startsWith('..')) return false
  return normalized.startsWith('docs/plans/') || normalized.startsWith('examples/authoring/')
}

function isSafeDraftOutputPath(path: string): boolean {
  if (isAbsolute(path)) return false
  const normalized = normalize(path)
  return normalized !== '.' && !normalized.startsWith('..')
}

function findUnknownOptions(args: readonly string[], optionsWithValues: ReadonlySet<string>, flags: ReadonlySet<string>): readonly string[] {
  const unknown: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (flags.has(arg)) continue
    if (optionsWithValues.has(arg)) {
      index += 1
      continue
    }
    if (arg.startsWith('--')) unknown.push(arg)
  }
  return unknown
}

function isDraftGenerationAllowed(args: readonly string[], designMarkdown: string): boolean {
  return args.includes('--allow-unapproved-draft') || /status:\s*approved/i.test(designMarkdown)
}

async function isManifestDraftGenerationAllowed(args: readonly string[], designSpecPath: string | undefined, cwd: string): Promise<boolean> {
  if (args.includes('--allow-unapproved-draft')) return true
  if (!designSpecPath || !isSafeAuthoringOutputPath(designSpecPath)) return false
  try {
    const markdown = await readFile(resolve(cwd, designSpecPath), 'utf8')
    return /status:\s*approved/i.test(markdown)
  } catch {
    return false
  }
}

function generateImplementationPlanDraft(designPath: string, designMarkdown: string): string {
  const title = designMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Waypoint Authoring Design'
  return `# Implementation Plan Draft — ${title}\n\nSource design: ${designPath}\n\nStatus: draft-only; not approved for installation by default.\n\n## Phases\n\n1. Re-read the approved design spec and primary source paths.\n2. Generate or update draft manifests using Waypoint authoring generators.\n3. Validate generated YAML with existing Quest/Recipe parsers.\n4. Run targeted tests and full verification gates before commit.\n\n## Verification Gates\n\n- pnpm exec vitest run packages/waypoint-cli/src/commands/author.test.ts src/authoring/__tests__/recipe-generator.test.ts src/authoring/__tests__/quest-generator.test.ts\n- pnpm build\n- pnpm verify:built-imports\n\n## Safety\n\n- No files are written by this dry-run plan command.\n- Generated manifests remain drafts until explicitly approved and written.\n`
}
