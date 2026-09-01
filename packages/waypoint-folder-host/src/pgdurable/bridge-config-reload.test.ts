import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { configFingerprint } from './bridge.ts'

/**
 * A bridge lives for days; the config it read at startup goes stale under it.
 * Raising `task_timeout_minutes` from 30 to 180 changed nothing until the
 * bridge was restarted, and the same task died at exactly 30 minutes twice
 * (Aaron 2026-07-31). This is the signal that ends that.
 */
async function project(config: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bridge-config-'))
  await mkdir(join(root, '.waypoint'), { recursive: true })
  await writeFile(join(root, '.waypoint', 'config.yaml'), config, 'utf8')
  return root
}

describe('noticing a config edit', () => {
  it('changes when the operator edits the config', async () => {
    const root = await project('runtime:\n  recipe: worker\n')
    const before = await configFingerprint(root)

    await writeFile(
      join(root, '.waypoint', 'config.yaml'),
      'runtime:\n  recipe: worker\n  worker:\n    task_timeout_minutes: 180\n',
      'utf8',
    )

    expect(await configFingerprint(root)).not.toBe(before)
  })

  it('holds steady while nothing is edited', async () => {
    const root = await project('runtime:\n  recipe: worker\n')

    expect(await configFingerprint(root)).toBe(await configFingerprint(root))
  })

  it('says so rather than throwing when there is no config', async () => {
    expect(await configFingerprint(await mkdtemp(join(tmpdir(), 'bridge-none-')))).toBe('absent')
  })
})
