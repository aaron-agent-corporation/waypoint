import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function commandUsagesFromCliHelp(): string[] {
  const bin = readRepoFile('packages/waypoint-cli/src/bin.ts')
  const helpMatch = bin.match(/const helpText = `([\s\S]*?)`/)
  if (!helpMatch) throw new Error('Unable to find CLI help text')
  return helpMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('waypoint '))
}

describe('folder host documentation', () => {
  it('links the folder host guide and example from the README', () => {
    const readme = readRepoFile('README.md')

    expect(readme).toContain('docs/waypoint-folder-host.md')
    expect(readme).toContain('examples/folder-host-quest/README.md')
    expect(readme).toContain('Local folder host')
  })

  it('provides a runnable folder-host example project', () => {
    expect(existsSync(resolve(repoRoot, 'examples/folder-host-quest/README.md'))).toBe(true)
    expect(existsSync(resolve(repoRoot, 'examples/folder-host-quest/.gitignore'))).toBe(true)

    const example = readRepoFile('examples/folder-host-quest/README.md')

    for (const phrase of [
      'Waypoint folder-host Quest example',
      'node ../../packages/waypoint-cli/src/bin.ts init --quest waypoint',
      'node ../../packages/waypoint-cli/src/bin.ts start --quest waypoint',
      'node ../../packages/waypoint-cli/src/bin.ts discuss --task-id task-003',
      'node ../../packages/waypoint-cli/src/bin.ts auto --route-id route-001',
      '.waypoint/',
      'Reset the example',
    ]) {
      expect(example).toContain(phrase)
    }
  })

  it('documents the folder-host operator journey, state layout, runtime safety, and limitations', () => {
    const guide = readRepoFile('docs/waypoint-folder-host.md')

    for (const phrase of [
      'Waypoint folder host',
      'waypoint init --quest waypoint',
      'waypoint status',
      'waypoint doctor firmvault',
      'waypoint firmvault init-case',
      'waypoint firmvault landmarks',
      'waypoint quests',
      'waypoint recipes --quest waypoint',
      'waypoint start --quest waypoint',
      'waypoint routes',
      'waypoint route --route-id route-001',
      'waypoint tasks --route-id route-001',
      'waypoint discuss --task-id task-003',
      'waypoint auto --route-id route-001',
      'waypoint auto status',
      'waypoint gate --route-id route-001',
      '.waypoint/config.yaml',
      '.waypoint/routes/',
      '.waypoint/events/',
      '.waypoint/tasks/',
      '.waypoint/autopilot/runs.jsonl',
      'null runtime',
      'runtime.recipe: local',
      'executes local commands',
      'not a globally published CLI',
      'private development package',
      'rm -rf .waypoint',
    ]) {
      expect(guide).toContain(phrase)
    }
  })

  it('documents starter Quest selection guidance for folder setup', () => {
    const guide = readRepoFile('docs/waypoint-folder-host.md')

    for (const phrase of [
      'Choosing a starter Quest',
      'If the operator says "set up a Waypoint Quest for this folder"',
      '`firmvault` — FirmVault',
      'Best for: legal case workflow with evidence-backed FirmVault state',
      '`waypoint` — Project Delivery',
      'Best for: general project planning and execution',
      '`agile-delivery` — Agile Delivery',
      'Best for: structured software delivery from PRD through sprint execution',
      '`product-sprint` — Product Sprint',
      'Best for: product ideation, review, QA, and ship cycles',
    ]) {
      expect(guide).toContain(phrase)
    }
  })

  it('keeps documented command surfaces aligned with the CLI help registry', () => {
    const guide = readRepoFile('docs/waypoint-folder-host.md')
    const example = readRepoFile('examples/folder-host-quest/README.md')
    const docs = `${guide}\n${example}`

    for (const usage of commandUsagesFromCliHelp()) {
      expect(docs).toContain(usage)
    }
  })

  it('points core integration readers to the folder host as a concrete adapter', () => {
    const integration = readRepoFile('docs/waypoint-core-integration.md')

    expect(integration).toContain('docs/waypoint-folder-host.md')
    expect(integration).toContain('examples/folder-host-quest/README.md')
    expect(integration).toContain('folder-backed host adapter')
  })
})
