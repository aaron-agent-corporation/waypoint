import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SPRITES_TOKEN_ENV,
  SPRITES_TOKEN_FILE_ENV,
  defaultSpritesTokenFile,
  resolveSpritesToken,
  spritesTokenRefusal,
} from './sprites-token.ts'

async function tokenFile(contents: string, mode = 0o600): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sprites-token-'))
  const path = join(dir, 'sprites-token')
  await writeFile(path, contents, 'utf8')
  await chmod(path, mode)
  return path
}

describe('where Waypoint keeps its Sprites token', () => {
  it('prefers the environment, so every existing caller is unchanged', async () => {
    const path = await tokenFile('from-file')
    const got = resolveSpritesToken({
      [SPRITES_TOKEN_ENV]: '  from-env  ',
      [SPRITES_TOKEN_FILE_ENV]: path,
    } as NodeJS.ProcessEnv)
    expect(got).toMatchObject({ token: 'from-env', source: 'env' })
  })

  it('falls back to the token file — the case launchd could not serve', async () => {
    const path = await tokenFile('from-file\n')
    const got = resolveSpritesToken({ [SPRITES_TOKEN_FILE_ENV]: path } as NodeJS.ProcessEnv)
    expect(got).toMatchObject({ token: 'from-file', source: 'file' })
    expect(got.warnings).toEqual([])
  })

  it('warns but still serves a token file others can read', async () => {
    const path = await tokenFile('from-file', 0o644)
    const got = resolveSpritesToken({ [SPRITES_TOKEN_FILE_ENV]: path } as NodeJS.ProcessEnv)
    // A working token is never rejected over a permission bit — but it is
    // never silent either.
    expect(got.token).toBe('from-file')
    expect(got.warnings.join(' ')).toMatch(/readable beyond its owner/)
  })

  it('treats an empty file as no token, and says so', async () => {
    const path = await tokenFile('   \n')
    const got = resolveSpritesToken({ [SPRITES_TOKEN_FILE_ENV]: path } as NodeJS.ProcessEnv)
    expect(got.token).toBeNull()
    expect(got.warnings.join(' ')).toMatch(/exists but is empty/)
  })

  it('defaults under WAYPOINT_HOME, and the refusal names every place looked', async () => {
    const env = { WAYPOINT_HOME: '/tmp/waypoint-x' } as NodeJS.ProcessEnv
    expect(defaultSpritesTokenFile(env)).toBe('/tmp/waypoint-x/secrets/sprites-token')
    const got = resolveSpritesToken(env)
    expect(got.token).toBeNull()
    const refusal = spritesTokenRefusal(got.searched)
    expect(refusal).toContain('$SPRITES_TOKEN')
    expect(refusal).toContain('/tmp/waypoint-x/secrets/sprites-token')
    expect(refusal).toMatch(/does not reach bridges spawned by launchd/)
  })
})
