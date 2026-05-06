export type WaypointCommandName =
  | 'status'
  | 'start'
  | 'auto'
  | 'auto_status'
  | 'discuss'
  | 'doctor'
  | 'forensics'
  | 'routes'
  | 'route'
  | 'pause'
  | 'resume'
  | 'route_events'
  | 'gate'
  | 'help'

export type WaypointParsedCommand =
  | { name: 'status' }
  | {
      name: 'start'
      target: 'plan'
      planId: number
      definitionSlug: string
      definitionVersion: number
    }
  | { name: 'auto'; maxIterations?: number }
  | { name: 'auto_status'; limit?: number; offset?: number }
  | { name: 'discuss'; taskId: number; message?: string }
  | { name: 'doctor'; definitionSlug: string; definitionVersion: number }
  | { name: 'forensics'; definitionSlug: string; definitionVersion: number }
  | {
      name: 'routes'
      status?: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
      limit?: number
      offset?: number
    }
  | { name: 'route'; routeId: number }
  | { name: 'pause'; routeId: number }
  | { name: 'resume'; routeId: number }
  | { name: 'route_events'; routeId: number; limit?: number; offset?: number }
  | { name: 'gate'; routeId: number; nodeKey: string; decision: 'approve' | 'reject'; note?: string }
  | { name: 'help' }

function asPositiveInt(value: string | undefined): number | null {
  if (!value) return null
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function asNonNegativeInt(value: string | undefined): number | null {
  if (value == null) return null
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function stripPrefix(tokens: string[]): string[] {
  if (tokens.length === 0) return tokens
  const first = tokens[0].toLowerCase()
  if (first === '/waypoint' || first === 'waypoint' || first === '/wp' || first === 'wp') {
    return tokens.slice(1)
  }
  return tokens
}

export function parseWaypointCommand(rawCommand: string): WaypointParsedCommand {
  const tokens = stripPrefix(tokenize(rawCommand))
  if (tokens.length === 0) return { name: 'help' }

  const head = tokens[0].toLowerCase()
  if (head === 'status') return { name: 'status' }
  if (head === 'help') return { name: 'help' }

  if (head === 'auto') {
    const statusAlias = (tokens[1] || '').toLowerCase()
    if (statusAlias === 'status') {
      const limitFlagIdx = tokens.findIndex((t) => t === '--limit')
      const offsetFlagIdx = tokens.findIndex((t) => t === '--offset')
      const parsed: { name: 'auto_status'; limit?: number; offset?: number } = { name: 'auto_status' }
      if (limitFlagIdx >= 0) {
        const limit = asPositiveInt(tokens[limitFlagIdx + 1])
        if (limit == null) throw new Error('Invalid --limit value')
        parsed.limit = Math.min(limit, 200)
      }
      if (offsetFlagIdx >= 0) {
        const offset = asNonNegativeInt(tokens[offsetFlagIdx + 1])
        if (offset == null) throw new Error('Invalid --offset value')
        parsed.offset = offset
      }
      return parsed
    }

    const idx = tokens.findIndex((t) => t === '--max-iterations')
    if (idx >= 0) {
      const parsed = asPositiveInt(tokens[idx + 1])
      if (parsed == null) throw new Error('Invalid --max-iterations value')
      return { name: 'auto', maxIterations: parsed }
    }
    return { name: 'auto' }
  }

  if (head === 'discuss') {
    const taskFlagIdx = tokens.findIndex((t) => t === '--task-id')
    const taskId = asPositiveInt(tokens[taskFlagIdx + 1])
    if (taskFlagIdx < 0 || taskId == null) throw new Error('Missing or invalid --task-id')

    const messageFlagIdx = tokens.findIndex((t) => t === '--message')
    if (messageFlagIdx >= 0) {
      const message = tokens.slice(messageFlagIdx + 1).join(' ').trim()
      if (!message) throw new Error('Invalid --message value')
      return { name: 'discuss', taskId, message }
    }

    return { name: 'discuss', taskId }
  }

  if (head === 'route') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id' || t === '--id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    return { name: 'route', routeId }
  }

  if (head === 'route-events' || head === 'events') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id' || t === '--id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')

    const limitFlagIdx = tokens.findIndex((t) => t === '--limit')
    const offsetFlagIdx = tokens.findIndex((t) => t === '--offset')
    const parsed: { name: 'route_events'; routeId: number; limit?: number; offset?: number } = {
      name: 'route_events',
      routeId,
    }

    if (limitFlagIdx >= 0) {
      const limit = asPositiveInt(tokens[limitFlagIdx + 1])
      if (limit == null) throw new Error('Invalid --limit value')
      parsed.limit = Math.min(limit, 500)
    }

    if (offsetFlagIdx >= 0) {
      const offset = asNonNegativeInt(tokens[offsetFlagIdx + 1])
      if (offset == null) throw new Error('Invalid --offset value')
      parsed.offset = offset
    }

    return parsed
  }

  if (head === 'routes') {
    const statusFlagIdx = tokens.findIndex((t) => t === '--status')
    const limitFlagIdx = tokens.findIndex((t) => t === '--limit')
    const offsetFlagIdx = tokens.findIndex((t) => t === '--offset')

    const parsed: {
      name: 'routes'
      status?: 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
      limit?: number
      offset?: number
    } = { name: 'routes' }

    if (statusFlagIdx >= 0) {
      const status = (tokens[statusFlagIdx + 1] || '').toLowerCase()
      if (!['active', 'blocked', 'complete', 'cancelled', 'failed'].includes(status)) {
        throw new Error('Invalid --status value')
      }
      parsed.status = status as 'active' | 'blocked' | 'complete' | 'cancelled' | 'failed'
    }

    if (limitFlagIdx >= 0) {
      const limit = asPositiveInt(tokens[limitFlagIdx + 1])
      if (limit == null) throw new Error('Invalid --limit value')
      parsed.limit = Math.min(limit, 200)
    }

    if (offsetFlagIdx >= 0) {
      const offset = asNonNegativeInt(tokens[offsetFlagIdx + 1])
      if (offset == null) throw new Error('Invalid --offset value')
      parsed.offset = offset
    }

    return parsed
  }

  if (head === 'pause') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id' || t === '--id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    return { name: 'pause', routeId }
  }

  if (head === 'resume') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id' || t === '--id')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    return { name: 'resume', routeId }
  }

  if (head === 'gate') {
    const routeFlagIdx = tokens.findIndex((t) => t === '--route-id' || t === '--id')
    const nodeFlagIdx = tokens.findIndex((t) => t === '--node')
    const approve = tokens.includes('--approve')
    const reject = tokens.includes('--reject')
    const noteFlagIdx = tokens.findIndex((t) => t === '--note')
    const routeId = asPositiveInt(tokens[routeFlagIdx + 1])
    const nodeKey = tokens[nodeFlagIdx + 1]
    if (routeFlagIdx < 0 || routeId == null) throw new Error('Missing or invalid --route-id')
    if (nodeFlagIdx < 0 || !nodeKey) throw new Error('Missing or invalid --node')
    if ((approve && reject) || (!approve && !reject)) throw new Error('Specify exactly one of --approve or --reject')
    const note = noteFlagIdx >= 0 ? tokens.slice(noteFlagIdx + 1).join(' ').trim() : undefined
    return { name: 'gate', routeId, nodeKey, decision: approve ? 'approve' : 'reject', ...(note ? { note } : {}) }
  }

  if (head === 'doctor') {
    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-doctor'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return { name: 'doctor', definitionSlug, definitionVersion }
  }

  if (head === 'forensics') {
    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-forensics'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return { name: 'forensics', definitionSlug, definitionVersion }
  }

  if (head === 'start' || head === 'execute') {
    if (head === 'start') {
      const target = (tokens[1] || '').toLowerCase()
      if (target !== 'plan') throw new Error('Only `start plan` is currently supported')
    }

    const planFlagIdx = tokens.findIndex((t) => t === '--plan-id' || t === '--id')
    const planId = asPositiveInt(tokens[planFlagIdx + 1])
    if (planFlagIdx < 0 || planId == null) throw new Error('Missing or invalid --plan-id')

    const defFlagIdx = tokens.findIndex((t) => t === '--definition')
    const definitionSlug = defFlagIdx >= 0 ? tokens[defFlagIdx + 1] : 'waypoint-plan-execution'
    if (!definitionSlug) throw new Error('Invalid --definition value')

    const versionFlagIdx = tokens.findIndex((t) => t === '--version')
    const definitionVersion = versionFlagIdx >= 0 ? asPositiveInt(tokens[versionFlagIdx + 1]) : 1
    if (definitionVersion == null) throw new Error('Invalid --version value')

    return {
      name: 'start',
      target: 'plan',
      planId,
      definitionSlug,
      definitionVersion,
    }
  }

  throw new Error(`Unknown Waypoint command: ${head}`)
}
