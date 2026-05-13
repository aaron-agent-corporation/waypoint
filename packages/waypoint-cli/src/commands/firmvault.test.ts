import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parse as yamlParse } from 'yaml'

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

  it('records document-pipeline handoff metadata from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const source = join(root, '..', 'daily-mail.pdf')
    await writeFile(source, 'fake document')
    const add = captureIo(root)
    await runWaypointCli(['firmvault', 'add-document', '--source', source, '--kind', 'unknown'], add.io)
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli([
      'firmvault',
      'document-handoff',
      '--document-id',
      'document-001',
      '--status',
      'pr-opened',
      '--pr-number',
      '123',
      '--pr-url',
      'http://localhost:3001/aaron/FirmVault/pulls/123',
      '--branch',
      'ingest/2026-05-08-deadbeef',
      '--submitted-at',
      '2026-05-08T12:00:00.000Z',
      '--json',
    ], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.document_id).toBe('document-001')
    expect(body.handoff).toEqual({
      system: 'firmvault-document-pipeline',
      status: 'pr_opened',
      pr_number: 123,
      pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
      submitted_at: '2026-05-08T12:00:00.000Z',
    })
    const documentsYaml = yamlParse(await readFile(join(root, '.waypoint', 'firmvault', 'documents.yaml'), 'utf8'))
    expect(documentsYaml.documents[0].handoff).toEqual(body.handoff)
  })

  it('prints full FirmVault explicit state from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'state', 'show', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.schema_version).toBe(1)
    expect(body.section).toBeNull()
    expect(body.state.case.case.slug).toBe('smith-v-acme')
    expect(body.state.demand.demand.send.status).toBe('not_sent')
    expect(body.landmarks).toEqual({ satisfied: 0, total: 82 })
    expect(body.warnings).toEqual([])
  })

  it('prints a single FirmVault state section from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'state', 'show', '--section', 'demand', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.section).toBe('demand')
    expect(body.state.demand.send.status).toBe('not_sent')
    expect(body.state.case).toBeUndefined()
    expect(body.landmarks).toEqual({ satisfied: 0, total: 82 })
  })

  it('prints FirmVault next-action guidance from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'guidance', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.schema_version).toBe(1)
    expect(body.mutates_state).toBe(false)
    expect(body.stage).toBe('intake_not_started')
    expect(body.landmarks).toEqual({ satisfied: 0, total: 82 })
    expect(body.next_actions.required.map((action: any) => action.fact).slice(0, 4)).toEqual([
      'case.setup',
      'client.intake',
      'client.contracts.fee_agreement',
      'client.authorizations.hipaa',
    ])
    expect(body.next_actions.required[0].command_hint).toContain('waypoint firmvault state set --fact case.setup')
  })

  it('previews existing FirmVault case adoption from the CLI', async () => {
    const root = await tempProjectRoot()
    await writeFile(join(root, 'Dashboard.md'), '# Legacy Case\n')
    await mkdir(join(root, 'documents', 'police-reports'), { recursive: true })
    await writeFile(join(root, 'documents', 'police-reports', 'report.md'), '---\ndocument_category: police-reports\n---\n')
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'adopt', 'preview', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.schema_version).toBe(1)
    expect(body.mutates_state).toBe(false)
    expect(body.case_slug).toMatch(/^waypoint-cli-firmvault-/)
    expect(body.proposed_facts.map((proposal: any) => proposal.fact)).toEqual(expect.arrayContaining([
      'case.setup',
      'accident.police_report',
    ]))
  })

  it('initializes adopted FirmVault case state from the CLI and applies safe proposals', async () => {
    const root = await tempProjectRoot()
    await writeFile(join(root, 'Dashboard.md'), '# Legacy Case\n')
    await mkdir(join(root, 'documents', 'police-reports'), { recursive: true })
    await writeFile(join(root, 'documents', 'police-reports', 'report.md'), '---\ndocument_category: police-reports\n---\n')
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'adopt', 'init', '--apply-safe', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body.schema_version).toBe(1)
    expect(body.mutates_state).toBe(true)
    expect(body.applied_facts.map((item: any) => item.fact)).toEqual(expect.arrayContaining([
      'case.setup',
      'accident.police_report',
    ]))
    expect(existsSync(join(root, '.waypoint', 'firmvault', 'case.yaml'))).toBe(true)
  })

  it('checks FirmVault evidence paths from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    await mkdir(join(root, 'documents', 'sent'), { recursive: true })
    await writeFile(join(root, 'documents', 'sent', 'demand.md'), '# Demand sent\n')
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'evidence', 'check', '--path', 'documents/sent/demand.md', '--json'], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body).toEqual({
      ok: true,
      path: 'documents/sent/demand.md',
      exists: true,
      safe: true,
      reason: null,
    })
  })

  it('sets a FirmVault legal state fact from the CLI and reports landmark impact', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    await mkdir(join(root, 'documents', 'sent'), { recursive: true })
    await writeFile(join(root, 'documents', 'sent', 'demand.md'), '# Demand sent\n')
    const { io, stdout, stderr } = captureIo(root)

    const exitCode = await runWaypointCli([
      'firmvault',
      'state',
      'set',
      '--fact',
      'demand.send',
      '--status',
      'sent',
      '--evidence',
      'documents/sent/demand.md',
      '--note',
      'Sent by human after attorney approval.',
      '--json',
    ], io)

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const body = JSON.parse(stdout.join('\n'))
    expect(body).toMatchObject({
      ok: true,
      fact: 'demand.send',
      section: 'demand',
      status: 'sent',
      evidence: ['documents/sent/demand.md'],
      landmarks_before: { satisfied: 0, total: 82 },
      landmarks_after: { satisfied: 1, total: 82 },
      newly_satisfied: ['demand_sent'],
      newly_unsatisfied: [],
      legal_landmarks_updated: true,
    })
    const demandYaml = yamlParse(await readFile(join(root, '.waypoint', 'firmvault', 'demand.yaml'), 'utf8'))
    expect(demandYaml.demand.send.status).toBe('sent')
    expect(demandYaml.demand.send.evidence).toEqual([{ path: 'documents/sent/demand.md' }])
    await expect(readFile(join(root, '.waypoint', 'firmvault', 'events.jsonl'), 'utf8')).resolves.toContain('firmvault.state.updated')
  })

  it('rejects invalid FirmVault state facts from the CLI', async () => {
    const root = await tempProjectRoot()
    const init = captureIo(root)
    await runWaypointCli(['firmvault', 'init-case', '--case-slug', 'smith-v-acme'], init.io)
    const { io, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'state', 'set', '--fact', 'bogus.fact', '--status', 'sent'], io)

    expect(exitCode).toBe(1)
    expect(stderr[0]).toContain('Unknown FirmVault fact: bogus.fact')
  })

  it('rejects unknown FirmVault commands', async () => {
    const root = await tempProjectRoot()
    const { io, stderr } = captureIo(root)

    const exitCode = await runWaypointCli(['firmvault', 'unknown'], io)

    expect(exitCode).toBe(1)
    expect(stderr).toContain('Usage: waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]')
  })
})
