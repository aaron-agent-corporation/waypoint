import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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

  it('bootstraps and starts a new FirmVault case folder from the CLI', async () => {
    const casesRoot = await tempProjectRoot()
    const { io, stdout, stderr } = captureIo(casesRoot)

    const exitCode = await runWaypointCli([
      'firmvault',
      'bootstrap',
      '--cases-root',
      casesRoot,
      '--case-name',
      'Taylor Client v. Delivery Co',
      '--case-type',
      'personal-injury',
      '--start',
    ], io)

    const caseRoot = join(casesRoot, 'taylor-client-v-delivery-co')
    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toContain('Waypoint FirmVault case bootstrapped')
    expect(stdout).toContain(`case_root: ${caseRoot}`)
    expect(stdout).toContain('case_slug: taylor-client-v-delivery-co')
    expect(stdout).toContain('quest: firmvault')
    expect(stdout).toContain('route_id: route-001')
    expect(existsSync(join(caseRoot, 'taylor-client-v-delivery-co.md'))).toBe(true)
    expect(existsSync(join(caseRoot, '.waypoint', 'config.yaml'))).toBe(true)
    expect(existsSync(join(caseRoot, '.waypoint', 'quests', 'firmvault.yaml'))).toBe(true)
    expect(existsSync(join(caseRoot, '.waypoint', 'firmvault', 'case.yaml'))).toBe(true)
    expect(existsSync(join(caseRoot, '.waypoint', 'routes', 'route-001.yaml'))).toBe(true)
    expect(existsSync(join(caseRoot, '.waypoint', 'tasks', 'tasks.yaml'))).toBe(true)
  })

  it('prints bootstrap output as JSON when requested', async () => {
    const casesRoot = await tempProjectRoot()
    const { io, stdout, stderr } = captureIo(casesRoot)

    const exitCode = await runWaypointCli([
      'firmvault',
      'bootstrap',
      '--cases-root',
      casesRoot,
      '--case-name',
      'Json Client',
      '--case-type',
      'personal-injury',
      '--json',
    ], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.case_slug).toBe('json-client')
    expect(body.case_root).toBe(join(casesRoot, 'json-client'))
    expect(body.quest).toBe('firmvault')
    expect(body.route_id).toBeNull()
    expect(body.landmarks.total).toBe(82)
  })

  it('adds a local document to a FirmVault case from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const source = join(root, '..', 'client-upload.pdf')
    await writeFile(source, 'fake document')
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli([
      'firmvault',
      'add-document',
      '--source',
      source,
      '--kind',
      'police-report',
      '--note',
      'uploaded by client',
      '--json',
    ], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.document_id).toBe('document-001')
    expect(body.kind).toBe('police_report')
    expect(body.path).toBe('documents/inbox/client-upload.pdf')
    expect(existsSync(join(root, 'documents', 'inbox', 'client-upload.pdf'))).toBe(true)
    await expect(readFile(join(root, '.waypoint', 'firmvault', 'documents.yaml'), 'utf8')).resolves.toContain('document-001')
  })

  it('rejects unknown FirmVault commands', async () => {
    const root = await tempProjectRoot()
    const { io, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'unknown'], io)

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Usage: waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]')
  })
})
