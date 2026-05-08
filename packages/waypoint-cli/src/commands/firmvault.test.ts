import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin.ts'

async function tempProjectRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'waypoint-cli-firmvault-'))
}

function captureIo(cwd: string) {
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

describe('waypoint firmvault commands', () => {
  it('initializes FirmVault case state from the CLI', async () => {
    const root = await tempProjectRoot()
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli([
      'firmvault',
      'init-case',
      '--case-type',
      'personal-injury',
      '--case-slug',
      'smith-v-acme',
    ], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toContain('Waypoint FirmVault case state initialized')
    expect(stdout).toContain('case_slug: smith-v-acme')
    expect(stdout).toContain('landmarks satisfied: 0/82')
    expect(existsSync(join(root, '.waypoint', 'firmvault', 'case.yaml'))).toBe(true)
    expect(existsSync(join(root, '.waypoint', 'firmvault', 'events.jsonl'))).toBe(true)
  })

  it('prints FirmVault landmark projection as JSON', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'landmarks', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.landmarks.full_intake_complete.satisfied).toBe(false)
    expect(Object.keys(body.landmarks)).toHaveLength(82)
    expect(body.landmarks.at_fault_insurance_identified.satisfied).toBe(false)
  })

  it('rejects unknown FirmVault commands', async () => {
    const root = await tempProjectRoot()
    const { io, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'unknown'], io)

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Usage: waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]')
  })
})
