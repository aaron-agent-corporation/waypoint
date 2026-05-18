import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { loadBundledWaypointCatalog } from '@waypoint/folder-host'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { parseRecipeManifest } from '../recipes/manifest.js'

const repoRoot = resolve(__dirname, '../..')
const missionControlRoot = '/Users/aaronwhaley/Github/mission-control'
const firmvaultRecipeDir = join(repoRoot, 'recipes', 'firmvault')
const firmvaultQuestPath = join(repoRoot, 'quests', 'firmvault.yaml')

const firmVaultRecipeSlugs = [
  'firmvault-case-setup-create-shell',
  'firmvault-document-collection-review-intake',
  'firmvault-document-collection-request-missing-documents',
  'firmvault-document-collection-send-signature-packets',
  'firmvault-accident-report-analyze',
  'firmvault-medical-provider-setup-case',
  'firmvault-client-check-in-start-cadence',
  'firmvault-client-check-in-prepare-handoff',
  'firmvault-insurance-bi-identify-carrier',
  'firmvault-insurance-bi-prepare-lor',
  'firmvault-insurance-bi-process-acknowledgment',
  'firmvault-insurance-pip-open-claim',
  'firmvault-pip-file-application',
  'firmvault-pip-confirm-approval',
  'firmvault-pip-track-exhaustion',
  'firmvault-medical-provider-review-status',
  'firmvault-lien-identify-potential',
  'firmvault-medical-records-verify-authorization',
  'firmvault-request-records-bills-prepare-request',
  'firmvault-request-records-bills-send-request',
  'firmvault-request-records-bills-follow-up',
  'firmvault-medical-records-receive-and-process',
  'firmvault-medical-chronology-update',
  'firmvault-medical-chronology-adversarial-qc',
  'firmvault-medical-records-prepare-request',
  'firmvault-medical-records-send-request',
  'firmvault-medical-records-first-follow-up',
  'firmvault-medical-records-second-follow-up',
  'firmvault-medical-records-escalate-delay',
  'firmvault-demand-gather-materials',
  'firmvault-demand-check-final-lien-process',
  'firmvault-demand-draft-letter',
  'firmvault-demand-identify-recipients',
  'firmvault-demand-send-package',
  'firmvault-negotiation-track-offer',
  'firmvault-negotiation-offer-evaluation',
  'firmvault-negotiation-document-client-decision',
  'firmvault-negotiation-prepare-response',
  'firmvault-negotiation-document-response',
  'firmvault-settlement-prepare-statement',
  'firmvault-settlement-prepare-authorization',
  'firmvault-settlement-document-funds',
  'firmvault-settlement-lien-audit',
  'firmvault-settlement-lien-document-result',
  'firmvault-lien-resolution-review-inventory',
  'firmvault-lien-resolution-prepare-final-request',
  'firmvault-lien-resolution-document-final-amount',
  'firmvault-lien-resolution-document-payment',
  'firmvault-final-distribution-prepare-statement',
  'firmvault-final-distribution-zero-trust',
  'firmvault-close-case-verify-readiness',
  'firmvault-close-case-prepare-letter',
  'firmvault-close-case-document-closure',
  'firmvault-document-intake-record-source',
  'firmvault-document-pipeline-submit-for-review',
  'firmvault-document-pipeline-review-pr',
  'firmvault-document-pipeline-record-merge',
] as const

const documentPipelineRecipeSlugs = new Set<string>([
  'firmvault-document-intake-record-source',
  'firmvault-document-pipeline-submit-for-review',
  'firmvault-document-pipeline-review-pr',
  'firmvault-document-pipeline-record-merge',
])

const waypointNativeRecipeSlugs = new Set<string>(['firmvault-medical-chronology-adversarial-qc'])

const firmvaultDocumentPipelineRoot = '/Users/aaronwhaley/Github/firmvault-document-pipeline'
const requiredSourceFiles = ['recipe.yaml', 'SOUL.md', 'REVIEW.md'] as const
const placeholderPhrase = 'Placeholder Recipe manifest for Part One Quest skeleton resolution'

type QuestRecipeList = {
  readonly recipes?: readonly string[]
}

type RecipeSourcePortMetadata = {
  readonly status?: string
  readonly source_repository?: string
  readonly source_recipe?: string
  readonly source_workflow?: string
  readonly source_node?: string
  readonly source_files?: readonly string[]
  readonly external_side_effects?: string
  readonly review_criteria?: readonly string[]
}

type RecipeManifestWithSourcePort = {
  readonly metadata?: {
    readonly source_port?: RecipeSourcePortMetadata
  }
}

async function loadQuestRecipes(): Promise<readonly string[]> {
  const quest = parseYaml(await readFile(firmvaultQuestPath, 'utf8')) as QuestRecipeList
  return quest.recipes ?? []
}

async function readRecipeManifest(slug: string) {
  const manifestPath = join(firmvaultRecipeDir, `${slug.replace('firmvault-', '')}.yaml`)
  const raw = await readFile(manifestPath, 'utf8')
  const parsed = parseRecipeManifest(raw)
  expect(parsed.ok, parsed.ok ? undefined : parsed.error.message).toBe(true)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.manifest as typeof parsed.manifest & RecipeManifestWithSourcePort
}

describe('FirmVault source-backed Recipe port', () => {
  it('keeps the FirmVault Quest bound to the current FirmVault source-backed recipe slugs', async () => {
    const questRecipes = await loadQuestRecipes()
    expect(questRecipes).toEqual(firmVaultRecipeSlugs)

    const catalog = await loadBundledWaypointCatalog()
    const resolved = catalog.resolveQuestRecipes('firmvault')
    expect(resolved.ok, resolved.ok ? undefined : resolved.message).toBe(true)
    if (!resolved.ok) throw new Error(resolved.message)

    for (const slug of firmVaultRecipeSlugs) {
      expect(catalog.recipes.has(slug), `${slug} exists in bundled catalog`).toBe(true)
    }
  })

  it('uses the medical chronology binder-generation skill for medical chronology creation', async () => {
    const manifest = await readRecipeManifest('firmvault-medical-chronology-update')

    for (const phrase of [
      'medical-chronology-binder-generation',
      'medical-chronology-output/',
      'organized-source-pdfs/',
      'extracted-visit-pdfs/',
      'linked chronology workbook',
      'master linked binder PDF',
      'Review sheet',
      'Preserve originals',
      'Timeline prose is not an audit trail',
      'Summarize visits, not documents',
      'one-visit-per-page',
      'Provider:',
      'Facility:',
      'Chronology treatment:',
      'Source links',
      'View source',
      'bordered text box',
      'summarize the actual record substance',
      'Do not tell the reader to go read the source record in place of a summary',
      'variable-height boxes',
      'continuation pages',
      'Primary:',
      'Secondary:',
      'Findings:',
      'Visit Summary first',
      'HTML chronology',
      'accordion',
      'relative from the HTML file location',
      'all HTML `View source` links resolve',
      'Back to Timeline',
      'Do not make executive decisions about whether a visit is related',
      'render representative pages',
      'visual source-document inspection is mandatory',
      'source-visual-inspection-ledger',
      'date of service + provider/facility + encounter',
      'same date of service at the same provider',
      'hospital or multi-provider same-day care',
      'certified packet/export/fax date',
      'not by source file',
      'one independent extracted visit PDF per chronology row',
      'Source buttons must point to the consolidated visit PDF',
      'Do not enumerate repeated copies',
      'chronology first, then extracted visit PDFs in chronology order',
      'must not contain build-process or meta commentary',
      'docs/templates/firmvault/medical-chronology/',
    ]) {
      expect(manifest.prompt, phrase).toContain(phrase)
    }

    expect(manifest.subagents).toContain('firmvault-medical-chronology-adversarial-qc')
  })

  it('ships repeatable medical chronology templates for future agents', async () => {
    const templateDir = join(repoRoot, 'docs/templates/firmvault/medical-chronology')
    const requiredTemplates = [
      'visit-pdf-manifest-template.csv',
      'source-visual-inspection-ledger-template.csv',
      'adversarial-qc-report-template.md',
      'attorney-facing-output-cleanliness-checklist.md',
    ]

    for (const filename of requiredTemplates) {
      const content = await readFile(join(templateDir, filename), 'utf8')
      expect(content.length, filename).toBeGreaterThan(100)
    }

    const visitManifest = await readFile(join(templateDir, 'visit-pdf-manifest-template.csv'), 'utf8')
    expect(visitManifest).toContain('chronology_row_id,date_of_service,provider,facility,visit_title,visit_pdf_filename')
    expect(visitManifest).toContain('duplicate_source_group_ids')

    const cleanlinessChecklist = await readFile(
      join(templateDir, 'attorney-facing-output-cleanliness-checklist.md'),
      'utf8',
    )
    for (const forbiddenPhrase of ['fresh start pass', 'restart pass', 'inventoried', 'prior output']) {
      expect(cleanlinessChecklist).toContain(forbiddenPhrase)
    }
  })

  it('requires an independent adversarial chronology QC recipe before human completion review', async () => {
    const qcManifest = await readRecipeManifest('firmvault-medical-chronology-adversarial-qc')
    const questRaw = parseYaml(await readFile(firmvaultQuestPath, 'utf8')) as any
    const recordsBillsPlans = questRaw.scaffolds.workstreams[0].milestones[0].phases.find(
      (phase: any) => phase.phase_slug === 'records-bills',
    ).plans
    const chronologyIndex = recordsBillsPlans.findIndex(
      (plan: any) => plan.plan_ref === 'firmvault-medical-chronology-update-task',
    )
    const qcIndex = recordsBillsPlans.findIndex(
      (plan: any) => plan.plan_ref === 'firmvault-medical-chronology-adversarial-qc-task',
    )
    const humanReviewIndex = recordsBillsPlans.findIndex(
      (plan: any) => plan.plan_ref === 'firmvault-records-bills-human-completion-review',
    )

    expect(qcManifest.prompt).toContain('independent adversarial reviewer')
    expect(qcManifest.prompt).toContain('visually inspect the source documents')
    expect(qcManifest.prompt).toContain('missed visits')
    expect(qcManifest.prompt).toContain('duplicate chronology rows')
    expect(qcManifest.prompt).toContain('packet/certification/export dates')
    expect(qcManifest.prompt).toContain('date of service + provider/facility + encounter')
    expect(qcManifest.prompt).toContain('one-question-at-a-time')
    expect(qcManifest.prompt).toContain('one independent extracted visit PDF per chronology row')
    expect(qcManifest.prompt).toContain('Source buttons must point to consolidated visit PDFs')
    expect(qcManifest.prompt).toContain('attorney-facing output contains no build-process/meta notes')
    expect(qcManifest.prompt).toContain('adversarial-qc-report-template.md')
    expect(qcManifest.prompt).toContain('No external side effects')

    expect(chronologyIndex).toBeGreaterThanOrEqual(0)
    expect(qcIndex).toBeGreaterThan(chronologyIndex)
    expect(humanReviewIndex).toBeGreaterThan(qcIndex)
    expect(recordsBillsPlans[qcIndex].metadata.waypoint.recipe.slug).toBe('firmvault-medical-chronology-adversarial-qc')
    expect(recordsBillsPlans[qcIndex].metadata.waypoint.review).toMatchObject({
      independent: true,
      checks: expect.arrayContaining([
        'visual_source_inspection',
        'visit_level_consolidation',
        'extracted_visit_pdf_per_row',
        'deduplicated_source_buttons',
        'chronology_first_binder_order',
        'attorney_facing_no_process_meta',
      ]),
    })
  })

  it('ports every current FirmVault Recipe from Mission Control source files with safe folder-host metadata', async () => {
    for (const slug of firmVaultRecipeSlugs) {
      const manifest = await readRecipeManifest(slug)
      const sourcePort = manifest.metadata?.source_port

      expect(manifest.schema_version, `${slug} schema_version`).toBe(1)
      expect(manifest.slug, `${slug} slug`).toBe(slug)
      expect(manifest.name, `${slug} name`).toEqual(expect.any(String))
      expect(manifest.name.length, `${slug} name length`).toBeGreaterThan(0)
      expect(manifest.description, `${slug} description`).toEqual(expect.any(String))
      expect(manifest.description?.length ?? 0, `${slug} description length`).toBeGreaterThan(0)
      expect(manifest.prompt.length, `${slug} prompt length`).toBeGreaterThan(500)
      expect(manifest.prompt, `${slug} prompt safety`).toContain('No external side effects')
      expect(manifest.prompt, `${slug} prompt workspace`).toContain('local Waypoint project folder')
      expect(manifest.prompt, `${slug} placeholder phrase`).not.toContain(placeholderPhrase)
      expect(manifest.prompt, `${slug} active OpenRouter secret instruction`).not.toContain('OPENROUTER_API_KEY')
      expect(manifest.prompt, `${slug} token-looking secret`).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)

      expect(sourcePort?.status, `${slug} source status`).toMatch(/^ported_from_/)
      const expectedSourceRepository = documentPipelineRecipeSlugs.has(slug)
        ? firmvaultDocumentPipelineRoot
        : waypointNativeRecipeSlugs.has(slug)
          ? repoRoot
          : missionControlRoot
      expect(sourcePort?.source_repository, `${slug} source repository`).toBe(expectedSourceRepository)
      expect(sourcePort?.external_side_effects, `${slug} external side effects`).toBe('forbidden')
      expect(sourcePort?.review_criteria, `${slug} review criteria`).toEqual(expect.any(Array))
      expect(sourcePort?.review_criteria?.length ?? 0, `${slug} review criteria length`).toBeGreaterThan(0)

      if (documentPipelineRecipeSlugs.has(slug)) {
        expect(sourcePort?.source_workflow, `${slug} pipeline source`).toMatch(/^firmvault-document-pipeline\//)
        expect(sourcePort?.source_node, `${slug} pipeline source node`).toEqual(expect.any(String))
        continue
      }

      if (sourcePort?.source_recipe) {
        expect(sourcePort.source_recipe, `${slug} source recipe`).toBe(`recipes/${slug}`)
        for (const sourceFile of requiredSourceFiles) {
          expect(sourcePort?.source_files, `${slug} source file ${sourceFile}`).toContain(sourceFile)
          await expect(access(join(missionControlRoot, `recipes/${slug}`, sourceFile)), `${slug} source file exists ${sourceFile}`).resolves.toBeUndefined()
        }
      } else {
        expect(sourcePort?.source_workflow, `${slug} workflow-backed source`).toMatch(/^workflows\/firmvault-/)
        expect(sourcePort?.source_node, `${slug} workflow source node`).toEqual(expect.any(String))
      }
    }
  })
})
