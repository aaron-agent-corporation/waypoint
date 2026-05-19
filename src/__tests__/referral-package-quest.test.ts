import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { loadQuestsFromDirectory, loadRecipesFromDirectory } from '../index.js'

const repoRoot = resolve(__dirname, '../..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

const referralRecipeSlugs = [
  'referral-package-document-reviewer',
  'referral-package-packet-segmenter',
  'referral-package-filename-placement-reviewer',
  'firmvault-medical-chronology-update',
  'firmvault-medical-chronology-adversarial-qc',
  'referral-package-start-here-builder',
  'referral-package-package-qc',
]

describe('Referral Package Quest', () => {
  it('loads the referral-package Quest and resolves its source-attributed Recipes', async () => {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const quest = quests.registry.get('referral-package')
    expect(quest).toBeDefined()
    expect(quest?.name).toBe('Referral Package')
    expect(quest?.description).toContain('attorney referral handoff package')
    expect(quest?.recipes).toEqual(referralRecipeSlugs)
    expect(quest?.metadata).toMatchObject({
      waypoint: {
        quest_family: 'primary_starter',
        selection_summary: 'attorney referral handoff package assembly with safe document review and QC',
      },
      source: {
        project: 'llm-lawyer',
        path: 'docs/referrals/referral-package-and-document-naming-sop.md',
      },
    })

    const phases = quest?.scaffolds?.workstreams?.[0]?.milestones?.[0]?.phases ?? []
    expect(phases.map((phase) => phase.phase_slug)).toEqual([
      'intake-review',
      'document-organization',
      'medical-chronology',
      'package-drafting',
      'quality-control',
      'handoff',
    ])
    const allPlans = phases.flatMap((phase) => phase.plans ?? [])
    expect(allPlans.map((plan) => plan.plan_ref)).toEqual(
      expect.arrayContaining([
        'medical-chronology-update',
        'medical-chronology-adversarial-qc',
        'attorney-handoff-gate',
      ]),
    )
    const chronologyPlan = allPlans.find((plan) => plan.plan_ref === 'medical-chronology-update') as any
    expect(chronologyPlan?.title).toContain('if medical records are present')
    expect(chronologyPlan?.metadata?.waypoint?.recipe?.slug).toBe('firmvault-medical-chronology-update')
    expect(chronologyPlan?.metadata?.waypoint?.required_when).toBe('medical_records_present')
    expect(chronologyPlan?.metadata?.waypoint?.output_artifacts).toEqual(
      expect.arrayContaining([
        '03-medical/medical-chronology-output/reports/date-of-service-ledger.json',
        '03-medical/medical-chronology-output/reports/visit-content.json',
        '03-medical/medical-chronology-output/reports/rendered-template-check.json',
      ]),
    )

    const chronologyQcPlan = allPlans.find((plan) => plan.plan_ref === 'medical-chronology-adversarial-qc') as any
    expect(chronologyQcPlan?.metadata?.waypoint?.recipe?.slug).toBe(
      'firmvault-medical-chronology-adversarial-qc',
    )
    expect(chronologyQcPlan?.metadata?.waypoint?.review?.checks).toEqual(
      expect.arrayContaining([
        'extracted_visit_pdf_per_row',
        'deduplicated_source_buttons',
        'chronology_first_binder_order',
        'attorney_facing_no_process_meta',
      ]),
    )

    const startHerePlan = allPlans.find((plan) => plan.plan_ref === 'start-here-draft') as any
    expect(startHerePlan?.metadata?.waypoint?.recipe?.slug).toBe('referral-package-start-here-builder')
    expect(startHerePlan?.metadata?.waypoint?.output_artifacts).toEqual(
      expect.arrayContaining([
        'referral-package-build/attorney-handoff/START_HERE.html',
        'referral-package-build/attorney-handoff/START_HERE.pdf',
      ]),
    )

    const packageQcPlan = allPlans.find((plan) => plan.plan_ref === 'package-qc') as any
    expect(packageQcPlan?.metadata?.waypoint?.recipe?.slug).toBe('referral-package-package-qc')
    expect(packageQcPlan?.metadata?.waypoint?.output_artifacts).toEqual(
      expect.arrayContaining(['referral-package-build/build-internal/package-qc-report.json']),
    )

    for (const slug of referralRecipeSlugs) {
      const recipe = recipes.registry.get(slug)
      expect(recipe).toBeDefined()
      if (slug.startsWith('referral-package-')) {
        expect(recipe?.metadata).toMatchObject({
          source: {
            project: 'llm-lawyer',
          },
          safety: {
            external_side_effects: 'forbidden',
          },
        })
      } else {
        expect(recipe?.metadata?.source_port).toMatchObject({
          external_side_effects: 'forbidden',
        })
      }
      expect(recipe?.prompt).toContain('No external side effects')
    }
  })

  it('templates the attorney-facing START_HERE dashboard structure for agents', async () => {
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const startHereBuilder = recipes.registry.get('referral-package-start-here-builder')
    expect(startHereBuilder).toBeDefined()

    for (const phrase of [
      'real attorney-facing case dashboard',
      'Do not copy nonfunctional UI chrome',
      'fake top bars',
      'Summary of facts',
      'Current status',
      'Summary of medicals',
      'left-side category navigation',
      'Case Summary, Insurance, Medical, Liens, Expenses, Litigation, Timeline, Documents',
      'Activity Log',
      'descriptive attorney-facing names',
      'HTML medical chronology',
      'medical-chronology.html',
      'accordion',
    ]) {
      expect(startHereBuilder?.prompt).toContain(phrase)
    }
  })

  it('hardens START_HERE instructions against the Alma Cristobal package failure', async () => {
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const startHereBuilder = recipes.registry.get('referral-package-start-here-builder')
    expect(startHereBuilder).toBeDefined()

    for (const phrase of [
      'raw markdown syntax must not leak into START_HERE.html',
      'HTML tables must render as real table elements, not markdown rows in `<pre>` blocks',
      'surface needs-review counts and the highest-priority unresolved items',
      'block the dashboard as not handoff-ready when medical chronology artifacts are missing',
      'record whether the package was produced by a real Waypoint Quest route',
    ]) {
      expect(startHereBuilder?.prompt).toContain(phrase)
    }
  })

  it('hardens referral package QC against missing Quest execution and Alma Cristobal failure modes', async () => {
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const qc = recipes.registry.get('referral-package-package-qc')
    expect(qc).toBeDefined()

    for (const phrase of [
      'verify that a real Waypoint Quest route/recipe chain produced or governed the package',
      'missing `.waypoint` route evidence',
      'duplicate ISO date prefixes',
      'raw markdown leakage in START_HERE.html',
      'markdown tables rendered inside `<pre>` blocks',
      'needs-review count',
      'obvious folder/category contradictions',
      'medical records present but chronology artifacts missing',
    ]) {
      expect(qc?.prompt).toContain(phrase)
    }
  })

  it('hardens filename placement review against duplicated dates and category contradictions', async () => {
    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const filenameReviewer = recipes.registry.get('referral-package-filename-placement-reviewer')
    expect(filenameReviewer).toBeDefined()

    for (const phrase of [
      'Reject duplicated ISO date prefixes such as `2024-04-01-2024-04-01-...`',
      'police reports, citations, trip reports, fuel receipts, open-records requests, and client intake packets are not medical records merely because they mention medical terms',
      'conflicting folder signals require review questions instead of confident placement',
      'large needs-review counts must be surfaced to package QC and START_HERE',
    ]) {
      expect(filenameReviewer?.prompt).toContain(phrase)
    }
  })

  it('documents how to inspect and start the referral-package Quest', () => {
    const guide = readFileSync(resolve(repoRoot, 'docs/quests/referral-package.md'), 'utf8')

    for (const phrase of [
      'Referral Package',
      'waypoint init --quest referral-package',
      'waypoint start --quest referral-package',
      'waypoint recipes --quest referral-package',
      'source folders remain read-only',
      'does not satisfy FirmVault legal facts',
      'No external side effects',
      'attorney-handoff-gate',
      'medical-chronology-update',
      'medical-chronology-adversarial-qc',
      'Create a referral package for <folder>',
      'medical records are present',
      'one extracted visit PDF per chronology row',
      'Paralegal/Perry agents must invoke the Waypoint CLI rather than an ad hoc direct builder',
      'Missing `.waypoint` route evidence means the output is not Quest-governed',
      'waypoint route-events --route-id route-001 --json',
      'medical records present → chronology artifacts required',
      'Do not mark the referral package handoff-ready from files alone',
    ]) {
      expect(guide).toContain(phrase)
    }
  })
})
