import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CORDIS_GUEST_DIST_ENV,
  cordisGuestDistRefusal,
  defaultCordisGuestDist,
  resolveCordisGuestDist,
} from './cordis-guest-dist.ts'

async function distDir(withDigest = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'guest-dist-'))
  if (withDigest) await writeFile(join(dir, 'digest.txt'), 'sha256:abc\n', 'utf8')
  return dir
}

describe('finding the cordis guest bundle', () => {
  it('prefers the env override', async () => {
    const dir = await distDir()
    const got = resolveCordisGuestDist({ [CORDIS_GUEST_DIST_ENV]: dir } as NodeJS.ProcessEnv)
    expect(got).toMatchObject({ dist: dir, source: 'env' })
  })

  it('falls back to the installed home — the case launchd could not serve', async () => {
    const waypoint = await mkdtemp(join(tmpdir(), 'waypoint-home-'))
    const installed = join(waypoint, 'cordis-guest')
    await mkdir(installed, { recursive: true })
    await writeFile(join(installed, 'digest.txt'), 'sha256:abc', 'utf8')
    const got = resolveCordisGuestDist({ WAYPOINT_HOME: waypoint } as NodeJS.ProcessEnv)
    expect(got).toMatchObject({ dist: installed, source: 'installed' })
    expect(defaultCordisGuestDist({ WAYPOINT_HOME: waypoint } as NodeJS.ProcessEnv)).toBe(installed)
  })

  it('a dist without digest.txt does not count — drift could not be checked', async () => {
    const dir = await distDir(false)
    // WAYPOINT_HOME is pinned at an empty dir: without it the installed fallback
    // finds the REAL bundle on this machine and the test proves nothing.
    const waypoint = await mkdtemp(join(tmpdir(), 'waypoint-empty-'))
    const got = resolveCordisGuestDist({
      [CORDIS_GUEST_DIST_ENV]: dir,
      WAYPOINT_HOME: waypoint,
    } as NodeJS.ProcessEnv)
    expect(got.dist).toBeNull()
    // Still reported as looked-at, so the refusal names the wrong-looking dir.
    expect(got.searched).toContain(dir)
  })

  it('the refusal names every path and how to build the bundle', async () => {
    const waypoint = await mkdtemp(join(tmpdir(), 'waypoint-home-'))
    const got = resolveCordisGuestDist({ WAYPOINT_HOME: waypoint } as NodeJS.ProcessEnv)
    expect(got.dist).toBeNull()
    const refusal = cordisGuestDistRefusal(got.searched)
    expect(refusal).toContain(join(waypoint, 'cordis-guest'))
    expect(refusal).toMatch(/build\.sh/)
    // The point: never silently proceed into a bare sprite.
    expect(refusal).toMatch(/fail closed/)
  })
})
