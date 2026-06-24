import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runQuestsCommand } from './quests.ts'
import { runRecipesCommand } from './recipes.ts'

async function projectWithAuthoredQuest(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wp-cli-ws-'))
  const qDir = join(root, '.waypoint', 'quests')
  await mkdir(qDir, { recursive: true })
  await writeFile(
    join(qDir, 'authored-quest.yaml'),
    'schema_version: 1\nslug: authored-quest\nname: Authored Quest\nworkflow: workflows/authored-quest.md\n',
    'utf8',
  )
  return root
}

describe('waypoint quests CLI with workspace entries', () => {
  it('lists workspace-approved quests when run from a project subdirectory', async () => {
    const root = await projectWithAuthoredQuest()
    const sub = join(root, 'nested', 'dir')
    await mkdir(sub, { recursive: true })

    const out: string[] = []
    const code = await runQuestsCommand([], { stdout: (l) => out.push(l), stderr: () => {}, cwd: sub })

    expect(code).toBe(0)
    expect(out.join('\n')).toContain('authored-quest')
  })

  // P2-1: the CLI skip-and-warn branch (io.stderr) is distinct from the engine e2e.
  it('quests CLI warns on a malformed authored quest yet still prints valid rows', async () => {
    const root = await projectWithAuthoredQuest()
    await writeFile(join(root, '.waypoint', 'quests', 'broken.yaml'), 'schema_version: 2\nslug: broken\n', 'utf8')

    const out: string[] = []
    const err: string[] = []
    const code = await runQuestsCommand([], { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: root })

    expect(code).toBe(0)
    expect(out.join('\n')).toContain('authored-quest') // valid rows still printed
    expect(err.join('\n')).toMatch(/skipped malformed manifest .*broken\.yaml/)
  })

  it('recipes CLI warns on a malformed authored recipe yet still prints valid rows', async () => {
    const root = await projectWithAuthoredQuest()
    const rDir = join(root, '.waypoint', 'recipes')
    await mkdir(rDir, { recursive: true })
    await writeFile(join(rDir, 'good.yaml'), 'schema_version: 1\nslug: good\nname: Good Recipe\nprompt: Do it.\n', 'utf8')
    await writeFile(join(rDir, 'broken.yaml'), 'schema_version: 2\nslug: broken\n', 'utf8')

    const out: string[] = []
    const err: string[] = []
    const code = await runRecipesCommand([], { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: root })

    expect(code).toBe(0)
    expect(out.join('\n')).toContain('good')
    expect(err.join('\n')).toMatch(/skipped malformed manifest .*broken\.yaml/)
  })

  // P3-1: the quest-scoped recipes surface is resolution-only — it must stay silent
  // on unrelated malformed files (only the quest's own referenced recipes matter).
  it('recipes --quest stays silent on an unrelated malformed recipe', async () => {
    const root = await projectWithAuthoredQuest()
    const rDir = join(root, '.waypoint', 'recipes')
    await mkdir(rDir, { recursive: true })
    await writeFile(join(rDir, 'unrelated-broken.yaml'), 'schema_version: 2\nslug: unrelated-broken\n', 'utf8')

    const out: string[] = []
    const err: string[] = []
    // authored-quest references no recipes, so resolution succeeds with an empty list.
    const code = await runRecipesCommand(['--quest', 'authored-quest'], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      cwd: root,
    })

    expect(code).toBe(0)
    expect(err.join('\n')).not.toMatch(/skipped malformed manifest/)
  })
})
