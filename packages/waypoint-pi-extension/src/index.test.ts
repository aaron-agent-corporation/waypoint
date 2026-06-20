import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import activateWaypointExtension from './index.ts'
import { WAYPOINT_TOOL_SPECS } from './tools.ts'

interface RegisteredTool {
  name: string
  label: string
  description: string
  parameters: unknown
  execute: (...args: unknown[]) => unknown
}

function fakePi(): { registerTool: (tool: RegisteredTool) => void; registered: RegisteredTool[] } {
  const registered: RegisteredTool[] = []
  return { registered, registerTool: (tool) => registered.push(tool) }
}

const ORIGINAL = { url: process.env.WAYPOINT_HOST_URL, token: process.env.WAYPOINT_HOST_TOKEN }

beforeEach(() => {
  process.env.WAYPOINT_HOST_URL = 'http://127.0.0.1:9999/'
  process.env.WAYPOINT_HOST_TOKEN = 'scoped-test'
})

afterEach(() => {
  if (ORIGINAL.url === undefined) delete process.env.WAYPOINT_HOST_URL
  else process.env.WAYPOINT_HOST_URL = ORIGINAL.url
  if (ORIGINAL.token === undefined) delete process.env.WAYPOINT_HOST_TOKEN
  else process.env.WAYPOINT_HOST_TOKEN = ORIGINAL.token
})

describe('activateWaypointExtension', () => {
  it('registers every granted tool with its name, schema, and a callable handler', () => {
    const pi = fakePi()
    activateWaypointExtension(pi as never)

    expect(pi.registered.map((t) => t.name).sort()).toEqual(WAYPOINT_TOOL_SPECS.map((s) => s.name).sort())
    for (const tool of pi.registered) {
      const spec = WAYPOINT_TOOL_SPECS.find((s) => s.name === tool.name)!
      expect(tool.parameters).toBe(spec.parameters)
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('fails loud when the callback credentials are missing', () => {
    delete process.env.WAYPOINT_HOST_TOKEN
    expect(() => activateWaypointExtension(fakePi() as never)).toThrow(/WAYPOINT_HOST_TOKEN/)
  })
})
