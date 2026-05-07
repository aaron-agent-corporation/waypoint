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
    expect(roadmap).toContain('**Status:** Active — H1 project registry complete')
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
})
