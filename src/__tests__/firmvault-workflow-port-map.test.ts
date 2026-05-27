import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const repoRoot = resolve(__dirname, '../..')
const missionControlRoot = '/Users/aaronwhaley/Github/Active Projects/mission-control'
const mapPath = join(repoRoot, 'docs', 'quests', 'firmvault-workflow-map.yaml')
const notesPath = join(repoRoot, 'docs', 'plans', 'firmvault-workflow-port-map.md')

const requiredWorkflowIds = [
  'firmvault-case-setup',
  'firmvault-document-collection',
  'firmvault-accident-report',
  'firmvault-medical-provider-setup',
  'firmvault-client-check-in-cadence',
  'firmvault-request-medical-records',
  'firmvault-demand-readiness',
  'firmvault-draft-demand',
  'firmvault-send-demand',
  'firmvault-track-offers',
  'firmvault-offer-evaluation',
  'firmvault-negotiate-claim',
  'firmvault-settlement-processing',
  'firmvault-lien-resolution',
  'firmvault-final-distribution',
  'firmvault-close-case',
] as const

type FirmVaultWorkflowPortMap = {
  readonly schema_version?: number
  readonly kind?: string
  readonly source?: {
    readonly repositories?: {
      readonly mission_control?: {
        readonly path?: string
      }
    }
    readonly workflow_glob?: string
  }
  readonly workflows?: readonly WorkflowEntry[]
}

type WorkflowEntry = {
  readonly id?: string
  readonly source_files?: readonly string[]
  readonly source_priority?: string
  readonly wave?: string
  readonly phase?: string
  readonly node_count?: number
  readonly recipe_slugs?: readonly string[]
  readonly trigger_landmarks?: readonly string[]
  readonly output_landmarks?: readonly string[]
  readonly human_gates?: readonly string[]
  readonly waits?: readonly string[]
  readonly canonical_paths?: readonly string[]
}

async function loadMap(): Promise<FirmVaultWorkflowPortMap> {
  return parseYaml(await readFile(mapPath, 'utf8')) as FirmVaultWorkflowPortMap
}

describe('FirmVault workflow port map', () => {
  it('documents the Mission Control source set and initial required workflows', async () => {
    const map = await loadMap()

    expect(map.schema_version).toBe(1)
    expect(map.kind).toBe('firmvault_workflow_port_map')
    expect(map.source?.repositories?.mission_control?.path).toBe(missionControlRoot)
    expect(map.source?.workflow_glob).toBe('workflows/firmvault*.yaml')

    const workflows = map.workflows ?? []
    const ids = workflows.map((workflow) => workflow.id)
    for (const id of requiredWorkflowIds) {
      expect(ids, `missing workflow id ${id}`).toContain(id)
    }
  })

  it('keeps every workflow entry source-backed and structurally complete', async () => {
    const map = await loadMap()
    const workflows = map.workflows ?? []
    expect(workflows.length).toBeGreaterThanOrEqual(requiredWorkflowIds.length)

    for (const workflow of workflows) {
      expect(workflow.id, 'workflow id').toEqual(expect.any(String))
      expect(workflow.phase, `${workflow.id} phase`).toEqual(expect.any(String))
      expect(workflow.wave, `${workflow.id} wave`).toEqual(expect.any(String))
      expect(workflow.node_count, `${workflow.id} node_count`).toEqual(expect.any(Number))
      expect(workflow.source_files, `${workflow.id} source_files`).toEqual(expect.any(Array))
      expect(workflow.recipe_slugs, `${workflow.id} recipe_slugs`).toEqual(expect.any(Array))
      expect(workflow.trigger_landmarks, `${workflow.id} trigger_landmarks`).toEqual(expect.any(Array))
      expect(workflow.output_landmarks, `${workflow.id} output_landmarks`).toEqual(expect.any(Array))
      expect(workflow.human_gates, `${workflow.id} human_gates`).toEqual(expect.any(Array))
      expect(workflow.waits, `${workflow.id} waits`).toEqual(expect.any(Array))
      expect(workflow.canonical_paths, `${workflow.id} canonical_paths`).toEqual(expect.any(Array))

      for (const sourceFile of workflow.source_files ?? []) {
        await expect(access(join(missionControlRoot, sourceFile)), `${workflow.id} source ${sourceFile}`).resolves.toBeUndefined()
      }
    }
  })

  it('preserves the duplicate source rule for workflows defined twice', async () => {
    const map = await loadMap()
    const byId = new Map((map.workflows ?? []).map((workflow) => [workflow.id, workflow]))
    const caseSetup = byId.get('firmvault-case-setup')
    expect(caseSetup?.source_files).toContain('workflows/firmvault-case-setup.yaml')
    expect(caseSetup?.source_files).toContain('workflows/firmvault-workflows.yaml')
    expect(caseSetup?.source_priority).toBe('standalone_then_aggregate')
  })

  it('has human-readable port map notes with safety and temp-folder verification rules', async () => {
    const notes = await readFile(notesPath, 'utf8')
    expect(notes).toContain('standalone_then_aggregate')
    expect(notes).toContain('No external side effects')
    expect(notes).toContain('temp FirmVault-style case folder')
  })
})
