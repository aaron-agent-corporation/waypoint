import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { renderWaypointShim, stableNodePath } from './provision.ts'

const run = promisify(execFile)

/**
 * The `~/.waypoint/bin/waypoint` shim is on every worker's PATH. When it breaks it
 * breaks for a jailed agent mid-quest, whose only account of the failure is
 * what the shell printed — so these pin the two ways it has actually broken
 * (a version-pinned interpreter path, a CLI entrypoint that moved) and that
 * each one now says what to do about it.
 */
describe('waypoint shim', () => {
  describe('stableNodePath', () => {
    it('prefers a stable symlink that resolves to the SAME running binary', () => {
      const realpath = (path: string) =>
        path === '/opt/homebrew/bin/node' || path === '/opt/homebrew/Cellar/node/24.7.0/bin/node'
          ? '/opt/homebrew/Cellar/node/24.7.0/bin/node'
          : path
      expect(stableNodePath('/opt/homebrew/Cellar/node/24.7.0/bin/node', undefined, realpath)).toBe(
        '/opt/homebrew/bin/node',
      )
    })

    it('keeps execPath when a candidate is a DIFFERENT node', () => {
      // A /usr/bin/node from an unrelated install has different flag support.
      // Swapping to it would be a worse failure than the version-pinned path.
      const realpath = (path: string) => path
      expect(stableNodePath('/opt/homebrew/Cellar/node/24.7.0/bin/node', ['/usr/bin/node'], realpath)).toBe(
        '/opt/homebrew/Cellar/node/24.7.0/bin/node',
      )
    })

    it('keeps execPath when nothing resolves', () => {
      const realpath = (path: string) => {
        throw new Error(`ENOENT: ${path}`)
      }
      expect(stableNodePath('/some/node', ['/opt/homebrew/bin/node'], realpath)).toBe('/some/node')
    })

    it('resolves to a real, existing interpreter on this machine', () => {
      // Not a mock: whatever we pick has to actually be node, or the shim is
      // broken the moment it is written.
      expect(stableNodePath()).toMatch(/node$/)
    })
  })

  describe('renderWaypointShim', () => {
    it('refuses with an actionable message when the interpreter is gone', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'shim-no-node-'))
      const shim = join(dir, 'waypoint')
      await writeFile(shim, renderWaypointShim('/opt/homebrew/Cellar/node/1.2.3/bin/node', join(dir, 'bin.ts')), 'utf8')
      await chmod(shim, 0o755)

      const failure = await run(shim, ['status']).catch((error) => error)
      expect(failure.code).toBe(127)
      expect(failure.stderr).toContain('no node at /opt/homebrew/Cellar/node/1.2.3/bin/node')
      expect(failure.stderr).toContain('waypoint provision')
    })

    it('refuses with an actionable message when the CLI entrypoint is gone', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'shim-no-bin-'))
      const shim = join(dir, 'waypoint')
      await writeFile(shim, renderWaypointShim(process.execPath, join(dir, 'nope', 'bin.ts')), 'utf8')
      await chmod(shim, 0o755)

      const failure = await run(shim, ['status']).catch((error) => error)
      expect(failure.code).toBe(127)
      expect(failure.stderr).toContain('no Waypoint CLI at')
      expect(failure.stderr).toContain('waypoint provision')
    })

    it('execs the CLI when both are present', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'shim-ok-'))
      await mkdir(join(dir, 'cli'), { recursive: true })
      const bin = join(dir, 'cli', 'bin.ts')
      await writeFile(bin, 'process.stdout.write(`ok:${process.argv.slice(2).join(",")}`)\n', 'utf8')
      const shim = join(dir, 'waypoint')
      await writeFile(shim, renderWaypointShim(stableNodePath(), bin), 'utf8')
      await chmod(shim, 0o755)

      const { stdout } = await run(shim, ['quests'])
      expect(stdout).toBe('ok:quests')
    })
  })
})
