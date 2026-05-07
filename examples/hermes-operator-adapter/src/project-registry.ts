import { isAbsolute, resolve } from 'node:path'

import { parse as yamlParse } from 'yaml'

export interface HermesProjectRecord {
  readonly name: string
  readonly path: string
  readonly waypointCli: string
}

export interface HermesProjectRegistry {
  readonly projects: Readonly<Record<string, HermesProjectRecord>>
}

export function parseHermesProjectRegistry(source: string): HermesProjectRegistry {
  const parsed = yamlParse(source) as unknown
  const root = asRecord(parsed, 'Hermes project registry must be a YAML object')
  const projects = asRecord(root.projects, 'Hermes project registry must define projects')
  const records: Record<string, HermesProjectRecord> = {}

  for (const [name, rawProject] of Object.entries(projects)) {
    assertSafeProjectName(name)
    const project = asRecord(rawProject, `Hermes project ${name} must be a YAML object`)
    const path = stringField(project, 'path', `Hermes project ${name} path is required`)
    if (!isAbsolute(path)) throw new Error(`Hermes project ${name} path must be absolute`)

    const rawWaypointCli = typeof project.waypoint_cli === 'string' ? project.waypoint_cli : null
    if (rawWaypointCli !== null && !isAbsolute(rawWaypointCli)) {
      throw new Error(`Hermes project ${name} waypoint_cli must be absolute`)
    }

    records[name] = {
      name,
      path,
      waypointCli: rawWaypointCli ?? resolve(path, 'packages/waypoint-cli/src/bin.ts'),
    }
  }

  return { projects: records }
}

export function resolveHermesProject(registry: HermesProjectRegistry, name: string): HermesProjectRecord {
  const project = registry.projects[name]
  if (!project) throw new Error(`Unknown Hermes Waypoint project: ${name}`)
  return project
}

function assertSafeProjectName(name: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error(`Invalid Hermes project name: ${name}`)
}

function stringField(record: Record<string, unknown>, field: string, error: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(error)
  return value
}

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(error)
  return value as Record<string, unknown>
}
