import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadBundledWaypointCatalog } from '@waypoint/folder-host'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { runWaypointCli } from '../../packages/waypoint-cli/src/bin.ts'
import { loadBundledHandoffManifests, resolveQuestHandoffManifests, type QuestManifest } from '../index.js'

type ScaffoldPlan = {
  readonly plan_ref?: string
  readonly title?: string
  readonly metadata?: {
    readonly waypoint?: {
      readonly node?: { readonly type?: string }
      readonly recipe?: { readonly slug?: string }
      readonly gate?: { readonly required?: boolean; readonly kind?: string }
      readonly wait?: unknown
    }
    readonly source_port?: {
      readonly allow_plan_ref_recipe_slug?: boolean
      readonly supporting_skill?: string
    }
  }
}

type ScaffoldPhase = {
  readonly phase_slug?: string
  readonly plans?: readonly ScaffoldPlan[]
}

type ScaffoldQuest = {
  readonly scaffolds?: {
    readonly workstreams?: readonly {
      readonly milestones?: readonly {
        readonly phases?: readonly ScaffoldPhase[]
      }[]
    }[]
  }
}

function flattenPhases(quest: ScaffoldQuest): readonly ScaffoldPhase[] {
  return (quest.scaffolds?.workstreams ?? []).flatMap((workstream) =>
    (workstream.milestones ?? []).flatMap((milestone) => milestone.phases ?? []),
  )
}

function flattenPlans(quest: ScaffoldQuest): readonly ScaffoldPlan[] {
  return flattenPhases(quest).flatMap((phase) => phase.plans ?? [])
}

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'firmvault-waypoint-case-'))
}

describe('FirmVault Quest skeleton', () => {
  it('loads through the bundled catalog and resolves all explicit recipe references', async () => {
    const catalog = await loadBundledWaypointCatalog()
    expect(catalog.quests.has('firmvault')).toBe(true)

    const resolved = catalog.resolveQuestRecipes('firmvault')
    expect(resolved.ok, resolved.ok ? undefined : resolved.message).toBe(true)
    if (!resolved.ok) throw new Error(resolved.message)

    const handoffLoad = await loadBundledHandoffManifests()
    expect(handoffLoad.ok).toBe(true)
    if (!handoffLoad.ok) throw new Error(handoffLoad.errors.map((error) => error.message).join('\n'))
    const resolvedHandoffs = resolveQuestHandoffManifests(resolved.quest as QuestManifest, handoffLoad.registry)
    expect(resolvedHandoffs.ok, resolvedHandoffs.ok ? undefined : resolvedHandoffs.error.message).toBe(true)
    if (!resolvedHandoffs.ok) throw new Error(resolvedHandoffs.error.message)
    expect(resolvedHandoffs.resolved.map((manifest) => manifest.slug)).toEqual(['firmvault-paralegal-handoffs'])
    expect(resolvedHandoffs.resolved[0]?.handoffs).toHaveLength(5)

    const quest = resolved.quest as typeof resolved.quest & ScaffoldQuest
    const questRecipeSlugs = new Set(quest.recipes ?? [])
    const phases = flattenPhases(quest)
    const phaseSlugs = phases.map((phase) => phase.phase_slug)
    expect(phaseSlugs).toEqual([
      'onboarding',
      'document-pipeline',
      'file-setup',
      'treatment-monitoring',
      'records-bills',
      'demand',
      'negotiation',
      'settlement',
      'liens',
      'close',
    ])

    const plans = flattenPlans(quest)
    const planRefs = plans.map((plan) => plan.plan_ref)
    expect(new Set(planRefs).size).toBe(planRefs.length)

    const recipePlans = plans.filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
    expect(recipePlans.length).toBeGreaterThan(0)
    for (const plan of recipePlans) {
      const recipeSlug = plan.metadata?.waypoint?.recipe?.slug
      expect(recipeSlug, `${plan.plan_ref} explicit recipe slug`).toEqual(expect.any(String))
      expect(questRecipeSlugs.has(recipeSlug ?? ''), `${plan.plan_ref} recipe listed in Quest recipes`).toBe(true)
      expect(recipeSlug === plan.plan_ref && !plan.metadata?.source_port?.allow_plan_ref_recipe_slug).toBe(false)
    }

    const gatePlans = plans.filter((plan) => plan.metadata?.waypoint?.node?.type === 'gate')
    expect(gatePlans.length).toBeGreaterThan(0)
    for (const plan of gatePlans) {
      expect(plan.metadata?.waypoint?.gate?.required, `${plan.plan_ref} gate required`).toBe(true)
    }

    const waitPlans = plans.filter((plan) => plan.metadata?.waypoint?.node?.type === 'wait')
    expect(waitPlans.length).toBeGreaterThan(0)
    for (const plan of waitPlans) {
      expect(plan.metadata?.waypoint?.wait, `${plan.plan_ref} wait metadata`).toBeDefined()
    }

    const documentPipelinePhase = phases.find((phase) => phase.phase_slug === 'document-pipeline')
    const documentPipelinePlanRefs = new Set((documentPipelinePhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...documentPipelinePlanRefs]).toEqual(expect.arrayContaining([
      'firmvault-document-intake-record-source-task',
      'firmvault-document-pipeline-submit-for-review-task',
      'firmvault-document-pipeline-review-pr-task',
      'firmvault-document-pipeline-human-review-pr-gate',
      'firmvault-document-pipeline-record-merge-task',
    ]))
    const documentPipelineRecipeSlugs = new Set(
      (documentPipelinePhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...documentPipelineRecipeSlugs]).toEqual(expect.arrayContaining([
      'firmvault-document-intake-record-source',
      'firmvault-document-pipeline-submit-for-review',
      'firmvault-document-pipeline-review-pr',
      'firmvault-document-pipeline-record-merge',
    ]))
    const documentPipelineGateRefs = new Set(
      (documentPipelinePhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'gate')
        .map((plan) => plan.plan_ref),
    )
    expect([...documentPipelineGateRefs]).toEqual(expect.arrayContaining([
      'firmvault-document-pipeline-human-review-pr-gate',
    ]))

    const treatmentMonitoring = phases.find((phase) => phase.phase_slug === 'treatment-monitoring')
    const treatmentPlanRefs = new Set((treatmentMonitoring?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...treatmentPlanRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-insurance-bi-identify-carrier-task',
        'firmvault-insurance-bi-prepare-lor-handoff',
        'firmvault-insurance-bi-human-send-lor',
        'firmvault-insurance-bi-wait-acknowledgment',
        'firmvault-insurance-bi-process-acknowledgment-task',
        'firmvault-insurance-pip-open-claim-task',
        'firmvault-insurance-pip-prepare-packet',
        'firmvault-insurance-pip-human-send-packet',
        'firmvault-insurance-pip-wait-acknowledgment',
        'firmvault-insurance-pip-confirm-approval-task',
        'firmvault-insurance-pip-wait-status-followup',
        'firmvault-insurance-pip-track-exhaustion-task',
        'firmvault-medical-provider-review-status-task',
        'firmvault-medical-provider-human-status-review',
        'firmvault-medical-provider-wait-status-refresh',
      ]),
    )

    const treatmentRecipeSlugs = new Set(
      (treatmentMonitoring?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...treatmentRecipeSlugs]).toEqual(
      expect.arrayContaining([
        'firmvault-insurance-bi-identify-carrier',
        'firmvault-insurance-bi-prepare-lor',
        'firmvault-insurance-bi-process-acknowledgment',
        'firmvault-insurance-pip-open-claim',
        'firmvault-pip-file-application',
        'firmvault-pip-confirm-approval',
        'firmvault-pip-track-exhaustion',
        'firmvault-medical-provider-review-status',
      ]),
    )

    const treatmentGateRefs = new Set(
      (treatmentMonitoring?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'gate')
        .map((plan) => plan.plan_ref),
    )
    expect([...treatmentGateRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-insurance-bi-human-send-lor',
        'firmvault-insurance-pip-human-send-packet',
        'firmvault-medical-provider-human-status-review',
      ]),
    )

    const treatmentWaitRefs = new Set(
      (treatmentMonitoring?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'wait')
        .map((plan) => plan.plan_ref),
    )
    expect([...treatmentWaitRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-insurance-bi-wait-acknowledgment',
        'firmvault-insurance-pip-wait-acknowledgment',
        'firmvault-insurance-pip-wait-status-followup',
        'firmvault-medical-provider-wait-status-refresh',
      ]),
    )


    const recordsPhase = phases.find((phase) => phase.phase_slug === 'records-bills')
    const recordsPlanRefs = new Set((recordsPhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...recordsPlanRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-medical-records-verify-authorization-task',
        'firmvault-records-bills-prepare-request-task',
        'firmvault-records-bills-human-send-request',
        'firmvault-records-bills-wait-first-follow-up',
        'firmvault-records-bills-first-follow-up-task',
        'firmvault-records-bills-wait-second-follow-up',
        'firmvault-records-bills-second-follow-up-task',
        'firmvault-records-bills-wait-third-follow-up',
        'firmvault-records-bills-third-follow-up-task',
        'firmvault-records-bills-wait-escalation',
        'firmvault-records-bills-escalate-delay-task',
        'firmvault-records-bills-receive-process-task',
        'firmvault-medical-chronology-update-task',
        'firmvault-medical-chronology-adversarial-qc-task',
        'firmvault-records-bills-human-completion-review',
      ]),
    )
    const recordsRecipeSlugs = new Set(
      (recordsPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    const chronologyPlan = (recordsPhase?.plans ?? []).find(
      (plan) => plan.plan_ref === 'firmvault-medical-chronology-update-task',
    )
    expect(chronologyPlan?.title).toContain('medical-chronology-binder-generation')
    expect(chronologyPlan?.metadata?.source_port?.supporting_skill).toBe(
      'medical-chronology-binder-generation',
    )
    expect([...recordsRecipeSlugs]).toEqual(
      expect.arrayContaining([
        'firmvault-medical-records-verify-authorization',
        'firmvault-request-records-bills-prepare-request',
        'firmvault-request-records-bills-follow-up',
        'firmvault-medical-records-escalate-delay',
        'firmvault-medical-records-receive-and-process',
        'firmvault-medical-chronology-update',
        'firmvault-medical-chronology-adversarial-qc',
      ]),
    )


    const demandPhase = phases.find((phase) => phase.phase_slug === 'demand')
    const demandPlanRefs = new Set((demandPhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...demandPlanRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-demand-gather-materials-task',
        'firmvault-demand-readiness-human-review',
        'firmvault-demand-final-lien-process-check-task',
        'firmvault-demand-draft-letter-task',
        'firmvault-demand-attorney-review-gate',
        'firmvault-demand-identify-recipients-task',
        'firmvault-demand-human-send-package',
        'firmvault-demand-wait-response',
      ]),
    )
    const demandRecipeSlugs = new Set(
      (demandPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...demandRecipeSlugs]).toEqual(
      expect.arrayContaining([
        'firmvault-demand-gather-materials',
        'firmvault-demand-check-final-lien-process',
        'firmvault-demand-draft-letter',
        'firmvault-demand-identify-recipients',
      ]),
    )

    const negotiationPhase = phases.find((phase) => phase.phase_slug === 'negotiation')
    const negotiationPlanRefs = new Set((negotiationPhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...negotiationPlanRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-negotiation-wait-offer-response',
        'firmvault-negotiation-log-incoming-offer-task',
        'firmvault-negotiation-offer-evaluation-task',
        'firmvault-negotiation-client-offer-decision-gate',
        'firmvault-negotiation-document-client-decision-task',
        'firmvault-negotiation-prepare-response-task',
        'firmvault-negotiation-human-send-response-gate',
        'firmvault-negotiation-document-response-task',
      ]),
    )
    const negotiationRecipeSlugs = new Set(
      (negotiationPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...negotiationRecipeSlugs]).toEqual(
      expect.arrayContaining([
        'firmvault-negotiation-track-offer',
        'firmvault-negotiation-offer-evaluation',
        'firmvault-negotiation-document-client-decision',
        'firmvault-negotiation-prepare-response',
        'firmvault-negotiation-document-response',
      ]),
    )
    const negotiationGateRefs = new Set(
      (negotiationPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'gate')
        .map((plan) => plan.plan_ref),
    )
    expect([...negotiationGateRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-negotiation-client-offer-decision-gate',
        'firmvault-negotiation-human-send-response-gate',
      ]),
    )
    const negotiationWaitRefs = new Set(
      (negotiationPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'wait')
        .map((plan) => plan.plan_ref),
    )
    expect([...negotiationWaitRefs]).toEqual(expect.arrayContaining(['firmvault-negotiation-wait-offer-response']))

    const settlementPhase = phases.find((phase) => phase.phase_slug === 'settlement')
    const settlementPlanRefs = new Set((settlementPhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...settlementPlanRefs]).toEqual(expect.arrayContaining([
      'firmvault-settlement-prepare-statement-task',
      'firmvault-settlement-prepare-authorization-task',
      'firmvault-settlement-client-authorization-gate',
      'firmvault-settlement-execute-release-gate',
      'firmvault-settlement-wait-for-funds',
      'firmvault-settlement-document-funds-task',
      'firmvault-settlement-lien-audit-task',
      'firmvault-settlement-lien-strategy-review-gate',
      'firmvault-settlement-lien-document-result-task',
      'firmvault-final-distribution-prepare-statement-task',
      'firmvault-final-distribution-issue-client-gate',
      'firmvault-final-distribution-confirm-client-receipt-gate',
      'firmvault-final-distribution-zero-trust-task',
    ]))
    expect(settlementPlanRefs.has('firmvault-settlement-deferred')).toBe(false)

    const liensPhase = phases.find((phase) => phase.phase_slug === 'liens')
    const lienPlanRefs = new Set((liensPhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...lienPlanRefs]).toEqual(
      expect.arrayContaining([
        'firmvault-early-lien-identification-task',
        'firmvault-early-lien-human-inventory-review',
        'firmvault-lien-resolution-review-inventory-task',
        'firmvault-lien-resolution-prepare-final-request-task',
        'firmvault-lien-resolution-human-send-final-request',
        'firmvault-lien-resolution-wait-final-amount',
        'firmvault-lien-resolution-document-final-amount-task',
        'firmvault-lien-resolution-payment-review-gate',
        'firmvault-lien-resolution-document-payment-task',
      ]),
    )
    expect(lienPlanRefs.has('firmvault-liens-deferred')).toBe(false)
    const lienRecipeSlugs = new Set(
      (liensPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...lienRecipeSlugs]).toEqual(expect.arrayContaining([
      'firmvault-lien-identify-potential',
      'firmvault-lien-resolution-review-inventory',
      'firmvault-lien-resolution-prepare-final-request',
      'firmvault-lien-resolution-document-final-amount',
      'firmvault-lien-resolution-document-payment',
    ]))

    const closePhase = phases.find((phase) => phase.phase_slug === 'close')
    const closePlanRefs = new Set((closePhase?.plans ?? []).map((plan) => plan.plan_ref))
    expect([...closePlanRefs]).toEqual(expect.arrayContaining([
      'firmvault-close-case-verify-readiness-task',
      'firmvault-close-case-prepare-letter-task',
      'firmvault-close-case-human-send-letter-gate',
      'firmvault-close-case-human-archive-file-gate',
      'firmvault-close-case-document-closure-task',
    ]))
    expect(closePlanRefs.has('firmvault-close-deferred')).toBe(false)
    const closeRecipeSlugs = new Set(
      (closePhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...closeRecipeSlugs]).toEqual(expect.arrayContaining([
      'firmvault-close-case-verify-readiness',
      'firmvault-close-case-prepare-letter',
      'firmvault-close-case-document-closure',
    ]))
    const closeGateRefs = new Set(
      (closePhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'gate')
        .map((plan) => plan.plan_ref),
    )
    expect([...closeGateRefs]).toEqual(expect.arrayContaining([
      'firmvault-close-case-human-send-letter-gate',
      'firmvault-close-case-human-archive-file-gate',
    ]))
  })

  it('installs and starts inside a temp FirmVault-style case folder without touching the repo root', async () => {
    const cwd = await tempProject()
    const repoRoot = join(__dirname, '..', '..')

    expect(await runWaypointCli(['quests'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)
    expect(await runWaypointCli(['init', '--quest', 'firmvault'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)
    expect(await runWaypointCli(['status'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)
    expect(await runWaypointCli(['start', '--quest', 'firmvault'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)
    expect(await runWaypointCli(['routes'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)
    expect(await runWaypointCli(['tasks', '--route-id', 'route-001'], { cwd, stdout: () => undefined, stderr: () => undefined })).toBe(0)

    await expect(readFile(join(cwd, '.waypoint/config.yaml'), 'utf8')).resolves.toContain('quest: firmvault')
    await expect(readFile(join(cwd, '.waypoint/quests/firmvault.yaml'), 'utf8')).resolves.toContain('slug: firmvault')
    await expect(readFile(join(cwd, '.waypoint/routes/route-001.yaml'), 'utf8')).resolves.toContain('quest: firmvault')

    const eventLines = (await readFile(join(cwd, '.waypoint/events/route-001.jsonl'), 'utf8')).trim().split('\n')
    expect(eventLines.some((line) => JSON.parse(line).kind === 'route.started')).toBe(true)

    const taskState = parseYaml(await readFile(join(cwd, '.waypoint/tasks/tasks.yaml'), 'utf8')) as {
      readonly tasks?: readonly { readonly kind?: string }[]
    }
    const taskKinds = new Set((taskState.tasks ?? []).map((task) => task.kind))
    expect((taskState.tasks ?? []).length).toBeGreaterThan(0)
    expect(taskKinds.has('recipe')).toBe(true)
    expect(taskKinds.has('gate')).toBe(true)
    expect(taskKinds.has('wait')).toBe(true)
    expect(taskKinds.has('checkpoint')).toBe(false)

    await expect(readFile(join(repoRoot, '.waypoint/config.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)
})
