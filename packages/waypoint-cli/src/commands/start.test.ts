import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as yamlParse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

async function tempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-start-'))
}

function makeIo(cwd: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('waypoint start command', () => {
  it('starts the selected Quest in an initialized folder', async () => {
    const cwd = await tempProject()
    await runWaypointCli(['init', '--quest', 'gsd'], { cwd, stdout: () => undefined, stderr: () => undefined })

    const { io, stdout, stderr } = makeIo(cwd)
    expect(await runWaypointCli(['start', '--quest', 'gsd'], io)).toBe(0)
    expect(stderr).toEqual([])
    const output = stdout.join('\n')
    expect(output).toContain('Started Waypoint route route-001')
    expect(output).toContain('quest: gsd')
    expect(output).toContain('current node: initialize')
    expect(output).toContain('scaffolded lifecycle: 1 workstream, 1 milestone, 6 phases, 12 plans')

    const routeYaml = yamlParse(await readFile(join(cwd, '.waypoint/routes/route-001.yaml'), 'utf8')) as {
      route: Record<string, unknown>
    }
    expect(routeYaml.route).toMatchObject({ id: 'route-001', quest: 'gsd', current_node: 'initialize' })

    const eventLines = (await readFile(join(cwd, '.waypoint/events/route-001.jsonl'), 'utf8')).trim().split('\n')
    expect(eventLines).toHaveLength(1)
    expect(JSON.parse(eventLines[0])).toMatchObject({ kind: 'route.started', route_id: 'route-001' })
  })
})
