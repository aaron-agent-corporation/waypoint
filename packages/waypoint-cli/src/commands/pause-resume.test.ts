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

async function startedProject(): Promise<string> {
  const cwd = await pgProjects.mkProjectRoot('waypoint-cli-pause-')
  await runWaypointCli(['init', '--quest', 'runner', '--postgres-no-durable', '--simulated'], silentIo(cwd))
  await runWaypointCli(['start', '--quest', 'runner'], silentIo(cwd))
  return cwd
}

describe('waypoint pause/resume commands', () => {
  it('pauses and resumes a route', async () => {
    const cwd = await startedProject()
    const pause = makeIo(cwd)

    expect(await runWaypointCli(['pause', '--route-id', 'route-001', '--reason', 'Waiting on review'], pause.io)).toBe(0)
    expect(pause.stderr).toEqual([])
    expect(pause.stdout.join('\n')).toContain('Paused run route-001')
    expect(pause.stdout.join('\n')).toContain('status: blocked')

    const resume = makeIo(cwd)
    expect(await runWaypointCli(['resume', '--route-id', 'route-001'], resume.io)).toBe(0)
    expect(resume.stderr).toEqual([])
    expect(resume.stdout.join('\n')).toContain('Resumed run route-001')
    expect(resume.stdout.join('\n')).toContain('status: active')

    const events = makeIo(cwd)
    expect(await runWaypointCli(['route-events', '--route-id', 'route-001'], events.io)).toBe(0)
    expect(events.stdout.join('\n')).toContain('event-002 route.paused')
    expect(events.stdout.join('\n')).toContain('event-003 route.resumed')
  })
})
