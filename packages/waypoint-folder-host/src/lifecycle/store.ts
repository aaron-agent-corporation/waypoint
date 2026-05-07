import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

import { getWaypointProjectPaths } from '../project/root.ts'

import type {
  AddLifecycleMilestoneInput,
  AddLifecyclePhaseInput,
  AddLifecyclePlanInput,
  AddLifecycleWorkstreamInput,
  LifecycleMilestone,
  LifecyclePhase,
  LifecyclePlan,
  LifecycleState,
  LifecycleWorkstream,
} from './types.ts'

const LIFECYCLE_SCHEMA_VERSION = 1

type LifecycleCollectionName = 'workstreams' | 'milestones' | 'phases' | 'plans'

const COLLECTION_FILES: Record<LifecycleCollectionName, string> = {
  workstreams: 'workstreams.yaml',
  milestones: 'milestones.yaml',
  phases: 'phases.yaml',
  plans: 'plans.yaml',
}

export async function addLifecycleWorkstream(
  projectRoot: string,
  input: AddLifecycleWorkstreamInput,
): Promise<LifecycleWorkstream> {
  const state = await listLifecycleState(projectRoot)
  assertUnique(state.workstreams, input.key, 'Lifecycle workstream already exists')
  const timestamp = timestampFor(input.now)
  const record: LifecycleWorkstream = {
    id: nextId('workstream', state.workstreams.length),
    key: input.key,
    name: input.name,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeCollection(projectRoot, 'workstreams', [...state.workstreams, record])
  return record
}

export async function addLifecycleMilestone(
  projectRoot: string,
  input: AddLifecycleMilestoneInput,
): Promise<LifecycleMilestone> {
  const state = await listLifecycleState(projectRoot)
  if (!state.workstreams.some((entry) => entry.key === input.workstream)) {
    throw new Error(`Lifecycle workstream does not exist: ${input.workstream}`)
  }
  assertUnique(state.milestones, input.key, 'Lifecycle milestone already exists')
  const timestamp = timestampFor(input.now)
  const record: LifecycleMilestone = {
    id: nextId('milestone', state.milestones.length),
    workstream: input.workstream,
    key: input.key,
    title: input.title,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeCollection(projectRoot, 'milestones', [...state.milestones, record])
  return record
}

export async function addLifecyclePhase(projectRoot: string, input: AddLifecyclePhaseInput): Promise<LifecyclePhase> {
  const state = await listLifecycleState(projectRoot)
  if (!state.milestones.some((entry) => entry.key === input.milestone)) {
    throw new Error(`Lifecycle milestone does not exist: ${input.milestone}`)
  }
  assertUnique(state.phases, input.key, 'Lifecycle phase already exists')
  const timestamp = timestampFor(input.now)
  const record: LifecyclePhase = {
    id: nextId('phase', state.phases.length),
    milestone: input.milestone,
    key: input.key,
    lifecycle: input.lifecycle,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeCollection(projectRoot, 'phases', [...state.phases, record])
  return record
}

export async function addLifecyclePlan(projectRoot: string, input: AddLifecyclePlanInput): Promise<LifecyclePlan> {
  const state = await listLifecycleState(projectRoot)
  if (!state.phases.some((entry) => entry.key === input.phase)) {
    throw new Error(`Lifecycle phase does not exist: ${input.phase}`)
  }
  if (state.plans.some((entry) => entry.ref === input.ref)) {
    throw new Error(`Lifecycle plan already exists: ${input.ref}`)
  }
  const timestamp = timestampFor(input.now)
  const record: LifecyclePlan = {
    id: nextId('plan', state.plans.length),
    phase: input.phase,
    ref: input.ref,
    title: input.title,
    status: 'pending',
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeCollection(projectRoot, 'plans', [...state.plans, record])
  return record
}

export async function listLifecycleState(projectRoot: string): Promise<LifecycleState> {
  const [workstreams, milestones, phases, plans] = await Promise.all([
    readCollection<LifecycleWorkstream>(projectRoot, 'workstreams'),
    readCollection<LifecycleMilestone>(projectRoot, 'milestones'),
    readCollection<LifecyclePhase>(projectRoot, 'phases'),
    readCollection<LifecyclePlan>(projectRoot, 'plans'),
  ])

  return { workstreams, milestones, phases, plans }
}

async function readCollection<T>(projectRoot: string, collectionName: LifecycleCollectionName): Promise<T[]> {
  const filePath = lifecycleFilePath(projectRoot, collectionName)
  try {
    const parsed = yamlParse(await readFile(filePath, 'utf8')) as Record<string, unknown> | null
    const collection = parsed?.[collectionName]
    return Array.isArray(collection) ? (collection as T[]) : []
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
}

async function writeCollection<T>(
  projectRoot: string,
  collectionName: LifecycleCollectionName,
  records: readonly T[],
): Promise<void> {
  const lifecycleDir = lifecycleDirectory(projectRoot)
  await mkdir(lifecycleDir, { recursive: true })
  await writeFile(
    join(lifecycleDir, COLLECTION_FILES[collectionName]),
    yamlStringify({ schema_version: LIFECYCLE_SCHEMA_VERSION, [collectionName]: records }),
    'utf8',
  )
}

function lifecycleDirectory(projectRoot: string): string {
  return join(getWaypointProjectPaths(projectRoot).waypointDir, 'lifecycle')
}

function lifecycleFilePath(projectRoot: string, collectionName: LifecycleCollectionName): string {
  return join(lifecycleDirectory(projectRoot), COLLECTION_FILES[collectionName])
}

function assertUnique<T extends { readonly key: string }>(records: readonly T[], key: string, message: string): void {
  if (records.some((entry) => entry.key === key)) {
    throw new Error(`${message}: ${key}`)
  }
}

function nextId(prefix: string, existingCount: number): string {
  return `${prefix}-${String(existingCount + 1).padStart(3, '0')}`
}

function timestampFor(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
