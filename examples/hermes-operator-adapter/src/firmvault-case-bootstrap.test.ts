import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createFirmVaultCaseWithHermesOperator,
  parseFirmVaultCasesRegistry,
  recordFirmVaultDocumentHandoffWithHermesOperator,
  addFirmVaultDocumentWithHermesOperator,
  checkFirmVaultEvidenceWithHermesOperator,
  setFirmVaultStateFactWithHermesOperator,
  showFirmVaultStateWithHermesOperator,
  type FirmVaultNewCaseRequest,
} from './firmvault-case-bootstrap.ts'
import { runSafeWaypointCommand, type WaypointCommandExecutor } from './safe-waypoint-command-runner.ts'

const repoRoot = resolve(__dirname, '../../..')
const waypointCli = resolve(repoRoot, 'packages/waypoint-cli/src/bin.ts')

describe('FirmVault Hermes case bootstrap adapter', () => {
  it('maps a trusted structured request to the exact FirmVault bootstrap CLI args and paralegal Hermes profile', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: WaypointCommandExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          case_root: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
          case_slug: 'jane-smith-v-acme-trucking',
          quest: 'firmvault',
          backend: 'beads',
          route_id: 'route-001',
          beads: { root_issue_id: 'bd-001', issue_count: 12, dependency_count: 11 },
          created_paths: ['AGENTS.md'],
          recipes_installed: 52,
          landmarks: { satisfied: 0, total: 82 },
        }),
        stderr: '',
      }
    }

    const result = await createFirmVaultCaseWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseName: 'Jane Smith v. Acme Trucking',
      caseType: 'personal_injury',
      backend: 'beads',
      initBeads: true,
      start: true,
    }, { executor })

    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          waypointCli,
          'firmvault',
          'bootstrap',
          '--cases-root',
          '/trusted/firmvault/cases',
          '--case-name',
          'Jane Smith v. Acme Trucking',
          '--case-type',
          'personal-injury',
          '--backend',
          'beads',
          '--init-beads',
          '--start',
          '--json',
        ],
        cwd: '/trusted/firmvault/cases',
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      casesRootKey: 'pi',
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      caseSlug: 'jane-smith-v-acme-trucking',
      backend: 'beads',
      routeId: 'route-001',
      beads: { rootIssueId: 'bd-001', issueCount: 12, dependencyCount: 11 },
      landmarkCount: 82,
      summary: 'FirmVault case jane-smith-v-acme-trucking bootstrapped under pi with Hermes profile paralegal using beads backend.',
    })
  })

  it('rejects unknown cases root keys and natural-language path attempts', () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)

    expect(() =>
      createFirmVaultCaseWithHermesOperator(registry, {
        casesRootKey: '/trusted/firmvault/cases',
        caseName: 'Jane Smith v. Acme Trucking',
        caseType: 'personal_injury',
      }),
    ).toThrow('Unknown FirmVault cases root key: /trusted/firmvault/cases')

    expect(() =>
      parseFirmVaultCasesRegistry(`
cases_roots:
  '../escape':
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`),
    ).toThrow('Invalid FirmVault cases root key: ../escape')
  })

  it('requires FirmVault bootstrap to be routed through the paralegal Hermes profile', () => {
    expect(() =>
      parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: gary
`),
    ).toThrow('FirmVault cases root pi must use Hermes profile paralegal')
  })

  it('maps trusted document intake and handoff requests to exact FirmVault CLI args', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: WaypointCommandExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      if (spec.args.includes('add-document')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            document_id: 'document-001',
            kind: 'unknown',
            path: 'documents/inbox/daily-mail.pdf',
            original_name: 'daily-mail.pdf',
            added_at: '2026-05-08T12:00:00.000Z',
            note: 'Daily Mail scan',
          }),
          stderr: '',
        }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          document_id: 'document-001',
          handoff: {
            system: 'firmvault-document-pipeline',
            status: 'pr_opened',
            pr_number: 123,
            pr_url: 'http://localhost:3001/aaron/FirmVault/pulls/123',
            branch: 'ingest/2026-05-08-deadbeef',
          },
        }),
        stderr: '',
      }
    }

    const added = await addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      source: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
      note: 'Daily Mail scan',
    }, { executor })
    const handoff = await recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: added.documentId,
      status: 'pr_opened',
      prNumber: 123,
      prUrl: 'http://localhost:3001/aaron/FirmVault/pulls/123',
      branch: 'ingest/2026-05-08-deadbeef',
    }, { executor })

    expect(added).toMatchObject({
      ok: true,
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      documentId: 'document-001',
      path: 'documents/inbox/daily-mail.pdf',
      summary: 'FirmVault document document-001 added to jane-smith-v-acme-trucking through Hermes profile paralegal.',
    })
    expect(handoff).toMatchObject({
      ok: true,
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      documentId: 'document-001',
      status: 'pr_opened',
      summary: 'FirmVault document document-001 handoff recorded as pr_opened for jane-smith-v-acme-trucking.',
    })
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          waypointCli,
          'firmvault',
          'add-document',
          '--source',
          '/trusted/scans/daily-mail.pdf',
          '--kind',
          'unknown',
          '--note',
          'Daily Mail scan',
          '--json',
        ],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
      {
        command: process.execPath,
        args: [
          waypointCli,
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
          '--json',
        ],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
    ])
  })

  it('rejects unsafe FirmVault document adapter inputs before invoking Waypoint', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const executor: WaypointCommandExecutor = async () => {
      throw new Error('executor should not be called')
    }

    await expect(addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: '../escape',
      source: '/trusted/scans/daily-mail.pdf',
      kind: 'unknown',
    }, { executor })).rejects.toThrow('Invalid FirmVault case slug: ../escape')
    await expect(addFirmVaultDocumentWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      source: 'daily-mail.pdf',
      kind: 'unknown',
    }, { executor })).rejects.toThrow('FirmVault document source must be an absolute path')
    await expect(recordFirmVaultDocumentHandoffWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      documentId: 'document-001',
      status: 'bogus' as never,
    }, { executor })).rejects.toThrow('Unsupported FirmVault document handoff status: bogus')
  })

  it('maps trusted state show, evidence check, and state set requests to exact FirmVault CLI args', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = []
    const executor: WaypointCommandExecutor = async (spec) => {
      calls.push({ command: spec.command, args: spec.args, cwd: spec.cwd })
      if (spec.args.includes('show')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            section: 'demand',
            state: { demand: { send: { status: 'not_started', evidence: [] } } },
            landmarks: { satisfied: 0, total: 82 },
            warnings: [],
          }),
          stderr: '',
        }
      }
      if (spec.args.includes('evidence')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ ok: true, path: 'documents/sent/demand.md', exists: true, safe: true, reason: null }),
          stderr: '',
        }
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          fact: 'demand.send',
          section: 'demand',
          status: 'sent',
          evidence: ['documents/sent/demand.md'],
          landmarks_before: { satisfied: 0, total: 82 },
          landmarks_after: { satisfied: 1, total: 82 },
          newly_satisfied: ['demand_sent'],
          newly_unsatisfied: [],
          warnings: [],
          legal_landmarks_updated: true,
        }),
        stderr: '',
      }
    }

    const shown = await showFirmVaultStateWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      section: 'demand',
    }, { executor })
    const evidence = await checkFirmVaultEvidenceWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      path: 'documents/sent/demand.md',
    }, { executor })
    const updated = await setFirmVaultStateFactWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      fact: 'demand.send',
      status: 'sent',
      evidence: ['documents/sent/demand.md'],
      note: 'Sent by human after attorney approval.',
    }, { executor })

    expect(shown).toMatchObject({
      ok: true,
      hermesProfile: 'paralegal',
      caseRoot: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      section: 'demand',
      landmarkCount: 82,
      summary: 'FirmVault state demand read for jane-smith-v-acme-trucking through Hermes profile paralegal.',
    })
    expect(evidence).toMatchObject({
      ok: true,
      path: 'documents/sent/demand.md',
      exists: true,
      safe: true,
      summary: 'FirmVault evidence documents/sent/demand.md is safe and exists for jane-smith-v-acme-trucking.',
    })
    expect(updated).toMatchObject({
      ok: true,
      fact: 'demand.send',
      status: 'sent',
      newlySatisfied: ['demand_sent'],
      legalLandmarksUpdated: true,
      summary: 'FirmVault fact demand.send set to sent for jane-smith-v-acme-trucking; newly satisfied: demand_sent.',
    })
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [waypointCli, 'firmvault', 'state', 'show', '--section', 'demand', '--json'],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
      {
        command: process.execPath,
        args: [waypointCli, 'firmvault', 'evidence', 'check', '--path', 'documents/sent/demand.md', '--json'],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
      {
        command: process.execPath,
        args: [
          waypointCli,
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
        ],
        cwd: '/trusted/firmvault/cases/jane-smith-v-acme-trucking',
      },
    ])
  })

  it('rejects unsafe FirmVault state adapter inputs before invoking Waypoint', async () => {
    const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: /trusted/firmvault/cases
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
    const executor: WaypointCommandExecutor = async () => {
      throw new Error('executor should not be called')
    }

    await expect(showFirmVaultStateWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: '../escape',
    }, { executor })).rejects.toThrow('Invalid FirmVault case slug: ../escape')
    await expect(checkFirmVaultEvidenceWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      path: '/tmp/demand.md',
    }, { executor })).rejects.toThrow('FirmVault evidence path must be a safe relative path: /tmp/demand.md')
    await expect(setFirmVaultStateFactWithHermesOperator(registry, {
      casesRootKey: 'pi',
      caseSlug: 'jane-smith-v-acme-trucking',
      fact: 'demand.send',
      status: 'sent',
      evidence: ['../demand.md'],
    }, { executor })).rejects.toThrow('FirmVault evidence path must be a safe relative path: ../demand.md')
  })

  it('can bootstrap a real temp FirmVault case through the adapter and actual CLI', async () => {
    const casesRoot = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-firmvault-cases-'))
    try {
      const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: ${casesRoot}
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
      const request: FirmVaultNewCaseRequest = {
        casesRootKey: 'pi',
        caseName: 'Smoke Client v. Adapter Co',
        caseType: 'personal_injury',
        start: true,
      }

      const result = await createFirmVaultCaseWithHermesOperator(registry, request)

      expect(result.ok).toBe(true)
      expect(result.hermesProfile).toBe('paralegal')
      expect(result.caseSlug).toBe('smoke-client-v-adapter-co')
      expect(result.routeId).toBe('route-001')
      expect(result.landmarkCount).toBe(82)
      expect(existsSync(join(casesRoot, 'smoke-client-v-adapter-co/.waypoint/routes/route-001.yaml'))).toBe(true)
      expect(existsSync(join(casesRoot, 'smoke-client-v-adapter-co/.waypoint/tasks/tasks.yaml'))).toBe(true)
    } finally {
      rmSync(casesRoot, { recursive: true, force: true })
    }
  }, 20000)

  it('can run a Beads-backed FirmVault case through the safe Hermes command boundary', async () => {
    const workspace = mkdtempSync(resolve(tmpdir(), 'waypoint-hermes-firmvault-beads-'))
    const casesRoot = join(workspace, 'cases')
    mkdirSync(casesRoot, { recursive: true })
    const fakeBd = installFakeBd(workspace)
    const originalPath = process.env.PATH
    const originalState = process.env.WAYPOINT_FAKE_BD_STATE
    process.env.PATH = `${fakeBd.binDir}:${originalPath ?? ''}`
    process.env.WAYPOINT_FAKE_BD_STATE = fakeBd.statePath

    try {
      const registry = parseFirmVaultCasesRegistry(`
cases_roots:
  pi:
    path: ${casesRoot}
    waypoint_cli: ${waypointCli}
    hermes_profile: paralegal
`)
      const result = await createFirmVaultCaseWithHermesOperator(registry, {
        casesRootKey: 'pi',
        caseName: 'Beads Smoke v. Adapter Co',
        caseType: 'personal_injury',
        backend: 'beads',
        start: true,
      })

      expect(result.ok).toBe(true)
      expect(result.backend).toBe('beads')
      expect(result.routeId).toBe('route-001')
      expect(result.beads).toMatchObject({ rootIssueId: 'bd-001', issueCount: expect.any(Number), dependencyCount: expect.any(Number) })

      const caseProject = { name: result.caseSlug, path: result.caseRoot, waypointCli }
      const status = await runSafeWaypointCommand(caseProject, ['status'])
      expect(status.ok).toBe(true)
      expect(status.stdout).toContain('route backend: beads')

      const routes = await runSafeWaypointCommand(caseProject, ['routes', '--json'])
      expect(JSON.parse(routes.stdout)).toMatchObject({ routes: [{ id: 'route-001', quest: 'firmvault' }] })

      const route = await runSafeWaypointCommand(caseProject, ['route', '--route-id', 'route-001', '--json'])
      expect(JSON.parse(route.stdout)).toMatchObject({ route: { id: 'route-001', metadata: { backend: { route: 'beads' } } } })

      const tasks = await runSafeWaypointCommand(caseProject, ['tasks', '--route-id', 'route-001', '--json'])
      const parsedTasks = JSON.parse(tasks.stdout) as { tasks: Array<{ id: string; plan_ref: string; kind: string }> }
      expect(parsedTasks.tasks.length).toBeGreaterThan(1)

      const auto = await runSafeWaypointCommand(caseProject, ['auto', '--route-id', 'route-001', '--max-iterations', '1', '--json'])
      expect(JSON.parse(auto.stdout)).toMatchObject({ routeId: 'route-001', iterations: 1 })

      const gateTask = parsedTasks.tasks.find((task) => task.kind === 'gate')
      expect(gateTask).toBeTruthy()
      const gate = await runSafeWaypointCommand(caseProject, [
        'gate',
        '--route-id',
        'route-001',
        '--node',
        gateTask!.plan_ref,
        '--approve',
        '--note',
        'Smoke approved.',
      ])
      expect(gate.ok).toBe(true)

      const resume = await runSafeWaypointCommand(caseProject, [
        'resume',
        '--route-id',
        'route-001',
        '--resolve-blocker',
        '--note',
        'Smoke blocker resolved.',
        '--json',
      ])
      expect(resume.ok).toBe(true)

      const routeEvents = await runSafeWaypointCommand(caseProject, ['route-events', '--route-id', 'route-001', '--json'])
      const parsedEvents = JSON.parse(routeEvents.stdout) as { items: Array<{ kind: string }> }
      expect(parsedEvents.items.map((event) => event.kind)).toEqual(expect.arrayContaining([
        'route.started',
        'route.gate.approved',
        'route.blocker.resolved',
      ]))

      const state = JSON.parse(readFileSync(fakeBd.statePath, 'utf8')) as FakeBdState
      expect(state.issues[0]?.metadata).toMatchObject({ waypoint: { kind: 'route', quest_slug: 'firmvault', route_id: 'route-001' } })
      expect(state.dependencies.length).toBeGreaterThan(0)
      expect(state.comments.some((comment) => comment.text.includes('Waypoint gate approved'))).toBe(true)
      expect(state.comments.some((comment) => comment.text.includes('Waypoint blocker resolved'))).toBe(true)
    } finally {
      process.env.PATH = originalPath
      if (originalState === undefined) {
        delete process.env.WAYPOINT_FAKE_BD_STATE
      } else {
        process.env.WAYPOINT_FAKE_BD_STATE = originalState
      }
      rmSync(workspace, { recursive: true, force: true })
    }
  }, 60000)
})

interface FakeBdIssue {
  readonly id: string
  readonly title: string
  status: string
  readonly issue_type: string
  readonly labels: readonly string[]
  readonly metadata: unknown
  readonly parent?: string
  readonly created_at: string
  updated_at: string
}

interface FakeBdState {
  readonly issues: FakeBdIssue[]
  readonly dependencies: Array<{ issue_id: string; depends_on_id: string; type: string }>
  readonly comments: Array<{ id: string; issue_id: string; text: string; created_at: string }>
}

function installFakeBd(cwd: string): { readonly binDir: string; readonly statePath: string } {
  const binDir = join(cwd, 'bin')
  const statePath = join(cwd, 'fake-bd-state.json')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(statePath, JSON.stringify({ issues: [], dependencies: [], comments: [] }), 'utf8')
  const scriptPath = join(binDir, 'bd')
  writeFileSync(scriptPath, fakeBdScript(), 'utf8')
  chmodSync(scriptPath, 0o755)
  return { binDir, statePath }
}

function fakeBdScript(): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const statePath = process.env.WAYPOINT_FAKE_BD_STATE
if (!statePath) throw new Error('WAYPOINT_FAKE_BD_STATE is required')
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(statePath, 'utf8'))

function write() {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n')
}

function nextIssueId() {
  return 'bd-' + String(state.issues.length + 1).padStart(3, '0')
}

function nextCommentId() {
  return 'comment-' + String(state.comments.length + 1).padStart(3, '0')
}

const command = args[0]
if (command === 'where') {
  output({ path: process.cwd() + '/.beads', database_path: process.cwd() + '/.beads/embeddeddolt', prefix: 'firmvault' })
} else if (command === 'create') {
  const title = args[1]
  const issue = {
    id: nextIssueId(),
    title,
    status: 'open',
    issue_type: valueAfter('--type') || 'task',
    labels: (valueAfter('--labels') || '').split(',').filter(Boolean),
    metadata: JSON.parse(valueAfter('--metadata') || '{}'),
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    ...(valueAfter('--parent') ? { parent: valueAfter('--parent') } : {}),
  }
  state.issues.push(issue)
  write()
  output(issue)
} else if (command === 'dep' && args[1] === 'add') {
  const dependency = { issue_id: args[2], depends_on_id: args[3], type: valueAfter('--type') || 'blocks' }
  state.dependencies.push(dependency)
  write()
  output({ status: 'added', ...dependency })
} else if (command === 'list') {
  output(state.issues.map((issue) => ({
    ...issue,
    dependencies: state.dependencies.filter((dependency) => dependency.issue_id === issue.id),
  })))
} else if (command === 'close') {
  const issue = state.issues.find((entry) => entry.id === args[1])
  if (!issue) throw new Error('missing issue ' + args[1])
  issue.status = 'closed'
  issue.updated_at = '2026-05-27T00:00:01.000Z'
  write()
  output([issue])
} else if (command === 'update') {
  const issue = state.issues.find((entry) => entry.id === args[1])
  if (!issue) throw new Error('missing issue ' + args[1])
  issue.status = valueAfter('--status') || issue.status
  issue.updated_at = '2026-05-27T00:00:02.000Z'
  write()
  output([issue])
} else if (command === 'comment') {
  state.comments.push({ id: nextCommentId(), issue_id: args[1], text: args[2] || '', created_at: '2026-05-27T00:00:03.000Z' })
  write()
  output({ status: 'commented' })
} else if (command === 'comments') {
  output(state.comments.filter((comment) => comment.issue_id === args[1]))
} else {
  console.error('unsupported fake bd command: ' + args.join(' '))
  process.exit(2)
}
`
}
