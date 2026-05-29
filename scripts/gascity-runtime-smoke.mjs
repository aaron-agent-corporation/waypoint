#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'))
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const waypointCli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const liveGcInitTimeoutMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_GC_INIT_TIMEOUT_MS', 360000)
const liveGcStopTimeoutMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_GC_STOP_TIMEOUT_MS', 90000)
const liveStoreReadyTimeoutMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_STORE_READY_TIMEOUT_MS', 90000)
const liveWaypointStartTimeoutMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_WAYPOINT_START_TIMEOUT_MS', 240000)
const liveCommandMaxBufferBytes = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_MAX_BUFFER_BYTES', 16 * 1024 * 1024)
const liveExecutionWaitMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_EXECUTION_WAIT_MS', 60000)
const liveCompletionWaitMs = positiveIntegerEnv('WAYPOINT_GASCITY_LIVE_COMPLETION_WAIT_MS', 300000)

if (args.has('--help') || args.has('-h')) {
  process.stdout.write(`Waypoint Gas City runtime smoke harness

Usage:
  node scripts/gascity-runtime-smoke.mjs [--json] [--live-preflight] [--live] [--live-execute] [--live-complete] [--keep-live]

Default mode is deterministic and mock-backed. It does not start Gas City,
Beads, tmux, Dolt, Codex, or mutate the Waypoint repository.

Options:
  --json            Print JSON only.
  --live-preflight  Also check local gc/bd/dolt/flock/codex availability.
  --live            Exercise a real temp Waypoint project and Gas City city.
  --live-execute    Opt-in explicit dispatch probe; may wake a provider session.
  --live-complete   Stricter opt-in dispatch probe that waits for provider completion and route advancement.
  --keep-live       Keep live temp state even when the live smoke passes.

Environment:
  WAYPOINT_GASCITY_LIVE_GC_INIT_TIMEOUT_MS  Override live gc init timeout (default 360000).
  WAYPOINT_GASCITY_LIVE_GC_STOP_TIMEOUT_MS  Override live gc stop timeout (default 90000).
  WAYPOINT_GASCITY_LIVE_STORE_READY_TIMEOUT_MS  Override adopted Beads store readiness wait (default 90000).
  WAYPOINT_GASCITY_LIVE_WAYPOINT_START_TIMEOUT_MS  Override waypoint start delegation timeout (default 240000).
  WAYPOINT_GASCITY_LIVE_MAX_BUFFER_BYTES  Override live command output buffer (default 16777216).
  WAYPOINT_GASCITY_LIVE_EXECUTION_WAIT_MS  Override explicit execution wait budget (default 60000).
  WAYPOINT_GASCITY_LIVE_COMPLETION_WAIT_MS  Override completion wait budget (default 300000).
`)
  process.exit(0)
}

const knownArgs = ['--json', '--live-preflight', '--live', '--live-execute', '--live-complete', '--keep-live']
const unknownArgs = [...args].filter((arg) => !knownArgs.includes(arg))
if (unknownArgs.length > 0) {
  process.stderr.write(`Unknown Gas City smoke option(s): ${unknownArgs.join(', ')}\n`)
  process.exit(2)
}

const target = 'waypoint-smoke/codex'
const cityPath = '<temp>/waypoint-gascity-city'
const rigPath = '<temp>/waypoint-gascity-rig'
const rootTaskId = 'wpg-2u6'
const commandPlan = [
  {
    step: 'init-city',
    argv: ['gc', 'init', '--provider', 'codex', '--skip-provider-readiness', cityPath],
    records: ['city path', 'provider', 'supervisor intent'],
  },
  {
    step: 'rig-add',
    argv: ['gc', '--city', cityPath, 'rig', 'add', rigPath, '--name', 'waypoint-smoke', '--prefix', '<beads-prefix>', '--start-suspended'],
    records: ['rig path', 'rig name', 'Gas City-owned Beads prefix'],
  },
  {
    step: 'session-list-before-no-nudge',
    argv: ['gc', '--city', cityPath, 'session', 'list', '--state', 'all', '--json'],
    records: ['session ids', 'states', 'created timestamps before no-nudge delegation'],
  },
  {
    step: 'metadata-route',
    argv: ['bd', 'update', rootTaskId, '--set-metadata', `gc.routed_to=${target}`],
    records: ['target', 'root Bead id', 'route metadata'],
  },
  {
    step: 'create-dispatch-convoy',
    argv: ['gc', '--city', cityPath, '--rig', 'waypoint-smoke', 'convoy', 'create', 'waypoint-route-001', rootTaskId],
    records: ['dispatch convoy id', 'root Bead id'],
  },
  {
    step: 'dispatch-convoy',
    argv: ['gc', '--city', cityPath, '--rig', 'waypoint-smoke', 'sling', target, '<convoy-id>', '--no-formula', '--nudge'],
    records: ['target', 'convoy id', 'intentional worker wake'],
  },
  {
    step: 'session-list-after-no-nudge',
    argv: ['gc', '--city', cityPath, 'session', 'list', '--state', 'all', '--json'],
    records: ['session ids', 'states', 'created timestamps after no-nudge delegation'],
  },
  {
    step: 'no-nudge-session-check',
    argv: ['compare-session-snapshots', 'before-no-nudge', 'after-no-nudge'],
    records: ['new sessions', 'inactive-to-active transitions'],
  },
  {
    step: 'hook',
    argv: ['gc', '--city', cityPath, 'hook'],
    records: ['ready routed Beads work'],
  },
  {
    step: 'session-list',
    argv: ['gc', '--city', cityPath, 'session', 'list', '--json'],
    records: ['worker state', 'target', 'drain reason'],
  },
]

const happyPathState = {
  task: {
    id: rootTaskId,
    status: 'open',
    assignee: null,
    metadata: {
      'gc.routed_to': target,
      waypoint: {
        kind: 'recipe',
        quest_slug: 'waypoint',
        route_id: 'route-001',
        node_key: 'initialize-context',
      },
    },
  },
  hook: [{ id: rootTaskId, title: 'Initialize Waypoint context', metadata: { 'gc.routed_to': target } }],
  sessions: [{ id: 'codex-adhoc-ready-001', status: 'running', target, age_seconds: 35, created_at: '2026-05-28T14:02:00Z' }],
  sessionsBeforeNoNudge: [{ id: 'codex-adhoc-ready-001', status: 'running', target, created_at: '2026-05-28T14:02:00Z' }],
  sessionsAfterNoNudge: [{ id: 'codex-adhoc-ready-001', status: 'running', target, created_at: '2026-05-28T14:02:00Z' }],
  noNudgeStartedAt: '2026-05-28T14:03:00Z',
  supervisorEvents: [],
}

const diagnosticStates = [
  {
    name: 'route metadata disappeared before worker hook',
    state: {
      task: {
        id: rootTaskId,
        status: 'open',
        assignee: null,
        metadata: {
          waypoint: { kind: 'recipe', route_id: 'route-001', node_key: 'initialize-context' },
        },
      },
      hook: [],
      sessions: [{ id: 'codex-adhoc-creating-001', status: 'creating', target, age_seconds: 45 }],
      supervisorEvents: [],
    },
    expectedCodes: ['gascity-route-metadata-missing', 'gascity-hook-no-work'],
  },
  {
    name: 'worker stuck creating while routed work exists',
    state: {
      task: {
        id: rootTaskId,
        status: 'open',
        assignee: null,
        metadata: {
          'gc.routed_to': target,
          waypoint: { kind: 'recipe', route_id: 'route-001', node_key: 'initialize-context' },
        },
      },
      hook: [{ id: rootTaskId }],
      sessions: [{ id: 'codex-adhoc-creating-002', status: 'creating', target, age_seconds: 900 }],
      supervisorEvents: [],
    },
    expectedCodes: ['gascity-worker-stuck-creating'],
  },
  {
    name: 'worker drained on config drift after claiming work',
    state: {
      task: {
        id: rootTaskId,
        status: 'in_progress',
        assignee: 'codex-adhoc-20f62702ff',
        metadata: {
          'gc.routed_to': target,
          waypoint: { kind: 'recipe', route_id: 'route-001', node_key: 'initialize-context' },
        },
      },
      hook: [],
      sessions: [
        {
          id: 'codex-adhoc-20f62702ff',
          status: 'drained',
          target,
          drain_reason: 'config-drift',
          age_seconds: 120,
        },
      ],
      supervisorEvents: [
        'config-drift codex-adhoc-20f62702ff: stored=0d9090cf3de2 current=1701e27ef3d8',
        'config-drift-diag codex-adhoc-20f62702ff: drifted fields: CopyFiles',
        "Draining session 'codex-adhoc-20f62702ff': config-drift",
      ],
    },
    expectedCodes: ['gascity-worker-drained-config-drift', 'gascity-work-stranded-on-drained-assignee'],
  },
  {
    name: 'worker claim released after task started',
    state: {
      task: {
        id: rootTaskId,
        status: 'open',
        assignee: null,
        started_at: '2026-05-28T17:33:39Z',
        metadata: {
          'gc.routed_to': target,
          waypoint: { kind: 'recipe', route_id: 'route-001', node_key: 'initialize-context' },
        },
      },
      hook: [{ id: rootTaskId }],
      sessions: [{ id: 'codex-adhoc-20f62702ff', status: 'asleep', target, drain_reason: 'orphaned', age_seconds: 180 }],
      supervisorEvents: ['session orphaned after provider claim; work reopened without assignee'],
    },
    expectedCodes: ['gascity-work-claim-released-after-start'],
  },
]

const liveCompletionRequested = args.has('--live-complete')
const liveExecutionRequested = args.has('--live-execute') || liveCompletionRequested
const liveRequested = args.has('--live') || liveExecutionRequested
const livePreflightRequested = args.has('--live-preflight') || liveRequested
const livePreflight = livePreflightRequested ? runLivePreflight() : { status: 'skipped' }
const liveBuildFreshness = liveRequested ? checkLiveBuildFreshness() : { status: 'skipped' }

class LiveSmokeStepError extends Error {
  constructor(step) {
    super(`Live Gas City smoke step failed: ${step}`)
    this.name = 'LiveSmokeStepError'
    this.step = step
  }
}

const report = {
  ok: true,
  mode: liveRequested ? 'fixture+live' : livePreflightRequested ? 'fixture+live-preflight' : 'fixture',
  mutates_waypoint_repo: false,
  command_plan: commandPlan,
  state_transitions: runHappyPathSmoke(happyPathState),
  diagnostic_cases: runDiagnosticCases(diagnosticStates),
  live_preflight: livePreflight,
  live_build_freshness: liveBuildFreshness,
  live_smoke: liveRequested
    ? liveBuildFreshness.status === 'passed'
      ? await runLiveSmoke({
          preflight: livePreflight,
        keepLive: args.has('--keep-live') || process.env.WAYPOINT_KEEP_GASCITY_SMOKE === '1',
        executeDispatch: liveExecutionRequested,
        requireCompletion: liveCompletionRequested,
      })
      : liveSmokeBlockedByBuildFreshness(liveBuildFreshness)
    : { status: 'skipped' },
}

if (report.state_transitions.some((transition) => transition.ok === false)) report.ok = false
if (report.diagnostic_cases.some((scenario) => scenario.ok === false)) report.ok = false
if (report.live_preflight.status === 'failed') report.ok = false
if (report.live_build_freshness.status === 'failed') report.ok = false
if (report.live_smoke.status === 'failed') report.ok = false

if (args.has('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  printHumanReport(report)
}

process.exit(report.ok ? 0 : 1)

function runHappyPathSmoke(state) {
  const tempRoot = awaitableTempRootLabel()
  const noNudgeViolations = detectNoNudgeSessionActivity({
    before: state.sessionsBeforeNoNudge ?? [],
    after: state.sessionsAfterNoNudge ?? [],
    startedAt: state.noNudgeStartedAt,
  })
  return [
    {
      step: 'workspace-isolation',
      ok: true,
      detail: `live commands use a temp root like ${tempRoot} and must not write into the Waypoint repo`,
    },
    {
      step: 'command-construction',
      ok: commandPlan.every((entry) => Array.isArray(entry.argv) && entry.argv.length > 0),
      detail: 'all runtime setup and route metadata calls are explicit argv arrays',
      commands: commandPlan.map((entry) => entry.argv.join(' ')),
    },
    {
      step: 'metadata-route-recorded',
      ok: state.task.metadata['gc.routed_to'] === target,
      detail: `task ${state.task.id} carries Gas City route metadata for ${target}`,
    },
    {
      step: 'no-nudge-does-not-start-or-wake-sessions',
      ok: noNudgeViolations.length === 0,
      detail: 'no new session ids or inactive-to-active session transitions appear after no-nudge delegation',
      violations: noNudgeViolations,
    },
    {
      step: 'hook-sees-routed-work',
      ok: state.hook.some((item) => item.id === state.task.id),
      detail: `gc hook can see routed Bead ${state.task.id}`,
    },
    {
      step: 'session-list-records-running-worker',
      ok: state.sessions.some((session) => session.status === 'running' && session.target === target),
      detail: `session list includes a running worker for ${target}`,
    },
    {
      step: 'healthy-state-has-no-diagnostics',
      ok: diagnoseGasCityState(state).length === 0,
      detail: 'no missing metadata, empty hook, stuck worker, drain, or stranded assignment diagnostics',
    },
  ]
}

function runDiagnosticCases(cases) {
  return cases.map((scenario) => {
    const diagnostics = diagnoseGasCityState(scenario.state)
    const actualCodes = diagnostics.map((diagnostic) => diagnostic.code)
    const missingExpectedCodes = scenario.expectedCodes.filter((code) => !actualCodes.includes(code))
    return {
      name: scenario.name,
      ok: missingExpectedCodes.length === 0,
      expected_codes: scenario.expectedCodes,
      actual_codes: actualCodes,
      missing_expected_codes: missingExpectedCodes,
      diagnostics,
    }
  })
}

function diagnoseGasCityState(state) {
  const diagnostics = []
  const metadata = state.task.metadata ?? {}
  const routedTo = metadata['gc.routed_to']

  if (routedTo !== target) {
    diagnostics.push({
      code: 'gascity-route-metadata-missing',
      severity: 'error',
      evidence: `Bead ${state.task.id} lacks gc.routed_to=${target}`,
      guidance: [
        `Re-run waypoint gascity sling --route-id route-001 --target ${target} --no-nudge, or apply an explicit repair if operator policy allows it.`,
        `Repair candidate: bd update ${state.task.id} --set-metadata gc.routed_to=${target}`,
      ],
    })
  }

  if (state.hook.length === 0 && state.task.status === 'open') {
    diagnostics.push({
      code: 'gascity-hook-no-work',
      severity: 'error',
      evidence: `gc hook returned [] while Waypoint task ${state.task.id} is still open`,
      guidance: [
        'Compare Beads blockers, assignment, and Gas City route metadata before starting another worker.',
        'Do not treat provider startup as proof that routed work is visible.',
      ],
    })
  }

  if (state.task.status === 'open' && !state.task.assignee && state.task.started_at && !state.task.closed_at) {
    diagnostics.push({
      code: 'gascity-work-claim-released-after-start',
      severity: 'error',
      evidence: `Bead ${state.task.id} has started_at=${state.task.started_at} but is open and unassigned; ${state.task.notes ? 'notes were recorded' : 'no notes were recorded'}.`,
      guidance: [
        'Treat this as a released provider/session claim after startup, not as ordinary ready work.',
        `Inspect Beads work: bd show ${state.task.id} --json`,
        `Inspect Beads comments: bd comments ${state.task.id} --json`,
        'Inspect Gas City events and session trace for orphan, drain, or release signals before retrying.',
        'Require an explicit recovery policy before clearing assignment, reopening, or re-slinging work.',
      ],
    })
  }

  for (const session of state.sessions) {
    if (session.status === 'creating' && session.age_seconds >= 600) {
      diagnostics.push({
        code: 'gascity-worker-stuck-creating',
        severity: 'warning',
        evidence: `Session ${session.id} has been creating for ${session.age_seconds} seconds`,
        guidance: [
          'Inspect Gas City supervisor logs and provider trust/login prompts.',
          'Keep Waypoint route work pending until a worker is running and hook-visible work exists.',
        ],
      })
    }

    if (session.status === 'drained' && session.drain_reason === 'config-drift') {
      diagnostics.push({
        code: 'gascity-worker-drained-config-drift',
        severity: 'error',
        evidence: `Session ${session.id} drained due to config-drift`,
        guidance: [
          'Treat this as a Gas City runtime blocker, not a Waypoint quest failure.',
          'Do not silently restart and claim success until routed work is completed or safely reassigned.',
        ],
      })
    }
  }

  const assignedSession = state.task.assignee
  const assignedSessionRecord = assignedSession ? state.sessions.find((session) => session.id === assignedSession) : undefined
  if (state.task.status === 'in_progress' && assignedSession && (!assignedSessionRecord || assignedSessionRecord.status === 'drained')) {
    diagnostics.push({
      code: 'gascity-work-stranded-on-drained-assignee',
      severity: 'error',
      evidence: `Bead ${state.task.id} is assigned to ${assignedSession}, but that session is drained or missing`,
      guidance: [
        'Report the Bead id and assignee to the operator.',
        'Require an explicit recovery policy before clearing assignment, reopening, or re-slinging work.',
      ],
    })
  }

  if (state.supervisorEvents.some((event) => event.includes('config-drift'))) {
    const alreadyRecorded = diagnostics.some((diagnostic) => diagnostic.code === 'gascity-worker-drained-config-drift')
    if (!alreadyRecorded) {
      diagnostics.push({
        code: 'gascity-worker-drained-config-drift',
        severity: 'error',
        evidence: state.supervisorEvents.find((event) => event.includes('config-drift')),
        guidance: ['Inspect Gas City generated config before retrying the worker.'],
      })
    }
  }

  return diagnostics
}

function runLivePreflight() {
  const checks = [
    {
      tool: 'gc',
      candidates: [['version'], ['--version']],
      guidance: 'Install Gas City and ensure gc is on PATH, or disable the Gas City runtime.',
    },
    {
      tool: 'bd',
      candidates: [['--version'], ['version']],
      guidance: 'Install Beads and ensure bd is on PATH before using Beads-backed Gas City work.',
    },
    {
      tool: 'dolt',
      candidates: [['version'], ['--version']],
      guidance: 'Install Dolt because Gas City uses it for city state.',
    },
    {
      tool: 'flock',
      candidates: [['--version'], ['-h']],
      guidance: 'Install flock; on macOS this may be available through Homebrew.',
    },
    {
      tool: 'codex',
      candidates: [['--version'], ['version']],
      guidance: 'Install and authorize the selected agent provider, or choose a different Gas City provider.',
    },
  ]

  const results = checks.map(checkCommand)
  return {
    status: results.every((result) => result.ok) ? 'passed' : 'failed',
    mutates_waypoint_repo: false,
    checks: results,
  }
}

function checkLiveBuildFreshness() {
  const checks = [
    buildFreshnessCheck({
      packageName: '@waypoint/core',
      sourceDir: join(repoRoot, 'src'),
      distDir: join(repoRoot, 'dist/src'),
    }),
    buildFreshnessCheck({
      packageName: '@waypoint/folder-host',
      sourceDir: join(repoRoot, 'packages/waypoint-folder-host/src'),
      distDir: join(repoRoot, 'packages/waypoint-folder-host/dist'),
    }),
  ]
  const failed = checks.filter((check) => !check.ok)
  return {
    status: failed.length === 0 ? 'passed' : 'failed',
    mutates_waypoint_repo: false,
    checks,
    ...(failed.length > 0
      ? {
          guidance: [
            'Run pnpm build before live Gas City smokes so package-export imports resolve to current built artifacts.',
            'Use fixture mode for cheap non-mutating validation when a build is not needed.',
          ],
        }
      : {}),
  }
}

function buildFreshnessCheck(input) {
  const source = newestFile(input.sourceDir, isBuildSourceFile)
  const dist = newestFile(input.distDir, isBuiltArtifactFile)
  const base = {
    package: input.packageName,
    source_dir: input.sourceDir,
    dist_dir: input.distDir,
    newest_source_file: source?.path,
    newest_source_mtime: source ? new Date(source.mtimeMs).toISOString() : undefined,
    newest_dist_file: dist?.path,
    newest_dist_mtime: dist ? new Date(dist.mtimeMs).toISOString() : undefined,
  }
  if (!source) {
    return {
      ...base,
      ok: false,
      reason: 'no-source-files',
      guidance: `Expected source files under ${input.sourceDir}.`,
    }
  }
  if (!dist) {
    return {
      ...base,
      ok: false,
      reason: 'dist-missing',
      guidance: 'Run pnpm build before starting live Gas City smoke modes.',
    }
  }
  if (source.mtimeMs > dist.mtimeMs + 1000) {
    return {
      ...base,
      ok: false,
      reason: 'source-newer-than-dist',
      guidance: `Run pnpm build; ${source.path} is newer than ${dist.path}.`,
    }
  }
  return {
    ...base,
    ok: true,
  }
}

function newestFile(root, predicate) {
  if (!existsSync(root)) return null
  let newest = null
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile() || !predicate(path)) continue
      const stats = statSync(path)
      if (!newest || stats.mtimeMs > newest.mtimeMs) {
        newest = { path, mtimeMs: stats.mtimeMs }
      }
    }
  }
  visit(root)
  return newest
}

function isBuildSourceFile(path) {
  if (!path.endsWith('.ts')) return false
  if (path.endsWith('.test.ts') || path.endsWith('.d.ts')) return false
  return !path.includes('/__tests__/')
}

function isBuiltArtifactFile(path) {
  return path.endsWith('.js') || path.endsWith('.d.ts') || path.endsWith('.js.map')
}

function liveSmokeBlockedByBuildFreshness(freshness) {
  return {
    status: 'failed',
    stage: 'build-freshness',
    mutates_waypoint_repo: false,
    reason: 'Live Gas City smoke requires current built package artifacts before provider execution.',
    cleanup: { status: 'not-started' },
    steps: [],
    diagnostics: [
      {
        code: 'waypoint-live-build-artifacts-stale',
        owner: 'waypoint-build',
        waypoint_diagnose: 'not-run-before-route-start',
        evidence: freshness.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.package}: ${check.reason}`)
          .join('; '),
        guidance: freshness.guidance ?? ['Run pnpm build before retrying live Gas City smoke modes.'],
      },
    ],
  }
}

function createLiveSmokeEnv(gcHome) {
  return {
    ...process.env,
    GC_HOME: gcHome,
  }
}

async function runLiveSmoke({ preflight, keepLive, executeDispatch = false, requireCompletion = false }) {
  if (preflight.status !== 'passed') {
    return {
      status: 'failed',
      stage: 'preflight',
      mutates_waypoint_repo: false,
      reason: 'Live Gas City smoke requires passing live preflight checks before creating temp state.',
      cleanup: { status: 'not-started' },
      steps: [],
    }
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-gascity-live-'))
  const projectRoot = join(tempRoot, 'project')
  const cityRoot = join(tempRoot, 'city')
  const gcHome = join(tempRoot, 'gc-home')
  const liveEnv = createLiveSmokeEnv(gcHome)
  const rigName = 'waypoint-live'
  const rigPrefix = 'wpl'
  const target = `${rigName}/codex`
  const steps = []
  let beadsPrefix = null
  let sessionsBeforeDelegation = []
  let sessionsAfterDelegation = []
  let rootBeadId = null
  let routedBeadId = null
  let dispatchBeadId = null
  let hookVisibility = null
  let executionObservation = null
  let completionReadback = null
  let nextDispatchProbe = null
  let failedStep = null
  let cleanup = { status: 'not-started' }

  try {
    await mkdir(projectRoot, { recursive: true })
    runLiveStep(steps, {
      step: 'gascity-init-city',
      command: 'gc',
      args: ['init', '--provider', 'codex', '--skip-provider-readiness', cityRoot],
      cwd: tempRoot,
      timeout: liveGcInitTimeoutMs,
      env: liveEnv,
    })
    runLiveStep(steps, {
      step: executeDispatch ? 'gascity-add-rig' : 'gascity-add-suspended-rig',
      command: 'gc',
      args: [
        '--city',
        cityRoot,
        'rig',
        'add',
        projectRoot,
        '--name',
        rigName,
        '--prefix',
        rigPrefix,
        ...(executeDispatch ? [] : ['--start-suspended']),
      ],
      cwd: tempRoot,
      timeout: 60000,
      env: liveEnv,
    })
    waitForLiveBeadsStore(steps, {
      cwd: projectRoot,
      timeout: liveStoreReadyTimeoutMs,
      env: liveEnv,
    })
    const beadsPrefixStep = runLiveStep(steps, {
      step: 'beads-read-prefix',
      command: 'bd',
      args: ['where', '--json'],
      cwd: projectRoot,
      timeout: 10000,
      env: liveEnv,
    })
    beadsPrefix = readLiveBeadsPrefix(beadsPrefixStep.stdout)
    if (!beadsPrefix) {
      beadsPrefixStep.ok = false
      beadsPrefixStep.error = 'bd where --json did not report a Beads issue prefix'
      throw new LiveSmokeStepError('beads-read-prefix')
    }
    runLiveStep(steps, {
      step: 'waypoint-init-project',
      command: process.execPath,
      args: [waypointCli, 'init', '--quest', 'waypoint', '--backend', 'beads'],
      cwd: projectRoot,
      timeout: 60000,
      env: liveEnv,
    })
    runLiveStep(steps, {
      step: 'waypoint-gascity-preflight',
      command: process.execPath,
      args: [waypointCli, 'gascity', 'preflight', '--city', cityRoot, '--rig', rigName, '--provider', 'codex', '--json'],
      cwd: projectRoot,
      timeout: 30000,
      env: liveEnv,
    })
    if (executeDispatch) {
      ensureLiveBeadsProvider(steps, {
        cwd: projectRoot,
        city: cityRoot,
        rig: rigName,
        timeout: 30000,
        env: liveEnv,
      })
    }
    sessionsBeforeDelegation = readLiveSessionSnapshot(runLiveStep(steps, {
      step: executeDispatch ? 'gascity-session-list-before-dispatch' : 'gascity-session-list-before-no-nudge',
      command: 'gc',
      args: ['--city', cityRoot, 'session', 'list', '--state', 'all', '--json'],
      cwd: projectRoot,
      timeout: 30000,
      env: liveEnv,
    }))
    const waypointStartArgs = [
      waypointCli,
      'start',
      '--quest',
      'waypoint',
      '--gascity',
      '--gascity-city',
      cityRoot,
      '--gascity-rig',
      rigName,
      '--gascity-target',
      target,
    ]
    if (!executeDispatch) waypointStartArgs.push('--gascity-no-nudge')
    const waypointStartStep = runLiveStep(steps, {
      step: 'waypoint-start-gascity',
      command: process.execPath,
      args: waypointStartArgs,
      cwd: projectRoot,
      timeout: liveWaypointStartTimeoutMs,
      env: liveEnv,
    })
    rootBeadId = readLiveStartBeadId(waypointStartStep.stdout)
    routedBeadId = readLiveRoutedBeadId(waypointStartStep.stdout) ?? rootBeadId
    dispatchBeadId = readLiveDispatchBeadId(waypointStartStep.stdout)
    if (executeDispatch && !dispatchBeadId) {
      waypointStartStep.ok = false
      waypointStartStep.error = 'waypoint start --gascity did not report a Gas City dispatch bead for explicit execution mode'
      throw new LiveSmokeStepError('waypoint-start-gascity')
    }
    sessionsAfterDelegation = readLiveSessionSnapshot(runLiveStep(steps, {
      step: executeDispatch ? 'gascity-session-list-after-dispatch' : 'gascity-session-list-after-no-nudge',
      command: 'gc',
      args: ['--city', cityRoot, 'session', 'list', '--state', 'all', '--json'],
      cwd: projectRoot,
      timeout: 30000,
      env: liveEnv,
    }))
    let deferredFailureStep = null
    if (executeDispatch) {
      if (!rootBeadId) {
        waypointStartStep.ok = false
        waypointStartStep.error = 'waypoint start --gascity did not report the delegated route Bead id'
        throw new LiveSmokeStepError('waypoint-start-gascity')
      }
      hookVisibility = recordLiveHookVisibility(steps, {
        cwd: projectRoot,
        city: cityRoot,
        rig: rigName,
        routeId: 'route-001',
        rootBeadId,
        routedBeadId,
        dispatchBeadId,
        agents: hookAgentsForTarget(target, sessionsAfterDelegation),
        timeout: 30000,
        env: liveEnv,
      })
      if (!hookVisibility.ok) {
        deferredFailureStep = hookVisibility.step
      } else {
        executionObservation = requireCompletion
          ? recordLiveCompletionObservation(steps, {
              cwd: projectRoot,
              beadId: routedBeadId,
              timeout: liveCompletionWaitMs,
              env: liveEnv,
            })
          : recordLiveExecutionObservation(steps, {
              cwd: projectRoot,
              beadId: routedBeadId,
              timeout: liveExecutionWaitMs,
              env: liveEnv,
            })
        if (!executionObservation.ok) deferredFailureStep = executionObservation.step
      }
      const routeReadback = runLiveStep(steps, {
        step: 'waypoint-route-readback',
        command: process.execPath,
        args: [waypointCli, 'route', '--route-id', 'route-001', '--json'],
        cwd: projectRoot,
        timeout: 30000,
        env: liveEnv,
      })
      const taskReadback = runLiveStep(steps, {
        step: 'waypoint-task-readback',
        command: process.execPath,
        args: [waypointCli, 'tasks', '--route-id', 'route-001', '--json'],
        cwd: projectRoot,
        timeout: 30000,
        env: liveEnv,
      })
      const eventReadback = runLiveStep(steps, {
        step: 'waypoint-route-events-readback',
        command: process.execPath,
        args: [waypointCli, 'route-events', '--route-id', 'route-001', '--json'],
        cwd: projectRoot,
        timeout: 30000,
        env: liveEnv,
      })
      if (requireCompletion && deferredFailureStep === null) {
        completionReadback = recordLiveCompletionReadback(steps, {
          completedBeadId: routedBeadId,
          routeStep: routeReadback,
          taskStep: taskReadback,
          eventStep: eventReadback,
        })
        if (!completionReadback.ok) {
          deferredFailureStep = completionReadback.step
        } else {
          nextDispatchProbe = recordLiveNextDispatchProbe(steps, {
            cwd: projectRoot,
            city: cityRoot,
            rig: rigName,
            target,
            completedBeadId: routedBeadId,
            completionReadback,
            env: liveEnv,
          })
          if (!nextDispatchProbe.ok) deferredFailureStep = nextDispatchProbe.step
        }
      }
    } else {
      recordNoNudgeSessionCheck(steps, {
        cwd: projectRoot,
        startedAt: waypointStartStep.started_at,
        before: sessionsBeforeDelegation,
        after: sessionsAfterDelegation,
      })
    }
    runLiveStep(steps, {
      step: 'waypoint-gascity-diagnose',
      command: process.execPath,
      args: [
        waypointCli,
        'gascity',
        'diagnose',
        '--route-id',
        'route-001',
        '--target',
        target,
        '--city',
        cityRoot,
        '--rig',
        rigName,
        '--provider',
        'codex',
        '--json',
      ],
      cwd: projectRoot,
      timeout: 30000,
      allowFailure: deferredFailureStep !== null,
      env: liveEnv,
    })
    if (deferredFailureStep) throw new LiveSmokeStepError(deferredFailureStep)
  } catch (error) {
    failedStep = error instanceof LiveSmokeStepError ? error.step : String(error)
  } finally {
    cleanup = await cleanupLiveSmoke({ cityRoot, tempRoot, keepLive: keepLive || failedStep !== null, env: liveEnv })
    if (!failedStep && cleanup.status === 'cleanup-failed') {
      failedStep = 'gascity-live-cleanup'
    }
  }

  return {
    status: failedStep ? 'failed' : 'passed',
    stage: failedStep ?? 'complete',
    mutates_waypoint_repo: false,
    temp_root: cleanup.tempRoot,
    gc_home: cleanup.kept ? gcHome : undefined,
    project_root: cleanup.kept ? projectRoot : undefined,
    city_root: cleanup.kept ? cityRoot : undefined,
    beads_prefix: beadsPrefix ?? undefined,
    execution_mode: requireCompletion ? 'completion' : executeDispatch ? 'explicit-dispatch' : 'metadata-only',
    target,
    root_bead_id: rootBeadId ?? undefined,
    routed_bead_id: routedBeadId ?? undefined,
    dispatch_bead_id: dispatchBeadId ?? undefined,
    session_baseline_count: sessionsBeforeDelegation.length,
    session_after_delegation_count: sessionsAfterDelegation.length,
    ...(executeDispatch ? {} : { session_after_no_nudge_count: sessionsAfterDelegation.length }),
    hook_visibility: hookVisibility ?? undefined,
    execution_observation: executionObservation ?? undefined,
    completion_readback: completionReadback ?? undefined,
    next_dispatch_probe: nextDispatchProbe ?? undefined,
    cleanup,
    diagnostics: diagnoseLiveSmokeRun({ failedStep, steps, tempRoot, cityRoot, projectRoot, target, cleanup }),
    steps,
  }
}

function diagnoseLiveSmokeRun({ failedStep, steps, tempRoot, cityRoot, projectRoot, target, cleanup }) {
  if (!failedStep) return []
  if (failedStep === 'gascity-live-cleanup') {
    return [
      {
        code: 'gascity-live-cleanup-incomplete',
        owner: 'waypoint-smoke-harness',
        waypoint_diagnose: 'not-run-after-cleanup',
        evidence: cleanupFailureEvidence(cleanup),
        guidance: [
          'The live route proof passed, but cleanup did not prove the isolated Gas City supervisor and temp provider processes stopped.',
          `Inspect retained temp state at ${tempRoot}.`,
          `Inspect isolated supervisor status: GC_HOME=${join(tempRoot, 'gc-home')} gc supervisor status --json`,
          `Remove retained temp state after process cleanup: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }
  const failed = steps.find((step) => step.step === failedStep)
  if (!failed) {
    return [
      {
        code: 'gascity-live-smoke-unknown-failure',
        owner: 'unknown',
        waypoint_diagnose: 'not-run',
        evidence: String(failedStep),
        guidance: ['Inspect the live_smoke.steps array for the last completed command.'],
      },
    ]
  }

  if (failed.step === 'gascity-init-city' && failed.timed_out && outputIncludes(failed, ['Waiting for supervisor to start city', 'Adopting sessions'])) {
    return [
      {
        code: 'gascity-supervisor-adoption-timeout',
        owner: 'gascity',
        waypoint_diagnose: 'not-available-before-route-start',
        evidence: 'gc init timed out while waiting for the supervisor to start the city and adopt sessions.',
        guidance: [
          'Treat this as a Gas City supervisor/provider blocker, not a Waypoint route materialization failure.',
          'Because waypoint start did not run, waypoint gascity diagnose will report that route-001 does not exist.',
          `Inspect city status: gc --city ${cityRoot} status --json`,
          `Inspect sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Stop the temp city when finished: gc --city ${cityRoot} stop`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'gascity-add-suspended-rig') {
    const prefixMismatch = outputIncludes(failed, ['already has bead prefix', 'requested'])
    return [
      {
        code: prefixMismatch ? 'gascity-rig-prefix-mismatch' : 'gascity-rig-adoption-failed',
        owner: 'gascity',
        waypoint_diagnose: 'not-available-before-route-start',
        evidence: failureEvidence(failed),
        guidance: [
          prefixMismatch
            ? 'Use the existing Beads issue prefix from bd where --json when adopting a rig, or omit --prefix if Gas City supports that for the installed version.'
            : 'Confirm the temp Waypoint project has a healthy .beads workspace before retrying rig adoption.',
          `Inspect Beads readiness: cd ${projectRoot} && bd where --json`,
          `Inspect city status: gc --city ${cityRoot} status --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-start-gascity') {
    const timedOut = failed.timed_out === true
    const doltUnavailable = outputIncludesAny(failed, ['Dolt server unreachable', 'database "']) && outputIncludesAny(failed, ['Beads CLI add dependency failed', 'Beads CLI create issue failed', 'failed to open database'])
    return [
      {
        code: doltUnavailable
          ? 'gascity-live-beads-dolt-unavailable'
          : timedOut
            ? 'waypoint-gascity-start-delegation-timeout'
            : 'waypoint-gascity-start-delegation-failed',
        owner: doltUnavailable ? 'gascity-beads' : 'waypoint-or-gascity',
        waypoint_diagnose: `node ${waypointCli} gascity diagnose --route-id route-001 --target ${target} --city ${cityRoot} --rig waypoint-live --provider codex --json`,
        evidence: failureEvidence(failed),
        guidance: [
          doltUnavailable
            ? 'Gas City reached the convoy/dependency write, but the temp Beads/Dolt store was not reachable through the runtime path.'
            : timedOut
              ? 'The route was materialized, but delegation did not return before the live harness timeout.'
              : 'If route-001 exists, run waypoint gascity diagnose to distinguish missing route metadata from Gas City session/provider failures.',
          doltUnavailable ? `Inspect Beads/Dolt status: cd ${projectRoot} && bd dolt status --json` : 'If route-001 does not exist, inspect the start command output before retrying to avoid duplicate route materialization.',
          doltUnavailable ? `Inspect Beads doctor output: cd ${projectRoot} && bd doctor` : undefined,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ].filter(Boolean),
      },
    ]
  }

  if (failed.step === 'beads-store-ready') {
    return [
      {
        code: 'gascity-rig-store-not-ready',
        owner: 'gascity',
        waypoint_diagnose: 'not-available-before-route-start',
        evidence: failureEvidence(failed),
        guidance: [
          'Gas City added the suspended rig, but raw bd commands could not open the inherited Beads database before Waypoint route materialization.',
          `Inspect rig status: gc --city ${cityRoot} rig status waypoint-live --json`,
          `Inspect Beads/Dolt status: cd ${projectRoot} && bd dolt status --json`,
          `Inspect city events: gc --city ${cityRoot} events --since 10m`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'gascity-beads-provider-ready') {
    return [
      {
        code: 'gascity-live-beads-dolt-unavailable',
        owner: 'gascity-beads',
        waypoint_diagnose: 'not-available-before-route-start',
        evidence: failureEvidence(failed),
        guidance: [
          'The temp Beads workspace exists, but the Dolt SQL server required by the live execution path could not be started or verified.',
          `Inspect Beads/Dolt status: cd ${projectRoot} && bd dolt status --json`,
          `Inspect Beads doctor output: cd ${projectRoot} && bd doctor`,
          `Inspect city events: gc --city ${cityRoot} events --since 10m`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-gascity-diagnose') {
    return [
      {
        code: 'waypoint-gascity-diagnose-reported-blocker',
        owner: 'diagnosed-by-waypoint',
        waypoint_diagnose: 'already-run',
        evidence: failureEvidence(failed),
        guidance: [
          'Use the JSON error or diagnostics from the failed diagnose step as the operator-facing blocker.',
          `Inspect Gas City sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'gascity-no-nudge-session-check') {
    return [
      {
        code: 'gascity-no-nudge-started-or-woke-session',
        owner: 'waypoint-gascity-contract',
        waypoint_diagnose: 'already-run-before-diagnose',
        evidence: failureEvidence(failed),
        guidance: [
          'Compare the before/after session snapshots in live_smoke.steps to identify the session id that appeared or woke after no-nudge delegation.',
          'Waypoint no-nudge delegation must remain metadata-only; do not call gc sling or resume a rig from this path.',
          `Inspect recent Gas City events: gc --city ${cityRoot} events --since 1h`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'gascity-execution-observation') {
    return diagnoseLiveExecutionObservation({ failed, steps, tempRoot, cityRoot, projectRoot, target })
  }

  if (failed.step === 'gascity-completion-observation') {
    return diagnoseLiveCompletionObservation({ failed, steps, tempRoot, cityRoot, projectRoot, target })
  }

  if (failed.step === 'gascity-hook-visibility') {
    return [
      {
        code: failed.exit_code === 1 ? 'gascity-hook-no-work-after-dispatch' : 'gascity-hook-no-visible-dispatch-work',
        owner: 'gascity-routing',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The explicit dispatch returned, but Gas City hook output did not expose any Waypoint route issue id to the target agent.',
          `Inspect Beads route issues: cd ${projectRoot} && bd list --all --limit 0 --json`,
          `Inspect hook output for active session agents: cd ${projectRoot} && gc --city ${cityRoot} --rig waypoint-live hook <agent>`,
          `Inspect Gas City events: gc --city ${cityRoot} events --since 1h`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-route-readback') {
    return [
      {
        code: 'waypoint-live-route-readback-failed',
        owner: 'waypoint',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The explicit dispatch returned, but Waypoint could not read route-001 back from the temp project.',
          `Inspect the route store: cd ${projectRoot} && node ${waypointCli} route --route-id route-001 --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-task-readback') {
    return [
      {
        code: 'waypoint-live-task-readback-failed',
        owner: 'waypoint',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The explicit dispatch returned, but Waypoint could not read route-001 task status back from the temp project.',
          `Inspect the task read model: cd ${projectRoot} && node ${waypointCli} tasks --route-id route-001 --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-route-events-readback') {
    return [
      {
        code: 'waypoint-live-route-events-readback-failed',
        owner: 'waypoint',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The provider completion path returned, but Waypoint could not read route events from the temp project.',
          `Inspect route events: cd ${projectRoot} && node ${waypointCli} route-events --route-id route-001 --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-completion-readback-check') {
    return [
      {
        code: 'waypoint-live-completion-readback-mismatch',
        owner: 'waypoint',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The routed Beads task closed, but Waypoint read models did not show the completed task and advanced route state expected by the completion smoke.',
          `Inspect route readback: cd ${projectRoot} && node ${waypointCli} route --route-id route-001 --json`,
          `Inspect task readback: cd ${projectRoot} && node ${waypointCli} tasks --route-id route-001 --json`,
          `Inspect route events: cd ${projectRoot} && node ${waypointCli} route-events --route-id route-001 --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  if (failed.step === 'waypoint-gascity-next-dispatch-dry-run') {
    return [
      {
        code: 'waypoint-live-next-dispatch-probe-failed',
        owner: 'waypoint-gascity-contract',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: failureEvidence(failed),
        guidance: [
          'The routed Beads task closed, but Waypoint could not prove that the next Gas City dispatch would select the next executable task or stop at a gate/wait.',
          `Inspect dry-run dispatch: cd ${projectRoot} && node ${waypointCli} gascity sling --route-id route-001 --target ${target} --city ${cityRoot} --rig waypoint-live --provider codex --dry-run --json`,
          `Inspect task readback: cd ${projectRoot} && node ${waypointCli} tasks --route-id route-001 --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  return [
    {
      code: 'gascity-live-smoke-step-failed',
      owner: failed.command.startsWith('gc ') ? 'gascity' : 'waypoint',
      waypoint_diagnose: failed.step.startsWith('waypoint-gascity') ? 'see-failed-step-output' : 'not-run',
      evidence: failureEvidence(failed),
      guidance: [`Inspect retained temp state at ${tempRoot}.`],
    },
  ]
}

function diagnoseLiveExecutionObservation({ failed, steps, tempRoot, cityRoot, projectRoot, target }) {
  const sessions = latestLiveSessions(steps, 'gascity-session-list-after-dispatch')
  const creating = sessions.find((session) => session.status.toLowerCase() === 'creating')
  if (creating) {
    return [
      {
        code: 'gascity-live-session-creating-without-claim',
        owner: 'gascity-or-provider',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: `Session ${creating.id} was creating, but no Beads claim or completion was observed before timeout.`,
        guidance: [
          'Inspect Gas City events for provider trust, login, or startup prompts.',
          `Inspect sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  const drained = sessions.find((session) => session.status.toLowerCase() === 'drained')
  if (drained) {
    return [
      {
        code: drained.drain_reason === 'config-drift' ? 'gascity-worker-drained-config-drift' : 'gascity-live-session-drained-without-claim',
        owner: 'gascity',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: `Session ${drained.id} drained before any Beads claim or completion was observed.`,
        guidance: [
          'Treat this as a runtime/session blocker, not a Waypoint quest failure.',
          `Inspect sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  return [
    {
      code: 'gascity-live-execution-no-claim',
      owner: 'gascity-or-provider',
      waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
      evidence: failureEvidence(failed),
      guidance: [
        'The explicit Gas City dispatch returned, but no Beads issue was claimed or completed within the configured wait budget.',
        `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
        `Inspect all temp Beads issues: cd ${projectRoot} && bd list --all --limit 0 --json`,
        `Inspect Gas City sessions: gc --city ${cityRoot} session list --state all --json`,
        `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
        `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
      ],
    },
  ]
}

function diagnoseLiveCompletionObservation({ failed, steps, tempRoot, cityRoot, projectRoot, target }) {
  const sessions = latestLiveSessions(steps, 'gascity-session-list-after-dispatch')
  const status = String(failed.issue_status ?? '').toLowerCase()
  if (status === 'open' && failed.issue_started_at && !failed.assignee) {
    return [
      {
        code: 'gascity-work-claim-released-after-start',
        owner: 'gascity',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: `Bead ${failed.bead_id} has started_at=${failed.issue_started_at} but is open and unassigned; ${failed.notes_signal ? 'notes were recorded' : 'no notes were recorded'} and ${failed.comment_count ?? 0} Beads comments were observed.`,
        guidance: [
          'Treat this as a released provider/session claim after startup, not as ordinary ready work.',
          `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
          `Inspect Beads comments: cd ${projectRoot} && bd comments ${failed.bead_id} --json`,
          `Inspect Gas City sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          'Require an explicit recovery policy before clearing assignment, reopening, or re-slinging work.',
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }
  if (status === 'in_progress' || failed.assignee || failed.issue_started_at) {
    return [
      {
        code: 'gascity-live-task-claimed-not-completed',
        owner: 'gascity-or-provider',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: `Bead ${failed.bead_id} was started${failed.assignee ? ` by ${failed.assignee}` : ''}, but did not close before the completion timeout.`,
        guidance: [
          'Inspect the provider session and Beads issue before retrying; do not re-sling the same task without an explicit recovery decision.',
          `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
          `Inspect Beads comments: cd ${projectRoot} && bd comments ${failed.bead_id} --json`,
          `Inspect Gas City sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  const creating = sessions.find((session) => session.status.toLowerCase() === 'creating')
  if (creating) {
    return [
      {
        code: 'gascity-live-session-creating-without-completion',
        owner: 'gascity-or-provider',
        waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
        evidence: `Session ${creating.id} was creating, but Bead ${failed.bead_id} did not close before timeout.`,
        guidance: [
          'Inspect Gas City events for provider trust, login, or startup prompts.',
          `Inspect sessions: gc --city ${cityRoot} session list --state all --json`,
          `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
          `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
          `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
        ],
      },
    ]
  }

  return [
    {
      code: 'gascity-live-completion-not-observed',
      owner: 'gascity-or-provider',
      waypoint_diagnose: liveStepRunState(steps, 'waypoint-gascity-diagnose'),
      evidence: failureEvidence(failed),
      guidance: [
        'The explicit Gas City dispatch returned, but the routed Beads issue did not close within the configured completion wait budget.',
        `Inspect Beads work: cd ${projectRoot} && bd show ${failed.bead_id} --json`,
        `Inspect Beads comments: cd ${projectRoot} && bd comments ${failed.bead_id} --json`,
        `Inspect all temp Beads issues: cd ${projectRoot} && bd list --all --limit 0 --json`,
        `Inspect Gas City sessions: gc --city ${cityRoot} session list --state all --json`,
        `Inspect recent events: gc --city ${cityRoot} events --since 1h`,
        `Remove retained temp state after inspection: rm -rf ${tempRoot}`,
      ],
    },
  ]
}

function readLiveSessionSnapshot(step) {
  const parsed = parseLiveSessionSnapshot(step.stdout)
  if (!parsed.ok) {
    step.ok = false
    step.error = parsed.error
    throw new LiveSmokeStepError(step.step)
  }
  step.sessions = parsed.sessions
  return parsed.sessions
}

function parseLiveSessionSnapshot(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.sessions)
        ? parsed.sessions
        : []
    return {
      ok: true,
      sessions: entries.map(normalizeLiveSession).filter(Boolean),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      sessions: [],
    }
  }
}

function normalizeLiveSession(entry) {
  if (!isRecord(entry)) return null
  const id = stringField(entry, ['id', 'ID', 'session_id', 'SessionID', 'name', 'Name'])
  const status = stringField(entry, ['status', 'Status', 'state', 'State'])
  if (!id || !status) return null
  return {
    id,
    status,
    target: stringField(entry, ['target', 'Target']),
    template: stringField(entry, ['template', 'Template', 'template_name', 'TemplateName']),
    alias: stringField(entry, ['alias', 'Alias']),
    agent_name: stringField(entry, ['agent_name', 'AgentName', 'agentName']),
    drain_reason: stringField(entry, ['drain_reason', 'DrainReason', 'drainReason']),
    age_seconds: numberField(entry, ['age_seconds', 'AgeSeconds', 'ageSeconds']),
    created_at: stringField(entry, ['created_at', 'CreatedAt', 'createdAt']),
    last_active: stringField(entry, ['last_active', 'LastActive', 'lastActive']),
    closed: booleanField(entry, ['closed', 'Closed']),
  }
}

function recordNoNudgeSessionCheck(steps, input) {
  const violations = detectNoNudgeSessionActivity(input)
  const stepResult = {
    step: 'gascity-no-nudge-session-check',
    ok: violations.length === 0,
    command: 'compare-session-snapshots before-no-nudge after-no-nudge',
    cwd: input.cwd,
    timeout_ms: 0,
    started_at: new Date().toISOString(),
    baseline_session_count: input.before.length,
    after_session_count: input.after.length,
    violations,
  }
  steps.push(stepResult)
  if (!stepResult.ok) throw new LiveSmokeStepError(stepResult.step)
  return stepResult
}

function detectNoNudgeSessionActivity(input) {
  const beforeById = new Map(input.before.map((session) => [session.id, session]))
  const startedAtMs = Date.parse(input.startedAt)
  const violations = []
  for (const afterSession of input.after) {
    const beforeSession = beforeById.get(afterSession.id)
    if (!beforeSession) {
      const createdAtMs = Date.parse(afterSession.created_at ?? '')
      if (!Number.isFinite(createdAtMs) || !Number.isFinite(startedAtMs) || createdAtMs >= startedAtMs) {
        violations.push({
          code: 'gascity-no-nudge-started-session',
          id: afterSession.id,
          status: afterSession.status,
          created_at: afterSession.created_at,
        })
      }
      continue
    }

    if (isInactiveSessionStatus(beforeSession.status) && isActiveSessionStatus(afterSession.status)) {
      violations.push({
        code: 'gascity-no-nudge-woke-session',
        id: afterSession.id,
        before_status: beforeSession.status,
        after_status: afterSession.status,
      })
    }
  }
  return violations
}

function recordLiveExecutionObservation(steps, input) {
  const startedAt = new Date().toISOString()
  const deadline = Date.now() + input.timeout
  let attempts = 0
  let lastRootResult = null
  let lastListResult = null
  let lastSignal = null
  let lastParseError = null

  while (Date.now() <= deadline) {
    attempts += 1
    const remaining = Math.max(1000, deadline - Date.now())
    const rootResult = spawnSync('bd', ['show', input.beadId, '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, remaining),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    const listResult = spawnSync('bd', ['list', '--all', '--limit', '0', '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, remaining),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    lastRootResult = rootResult
    lastListResult = listResult

    if (rootResult.status === 0 && !rootResult.error && listResult.status === 0 && !listResult.error) {
      const parsedRoot = parseLiveIssues(rootResult.stdout)
      const parsedList = parseLiveIssues(listResult.stdout)
      lastParseError = parsedRoot.error ?? parsedList.error ?? null
      if (parsedRoot.ok && parsedList.ok) {
        lastSignal = findLiveExecutionSignal({
          rootBeadId: input.beadId,
          issues: [...parsedRoot.issues, ...parsedList.issues],
        })
        if (lastSignal) {
          const stepResult = {
            step: 'gascity-execution-observation',
            ok: true,
            command: `bd show ${input.beadId} --json + bd list --all --limit 0 --json`,
            cwd: input.cwd,
            timeout_ms: input.timeout,
            started_at: startedAt,
            attempts,
            bead_id: input.beadId,
            signal_issue_id: lastSignal.id,
            issue_status: lastSignal.status,
            assignee: lastSignal.assignee,
            stdout: trimOutput(rootResult.stdout),
            stderr: trimOutput(`${rootResult.stderr}\n${listResult.stderr}`),
          }
          steps.push(stepResult)
          return stepResult
        }
      }
    }

    sleepSync(Math.min(5000, Math.max(0, deadline - Date.now())))
  }

  const stepResult = {
    step: 'gascity-execution-observation',
    ok: false,
    command: `bd show ${input.beadId} --json + bd list --all --limit 0 --json`,
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    attempts,
    bead_id: input.beadId,
    issue_status: lastSignal?.status ?? null,
    assignee: lastSignal?.assignee ?? null,
    exit_code: lastRootResult?.status ?? lastListResult?.status ?? null,
    signal: lastRootResult?.signal ?? lastListResult?.signal ?? null,
    timed_out: lastRootResult?.error?.code === 'ETIMEDOUT' || lastListResult?.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(lastRootResult?.stdout),
    stderr: trimOutput(`${lastRootResult?.stderr ?? ''}\n${lastListResult?.stderr ?? ''}`),
    error: lastRootResult?.error?.message
      ?? lastListResult?.error?.message
      ?? lastParseError
      ?? `No Beads claim or completion observed for ${input.beadId} within ${input.timeout}ms.`,
  }
  steps.push(stepResult)
  return stepResult
}

function recordLiveCompletionObservation(steps, input) {
  const startedAt = new Date().toISOString()
  const deadline = Date.now() + input.timeout
  let attempts = 0
  let lastRootResult = null
  let lastListResult = null
  let lastCommentsResult = null
  let lastIssue = null
  let lastParseError = null
  let lastComments = []

  while (Date.now() <= deadline) {
    attempts += 1
    const remaining = Math.max(1000, deadline - Date.now())
    const rootResult = spawnSync('bd', ['show', input.beadId, '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, remaining),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    const commentsResult = spawnSync('bd', ['comments', input.beadId, '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, remaining),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    const listResult = spawnSync('bd', ['list', '--all', '--limit', '0', '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, remaining),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    lastRootResult = rootResult
    lastCommentsResult = commentsResult
    lastListResult = listResult

    if (rootResult.status === 0 && !rootResult.error && listResult.status === 0 && !listResult.error) {
      const parsedRoot = parseLiveIssues(rootResult.stdout)
      const parsedList = parseLiveIssues(listResult.stdout)
      const parsedComments = commentsResult.status === 0 && !commentsResult.error
        ? parseLiveComments(commentsResult.stdout)
        : { ok: false, comments: [], error: commentsResult.error?.message ?? firstLine(commentsResult.stderr) }
      lastParseError = parsedRoot.error ?? parsedList.error ?? parsedComments.error ?? null
      lastComments = parsedComments.comments
      if (parsedRoot.ok && parsedList.ok) {
        lastIssue = findLiveIssueById({
          issueId: input.beadId,
          issues: [...parsedRoot.issues, ...parsedList.issues],
        })
        if (lastIssue?.status.toLowerCase() === 'closed') {
          const stepResult = {
            step: 'gascity-completion-observation',
            ok: true,
            command: `bd show ${input.beadId} --json + bd comments ${input.beadId} --json + bd list --all --limit 0 --json`,
            cwd: input.cwd,
            timeout_ms: input.timeout,
            started_at: startedAt,
            attempts,
            bead_id: input.beadId,
            issue_status: lastIssue.status,
            assignee: lastIssue.assignee,
            issue_started_at: lastIssue.started_at,
            close_reason: lastIssue.close_reason,
            notes_signal: Boolean(lastIssue.notes),
            comment_count: lastComments.length,
            comment_signal: lastComments.length > 0,
            stdout: trimOutput(rootResult.stdout),
            stderr: trimOutput(`${rootResult.stderr}\n${commentsResult.stderr}\n${listResult.stderr}`),
          }
          steps.push(stepResult)
          return stepResult
        }
      }
    }

    sleepSync(Math.min(5000, Math.max(0, deadline - Date.now())))
  }

  const stepResult = {
    step: 'gascity-completion-observation',
    ok: false,
    command: `bd show ${input.beadId} --json + bd comments ${input.beadId} --json + bd list --all --limit 0 --json`,
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    attempts,
    bead_id: input.beadId,
    issue_status: lastIssue?.status ?? null,
    assignee: lastIssue?.assignee ?? null,
    issue_started_at: lastIssue?.started_at ?? null,
    close_reason: lastIssue?.close_reason ?? null,
    notes_signal: Boolean(lastIssue?.notes),
    comment_count: lastComments.length,
    exit_code: lastRootResult?.status ?? lastListResult?.status ?? lastCommentsResult?.status ?? null,
    signal: lastRootResult?.signal ?? lastListResult?.signal ?? lastCommentsResult?.signal ?? null,
    timed_out: lastRootResult?.error?.code === 'ETIMEDOUT'
      || lastListResult?.error?.code === 'ETIMEDOUT'
      || lastCommentsResult?.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(lastRootResult?.stdout),
    stderr: trimOutput(`${lastRootResult?.stderr ?? ''}\n${lastCommentsResult?.stderr ?? ''}\n${lastListResult?.stderr ?? ''}`),
    error: lastRootResult?.error?.message
      ?? lastListResult?.error?.message
      ?? lastCommentsResult?.error?.message
      ?? lastParseError
      ?? `No Beads close signal observed for ${input.beadId} within ${input.timeout}ms.`,
  }
  steps.push(stepResult)
  return stepResult
}

function recordLiveCompletionReadback(steps, input) {
  const routeParsed = parseJsonObject(rawStepStdout(input.routeStep))
  const taskParsed = parseJsonObject(rawStepStdout(input.taskStep))
  const eventParsed = parseJsonObject(rawStepStdout(input.eventStep))
  const route = isRecord(routeParsed.value?.route) ? routeParsed.value.route : null
  const tasks = Array.isArray(taskParsed.value?.tasks) ? taskParsed.value.tasks : []
  const events = Array.isArray(eventParsed.value?.items) ? eventParsed.value.items : []
  const completedTask = tasks.find((task) => isRecord(task) && task.id === input.completedBeadId)
  const currentNode = typeof route?.current_node === 'string' ? route.current_node : null
  const currentTask = currentNode ? tasks.find((task) => isRecord(task) && task.plan_ref === currentNode) : null
  const completedTaskStatus = isRecord(completedTask) && typeof completedTask.status === 'string' ? completedTask.status : null
  const completedBeadsStatus = isRecord(completedTask) ? beadsMetadata(completedTask).status : null
  const routeStatus = typeof route?.status === 'string' ? route.status : null
  const currentKind = isRecord(currentTask) && typeof currentTask.kind === 'string' ? currentTask.kind : null
  const completedPlanRef = isRecord(completedTask) && typeof completedTask.plan_ref === 'string' ? completedTask.plan_ref : null
  const routeAdvanced = routeStatus === 'complete' || currentNode === null || (completedPlanRef !== null && currentNode !== completedPlanRef)
  const eventReadbackOk = events.some((event) => isRecord(event) && event.kind === 'route.started')
  const stepResult = {
    step: 'waypoint-completion-readback-check',
    ok: routeParsed.ok
      && taskParsed.ok
      && eventParsed.ok
      && completedTaskStatus === 'done'
      && completedBeadsStatus === 'closed'
      && routeAdvanced
      && eventReadbackOk,
    command: 'parse waypoint route/tasks/route-events readback',
    timeout_ms: 0,
    completed_bead_id: input.completedBeadId,
    completed_task_status: completedTaskStatus,
    completed_beads_status: completedBeadsStatus,
    completed_plan_ref: completedPlanRef,
    route_status: routeStatus,
    current_node: currentNode,
    current_task_kind: currentKind,
    route_advanced: routeAdvanced,
    event_count: events.length,
    error: routeParsed.error
      ?? taskParsed.error
      ?? eventParsed.error
      ?? (!completedTask ? `Waypoint tasks readback did not include ${input.completedBeadId}` : undefined)
      ?? (completedTaskStatus !== 'done' || completedBeadsStatus !== 'closed' ? 'Completed Beads issue did not read back as Waypoint done/closed.' : undefined)
      ?? (!routeAdvanced ? 'Waypoint route current_node did not advance past the completed task.' : undefined)
      ?? (!eventReadbackOk ? 'Waypoint route-events readback did not include route.started.' : undefined),
  }
  steps.push(stepResult)
  return stepResult
}

function recordLiveNextDispatchProbe(steps, input) {
  if (input.completionReadback.route_status === 'complete') {
    const stepResult = {
      step: 'waypoint-gascity-next-dispatch-dry-run',
      ok: true,
      skipped: true,
      command: 'skipped: route complete after provider completion',
      timeout_ms: 0,
      completed_bead_id: input.completedBeadId,
      route_status: input.completionReadback.route_status,
    }
    steps.push(stepResult)
    return stepResult
  }

  const currentIsControlStop = input.completionReadback.current_task_kind === 'gate' || input.completionReadback.current_task_kind === 'wait'
  const stepResult = runLiveStep(steps, {
    step: 'waypoint-gascity-next-dispatch-dry-run',
    command: process.execPath,
    args: [
      waypointCli,
      'gascity',
      'sling',
      '--route-id',
      'route-001',
      '--target',
      input.target,
      '--city',
      input.city,
      '--rig',
      input.rig,
      '--provider',
      'codex',
      '--dry-run',
      '--json',
    ],
    cwd: input.cwd,
    timeout: 60000,
    allowFailure: true,
    env: input.env,
  })

  if (currentIsControlStop) {
    stepResult.expected_control_stop = true
    stepResult.ok = stepResult.exit_code !== 0 && outputIncludesAny(stepResult, ['no current Gas City-routable Beads task', 'Human gates and wait nodes'])
    if (!stepResult.ok) {
      stepResult.error = stepResult.error ?? 'Expected Gas City dry-run dispatch to stop at the current gate/wait, but it did not.'
    }
    return stepResult
  }

  const parsed = parseJsonObject(rawStepStdout(stepResult))
  const routedBeadId = parsed.ok && typeof parsed.value?.routedBeadId === 'string' ? parsed.value.routedBeadId : null
  stepResult.routed_bead_id = routedBeadId
  stepResult.ok = stepResult.ok && parsed.ok && routedBeadId !== null && routedBeadId !== input.completedBeadId
  if (!stepResult.ok) {
    stepResult.error = stepResult.error
      ?? parsed.error
      ?? (routedBeadId === input.completedBeadId
        ? 'Gas City dry-run selected the completed Beads issue instead of the next executable task.'
        : 'Gas City dry-run did not report a next routed Bead id.')
  }
  return stepResult
}

function recordLiveHookVisibility(steps, input) {
  const startedAt = new Date().toISOString()
  const routeIssueProbe = readLiveWaypointIssueIds({
    cwd: input.cwd,
    routeId: input.routeId,
    timeout: input.timeout,
    env: input.env,
  })
  const routeIssueIds = routeIssueProbe.issueIds
  const agents = [...new Set(input.agents.filter((agent) => typeof agent === 'string' && agent.trim() !== ''))]
  const hookResults = agents.map((agent) => {
    const result = spawnSync('gc', ['--city', input.city, '--rig', input.rig, 'hook', agent], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: input.timeout,
      maxBuffer: liveCommandMaxBufferBytes,
    })
    const hookOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    return {
      agent,
      result,
      visibleIssueIds: routeIssueIds.filter((issueId) => hookOutput.includes(issueId)),
    }
  })
  const visible = hookResults.find((entry) => entry.result.status === 0 && !entry.result.error && entry.visibleIssueIds.length > 0)
  const firstWork = hookResults.find((entry) => entry.result.status === 0 && !entry.result.error)
  const representative = visible ?? firstWork ?? hookResults[0]
  const visibleIssueIds = visible?.visibleIssueIds ?? []
  const expectedIssueIds = [input.rootBeadId, input.routedBeadId, input.dispatchBeadId].filter(Boolean)
  const stepResult = {
    step: 'gascity-hook-visibility',
    ok: Boolean(visible),
    command: `${formatCommand('gc', ['--city', input.city, '--rig', input.rig, 'hook'])} <agent>`,
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    exit_code: representative?.result.status ?? null,
    signal: representative?.result.signal ?? null,
    timed_out: hookResults.some((entry) => entry.result.error?.code === 'ETIMEDOUT'),
    route_issue_count: routeIssueIds.length,
    route_issue_probe_ok: routeIssueProbe.ok,
    agent_candidates: agents,
    hook_results: hookResults.map((entry) => ({
      agent: entry.agent,
      exit_code: entry.result.status,
      visible_issue_ids: entry.visibleIssueIds,
    })),
    expected_issue_ids: expectedIssueIds,
    visible_issue_ids: visibleIssueIds,
    stdout: trimOutput(hookResults.map((entry) => `[${entry.agent}]\n${entry.result.stdout}`).join('\n')),
    stderr: trimOutput(hookResults.map((entry) => `[${entry.agent}]\n${entry.result.stderr}`).join('\n')),
    error: representative?.result.error?.message
      ?? routeIssueProbe.error
      ?? (hookResults.every((entry) => entry.result.status === 1) ? 'Gas City hook returned no work for all active session agent candidates.' : undefined)
      ?? (visibleIssueIds.length === 0 ? 'Gas City hook output did not contain any Waypoint route issue id.' : undefined),
  }
  steps.push(stepResult)
  return stepResult
}

function parseLiveIssues(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const entries = Array.isArray(parsed) ? parsed : [parsed]
    const issues = entries
      .map(normalizeLiveIssue)
      .filter(Boolean)
    return { ok: true, issues }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      issues: [],
    }
  }
}

function parseLiveComments(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.comments)
        ? parsed.comments
        : []
    return {
      ok: true,
      comments: entries.map(normalizeLiveComment).filter(Boolean),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      comments: [],
    }
  }
}

function parseJsonObject(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    return isRecord(parsed) ? { ok: true, value: parsed } : { ok: false, value: null, error: 'JSON output was not an object.' }
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeLiveComment(entry) {
  if (!isRecord(entry)) return null
  const id = stringField(entry, ['id', 'ID'])
  const text = stringField(entry, ['text', 'Text', 'body', 'Body', 'comment', 'Comment'])
  return {
    id,
    text,
    author: stringField(entry, ['author', 'Author', 'created_by', 'CreatedBy']),
    created_at: stringField(entry, ['created_at', 'CreatedAt', 'createdAt']),
  }
}

function readLiveWaypointIssueIds(input) {
  const result = spawnSync('bd', ['list', '--all', '--limit', '0', '--json'], {
    cwd: input.cwd,
    env: input.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: input.timeout,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  if (result.status !== 0 || result.error) {
    return {
      ok: false,
      issueIds: [],
      error: result.error?.message ?? firstLine(result.stderr) ?? `bd list exited ${result.status ?? 'unknown'}`,
    }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    const entries = Array.isArray(parsed) ? parsed : []
    return {
      ok: true,
      issueIds: entries
        .filter((entry) => issueRouteId(entry) === input.routeId)
        .map((entry) => entry.id)
        .filter((id) => typeof id === 'string'),
    }
  } catch (error) {
    return {
      ok: false,
      issueIds: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function issueRouteId(issue) {
  if (!isRecord(issue)) return null
  const metadata = metadataRecord(issue.metadata)
  const waypoint = isRecord(metadata?.waypoint) ? metadata.waypoint : null
  return typeof waypoint?.route_id === 'string' ? waypoint.route_id : null
}

function metadataRecord(value) {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function beadsMetadata(value) {
  if (!isRecord(value)) return {}
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  return isRecord(metadata.beads) ? metadata.beads : {}
}

function normalizeLiveIssue(entry) {
  if (!isRecord(entry)) return null
  const id = stringField(entry, ['id', 'ID'])
  const status = stringField(entry, ['status', 'Status'])
  if (!id || !status) return null
  return {
    id,
    status,
    assignee: nullableStringField(entry, ['assignee', 'Assignee']),
    started_at: nullableStringField(entry, ['started_at', 'StartedAt', 'startedAt']),
    close_reason: nullableStringField(entry, ['close_reason', 'CloseReason', 'closeReason']),
    notes: nullableStringField(entry, ['notes', 'Notes']),
  }
}

function findLiveIssueById(input) {
  const byId = new Map(input.issues.map((issue) => [issue.id, issue]))
  return byId.get(input.issueId) ?? null
}

function findLiveExecutionSignal(input) {
  const root = findLiveIssueById({ issueId: input.rootBeadId, issues: input.issues })
  if (root && isLiveExecutionSignal(root)) return root
  return input.issues.find(isLiveExecutionSignal) ?? null
}

function isLiveExecutionSignal(issue) {
  const status = issue.status.toLowerCase()
  return Boolean(issue.assignee) || Boolean(issue.started_at) || status === 'in_progress' || status === 'closed'
}

function isActiveSessionStatus(status) {
  return ['active', 'running', 'creating'].includes(String(status).toLowerCase())
}

function isInactiveSessionStatus(status) {
  return ['asleep', 'closed', 'drained', 'stopped', 'suspended'].includes(String(status).toLowerCase())
}

function runLiveStep(steps, input) {
  const startedAt = new Date().toISOString()
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: input.timeout,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  const stepResult = {
    step: input.step,
    ok: result.status === 0 && !result.error,
    command: formatCommand(input.command, input.args),
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    error: result.error?.message,
  }
  Object.defineProperty(stepResult, 'raw_stdout', {
    value: result.stdout ?? '',
    enumerable: false,
  })
  Object.defineProperty(stepResult, 'raw_stderr', {
    value: result.stderr ?? '',
    enumerable: false,
  })
  steps.push(stepResult)
  if (!stepResult.ok && input.allowFailure !== true) throw new LiveSmokeStepError(input.step)
  return stepResult
}

function rawStepStdout(step) {
  return typeof step.raw_stdout === 'string' ? step.raw_stdout : step.stdout
}

function readLiveBeadsPrefix(output) {
  try {
    const parsed = JSON.parse(output)
    return typeof parsed.prefix === 'string' && parsed.prefix.trim() !== '' ? parsed.prefix : null
  } catch {
    return null
  }
}

function readLiveStartBeadId(stdout) {
  return readLiveOutputId(stdout, /^gascity bead:\s+(\S+)$/m) ?? readLiveOutputId(stdout, /^beads root issue:\s+(\S+)$/m)
}

function readLiveDispatchBeadId(stdout) {
  return readLiveOutputId(stdout, /^gascity dispatch bead:\s+(\S+)$/m)
}

function readLiveRoutedBeadId(stdout) {
  return readLiveOutputId(stdout, /^gascity routed bead:\s+(\S+)$/m)
}

function readLiveOutputId(stdout, pattern) {
  const match = stdout.match(pattern)
  return match?.[1] ?? null
}

function hookAgentsForTarget(target, sessions) {
  return [
    target,
    target.split('/').filter(Boolean).at(-1) ?? target,
    ...sessions
      .filter((session) => isActiveSessionStatus(session.status))
      .flatMap((session) => [session.agent_name, session.alias]),
  ].filter(Boolean)
}

function latestLiveSessions(steps, stepName) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.step === stepName && Array.isArray(step.sessions)) return step.sessions
  }
  return []
}

function liveStepRunState(steps, stepName) {
  const step = steps.find((entry) => entry.step === stepName)
  if (!step) return 'not-run'
  return step.ok ? 'already-run' : 'ran-but-failed'
}

function waitForLiveBeadsStore(steps, input) {
  const startedAt = new Date().toISOString()
  const deadline = Date.now() + input.timeout
  let attempts = 0
  let lastResult = null
  while (Date.now() <= deadline) {
    attempts += 1
    const result = spawnSync('bd', ['list', '--json'], {
      cwd: input.cwd,
      env: input.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, Math.max(1000, deadline - Date.now())),
      maxBuffer: liveCommandMaxBufferBytes,
    })
    lastResult = result
    if (result.status === 0 && !result.error) {
      steps.push({
        step: 'beads-store-ready',
        ok: true,
        command: 'bd list --json',
        cwd: input.cwd,
        timeout_ms: input.timeout,
        started_at: startedAt,
        attempts,
        exit_code: result.status,
        signal: result.signal,
        timed_out: result.error?.code === 'ETIMEDOUT',
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        error: result.error?.message,
      })
      return
    }
    sleepSync(Math.min(1000, Math.max(0, deadline - Date.now())))
  }

  const result = lastResult ?? {}
  steps.push({
    step: 'beads-store-ready',
    ok: false,
    command: 'bd list --json',
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    attempts,
    exit_code: result.status ?? null,
    signal: result.signal ?? null,
    timed_out: result.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    error: result.error?.message,
  })
  throw new LiveSmokeStepError('beads-store-ready')
}

function ensureLiveBeadsProvider(steps, input) {
  const startedAt = new Date().toISOString()
  const health = spawnSync('gc', ['--city', input.city, '--rig', input.rig, 'beads', 'health'], {
    cwd: input.cwd,
    env: input.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: input.timeout,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  const verify = spawnSync('bd', ['list', '--json'], {
    cwd: input.cwd,
    env: input.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: input.timeout,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  const stepResult = {
    step: 'gascity-beads-provider-ready',
    ok: health.status === 0 && !health.error && verify.status === 0 && !verify.error,
    command: formatCommand('gc', ['--city', input.city, '--rig', input.rig, 'beads', 'health']) + ' + bd list --json',
    cwd: input.cwd,
    timeout_ms: input.timeout,
    started_at: startedAt,
    exit_code: health.status,
    signal: health.signal,
    timed_out: health.error?.code === 'ETIMEDOUT' || verify.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(`${health.stdout}\n${verify.stdout}`),
    stderr: trimOutput(`${health.stderr}\n${verify.stderr}`),
    error: health.error?.message
      ?? verify.error?.message
      ?? (health.status === 0 ? undefined : `Gas City Beads health exited ${health.status ?? 'unknown'}`)
      ?? (verify.status === 0 ? undefined : `bd list exited ${verify.status ?? 'unknown'}`),
  }
  steps.push(stepResult)
  if (!stepResult.ok) throw new LiveSmokeStepError(stepResult.step)
}

function sleepSync(ms) {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

async function cleanupLiveSmoke({ cityRoot, tempRoot, keepLive, env }) {
  const stop = existsSync(cityRoot)
    ? runCleanupCommand('gc', ['--city', cityRoot, 'stop'], tempRoot, liveGcStopTimeoutMs, env)
    : { skipped: true, reason: 'city directory was not created' }
  const supervisorStatusBefore = runCleanupCommand('gc', ['supervisor', 'status', '--json'], tempRoot, liveGcStopTimeoutMs, env)
  const supervisorBefore = parseSupervisorStatus(supervisorStatusBefore.stdout)
  const supervisorStop = supervisorStatusBefore.ok && supervisorBefore.running
    ? runCleanupCommand('gc', ['supervisor', 'stop', '--wait', '--json'], tempRoot, liveGcStopTimeoutMs, env)
    : { skipped: true, reason: supervisorStatusBefore.ok ? 'supervisor was not running' : 'supervisor status failed' }
  const supervisorStatusAfter = runCleanupCommand('gc', ['supervisor', 'status', '--json'], tempRoot, liveGcStopTimeoutMs, env)
  const supervisorAfter = parseSupervisorStatus(supervisorStatusAfter.stdout)
  const processCheck = inspectLiveTempProcesses(tempRoot)
  const cleanupOk = cleanupResultOk(stop)
    && cleanupResultOk(supervisorStatusBefore)
    && supervisorBefore.ok
    && cleanupResultOk(supervisorStop)
    && cleanupResultOk(supervisorStatusAfter)
    && supervisorAfter.ok
    && supervisorAfter.running === false
    && processCheck.ok
  if (keepLive || !cleanupOk) {
    return {
      status: keepLive ? 'kept' : 'cleanup-failed',
      kept: true,
      tempRoot,
      stop,
      supervisor_status_before: supervisorStatusBefore,
      supervisor_stop: supervisorStop,
      supervisor_status_after: supervisorStatusAfter,
      process_check: processCheck,
      guidance: cleanupOk
        ? `Inspect ${tempRoot}, then remove it manually when no longer needed.`
        : `Cleanup did not prove all temp Gas City processes stopped. Inspect ${tempRoot} before removing it.`,
    }
  }
  await rm(tempRoot, { recursive: true, force: true })
  return {
    status: 'removed',
    kept: false,
    tempRoot,
    stop,
    supervisor_status_before: supervisorStatusBefore,
    supervisor_stop: supervisorStop,
    supervisor_status_after: supervisorStatusAfter,
    process_check: processCheck,
  }
}

function cleanupResultOk(result) {
  return result?.skipped === true || result?.ok === true
}

function parseSupervisorStatus(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    return {
      ok: isRecord(parsed),
      running: Boolean(parsed?.running),
      pid: typeof parsed?.pid === 'number' ? parsed.pid : null,
      socket_path: typeof parsed?.socket_path === 'string' ? parsed.socket_path : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      running: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function inspectLiveTempProcesses(tempRoot) {
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  const processes = String(result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(tempRoot))
  return {
    ok: result.status === 0 && !result.error && processes.length === 0,
    command: 'ps -eo pid=,ppid=,command=',
    timeout_ms: 10000,
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT',
    process_count: processes.length,
    processes: processes.map((line) => trimOutput(line)),
    stderr: trimOutput(result.stderr),
    error: result.error?.message,
  }
}

function runCleanupCommand(command, args, cwd, timeout, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: liveCommandMaxBufferBytes,
  })
  return {
    ok: result.status === 0 && !result.error,
    command: formatCommand(command, args),
    cwd,
    timeout_ms: timeout,
    exit_code: result.status,
    signal: result.signal,
    timed_out: result.error?.code === 'ETIMEDOUT',
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr),
    error: result.error?.message,
  }
}

function checkCommand(check) {
  for (const candidateArgs of check.candidates) {
    const result = spawnSync(check.tool, candidateArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
    if (result.status === 0) {
      return {
        tool: check.tool,
        ok: true,
        argv: [check.tool, ...candidateArgs],
        version: firstLine(result.stdout || result.stderr),
      }
    }
  }

  const probe = spawnSync(check.tool, check.candidates[0], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  })
  return {
    tool: check.tool,
    ok: false,
    argv: [check.tool, ...check.candidates[0]],
    error: probe.error?.message ?? firstLine(probe.stderr) ?? `exit ${probe.status ?? 'unknown'}`,
    guidance: check.guidance,
  }
}

function firstLine(value) {
  const line = (value ?? '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  return line ?? ''
}

function positiveIntegerEnv(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function trimOutput(value) {
  const text = value ?? ''
  const trimmed = text.trim()
  if (trimmed.length <= 4000) return trimmed
  return `${trimmed.slice(0, 4000)}\n[truncated ${trimmed.length - 4000} chars]`
}

function outputIncludes(step, needles) {
  const output = `${step.stdout ?? ''}\n${step.stderr ?? ''}\n${step.error ?? ''}`
  return needles.every((needle) => output.includes(needle))
}

function outputIncludesAny(step, needles) {
  const output = `${step.stdout ?? ''}\n${step.stderr ?? ''}\n${step.error ?? ''}`
  return needles.some((needle) => output.includes(needle))
}

function failureEvidence(step) {
  return step.error
    || summarizeViolations(step.violations)
    || jsonErrorEvidence(step.stderr)
    || jsonErrorEvidence(step.stdout)
    || firstLine(step.stderr)
    || firstLine(step.stdout)
    || `exit ${step.exit_code ?? 'unknown'}`
}

function cleanupFailureEvidence(cleanup) {
  if (cleanup?.process_check?.process_count > 0) {
    return `cleanup left ${cleanup.process_check.process_count} temp process(es): ${cleanup.process_check.processes.join('; ')}`
  }
  if (cleanup?.supervisor_status_after && cleanup.supervisor_status_after.ok && parseSupervisorStatus(cleanup.supervisor_status_after.stdout).running) {
    return 'isolated Gas City supervisor was still running after cleanup'
  }
  return cleanup?.supervisor_stop?.error
    || firstLine(cleanup?.supervisor_stop?.stderr)
    || cleanup?.stop?.error
    || firstLine(cleanup?.stop?.stderr)
    || cleanup?.process_check?.error
    || 'cleanup status was incomplete'
}

function formatCommand(command, args) {
  return [command, ...args].join(' ')
}

function summarizeViolations(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return ''
  return violations
    .map((violation) => `${violation.code}: ${violation.id}`)
    .join('; ')
}

function jsonErrorEvidence(output) {
  const text = output ?? ''
  const match = text.match(/^(.*?)(?:\\{|\{)\s*"error"\s*:\s*"((?:\\.|[^"])*)"/s)
  if (!match) return ''
  const prefix = match[1].trim()
  let error = match[2]
  try {
    error = JSON.parse(`"${error}"`)
  } catch {}
  const evidence = firstLine(error)
  return [prefix, evidence].filter(Boolean).join(' ')
}

function stringField(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

function booleanField(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function nullableStringField(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (value === null) return null
  }
  return null
}

function numberField(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function printHumanReport(smokeReport) {
  process.stdout.write('Waypoint Gas City runtime smoke harness\n')
  process.stdout.write(`mode: ${smokeReport.mode}\n`)
  process.stdout.write(`mutates Waypoint repo: ${String(smokeReport.mutates_waypoint_repo)}\n\n`)

  process.stdout.write('commands exercised:\n')
  for (const entry of smokeReport.command_plan) {
    process.stdout.write(`- ${entry.step}: ${entry.argv.join(' ')}\n`)
  }

  process.stdout.write('\nstate transitions:\n')
  for (const transition of smokeReport.state_transitions) {
    process.stdout.write(`- ${transition.ok ? 'ok' : 'fail'} ${transition.step}: ${transition.detail}\n`)
  }

  process.stdout.write('\ndiagnostic cases:\n')
  for (const scenario of smokeReport.diagnostic_cases) {
    process.stdout.write(`- ${scenario.ok ? 'ok' : 'fail'} ${scenario.name}: ${scenario.actual_codes.join(', ')}\n`)
    for (const diagnostic of scenario.diagnostics) {
      process.stdout.write(`  ${diagnostic.code}: ${diagnostic.evidence}\n`)
    }
  }

  if (smokeReport.live_preflight.status !== 'skipped') {
    process.stdout.write(`\nlive preflight: ${smokeReport.live_preflight.status}\n`)
    for (const check of smokeReport.live_preflight.checks) {
      process.stdout.write(`- ${check.ok ? 'ok' : 'fail'} ${check.tool}`)
      if (check.version) process.stdout.write(`: ${check.version}`)
      if (check.error) process.stdout.write(`: ${check.error}`)
      process.stdout.write('\n')
      if (!check.ok) process.stdout.write(`  ${check.guidance}\n`)
    }
  }

  if (smokeReport.live_build_freshness.status !== 'skipped') {
    process.stdout.write(`\nlive build freshness: ${smokeReport.live_build_freshness.status}\n`)
    for (const check of smokeReport.live_build_freshness.checks) {
      process.stdout.write(`- ${check.ok ? 'ok' : 'fail'} ${check.package}`)
      if (check.reason) process.stdout.write(`: ${check.reason}`)
      process.stdout.write('\n')
      if (!check.ok && check.guidance) process.stdout.write(`  ${check.guidance}\n`)
    }
  }

  if (smokeReport.live_smoke.status !== 'skipped') {
    process.stdout.write(`\nlive smoke: ${smokeReport.live_smoke.status}\n`)
    if (smokeReport.live_smoke.target) process.stdout.write(`target: ${smokeReport.live_smoke.target}\n`)
    process.stdout.write(`cleanup: ${smokeReport.live_smoke.cleanup.status}\n`)
    if (smokeReport.live_smoke.cleanup.kept) {
      process.stdout.write(`temp root: ${smokeReport.live_smoke.temp_root}\n`)
      process.stdout.write(`${smokeReport.live_smoke.cleanup.guidance}\n`)
    }
    for (const diagnostic of smokeReport.live_smoke.diagnostics ?? []) {
      process.stdout.write(`diagnostic ${diagnostic.code}: ${diagnostic.evidence}\n`)
      process.stdout.write(`  owner: ${diagnostic.owner}\n`)
      process.stdout.write(`  waypoint diagnose: ${diagnostic.waypoint_diagnose}\n`)
    }
    for (const step of smokeReport.live_smoke.steps) {
      process.stdout.write(`- ${step.ok ? 'ok' : 'fail'} ${step.step}: ${step.command}\n`)
      if (!step.ok) {
        const detail = step.error || step.stderr || step.stdout || `exit ${step.exit_code ?? 'unknown'}`
        process.stdout.write(`  ${detail}\n`)
      }
    }
  }

  process.stdout.write(`\nGas City runtime smoke ${smokeReport.ok ? 'passed' : 'failed'}\n`)
}

function awaitableTempRootLabel() {
  return join(tmpdir(), 'waypoint-gascity-smoke-*')
}
