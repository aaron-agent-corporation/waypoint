import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Hermes integration plan', () => {
  it('records Track 3 as the selected active destination in the roadmap', () => {
    const roadmap = readRepoFile('docs/plans/waypoint-remaining-roadmap.md')

    expect(roadmap).toContain('### Track 3 — Hermes Runtime + Operator Bridge')
    expect(roadmap).toContain('**Status:** Active — H5 Telegram gate loop complete')
    expect(roadmap).toContain('docs/plans/waypoint-hermes-integration-plan.md')
    expect(roadmap).toContain('Mission Control bridge remains later')
  })

  it('defines the folder-host first Hermes integration contract boundary', () => {
    expect(existsSync(resolve(repoRoot, 'docs/plans/waypoint-hermes-integration-plan.md'))).toBe(true)

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    for (const phrase of [
      'Track 3 — Hermes Runtime + Operator Bridge',
      'folder host first',
      '.waypoint/ remains the source of truth',
      'Hermes is not the durable database',
      'Telegram is the human approval and review surface',
      'Mission Control bridge remains later',
      'Recipe execution payload',
      'schema_version: 1',
      'recipe_slug',
      'task_id',
      'route_id',
      'project_root',
      'operator command allowlist',
      'waypoint status',
      'waypoint routes',
      'waypoint tasks --route-id',
      'waypoint discuss --task-id',
      'waypoint auto --route-id',
      'waypoint gate --route-id',
      'loop prevention',
      'agent-authored',
      'rollback switches',
      'H1 — Project registry',
      'H2 — Safe Waypoint command runner',
      'H3 — Hermes Recipe runtime adapter',
      'H4 — Discussion loop',
      'H5 — Telegram gate loop',
      'H6 — End-to-end Hermes smoke',
    ]) {
      expect(plan).toContain(phrase)
    }
  })

  it('keeps Hermes integration scoped away from Mission Control UI assumptions', () => {
    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')

    expect(plan).toContain('No Mission Control UI is assumed for Track 3')
    expect(plan).toContain('Mission Control can later become a rich UI and database adapter')
    expect(plan).toContain('Folder host adapter: state → `.waypoint/`')
    expect(plan).toContain('Mission Control adapter: state → MC database/API/UI')
  })

  it('records the H1 project registry reference adapter and keeps it read-only', () => {
    expect(existsSync(resolve(repoRoot, 'examples/hermes-operator-adapter/src/project-registry.ts'))).toBe(true)
    expect(existsSync(resolve(repoRoot, 'examples/hermes-operator-adapter/README.md'))).toBe(true)

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    const readme = readRepoFile('examples/hermes-operator-adapter/README.md')
    for (const phrase of [
      'H1 status: complete',
      'examples/hermes-operator-adapter/src/project-registry.ts',
      'friendly project names to trusted local paths',
      'Unknown project names fail closed',
      'No arbitrary path execution from natural language',
      'project name → absolute path + CLI entrypoint',
      'waypoint_cli',
    ]) {
      expect(`${plan}\n${readme}`).toContain(phrase)
    }
  })

  it('records the H2 safe command runner reference adapter and allowlist boundary', () => {
    expect(existsSync(resolve(repoRoot, 'examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts'))).toBe(
      true,
    )

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    const readme = readRepoFile('examples/hermes-operator-adapter/README.md')
    for (const phrase of [
      'H2 status: complete',
      'examples/hermes-operator-adapter/src/safe-waypoint-command-runner.ts',
      'safe Waypoint command runner',
      'command allowlist rejects non-Waypoint shell commands',
      'Mutation commands are explicitly marked',
      'outputs are summarized without dropping route/task IDs',
      'waypoint route-events --route-id',
      'waypoint auto status',
    ]) {
      expect(`${plan}\n${readme}`).toContain(phrase)
    }
  })

  it('records the H3 Hermes Recipe runtime reference adapter and payload boundary', () => {
    expect(existsSync(resolve(repoRoot, 'examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs'))).toBe(true)
    expect(existsSync(resolve(repoRoot, 'examples/hermes-runtime-adapter/README.md'))).toBe(true)

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    const readme = readRepoFile('examples/hermes-runtime-adapter/README.md')
    for (const phrase of [
      'H3 status: complete',
      'examples/hermes-runtime-adapter/hermes-recipe-runtime.mjs',
      'F10 Recipe execution payload',
      'gsd-planner → planner-capable Hermes/Gary execution',
      'unknown recipe_slug → Gary/orchestrator fallback with explicit uncertainty',
      'non-zero adapter exit should be persisted by the existing local runtime as task/route failure',
      'schema_version: 1',
      'structured JSON stdout',
    ]) {
      expect(`${plan}\n${readme}`).toContain(phrase)
    }
  })

  it('records the H4 Hermes discussion loop reference adapter and loop-prevention boundary', () => {
    expect(existsSync(resolve(repoRoot, 'examples/hermes-operator-adapter/src/discussion-loop.ts'))).toBe(true)

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    const readme = readRepoFile('examples/hermes-operator-adapter/README.md')
    for (const phrase of [
      'H4 status: complete',
      'examples/hermes-operator-adapter/src/discussion-loop.ts',
      'task-scoped user↔agent discussion through Hermes',
      'appends user messages through `waypoint discuss --task-id`',
      'appends agent-authored replies through `waypoint discuss --task-id --author agent`',
      'conversation_id',
      'agent_authored',
      'Loop prevention ensures agent-authored replies do not recursively trigger more replies',
    ]) {
      expect(`${plan}\n${readme}`).toContain(phrase)
    }
  })

  it('records the H5 Hermes Telegram gate loop reference adapter and command mapping boundary', () => {
    expect(existsSync(resolve(repoRoot, 'examples/hermes-operator-adapter/src/telegram-gate-loop.ts'))).toBe(true)

    const plan = readRepoFile('docs/plans/waypoint-hermes-integration-plan.md')
    const readme = readRepoFile('examples/hermes-operator-adapter/README.md')
    for (const phrase of [
      'H5 status: complete',
      'examples/hermes-operator-adapter/src/telegram-gate-loop.ts',
      'Reply: approve, reject, revise, show tasks, or show events.',
      'waypoint gate --route-id route-001 --node plan-approval-gate --approve --next-node execute',
      'waypoint gate --route-id route-001 --node plan-approval-gate --reject --note',
      'waypoint tasks --route-id route-001',
      'waypoint route-events --route-id route-001 --limit 20',
      'Hermes response quotes updated route status',
    ]) {
      expect(`${plan}\n${readme}`).toContain(phrase)
    }
  })
})
