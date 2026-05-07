import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { HermesProjectRecord } from './project-registry.ts'
import { runHermesDiscussionLoop, type HermesDiscussionAgentRuntime } from './discussion-loop.ts'
import { runSafeWaypointCommand } from './safe-waypoint-command-runner.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')

function projectRecord(path: string): HermesProjectRecord {
  return { name: 'waypoint', path, waypointCli }
}

async function startedProject(): Promise<{ readonly root: string; readonly project: HermesProjectRecord }> {
  const root = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-discussion-loop-'))
  const project = projectRecord(root)
  await runUnsafeSetupCommand(project, ['init', '--quest', 'gsd'])
  await runUnsafeSetupCommand(project, ['start', '--quest', 'gsd'])
  return { root, project }
}

async function runUnsafeSetupCommand(project: HermesProjectRecord, args: readonly string[]): Promise<void> {
  const result = await spawnCommand(process.execPath, [project.waypointCli, ...args], project.path)
  if (result.exitCode !== 0) throw new Error(`setup failed: ${result.stderr}\n${result.stdout}`)
}

async function spawnCommand(command: string, args: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr }))
    child.on('error', (error) => resolvePromise({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }))
  })
}

describe('Hermes discussion loop reference adapter', () => {
  it('appends a user message, invokes the selected discussion agent, and appends an agent reply', async () => {
    const { root, project } = await startedProject()
    try {
      const calls: Array<{ recipeSlug: string; taskId: string; conversationId: string; userMessage: string }> = []
      const runtime: HermesDiscussionAgentRuntime = {
        async reply(input) {
          calls.push(input)
          return {
            content: `Agent reply for ${input.taskId} via ${input.recipeSlug}`,
            summary: 'reference agent replied',
          }
        },
      }

      const result = await runHermesDiscussionLoop(project, {
        taskId: 'task-003',
        userMessage: 'What acceptance criteria do you need?',
        requestAgent: true,
        agentRuntime: runtime,
      })

      expect(result).toMatchObject({
        taskId: 'task-003',
        conversationId: 'task:3:discussion:gsd-doc-writer',
        agent: 'gsd-doc-writer',
        userMessageId: 'message-001',
        agentMessageId: 'message-002',
        loopPrevention: { requested: false, reason: 'agent_authored' },
      })
      expect(calls).toEqual([
        {
          recipeSlug: 'gsd-doc-writer',
          taskId: 'task-003',
          conversationId: 'task:3:discussion:gsd-doc-writer',
          userMessage: 'What acceptance criteria do you need?',
        },
      ])

      const discussion = await runSafeWaypointCommand(project, ['discuss', '--task-id', 'task-003'])
      expect(discussion.stdout).toContain('- message-001 user')
      expect(discussion.stdout).toContain('- message-002 agent')
      expect(discussion.stdout).toContain('auto_response: requested=false reason=agent_authored agent=gsd-doc-writer')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('can append only the operator message when agent execution is not requested', async () => {
    const { root, project } = await startedProject()
    try {
      const result = await runHermesDiscussionLoop(project, {
        taskId: 'task-003',
        userMessage: 'Hold for operator review.',
        requestAgent: false,
      })

      expect(result).toMatchObject({
        taskId: 'task-003',
        conversationId: 'task:3:discussion:gsd-doc-writer',
        agent: 'gsd-doc-writer',
        userMessageId: 'message-001',
        agentMessageId: null,
      })
      expect(result.loopPrevention).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
