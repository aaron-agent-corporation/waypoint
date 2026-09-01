import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { enableGitPerformanceConfig } from './init.ts'

const execFileAsync = promisify(execFile)

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return { io: { cwd, stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) }, stdout, stderr }
}

async function tempGitRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'waypoint-cli-gitperf-'))
  await execFileAsync('git', ['-C', root, 'init', '-q'])
  return root
}

async function gitConfig(root: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'config', '--get', key])
    return stdout.trim()
  } catch {
    return null // git config exits non-zero when the key is unset
  }
}

describe('enableGitPerformanceConfig (rsc-rlf)', () => {
  it('sets fsmonitor + untrackedCache on a real repo and reports it', async () => {
    const root = await tempGitRepo()
    const { io, stdout } = makeIo(root)

    await enableGitPerformanceConfig(root, io)

    expect(await gitConfig(root, 'core.fsmonitor')).toBe('true')
    expect(await gitConfig(root, 'core.untrackedCache')).toBe('true')
    expect(stdout.join('\n')).toMatch(/git performance: set core\.fsmonitor=true, core\.untrackedCache=true/)
  })

  it('is idempotent — a second run neither errors nor duplicates the setting', async () => {
    const root = await tempGitRepo()
    const { io } = makeIo(root)

    await enableGitPerformanceConfig(root, io)
    await enableGitPerformanceConfig(root, io)

    // --get would throw on multiple values; a single 'true' proves no duplication.
    expect(await gitConfig(root, 'core.fsmonitor')).toBe('true')
  })

  it('is a silent no-op outside a git work tree — init must not fail over a tune', async () => {
    const root = await mkdtemp(join(tmpdir(), 'waypoint-cli-gitperf-nonrepo-'))
    const { io, stdout, stderr } = makeIo(root)

    await expect(enableGitPerformanceConfig(root, io)).resolves.toBeUndefined()
    expect(stdout).toEqual([])
    expect(stderr).toEqual([])
    // And it did not create a repo as a side effect.
    expect(await gitConfig(root, 'core.fsmonitor')).toBeNull()
  })
})
