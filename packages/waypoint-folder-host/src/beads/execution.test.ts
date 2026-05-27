import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
} from './instantiate.ts'
import { planWaypointBeadsRecipeExecution } from './execution.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsRunTask, type WaypointBeadsSnapshotStatus } from './reconstruct.ts'

describe('Waypoint Beads recipe execution policy planner', () => {
  it('plans ready recipe tasks with preserved runtime and tool metadata', async () => {
    const task = await readyTaskForQuest('example', 'recipe:doc-writer')

    const plan = planWaypointBeadsRecipeExecution(task, {
      external_side_effects: 'none',
      supported_tools: ['read_file', 'write_file', 'search_files'],
    })

    expect(plan).toMatchObject({
      action: 'run',
      recipe_slug: 'doc-writer',
      policy: {
        recipe_external_side_effects: 'forbidden',
        runtime_external_side_effects: 'none',
      },
      runtime: {
        tools: ['read_file', 'write_file', 'search_files'],
        runtime: {
          model: 'claude-sonnet-4',
          temperature: 0.3,
          max_tokens: 4000,
        },
      },
      missing_tools: [],
    })
  })

  it('blocks unsafe or unsupported recipe execution before runtime dispatch', async () => {
    const docWriter = await readyTaskForQuest('example', 'recipe:doc-writer')
    const missingToolPlan = planWaypointBeadsRecipeExecution(docWriter, {
      external_side_effects: 'none',
      supported_tools: ['read_file'],
    })
    expect(missingToolPlan).toMatchObject({
      action: 'block',
      block_reason: 'missing_required_tools',
      missing_tools: ['write_file', 'search_files'],
    })

    const chronology = await readyTaskForQuest('referral-package', 'plan:medical-chronology-update')
    const forbiddenPlan = planWaypointBeadsRecipeExecution(chronology, {
      external_side_effects: 'allowed',
      supported_tools: ['file_read', 'search_files', 'file_write'],
    })
    expect(forbiddenPlan).toMatchObject({
      action: 'block',
      recipe_slug: 'firmvault-medical-chronology-update',
      block_reason: 'external_side_effects_forbidden',
    })

    const gatedTask: WaypointBeadsRunTask = {
      ...docWriter,
      metadata: {
        waypoint: {
          ...docWriter.metadata.waypoint,
          policy: { external_side_effects: 'gated' },
        },
      },
    }
    expect(
      planWaypointBeadsRecipeExecution(gatedTask, {
        external_side_effects: 'allowed',
        supported_tools: ['read_file', 'write_file', 'search_files'],
      }),
    ).toMatchObject({
      action: 'block',
      block_reason: 'external_side_effects_require_approval',
    })
    expect(
      planWaypointBeadsRecipeExecution(gatedTask, {
        external_side_effects: 'allowed',
        approved_gated_side_effects: true,
        supported_tools: ['read_file', 'write_file', 'search_files'],
      }),
    ).toMatchObject({
      action: 'run',
      recipe_slug: 'doc-writer',
    })
  })
})

async function readyTaskForQuest(quest: string, logicalId: string): Promise<WaypointBeadsRunTask> {
  const catalog = await loadBundledWaypointCatalog()
  const instantiated = await instantiateWaypointRouteInBeads(catalog, {
    quest,
    routeId: `route-${quest}`,
    subject: { type: 'project', id: 'local' },
    client: createRecordingClient(),
  })
  const statuses: Record<string, WaypointBeadsSnapshotStatus> = Object.fromEntries(
    instantiated.issues.map((issue) => [issue.logicalId, 'closed']),
  )
  statuses[`route:${quest}`] = 'open'
  statuses[logicalId] = 'open'

  const reconstruction = reconstructWaypointRunFromBeads(snapshotFromInstantiation(instantiated, statuses))
  const task = reconstruction.tasks.find((candidate) => candidate.metadata.waypoint.node_key === logicalId.replace(/^[^:]+:/, ''))
  if (!task) throw new Error(`Task not found: ${logicalId}`)
  return task
}

function snapshotFromInstantiation(
  result: WaypointBeadsInstantiationResult,
  statuses: Record<string, WaypointBeadsSnapshotStatus>,
) {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: statuses[issue.logicalId] ?? 'open',
      issue_type: issue.spec.issueType,
      metadata: issue.spec.metadata,
      ...(issue.spec.parent ? { parent: result.root.beadsId } : {}),
    })),
    dependencies: result.dependencies.map((dependency) => ({
      issue_id: dependency.dependent,
      depends_on_id: dependency.dependency,
      type: dependency.type,
    })),
  }
}

function createRecordingClient(): WaypointBeadsIssueClient {
  let count = 0
  return {
    async createIssue() {
      count += 1
      return { id: `bd-${String(count).padStart(3, '0')}` }
    },
    async addDependency() {},
  }
}
