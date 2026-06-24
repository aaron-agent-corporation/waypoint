import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runQuestsCommand } from './quests.ts'

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
})
