import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { seatbeltAvailable, seatbeltCommand, seatbeltWrapArgv, writeSeatbeltProfile } from './wrap.ts'

describe('seatbelt wrap', () => {
  it('builds the sh -c argv', () => {
    expect(seatbeltCommand('/jail/p.sb', 'claude --print')).toEqual([
      '/usr/bin/sandbox-exec',
      '-f',
      '/jail/p.sb',
      'sh',
      '-c',
      'claude --print',
    ])
  })

  it('wraps an argv without a shell in between', () => {
    expect(seatbeltWrapArgv('/jail/p.sb', ['claude', '-p', 'do the task'])).toEqual([
      '/usr/bin/sandbox-exec',
      '-f',
      '/jail/p.sb',
      'claude',
      '-p',
      'do the task',
    ])
  })

  it('writes the profile atomically and leaves no temp files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-wrap-'))
    const profile = '(version 1)\n(allow default)\n(deny file-write*)\n'

    const profilePath = await writeSeatbeltProfile(dir, 'worker', profile)
    expect(path.basename(profilePath)).toBe('worker.sb')
    expect(await readFile(profilePath, 'utf8')).toBe(profile)
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('probe passes on darwin and reports unavailable elsewhere', async () => {
    // Integration-flavoured but cheap: on macOS sandbox-exec exists and the
    // probe should pass; elsewhere it must reject rather than crash, so the
    // host can refuse to spawn with a real diagnostic.
    if (process.platform === 'darwin') {
      await expect(seatbeltAvailable()).resolves.toBeUndefined()
      return
    }
    await expect(seatbeltAvailable()).rejects.toThrow('probe failed')
  })
})
