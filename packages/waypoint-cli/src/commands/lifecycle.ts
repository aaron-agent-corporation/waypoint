import {
  addLifecycleMilestone,
  addLifecyclePhase,
  addLifecyclePlan,
  addLifecycleWorkstream,
  listLifecycleState,
} from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runLifecycleCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const projectRoot = io.cwd ?? process.cwd()
  const [action, kind] = args

  try {
    if (action === 'add') {
      if (kind === 'workstream') {
        const record = await addLifecycleWorkstream(projectRoot, {
          key: requireOption(args, '--key'),
          name: requireOption(args, '--name'),
        })
        io.stdout(`Added workstream ${record.key} (${record.id})`)
        return 0
      }

      if (kind === 'milestone') {
        const record = await addLifecycleMilestone(projectRoot, {
          workstream: requireOption(args, '--workstream'),
          key: requireOption(args, '--key'),
          title: requireOption(args, '--title'),
        })
        io.stdout(`Added milestone ${record.key} (${record.id})`)
        return 0
      }

      if (kind === 'phase') {
        const record = await addLifecyclePhase(projectRoot, {
          milestone: requireOption(args, '--milestone'),
          key: requireOption(args, '--key'),
          lifecycle: requireOption(args, '--lifecycle'),
        })
        io.stdout(`Added phase ${record.key} (${record.id})`)
        return 0
      }

      if (kind === 'plan') {
        const record = await addLifecyclePlan(projectRoot, {
          phase: requireOption(args, '--phase'),
          ref: requireOption(args, '--ref'),
          title: requireOption(args, '--title'),
        })
        io.stdout(`Added plan ${record.ref} (${record.id})`)
        return 0
      }
    }

    if (action === 'list') {
      const state = await listLifecycleState(projectRoot)
      io.stdout('Lifecycle')
      io.stdout(`workstreams: ${state.workstreams.length}`)
      for (const workstream of state.workstreams) {
        io.stdout(`- ${workstream.key}: ${workstream.name}`)
      }
      io.stdout(`milestones: ${state.milestones.length}`)
      for (const milestone of state.milestones) {
        io.stdout(`- ${milestone.key}: ${milestone.title}`)
      }
      io.stdout(`phases: ${state.phases.length}`)
      for (const phase of state.phases) {
        io.stdout(`- ${phase.key}: ${phase.lifecycle}`)
      }
      io.stdout(`plans: ${state.plans.length}`)
      for (const plan of state.plans) {
        io.stdout(`- ${plan.ref}: ${plan.title}`)
      }
      return 0
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error))
    return 1
  }

  io.stderr('Usage: waypoint lifecycle add <workstream|milestone|phase|plan> [options]')
  io.stderr('       waypoint lifecycle list')
  return 1
}

function requireOption(args: readonly string[], option: string): string {
  const value = readStringOption(args, option)
  if (value === null) {
    throw new Error(`Missing required option: ${option}`)
  }
  return value
}

function readStringOption(args: readonly string[], option: string): string | null {
  const index = args.indexOf(option)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
