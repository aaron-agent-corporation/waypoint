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
] as const

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
  it('keeps the FirmVault Quest bound to the current Wave 0/1 plus BI/PIP, treatment-status, early-lien, records/bills, and demand recipe slugs', async () => {
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

      expect(sourcePort?.status, `${slug} source status`).toMatch(/^ported_from_mission_control/)
      expect(sourcePort?.source_repository, `${slug} source repository`).toBe(missionControlRoot)
      expect(sourcePort?.external_side_effects, `${slug} external side effects`).toBe('forbidden')
      expect(sourcePort?.review_criteria, `${slug} review criteria`).toEqual(expect.any(Array))
      expect(sourcePort?.review_criteria?.length ?? 0, `${slug} review criteria length`).toBeGreaterThan(0)

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
