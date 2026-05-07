#!/usr/bin/env node
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const projectRoot = await mkdtemp(join(tmpdir(), 'waypoint-folder-host-smoke-'))

function run(args) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
  if (!output.endsWith('\n')) process.stdout.write('\n')
  return output
}

function requireFile(relativePath) {
  const path = join(projectRoot, relativePath)
  if (!existsSync(path)) throw new Error(`Expected smoke artifact missing: ${relativePath}`)
  return path
}

try {
  run(['init', '--quest', 'waypoint'])
  run(['status'])
  run(['quests'])
  run(['recipes', '--quest', 'waypoint'])
  run(['start', '--quest', 'waypoint'])
  run(['routes'])
  run(['route', '--route-id', 'route-001'])
  run(['tasks', '--route-id', 'route-001'])
  run(['discuss', '--task-id', 'task-003', '--message', 'Smoke discussion from folder-host closeout'])
  run(['auto', '--route-id', 'route-001', '--max-iterations', '10'])
  run(['gate', '--route-id', 'route-001', '--node', 'plan-approval-gate', '--approve', '--note', 'Smoke gate approved', '--next-node', 'execute'])
  run(['auto', 'status'])
  run(['route-events', '--route-id', 'route-001', '--limit', '20'])

  const requiredArtifacts = [
    '.waypoint/config.yaml',
    '.waypoint/quests/waypoint.yaml',
    '.waypoint/lifecycle/workstreams.yaml',
    '.waypoint/routes/route-001.yaml',
    '.waypoint/events/route-001.jsonl',
    '.waypoint/tasks/tasks.yaml',
    '.waypoint/tasks/task-003-discussion.jsonl',
    '.waypoint/autopilot/runs.jsonl',
  ]

  for (const artifact of requiredArtifacts) {
    const path = requireFile(artifact)
    const info = await stat(path)
    if (info.size <= 0) throw new Error(`Expected smoke artifact to be non-empty: ${artifact}`)
  }

  process.stdout.write(`Smoke project: ${projectRoot}\n`)
  process.stdout.write('Waypoint folder-host smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(projectRoot, { recursive: true, force: true })
  }
}
