import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { appendTaskDiscussionMessage, readTaskDiscussionMessages } from './store'
import type {
  WaypointBeadsIssueCommentInput,
  WaypointBeadsIssueCommentSnapshot,
  WaypointBeadsIssueMutationClient,
  WaypointBeadsIssueSnapshotReader,
} from '../beads/cli-client'
import { instantiateWaypointRouteInBeads, type WaypointBeadsInstantiationResult, type WaypointBeadsIssueClient } from '../beads/instantiate'
import type { WaypointBeadsDependencySnapshot, WaypointBeadsIssueSnapshot } from '../beads/reconstruct'
import { installQuestCatalog } from '../catalog/install'
import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { initWaypointProject } from '../project/init'
import { startQuestRoute } from '../routes/start'

async function startedProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-discussion-'))
  await initWaypointProject(projectRoot, { quest: 'waypoint' })
  await installQuestCatalog(projectRoot, await loadBundledWaypointCatalog(), { quest: 'waypoint' })
  await startQuestRoute(projectRoot, { quest: 'waypoint' })
  return projectRoot
}

describe('Waypoint folder discussion store', () => {
  it('appends task-scoped discussion messages to JSONL', async () => {
    const projectRoot = await startedProject()

    const message = await appendTaskDiscussionMessage(projectRoot, 'task-003', {
      author: 'user',
      content: 'What are the acceptance criteria?',
      now: new Date('2026-05-07T12:30:00.000Z'),
    })

    expect(message).toMatchObject({
      id: 'message-001',
      task_id: 'task-003',
      author: 'user',
      content: 'What are the acceptance criteria?',
      metadata: {
        waypoint: {
          authored_by: 'user',
          auto_response: {
            requested: false,
            agent: 'waypoint-doc-writer',
            reason: 'global_disabled',
          },
        },
      },
    })

    const page = await readTaskDiscussionMessages(projectRoot, 'task-003')
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ id: 'message-001', content: 'What are the acceptance criteria?' })

    const jsonl = await readFile(join(projectRoot, '.waypoint/tasks/task-003-discussion.jsonl'), 'utf8')
    expect(jsonl).toContain('What are the acceptance criteria?')
  })

  it('records agent-authored messages as loop-prevented', async () => {
    const projectRoot = await startedProject()

    const message = await appendTaskDiscussionMessage(projectRoot, 'task-003', {
      author: 'agent',
      content: 'I will not trigger another agent response.',
    })

    expect(message.metadata).toMatchObject({
      waypoint: {
        authored_by: 'agent',
        agent: 'waypoint-doc-writer',
        auto_response: {
          requested: false,
          reason: 'agent_authored',
        },
      },
    })
  })

  it('stores discussion messages as Beads comments when the route backend is beads', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-discussion-beads-'))
    await initWaypointProject(projectRoot, { quest: 'waypoint', backend: 'beads' })
    const catalog = await loadBundledWaypointCatalog()
    const instantiated = await instantiateWaypointRouteInBeads(catalog, {
      quest: 'waypoint',
      routeId: 'route-waypoint',
      subject: { type: 'project', id: 'local' },
      client: createRecordingIssueClient(),
    })
    const discussion = instantiated.issues.find((issue) => issue.spec.metadata.waypoint.kind === 'discussion')
    expect(discussion).toBeTruthy()
    const comments = createRecordingCommentClient()

    const message = await appendTaskDiscussionMessage(
      projectRoot,
      discussion!.beadsId,
      {
        author: 'user',
        content: 'What needs clarification?',
        now: new Date('2026-05-27T12:00:00.000Z'),
      },
      {
        beadsReader: snapshotReader(snapshotFromInstantiation(instantiated)),
        beadsCommentReader: comments,
        beadsMutator: comments,
      },
    )

    expect(message).toMatchObject({
      id: 'message-001',
      task_id: discussion?.beadsId,
      route_id: 'route-waypoint',
      author: 'user',
      content: 'What needs clarification?',
      metadata: { waypoint: { backend: 'beads', authored_by: 'user' } },
    })
    expect(comments.comments).toEqual([
      {
        id: discussion?.beadsId,
        text: 'Waypoint discussion message\nauthor: user\ncreated_at: 2026-05-27T12:00:00.000Z\n\nWhat needs clarification?',
      },
    ])

    const page = await readTaskDiscussionMessages(projectRoot, discussion!.beadsId, {
      beadsReader: snapshotReader(snapshotFromInstantiation(instantiated)),
      beadsCommentReader: comments,
    })
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      task_id: discussion?.beadsId,
      author: 'user',
      content: 'What needs clarification?',
      metadata: { waypoint: { backend: 'beads' } },
    })
  })
})

function snapshotReader(snapshot: {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
}): WaypointBeadsIssueSnapshotReader {
  return {
    async listIssueSnapshots() {
      return snapshot
    },
  }
}

function snapshotFromInstantiation(result: WaypointBeadsInstantiationResult): {
  readonly issues: readonly WaypointBeadsIssueSnapshot[]
  readonly dependencies: readonly WaypointBeadsDependencySnapshot[]
} {
  return {
    issues: result.issues.map((issue) => ({
      id: issue.beadsId,
      title: issue.spec.title,
      status: 'open',
      issue_type: issue.spec.issueType,
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:00:00.000Z',
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

function createRecordingIssueClient(): WaypointBeadsIssueClient {
  let count = 0
  return {
    async createIssue() {
      count += 1
      return { id: `bd-${String(count).padStart(3, '0')}` }
    },
    async addDependency() {
      return undefined
    },
  }
}

function createRecordingCommentClient(): WaypointBeadsIssueMutationClient & {
  readonly comments: WaypointBeadsIssueCommentInput[]
  listIssueComments(issueId: string): Promise<readonly WaypointBeadsIssueCommentSnapshot[]>
} {
  const comments: WaypointBeadsIssueCommentInput[] = []
  return {
    comments,
    async closeIssue() {
      return undefined
    },
    async updateIssueStatus() {
      return undefined
    },
    async addIssueComment(input) {
      comments.push(input)
    },
    async listIssueComments(issueId) {
      return comments
        .filter((comment) => comment.id === issueId)
        .map((comment, index) => ({
          id: `comment-${String(index + 1).padStart(3, '0')}`,
          issue_id: issueId,
          text: comment.text,
          created_at: '2026-05-27T12:00:00.000Z',
        }))
    },
  }
}
