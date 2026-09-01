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
      'node ../../packages/waypoint-cli/src/bin.ts init --quest runner',
      'node ../../packages/waypoint-cli/src/bin.ts start --quest runner',
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
      'waypoint init --quest runner',
      'waypoint status',
      'waypoint quests',
      'waypoint recipes [--quest <slug>]',
      'waypoint start [--quest <slug>] [--json]',
      'waypoint routes',
      'waypoint route --route-id <id> [--json]',
      'waypoint tasks [--route-id <id>] [--json]',
      'waypoint discuss --task-id <id> [--message <text>] [--author user|agent]',
      'waypoint auto [--route-id <id>] [--max-iterations N] [--json]',
      'waypoint auto status',
      'waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]',
      '.waypoint/config.yaml',
      '.waypoint/quests/',
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

  it('documents how a host chooses or authors quests for a folder', () => {
    const guide = readRepoFile('docs/waypoint-folder-host.md')

    for (const phrase of [
      'Choosing or authoring a Quest',
      'If the operator says "set up a Waypoint Quest for this folder"',
      '`runner` scaffold',
      'an extension point, not a product surface',
      'waypoint author quest',
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
    const integration = readRepoFile('docs/runner-core-integration.md')

    expect(integration).toContain('docs/waypoint-folder-host.md')
    expect(integration).toContain('examples/folder-host-quest/README.md')
    expect(integration).toContain('folder-backed host adapter')
  })
})
