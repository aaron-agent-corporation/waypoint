import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'
import { makeIo, PostgresTestProjects, silentIo } from '../testing/backend-harness'

const pgProjects = new PostgresTestProjects()

beforeAll(() => {
  pgProjects.setEnv()
})

afterAll(async () => {
  await pgProjects.cleanup()
})

const RECIPE = `schema_version: 1
slug: adhoc-echo
name: Adhoc Echo
prompt: Echo the payload.
`

async function initProjectWithRecipe(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-adhoc-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await mkdir(join(cwd, '.waypoint', 'recipes'), { recursive: true })
  await writeFile(join(cwd, '.waypoint', 'recipes', 'adhoc-echo.yaml'), RECIPE, 'utf8')
  return cwd
}

describe('waypoint adhoc command', () => {
  it('runs one catalog recipe as its own route, copied into a session overlay', async () => {
    const cwd = await initProjectWithRecipe()

    const { io, stdout, stderr } = makeIo(cwd)
    const code = await runWaypointCli(
      [
        'adhoc',
        '--recipe',
        'adhoc-echo',
        '--produces',
        'build/plan.json',
        '--contract',
        'referral-package-placement-plan',
        '--access',
        'build:rw',
        '--dry-run',
      ],
      io,
    )
    expect(stderr).toEqual([])
    expect(code).toBe(0)

    const output = stdout.join('\n')
    expect(output).toContain('Started ad-hoc run route-')
    expect(output).toContain('recipe: adhoc-echo')
    expect(output).toContain('dry run: route + tasks materialized, nothing dispatched')

    // The recipe was copied into the route's overlay; the live catalog copy is untouched.
    const overlay = output.match(/overlay: (.+)/)?.[1]
    expect(overlay).toBeDefined()
    expect(existsSync(join(overlay!, 'recipes', 'adhoc-echo.yaml'))).toBe(true)
  })

  it('fails loud when the recipe is not in the local catalog', async () => {
    const cwd = await initProjectWithRecipe()
    const { io, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['adhoc', '--recipe', 'no-such-recipe', '--dry-run'], io)).toBe(1)
    expect(stderr.join('\n')).toContain('Recipe not found in local catalog: no-such-recipe')
  })

  it('rejects malformed flags before touching the project', async () => {
    const cwd = await initProjectWithRecipe()

    const missing = makeIo(cwd)
    expect(await runWaypointCli(['adhoc'], missing.io)).toBe(1)
    expect(missing.stderr.join('\n')).toContain('requires --recipe')

    const badAccess = makeIo(cwd)
    expect(
      await runWaypointCli(['adhoc', '--recipe', 'adhoc-echo', '--access', 'build=rw', '--dry-run'], badAccess.io),
    ).toBe(1)
    expect(badAccess.stderr.join('\n')).toContain("--access must be '<binding>:ro|rw'")
  })
})
