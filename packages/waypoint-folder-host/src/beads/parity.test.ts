import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runWaypointAutopilot } from '../autopilot/run.ts'
import { installQuestCatalog } from '../catalog/install.ts'
import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import { initWaypointProject } from '../project/init.ts'
import { startQuestRoute } from '../routes/start.ts'
import { listWaypointTasks } from '../tasks/store.ts'
import {
  instantiateWaypointRouteInBeads,
  type WaypointBeadsInstantiationResult,
  type WaypointBeadsIssueClient,
} from './instantiate.ts'
import { reconstructWaypointRunFromBeads, type WaypointBeadsRunTask, type WaypointBeadsSnapshotStatus } from './reconstruct.ts'
import { verifyWaypointBeadsTaskCompletion } from './verification.ts'

describe('Waypoint Beads backend parity fixtures', () => {
  it('preserves folder-host task graph shape for the waypoint Quest fixture', async () => {
    const projectRoot = await startedProject('waypoint')
    const folderTasks = await listWaypointTasks(projectRoot)
    const beads = await instantiateQuest('waypoint')
    const reconstructed = reconstructWaypointRunFromBeads(snapshotFromInstantiation(beads))

    expect(reconstructed.tasks.map((task) => task.plan_ref)).toEqual(folderTasks.map((task) => task.plan_ref))
    expect(reconstructed.tasks.map((task) => folderTaskKindForBeads(task))).toEqual(folderTasks.map((task) => task.kind))
    expect(reconstructed.route).toMatchObject({
      quest: 'waypoint',
      status: 'active',
      current_node: 'initialize-context',
      progress: { total: folderTasks.length, ready: 1 },
    })
  })

  it('matches the folder autopilot first human-gate block as a Beads reconstructed route state', async () => {
    const projectRoot = await startedProject('waypoint')
    const folderResult = await runWaypointAutopilot(projectRoot, {
      now: new Date('2026-05-27T00:00:00.000Z'),
      maxIterations: 10,
    })

    expect(folderResult).toMatchObject({
      status: 'blocked',
      blockedNode: 'plan-approval-gate',
    })

    const beads = await instantiateQuest('waypoint')
    const gate = beads.issues.find((issue) => issue.logicalId === 'plan:plan-approval-gate')
    if (!gate) throw new Error('missing plan-approval-gate fixture issue')
    const statuses: Record<string, WaypointBeadsSnapshotStatus> = Object.fromEntries(
      beads.issues.map((issue) => [
        issue.logicalId,
        issue.spec.metadata.waypoint.scaffold?.sequence && issue.spec.metadata.waypoint.scaffold.sequence < 6 ? 'closed' : 'open',
      ]),
    )
    statuses['route:waypoint'] = 'open'
    statuses['plan:plan-approval-gate'] = 'open'

    const reconstructed = reconstructWaypointRunFromBeads(snapshotFromInstantiation(beads, statuses))
    expect(reconstructed.route).toMatchObject({
      status: 'blocked',
      current_node: 'plan-approval-gate',
    })

    const gateTask = reconstructed.tasks.find((task) => task.plan_ref === 'plan-approval-gate')
    expect(gateTask?.kind).toBe('gate')
    await expect(verifyWaypointBeadsTaskCompletion(gateTask!)).resolves.toMatchObject({
      action: 'block_close',
      block_reasons: ['human_review_required'],
    })
  })
})

async function startedProject(quest: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-beads-parity-'))
  await initWaypointProject(projectRoot, { quest, now: new Date('2026-05-27T00:00:00.000Z') })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest })
  await startQuestRoute(projectRoot, { quest, now: new Date('2026-05-27T00:00:00.000Z') })
  return projectRoot
}

async function instantiateQuest(quest: string): Promise<WaypointBeadsInstantiationResult> {
  const catalog = await loadBundledWaypointCatalog()
  return instantiateWaypointRouteInBeads(catalog, {
    quest,
    routeId: `route-${quest}`,
    subject: { type: 'project', id: 'local' },
    client: createRecordingClient(),
  })
}

function snapshotFromInstantiation(
  result: WaypointBeadsInstantiationResult,
  statuses: Record<string, WaypointBeadsSnapshotStatus> = {},
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

function folderTaskKindForBeads(task: WaypointBeadsRunTask): string {
  if (task.kind === 'artifact' || task.kind === 'handoff' || task.kind === 'node') return 'checkpoint'
  return task.kind
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
