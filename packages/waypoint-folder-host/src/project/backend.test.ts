import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_POSTGRES_URL,
  deriveProjectSchemaName,
  isDurablePostgresRouteBackend,
  resolvePostgresBackend,
} from './backend'
import { createWaypointProjectConfig, serializeWaypointProjectConfig } from './config'
import { initWaypointProject } from './init'

async function tempProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'runner-backend-'))
}

describe('isDurablePostgresRouteBackend', () => {
  it('is true for a postgres backend with postgres.durable: true', async () => {
    const projectRoot = await tempProjectRoot()
    await initWaypointProject(projectRoot, {
      quest: 'runner',
      backend: 'postgres',
      postgres: { url: 'postgresql://localhost:5433/postgres', durable: true },
    })

    expect(await isDurablePostgresRouteBackend(projectRoot)).toBe(true)
  })

  it('is false for a postgres backend that opts out of the durable engine', async () => {
    const projectRoot = await tempProjectRoot()
    await initWaypointProject(projectRoot, {
      quest: 'runner',
      backend: 'postgres',
      postgres: { url: 'postgresql://localhost:5433/postgres', durable: false },
    })

    expect(await isDurablePostgresRouteBackend(projectRoot)).toBe(false)
  })

  it('is false for a directory with no config at all', async () => {
    const bareDir = await tempProjectRoot()
    expect(await isDurablePostgresRouteBackend(bareDir)).toBe(false)
  })
})

describe('resolvePostgresBackend defaults (P5/F1)', () => {
  it('falls back to the Console-managed instance URL when neither env nor config names one', async () => {
    const projectRoot = await tempProjectRoot()
    await initWaypointProject(projectRoot, { quest: 'runner', backend: 'postgres' })

    const previous = process.env.WAYPOINT_POSTGRES_URL
    delete process.env.WAYPOINT_POSTGRES_URL
    try {
      const resolved = await resolvePostgresBackend(projectRoot)
      expect(resolved.url).toBe(DEFAULT_POSTGRES_URL)
    } finally {
      if (previous !== undefined) process.env.WAYPOINT_POSTGRES_URL = previous
    }
  })

  it("resolves a project that names no schema to its derived schema, never a shared 'waypoint' default", async () => {
    const previousSchema = process.env.WAYPOINT_POSTGRES_SCHEMA
    delete process.env.WAYPOINT_POSTGRES_SCHEMA
    try {
      // A config that predates the schema-per-project init (no postgres.schema).
      const projectRoot = await tempProjectRoot()
      await mkdir(join(projectRoot, '.waypoint'), { recursive: true })
      await writeFile(
        join(projectRoot, '.waypoint/config.yaml'),
        serializeWaypointProjectConfig(createWaypointProjectConfig({ quest: 'runner' })),
        'utf8',
      )
      const resolved = await resolvePostgresBackend(projectRoot)
      expect(resolved.schema).toBe(deriveProjectSchemaName(projectRoot))
      expect(resolved.schema).not.toBe('waypoint')
    } finally {
      if (previousSchema !== undefined) process.env.WAYPOINT_POSTGRES_SCHEMA = previousSchema
    }
  })

  // Item 25: this used to resolve to a path-derived schema, so a mistyped
  // `cd` + any route/task read minted a permanent schema (530 → 694 during
  // the audit). An unconfigured directory now refuses instead.
  it('refuses a directory with no .waypoint/config.yaml unless the env names a schema', async () => {
    const previousSchema = process.env.WAYPOINT_POSTGRES_SCHEMA
    delete process.env.WAYPOINT_POSTGRES_SCHEMA
    try {
      const bareDir = await tempProjectRoot()
      await expect(resolvePostgresBackend(bareDir)).rejects.toThrow(/Not a Waypoint project/)

      // An explicit env schema is an intentional resolution (test harnesses,
      // operator overrides) — no path-derived schema is minted.
      process.env.WAYPOINT_POSTGRES_SCHEMA = 'item25_explicit_env'
      const resolved = await resolvePostgresBackend(bareDir)
      expect(resolved.schema).toBe('item25_explicit_env')
    } finally {
      if (previousSchema === undefined) delete process.env.WAYPOINT_POSTGRES_SCHEMA
      else process.env.WAYPOINT_POSTGRES_SCHEMA = previousSchema
    }
  })
})

describe('deriveProjectSchemaName (endstate Q1, schema-per-project)', () => {
  it('is deterministic for a path, distinct across same-named folders, and always a valid schema name', async () => {
    const first = await tempProjectRoot()
    const second = await tempProjectRoot()
    const sameNameA = join(first, 'smith-v-acme')
    const sameNameB = join(second, 'smith-v-acme')

    expect(deriveProjectSchemaName(sameNameA)).toBe(deriveProjectSchemaName(sameNameA))
    expect(deriveProjectSchemaName(sameNameA)).not.toBe(deriveProjectSchemaName(sameNameB))
    for (const candidate of [sameNameA, sameNameB, join(first, '00-Weird  Name!'), join(first, '日本語')]) {
      expect(deriveProjectSchemaName(candidate)).toMatch(/^[a-z_][a-z0-9_]{0,62}$/)
    }
  })

  it('is recorded in config by a postgres init that names no schema', async () => {
    const projectRoot = await tempProjectRoot()
    const result = await initWaypointProject(projectRoot, { quest: 'runner', backend: 'postgres' })
    expect(result.config.backend.postgres?.schema).toBe(deriveProjectSchemaName(projectRoot))

    // An explicit schema wins.
    const explicitRoot = await tempProjectRoot()
    const explicit = await initWaypointProject(explicitRoot, {
      quest: 'runner',
      backend: 'postgres',
      postgres: { schema: 'waypoint_named' },
    })
    expect(explicit.config.backend.postgres?.schema).toBe('waypoint_named')
  })
})
