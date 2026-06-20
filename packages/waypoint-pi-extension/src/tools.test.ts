import { describe, expect, it } from 'vitest'

import { AGENT_TOOL_GRANT } from '@waypoint/engine-host'

import { buildWaypointTools, WAYPOINT_TOOL_SPECS } from './tools.ts'
import type { HostClient } from './host-client.ts'
import { HostCommandError } from './host-client.ts'

function fakeClient(impl?: (name: string, payload?: unknown) => Promise<Record<string, unknown>>): {
  client: HostClient
  calls: { name: string; payload?: unknown }[]
} {
  const calls: { name: string; payload?: unknown }[] = []
  return {
    calls,
    client: {
      async command(name, payload) {
        calls.push({ name, payload })
        return impl ? impl(name, payload) : { ok: true }
      },
    },
  }
}

describe('Waypoint tool specs', () => {
  it('the tool command set exactly equals the host AGENT_TOOL_GRANT', () => {
    const commands = WAYPOINT_TOOL_SPECS.map((spec) => spec.command).sort()
    expect(commands).toEqual([...AGENT_TOOL_GRANT].sort())
  })

  it('excludes approveProposal and workspace.open', () => {
    const commands = WAYPOINT_TOOL_SPECS.map((spec) => spec.command)
    expect(commands).not.toContain('author.approveProposal')
    expect(commands).not.toContain('workspace.open')
  })

  it('uses snake_case names and never the agent.* namespace', () => {
    for (const spec of WAYPOINT_TOOL_SPECS) {
      expect(spec.name).toMatch(/^waypoint_[a-z_]+$/)
      expect(spec.command.startsWith('agent.')).toBe(false)
    }
  })
})

describe('buildWaypointTools', () => {
  it('routes a tool call to its engine command and serializes the result', async () => {
    const { client, calls } = fakeClient(async () => ({ ok: true, route: { id: 'route-001' } }))
    const tools = buildWaypointTools(client)
    const runAdhoc = tools.find((t) => t.name === 'waypoint_run_adhoc')!

    const result = await runAdhoc.execute({ questYaml: 'schema_version: 1', dryRun: true })

    expect(calls[0]).toEqual({ name: 'run.adhoc', payload: { questYaml: 'schema_version: 1', dryRun: true } })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, route: { id: 'route-001' } })
  })

  it('surfaces a HostCommandError as an isError tool result', async () => {
    const { client } = fakeClient(async () => {
      throw new HostCommandError('Tool not permitted', { code: 'FORBIDDEN', status: 403 })
    })
    const tools = buildWaypointTools(client)
    const result = await tools[0].execute({})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('FORBIDDEN')
  })
})
