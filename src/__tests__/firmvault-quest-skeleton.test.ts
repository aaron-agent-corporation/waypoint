import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadBundledWaypointCatalog } from '@waypoint/folder-host'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { runWaypointCli } from '../../packages/waypoint-cli/src/bin.ts'

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

    const quest = resolved.quest as typeof resolved.quest & ScaffoldQuest
    const questRecipeSlugs = new Set(quest.recipes ?? [])
    const phases = flattenPhases(quest)
    const phaseSlugs = phases.map((phase) => phase.phase_slug)
    expect(phaseSlugs).toEqual([
      'onboarding',
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
        'firmvault-records-bills-human-completion-review',
      ]),
    )
    const recordsRecipeSlugs = new Set(
      (recordsPhase?.plans ?? [])
        .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
        .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
    )
    expect([...recordsRecipeSlugs]).toEqual(
      expect.arrayContaining([
        'firmvault-medical-records-verify-authorization',
        'firmvault-request-records-bills-prepare-request',
        'firmvault-request-records-bills-follow-up',
        'firmvault-medical-records-escalate-delay',
        'firmvault-medical-records-receive-and-process',
        'firmvault-medical-chronology-update',
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

    const liensPhase = phases.find((phase) => phase.phase_slug === 'liens')
        const lienPlanRefs = new Set((liensPhase?.plans ?? []).map((plan) => plan.plan_ref))
        expect([...lienPlanRefs]).toEqual(
          expect.arrayContaining([
            'firmvault-early-lien-identification-task',
            'firmvault-early-lien-human-inventory-review',
            'firmvault-liens-deferred',
          ]),
        )
        const lienRecipeSlugs = new Set(
          (liensPhase?.plans ?? [])
            .filter((plan) => plan.metadata?.waypoint?.node?.type === 'recipe')
            .map((plan) => plan.metadata?.waypoint?.recipe?.slug),
        )
        expect([...lienRecipeSlugs]).toEqual(expect.arrayContaining(['firmvault-lien-identify-potential']))
    
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
    expect(taskKinds.has('checkpoint')).toBe(true)

    await expect(readFile(join(repoRoot, '.waypoint/config.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)
})
