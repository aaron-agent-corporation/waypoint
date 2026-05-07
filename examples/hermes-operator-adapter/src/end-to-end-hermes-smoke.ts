import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { runHermesDiscussionLoop, type HermesDiscussionLoopResult } from './discussion-loop.ts'
import { parseHermesProjectRegistry, resolveHermesProject, type HermesProjectRecord } from './project-registry.ts'
import { runSafeWaypointCommand } from './safe-waypoint-command-runner.ts'
import { runHermesTelegramGateLoop, type HermesTelegramGateLoopResult } from './telegram-gate-loop.ts'

export interface RunEndToEndHermesSmokeInput {
  readonly registryYaml: string
  readonly projectName: string
  readonly runtimeAdapterPath: string
  readonly nextNode?: string
}

export interface EndToEndHermesSmokeResult {
  readonly project: HermesProjectRecord
  readonly routeId: string
  readonly recipeRuntime: {
    readonly status: string
    readonly completedTasks: readonly string[]
    readonly events: string
  }
  readonly discussion: HermesDiscussionLoopResult
  readonly gate: HermesTelegramGateLoopResult
  readonly finalRoute: string
  readonly events: string
  readonly artifacts: {
    readonly config: string
    readonly tasksDirectory: string
    readonly eventsFile: string
  }
}

export async function runEndToEndHermesSmoke(input: RunEndToEndHermesSmokeInput): Promise<EndToEndHermesSmokeResult> {
  const registry = parseHermesProjectRegistry(input.registryYaml)
  const project = resolveHermesProject(registry, input.projectName)

  await runSetupWaypointCommand(project, ['init', '--quest', 'waypoint'])
  await runSetupWaypointCommand(project, ['start', '--quest', 'waypoint'])

  const setupAutopilot = await runSafeWaypointCommand(project, ['auto', '--route-id', 'route-001', '--max-iterations', '2'])
  if (!setupAutopilot.ok) throw new Error(`Initial null-runtime autopilot setup failed: ${setupAutopilot.stderr || setupAutopilot.stdout}`)

  await configureLocalHermesRecipeRuntime(project, input.runtimeAdapterPath)
  const recipeAutopilot = await runSafeWaypointCommand(project, ['auto', '--route-id', 'route-001', '--max-iterations', '1'])
  if (!recipeAutopilot.ok) throw new Error(`Hermes runtime autopilot failed: ${recipeAutopilot.stderr || recipeAutopilot.stdout}`)

  const runtimeEvents = await runSafeWaypointCommand(project, ['route-events', '--route-id', 'route-001', '--limit', '20'])
  if (!runtimeEvents.ok) throw new Error(`Runtime event inspection failed: ${runtimeEvents.stderr || runtimeEvents.stdout}`)

  const discussion = await runHermesDiscussionLoop(project, {
    taskId: 'task-003',
    userMessage: 'Please review the objective before the gate.',
    requestAgent: true,
    agentRuntime: {
      async reply(agentInput) {
        return {
          content: `Hermes smoke reply for ${agentInput.taskId} in ${agentInput.conversationId} via ${agentInput.recipeSlug}.`,
          summary: 'H6 smoke discussion reply',
        }
      },
    },
  })

  await configureNullRecipeRuntime(project)
  const gateAutopilot = await runSafeWaypointCommand(project, ['auto', '--route-id', 'route-001', '--max-iterations', '10'])
  if (!gateAutopilot.ok) throw new Error(`Gate autopilot failed: ${gateAutopilot.stderr || gateAutopilot.stdout}`)
  await configureLocalHermesRecipeRuntime(project, input.runtimeAdapterPath)

  const gate = await runHermesTelegramGateLoop(project, {
    routeId: 'route-001',
    node: 'plan-approval-gate',
    reply: 'approve',
    nextNode: input.nextNode,
  })

  const finalRoute = await runSafeWaypointCommand(project, ['route', '--route-id', 'route-001'])
  if (!finalRoute.ok) throw new Error(`Final route inspection failed: ${finalRoute.stderr || finalRoute.stdout}`)
  const finalEvents = await runSafeWaypointCommand(project, ['route-events', '--route-id', 'route-001', '--limit', '50'])
  if (!finalEvents.ok) throw new Error(`Final event inspection failed: ${finalEvents.stderr || finalEvents.stdout}`)

  return {
    project,
    routeId: 'route-001',
    recipeRuntime: {
      status: parseAutopilotStatus(gateAutopilot.stdout),
      completedTasks: parseCompletedTasks(gateAutopilot.stdout),
      events: runtimeEvents.stdout,
    },
    discussion,
    gate,
    finalRoute: finalRoute.stdout,
    events: finalEvents.stdout,
    artifacts: {
      config: join(project.path, '.waypoint/config.yaml'),
      tasksDirectory: join(project.path, '.waypoint/tasks'),
      eventsFile: join(project.path, '.waypoint/events/route-001.jsonl'),
    },
  }
}

async function configureLocalHermesRecipeRuntime(project: HermesProjectRecord, runtimeAdapterPath: string): Promise<void> {
  const configPath = join(project.path, '.waypoint/config.yaml')
  const config = yamlParse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  config.runtime = {
    recipe: 'local',
    command: process.execPath,
    args: [runtimeAdapterPath],
  }
  await mkdir(join(project.path, '.waypoint'), { recursive: true })
  await writeFile(configPath, yamlStringify(config), 'utf8')
}

async function configureNullRecipeRuntime(project: HermesProjectRecord): Promise<void> {
  const configPath = join(project.path, '.waypoint/config.yaml')
  const config = yamlParse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  config.runtime = {
    recipe: 'null',
  }
  await writeFile(configPath, yamlStringify(config), 'utf8')
}

async function runSetupWaypointCommand(project: HermesProjectRecord, args: readonly string[]): Promise<string> {
  const result = await spawnCommand(process.execPath, [project.waypointCli, ...args], project.path)
  if (result.exitCode !== 0) throw new Error(`Waypoint setup command failed: ${result.stderr}\n${result.stdout}`)
  return result.stdout
}

function spawnCommand(command: string, args: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
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

function parseAutopilotStatus(output: string): string {
  return output.split('\n').find((line) => line.startsWith('status: '))?.replace('status: ', '').trim() ?? 'unknown'
}

function parseCompletedTasks(output: string): readonly string[] {
  const line = output.split('\n').find((item) => item.startsWith('completed tasks: '))
  if (!line) return []
  return line
    .replace('completed tasks: ', '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
