import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('GSD Quest operator documentation', () => {
  it('links the operator guide and command map from the README', () => {
    const readme = readRepoFile('README.md')

    expect(readme).toContain('docs/quests/gsd.md')
    expect(readme).toContain('docs/quests/gsd-command-map.md')
  })

  it('explains the operator workflow, human gates, recipes, adaptations, and deferred scope', () => {
    const guide = readRepoFile('docs/quests/gsd.md')

    for (const phrase of [
      'initialize → discuss → plan → execute → verify → ship',
      'Quest is the user-facing journey template',
      'Recipe is the reusable agent definition',
      'Humans intervene',
      'task-scoped discussion',
      'plan approval gate',
      'verification gate',
      'ship approval gate',
      'not implemented yet',
      'does not implement a standalone GSD CLI',
    ]) {
      expect(guide).toContain(phrase)
    }
  })

  it('publishes a human-readable command map backed by all 65 YAML mappings', () => {
    const sourceMap = readRepoFile('docs/quests/gsd-command-map.yaml')
    const markdownMap = readRepoFile('docs/quests/gsd-command-map.md')
    const sourceCommands = Array.from(
      sourceMap.matchAll(/^\s+- source_command: commands\/gsd\/(.+)$/gm),
      ([, command]) => command,
    )

    expect(sourceCommands).toHaveLength(65)
    expect(markdownMap).toContain('Generated from `docs/quests/gsd-command-map.yaml`')

    for (const command of sourceCommands) {
      expect(markdownMap).toContain(`commands/gsd/${command}`)
    }

    for (const phrase of [
      '`/waypoint pause`',
      '`/waypoint resume`',
      '`/waypoint auto`',
      'deferred optional namespace commands',
      '`quests/gsd.yaml`',
    ]) {
      expect(markdownMap).toContain(phrase)
    }
  })
})
