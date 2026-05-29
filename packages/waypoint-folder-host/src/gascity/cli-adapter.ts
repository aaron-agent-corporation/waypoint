import { spawn } from 'node:child_process'

export interface WaypointGasCityCliAdapterConfig {
  readonly command?: string
  readonly city?: string
  readonly rig?: string
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly runner?: WaypointGasCityCommandRunner
}

export interface WaypointGasCityCommandInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}

export interface WaypointGasCityCommandOutput {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

export interface WaypointGasCityCommandRunner {
  run(input: WaypointGasCityCommandInput): Promise<WaypointGasCityCommandOutput>
}

export interface WaypointGasCityCommandResult {
  readonly command: string
  readonly stdout: string
  readonly stderr: string
}

export interface WaypointGasCityVersion {
  readonly version: string
  readonly raw: string
}

export type WaypointGasCityPreflightTool = 'gc' | 'bd' | 'dolt' | 'flock' | 'codex'

export interface WaypointGasCityPreflightInput {
  readonly provider?: 'codex' | string
  readonly tools?: readonly WaypointGasCityToolCheckSpec[]
}

export interface WaypointGasCityToolCheckSpec {
  readonly tool: WaypointGasCityPreflightTool | string
  readonly command?: string
  readonly args?: readonly string[]
  readonly guidance?: string
}

export interface WaypointGasCityToolCheck {
  readonly tool: string
  readonly command: string
  readonly args: readonly string[]
  readonly ok: boolean
  readonly version?: string
  readonly details?: string
  readonly guidance?: string
}

export interface WaypointGasCityPreflight {
  readonly ok: boolean
  readonly checks: readonly WaypointGasCityToolCheck[]
}

export interface WaypointGasCityInitCityInput extends WaypointGasCityScopeInput {
  readonly city: string
  readonly provider?: string
  readonly name?: string
  readonly from?: string
  readonly file?: string
  readonly bootstrapProfile?: string
  readonly skipProviderReadiness?: boolean
}

export interface WaypointGasCityRegisterCityInput extends WaypointGasCityScopeInput {
  readonly city?: string
  readonly name?: string
}

export interface WaypointGasCityAddRigInput extends WaypointGasCityScopeInput {
  readonly path: string
  readonly name?: string
  readonly prefix?: string
  readonly adopt?: boolean
  readonly startSuspended?: boolean
  readonly include?: readonly string[]
}

export interface WaypointGasCityCreateConvoyInput extends WaypointGasCityScopeInput {
  readonly name: string
  readonly issueIds?: readonly string[]
  readonly owner?: string
  readonly notify?: string
  readonly merge?: string
  readonly owned?: boolean
  readonly target?: string
}

export interface WaypointGasCityConvoyResult extends WaypointGasCityCommandResult {
  readonly convoyId: string
  readonly name: string
  readonly issueIds: readonly string[]
}

export interface WaypointGasCitySlingBeadInput extends WaypointGasCityScopeInput {
  readonly target: string
  readonly beadId: string
  readonly noFormula?: boolean
  readonly nudge?: boolean
  readonly dryRun?: boolean
  readonly force?: boolean
}

export interface WaypointGasCitySlingResult extends WaypointGasCityCommandResult {
  readonly target: string
  readonly beadId: string
  readonly mode?: 'gascity-sling' | 'metadata-only'
}

export interface WaypointGasCitySessionListInput extends WaypointGasCityScopeInput {
  readonly state?: 'active' | 'suspended' | 'closed' | 'all' | string
  readonly template?: string
}

export interface WaypointGasCitySessionList {
  readonly sessions: readonly WaypointGasCitySession[]
  readonly raw: unknown
}

export interface WaypointGasCitySession {
  readonly id: string
  readonly status: string
  readonly name?: string
  readonly target?: string
  readonly template?: string
  readonly alias?: string
  readonly agentName?: string
  readonly sessionName?: string
  readonly drainReason?: string
  readonly ageSeconds?: number
  readonly createdAt?: string
  readonly lastActive?: string
  readonly closed?: boolean
  readonly raw: unknown
}

export interface WaypointGasCityStatusInput extends WaypointGasCityScopeInput {}

export interface WaypointGasCityStatus {
  readonly status: Record<string, unknown>
  readonly raw: string
}

export interface WaypointGasCityEventsInput extends WaypointGasCityScopeInput {
  readonly since?: string
  readonly type?: string
  readonly timeout?: string
  readonly payloadMatch?: readonly string[]
}

export interface WaypointGasCityEventPage {
  readonly events: readonly Record<string, unknown>[]
  readonly raw: string
}

export interface WaypointGasCityDiagnosticInput {
  readonly expectedTarget: string
  readonly expectedMoleculeId?: string
  readonly task: WaypointGasCityTaskObservation
  readonly hookItems?: readonly WaypointGasCityHookItem[]
  readonly sessions?: readonly WaypointGasCitySessionObservation[]
  readonly events?: readonly WaypointGasCityEventObservation[]
}

export interface WaypointGasCityTaskObservation {
  readonly id: string
  readonly status: string
  readonly assignee?: string | null
  readonly startedAt?: string
  readonly closedAt?: string
  readonly notes?: string
  readonly metadata?: Record<string, unknown>
}

export interface WaypointGasCityHookItem {
  readonly id?: string
}

export interface WaypointGasCitySessionObservation {
  readonly id: string
  readonly status: string
  readonly name?: string
  readonly target?: string
  readonly template?: string
  readonly alias?: string
  readonly agentName?: string
  readonly sessionName?: string
  readonly drainReason?: string
  readonly ageSeconds?: number
}

export interface WaypointGasCityEventObservation {
  readonly type?: string
  readonly message?: string
  readonly payload?: unknown
}

export type WaypointGasCityDiagnosticCode =
  | 'gascity-route-metadata-missing'
  | 'gascity-hook-no-work'
  | 'gascity-worker-stuck-creating'
  | 'gascity-worker-drained-config-drift'
  | 'gascity-work-assignee-not-in-session-list'
  | 'gascity-work-stranded-on-drained-assignee'
  | 'gascity-work-claim-released-after-start'

export interface WaypointGasCityDiagnostic {
  readonly code: WaypointGasCityDiagnosticCode
  readonly severity: 'warning' | 'error'
  readonly evidence: string
  readonly guidance: readonly string[]
}

export interface WaypointGasCityScopeInput {
  readonly city?: string
  readonly rig?: string
}

export interface WaypointGasCityErrorEnvelope {
  readonly ok: false
  readonly action: 'error'
  readonly error: string
  readonly details?: string
}

const DEFAULT_GASCITY_COMMAND_TIMEOUT_MS = 240000

export class WaypointGasCityCliCommandError extends Error {
  readonly operation: string
  readonly command: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string

  constructor(input: {
    readonly operation: string
    readonly command: string
    readonly exitCode: number | null
    readonly signal: NodeJS.Signals | null
    readonly stdout: string
    readonly stderr: string
  }) {
    const status = input.exitCode === null ? `signal ${input.signal ?? 'unknown'}` : `exit ${input.exitCode}`
    const detail = input.stderr.trim() || input.stdout.trim() || status
    super(`Gas City CLI ${input.operation} failed (${status}): ${detail}`)
    this.name = 'WaypointGasCityCliCommandError'
    this.operation = input.operation
    this.command = input.command
    this.exitCode = input.exitCode
    this.signal = input.signal
    this.stdout = input.stdout
    this.stderr = input.stderr
  }
}

export class WaypointGasCityCliAdapter {
  private readonly command: string
  private readonly city: string | undefined
  private readonly rig: string | undefined
  private readonly cwd: string | undefined
  private readonly env: NodeJS.ProcessEnv | undefined
  private readonly timeoutMs: number
  private readonly runner: WaypointGasCityCommandRunner

  constructor(config: WaypointGasCityCliAdapterConfig = {}) {
    this.command = config.command ?? 'gc'
    this.city = config.city
    this.rig = config.rig
    this.cwd = config.cwd
    this.env = config.env
    this.timeoutMs = config.timeoutMs ?? positiveIntegerEnv('WAYPOINT_GASCITY_COMMAND_TIMEOUT_MS', DEFAULT_GASCITY_COMMAND_TIMEOUT_MS)
    this.runner = config.runner ?? new SpawnWaypointGasCityCommandRunner()
  }

  async version(): Promise<WaypointGasCityVersion> {
    const output = await this.runGc(['version'], 'version')
    const raw = output.stdout.trim() || output.stderr.trim()
    return {
      version: firstLine(raw) || raw,
      raw,
    }
  }

  async preflight(input: WaypointGasCityPreflightInput = {}): Promise<WaypointGasCityPreflight> {
    const checks = input.tools ?? defaultPreflightChecks(this.command, input.provider ?? 'codex')
    const results = await Promise.all(checks.map((check) => this.checkTool(check)))
    return {
      ok: results.every((result) => result.ok),
      checks: results,
    }
  }

  async initCity(input: WaypointGasCityInitCityInput): Promise<WaypointGasCityCommandResult> {
    const args = ['init']
    if (input.provider) args.push('--provider', input.provider)
    if (input.name) args.push('--name', input.name)
    if (input.from) args.push('--from', input.from)
    if (input.file) args.push('--file', input.file)
    if (input.bootstrapProfile) args.push('--bootstrap-profile', input.bootstrapProfile)
    if (input.skipProviderReadiness) args.push('--skip-provider-readiness')
    args.push(input.city)
    return this.commandResult(await this.runGc(args, 'init city'))
  }

  async registerCity(input: WaypointGasCityRegisterCityInput = {}): Promise<WaypointGasCityCommandResult> {
    const args = ['register']
    const city = input.city ?? this.city
    if (city) args.push(city)
    if (input.name) args.push('--name', input.name)
    return this.commandResult(await this.runGc(args, 'register city'))
  }

  async addRig(input: WaypointGasCityAddRigInput): Promise<WaypointGasCityCommandResult> {
    const args = [...this.scopeArgs(input), 'rig', 'add', input.path]
    if (input.name) args.push('--name', input.name)
    if (input.prefix) args.push('--prefix', input.prefix)
    for (const include of input.include ?? []) args.push('--include', include)
    if (input.adopt) args.push('--adopt')
    if (input.startSuspended) args.push('--start-suspended')
    return this.commandResult(await this.runGc(args, 'add rig'))
  }

  async createConvoy(input: WaypointGasCityCreateConvoyInput): Promise<WaypointGasCityConvoyResult> {
    const issueIds = input.issueIds ?? []
    const args = [...this.scopeArgs(input), 'convoy', 'create', input.name, ...issueIds]
    if (input.owner) args.push('--owner', input.owner)
    if (input.notify) args.push('--notify', input.notify)
    if (input.merge) args.push('--merge', input.merge)
    if (input.owned) args.push('--owned')
    if (input.target) args.push('--target', input.target)
    const output = await this.runGc(args, 'create convoy')
    const result = this.commandResult(output)
    return {
      ...result,
      convoyId: parseConvoyId(output.stdout, input.name),
      name: input.name,
      issueIds,
    }
  }

  async slingBead(input: WaypointGasCitySlingBeadInput): Promise<WaypointGasCitySlingResult> {
    const args = [...this.scopeArgs(input), 'sling', input.target, input.beadId]
    if (input.noFormula ?? true) args.push('--no-formula')
    if (input.nudge ?? true) args.push('--nudge')
    if (input.dryRun) args.push('--dry-run')
    if (input.force) args.push('--force')
    return {
      ...this.commandResult(await this.runGc(args, 'sling bead')),
      target: input.target,
      beadId: input.beadId,
      mode: 'gascity-sling',
    }
  }

  async listSessions(input: WaypointGasCitySessionListInput = {}): Promise<WaypointGasCitySessionList> {
    const args = [...this.scopeArgs(input), 'session', 'list', '--json']
    if (input.state) args.push('--state', input.state)
    if (input.template) args.push('--template', input.template)
    const output = await this.runGc(args, 'list sessions')
    return parseSessionList(output.stdout)
  }

  async status(input: WaypointGasCityStatusInput = {}): Promise<WaypointGasCityStatus> {
    const output = await this.runGc([...this.scopeArgs(input), 'status', '--json'], 'status')
    const parsed = parseJsonObject(output.stdout, 'status')
    return {
      status: parsed,
      raw: output.stdout,
    }
  }

  async readEvents(input: WaypointGasCityEventsInput = {}): Promise<WaypointGasCityEventPage> {
    const args = [...this.scopeArgs(input), 'events']
    if (input.since) args.push('--since', input.since)
    if (input.type) args.push('--type', input.type)
    if (input.timeout) args.push('--timeout', input.timeout)
    for (const match of input.payloadMatch ?? []) args.push('--payload-match', match)
    const output = await this.runGc(args, 'read events')
    return {
      events: parseJsonLines(output.stdout, 'read events'),
      raw: output.stdout,
    }
  }

  async diagnose(input: WaypointGasCityDiagnosticInput): Promise<readonly WaypointGasCityDiagnostic[]> {
    return diagnoseWaypointGasCityState(input)
  }

  private scopeArgs(input: WaypointGasCityScopeInput): string[] {
    const args: string[] = []
    const city = input.city ?? this.city
    const rig = input.rig ?? this.rig
    if (city) args.push('--city', city)
    if (rig) args.push('--rig', rig)
    return args
  }

  private async checkTool(check: WaypointGasCityToolCheckSpec): Promise<WaypointGasCityToolCheck> {
    const command = check.command ?? (check.tool === 'gc' ? this.command : check.tool)
    const args = check.args ?? defaultToolArgs(check.tool)
    try {
      const output = await this.runner.run({
        command,
        args,
        ...(this.cwd ? { cwd: this.cwd } : {}),
        ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
      })
      const detail = output.stderr.trim() || output.stdout.trim()
      return {
        tool: check.tool,
        command,
        args,
        ok: output.exitCode === 0,
        ...(output.exitCode === 0 ? { version: firstLine(output.stdout || output.stderr) } : { details: detail || `exit ${output.exitCode}` }),
        ...(output.exitCode === 0 ? {} : { guidance: check.guidance ?? defaultToolGuidance(check.tool) }),
      }
    } catch (error) {
      return {
        tool: check.tool,
        command,
        args,
        ok: false,
        details: error instanceof Error ? error.message : String(error),
        guidance: check.guidance ?? defaultToolGuidance(check.tool),
      }
    }
  }

  private async runGc(args: readonly string[], operation: string): Promise<WaypointGasCityCommandOutput> {
    const output = await this.runner.run({
      command: this.command,
      args,
      timeoutMs: this.timeoutMs,
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
    })
    if (output.exitCode !== 0) {
      throw new WaypointGasCityCliCommandError({
        operation,
        command: formatCommand(this.command, args),
        exitCode: output.exitCode,
        signal: output.signal,
        stdout: output.stdout,
        stderr: output.stderr,
      })
    }
    return output
  }

  private commandResult(output: WaypointGasCityCommandOutput): WaypointGasCityCommandResult {
    return {
      command: this.command,
      stdout: output.stdout,
      stderr: output.stderr,
    }
  }
}

export class SpawnWaypointGasCityCommandRunner implements WaypointGasCityCommandRunner {
  run(input: WaypointGasCityCommandInput): Promise<WaypointGasCityCommandOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timeout = input.timeoutMs && input.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
          }, input.timeoutMs)
        : null

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout)
        reject(error)
      })
      child.on('close', (exitCode, signal) => {
        if (timeout) clearTimeout(timeout)
        const timeoutDetails = timedOut ? `\nTimed out after ${input.timeoutMs}ms.` : ''
        const timedOutSignal = timedOut && signal === null ? 'SIGTERM' : signal
        resolve({ exitCode, signal: timedOutSignal, stdout, stderr: `${stderr}${timeoutDetails}` })
      })
    })
  }
}

export function diagnoseWaypointGasCityState(input: WaypointGasCityDiagnosticInput): readonly WaypointGasCityDiagnostic[] {
  const diagnostics: WaypointGasCityDiagnostic[] = []
  const metadata = input.task.metadata ?? {}
  const routedTo = metadata['gc.routed_to']
  const hookItems = input.hookItems
  const sessions = input.sessions ?? []
  const events = input.events ?? []
  const expectedMoleculeId = input.expectedMoleculeId ?? '<molecule-id>'
  const assignedSession = input.task.assignee ?? null
  const taskStartedAt = input.task.startedAt
  const taskClosedAt = input.task.closedAt

  if (routedTo !== input.expectedTarget) {
    diagnostics.push({
      code: 'gascity-route-metadata-missing',
      severity: 'error',
      evidence: `Bead ${input.task.id} lacks gc.routed_to=${input.expectedTarget}`,
      guidance: [
        `Re-run gc sling for ${input.task.id}, or apply an explicit repair if operator policy allows it.`,
        `Repair candidate: bd update ${input.task.id} --set-metadata gc.routed_to=${input.expectedTarget} --set-metadata molecule_id=${expectedMoleculeId}`,
      ],
    })
  }

  if (input.task.status === 'open' && !assignedSession && taskStartedAt && !taskClosedAt) {
    diagnostics.push({
      code: 'gascity-work-claim-released-after-start',
      severity: 'error',
      evidence: `Bead ${input.task.id} has started_at=${taskStartedAt} but is open and unassigned; ${input.task.notes ? 'notes were recorded' : 'no notes were recorded'}.`,
      guidance: [
        'Treat this as a released provider/session claim after startup, not as ordinary ready work.',
        `Inspect Beads work: bd show ${input.task.id} --json`,
        `Inspect Beads comments: bd comments ${input.task.id} --json`,
        'Inspect Gas City events and session trace for orphan, drain, or release signals before retrying.',
        'Require an explicit recovery policy before clearing assignment, reopening, or re-slinging work.',
      ],
    })
  }

  if (hookItems && hookItems.length === 0 && input.task.status === 'open') {
    diagnostics.push({
      code: 'gascity-hook-no-work',
      severity: 'error',
      evidence: `gc hook returned [] while Waypoint task ${input.task.id} is still open`,
      guidance: [
        'Compare Beads blockers, assignment, and Gas City route metadata before starting another worker.',
        'Do not treat provider startup as proof that routed work is visible.',
      ],
    })
  }

  for (const session of sessions) {
    if (session.status === 'creating' && (session.ageSeconds ?? 0) >= 600) {
      diagnostics.push({
        code: 'gascity-worker-stuck-creating',
        severity: 'warning',
        evidence: `Session ${session.id} has been creating for ${session.ageSeconds} seconds`,
        guidance: [
          'Inspect Gas City supervisor logs and provider trust/login prompts.',
          'Next command: gc events --since 1h --type session.started',
          'Keep Waypoint route work pending until a worker is running and hook-visible work exists.',
        ],
      })
    }

    if (session.status === 'drained' && session.drainReason === 'config-drift') {
      const relevant = gasCitySessionMatchesAssignee(session, input.expectedTarget)
        || (assignedSession ? gasCitySessionMatchesAssignee(session, assignedSession) : false)
      diagnostics.push({
        code: 'gascity-worker-drained-config-drift',
        severity: relevant ? 'error' : 'warning',
        evidence: `Session ${session.id} drained due to config-drift`,
        guidance: [
          relevant
            ? 'Treat this as a Gas City runtime blocker, not a Waypoint quest failure.'
            : 'Treat this as background Gas City runtime context unless routed work stops making progress.',
          'Do not silently restart and claim success until routed work is completed or safely reassigned.',
        ],
      })
    }
  }

  const assignedSessionRecord = assignedSession ? sessions.find((session) => gasCitySessionMatchesAssignee(session, assignedSession)) : undefined
  if (input.task.status === 'in_progress' && assignedSession && !assignedSessionRecord) {
    diagnostics.push({
      code: 'gascity-work-assignee-not-in-session-list',
      severity: 'warning',
      evidence: `Bead ${input.task.id} is assigned to ${assignedSession}, but that assignee was not present in the Gas City session list snapshot`,
      guidance: [
        'Treat the Beads assignment as the source of truth for claim observation.',
        'Inspect Gas City sessions and events if the task stops making progress.',
        `Inspect Beads work: bd show ${input.task.id} --json`,
      ],
    })
  }
  if (
    input.task.status === 'in_progress' &&
    assignedSession &&
    assignedSessionRecord &&
    isInactiveGasCitySessionStatus(assignedSessionRecord.status)
  ) {
    diagnostics.push({
      code: 'gascity-work-stranded-on-drained-assignee',
      severity: 'error',
      evidence: `Bead ${input.task.id} is assigned to ${assignedSession}, but that session is inactive or missing`,
      guidance: [
        'Report the Bead id and assignee to the operator.',
        `Inspect Beads work: bd show ${input.task.id} --json`,
        'Inspect Gas City sessions: gc session list --state all --json',
        'Require an explicit recovery policy before clearing assignment, reopening, or re-slinging work.',
      ],
    })
  }

  if (events.some((event) => eventContainsConfigDrift(event)) && !diagnostics.some((diagnostic) => diagnostic.code === 'gascity-worker-drained-config-drift')) {
    diagnostics.push({
      code: 'gascity-worker-drained-config-drift',
      severity: 'warning',
      evidence: 'Gas City events mention config-drift',
      guidance: ['Inspect Gas City generated config if routed work stops making progress.'],
    })
  }

  return diagnostics
}

export function formatWaypointGasCityErrorEnvelope(error: unknown): WaypointGasCityErrorEnvelope {
  if (error instanceof WaypointGasCityCliCommandError) {
    const details = error.stderr.trim() || error.stdout.trim() || error.command
    return {
      ok: false,
      action: 'error',
      error: `Gas City CLI ${error.operation} failed.`,
      ...(details ? { details } : {}),
    }
  }
  return {
    ok: false,
    action: 'error',
    error: error instanceof Error ? error.message : String(error),
  }
}

function defaultPreflightChecks(command: string, provider: string): readonly WaypointGasCityToolCheckSpec[] {
  const checks: WaypointGasCityToolCheckSpec[] = [
    { tool: 'gc', command, args: ['version'] },
    { tool: 'bd' },
    { tool: 'dolt' },
    { tool: 'flock' },
  ]
  if (provider === 'codex') checks.push({ tool: 'codex' })
  return checks
}

function defaultToolArgs(tool: string): readonly string[] {
  if (tool === 'dolt') return ['version']
  if (tool === 'gc') return ['version']
  return ['--version']
}

function defaultToolGuidance(tool: string): string {
  if (tool === 'gc') return 'Install Gas City and ensure gc is available on PATH.'
  if (tool === 'bd') return 'Install Beads and ensure bd is available on PATH.'
  if (tool === 'dolt') return 'Install Dolt because Gas City uses it for city state.'
  if (tool === 'flock') return 'Install flock; on macOS this may be available through Homebrew.'
  if (tool === 'codex') return 'Install and authorize Codex, or configure a different Gas City provider.'
  return `Install ${tool} or remove it from the Gas City preflight requirement.`
}

function parseSessionList(stdout: string): WaypointGasCitySessionList {
  const parsed = parseJsonValue(stdout, 'list sessions')
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.sessions)
      ? parsed.sessions
      : []
  return {
    sessions: entries.map((entry) => sessionFromRecord(entry)).filter(isPresent),
    raw: parsed,
  }
}

function parseConvoyId(stdout: string, name: string): string {
  const match = stdout.match(/\b([A-Za-z0-9]+-[A-Za-z0-9]+)\b/)
  if (!match?.[1]) {
    throw new Error(`Gas City CLI create convoy did not report a convoy id for ${name}`)
  }
  return match[1]
}

function sessionFromRecord(entry: unknown): WaypointGasCitySession | null {
  if (!isRecord(entry)) return null
  const name = stringValue(entry.name) ?? stringValue(entry.Name)
  const id = stringValue(entry.id) ?? stringValue(entry.ID) ?? stringValue(entry.session_id) ?? stringValue(entry.SessionID) ?? name
  const status = stringValue(entry.status) ?? stringValue(entry.Status) ?? stringValue(entry.state) ?? stringValue(entry.State)
  if (!id || !status) return null
  const alias = stringValue(entry.alias) ?? stringValue(entry.Alias)
  const agentName = stringValue(entry.agent_name) ?? stringValue(entry.AgentName) ?? stringValue(entry.agentName)
  const sessionName = stringValue(entry.session_name) ?? stringValue(entry.SessionName) ?? stringValue(entry.sessionName)
  const target = stringValue(entry.target) ?? stringValue(entry.Target) ?? alias ?? sessionName ?? agentName
  const template = stringValue(entry.template) ?? stringValue(entry.Template) ?? stringValue(entry.template_name) ?? stringValue(entry.TemplateName)
  const drainReason = stringValue(entry.drain_reason) ?? stringValue(entry.DrainReason) ?? stringValue(entry.drainReason)
  const ageSeconds = numberValue(entry.age_seconds) ?? numberValue(entry.AgeSeconds) ?? numberValue(entry.ageSeconds)
  const createdAt = stringValue(entry.created_at) ?? stringValue(entry.CreatedAt) ?? stringValue(entry.createdAt)
  const lastActive = stringValue(entry.last_active) ?? stringValue(entry.LastActive) ?? stringValue(entry.lastActive)
  const closed = booleanValue(entry.closed) ?? booleanValue(entry.Closed)
  return {
    id,
    status,
    ...(name ? { name } : {}),
    ...(target ? { target } : {}),
    ...(template ? { template } : {}),
    ...(alias ? { alias } : {}),
    ...(agentName ? { agentName } : {}),
    ...(sessionName ? { sessionName } : {}),
    ...(drainReason ? { drainReason } : {}),
    ...(ageSeconds !== undefined ? { ageSeconds } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(lastActive ? { lastActive } : {}),
    ...(closed !== undefined ? { closed } : {}),
    raw: entry,
  }
}

function parseJsonObject(stdout: string, operation: string): Record<string, unknown> {
  const parsed = parseJsonValue(stdout, operation)
  if (!isRecord(parsed)) {
    throw new Error(`Gas City CLI ${operation} returned non-object JSON output`)
  }
  return parsed
}

function parseJsonValue(stdout: string, operation: string): unknown {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    throw new Error(`Gas City CLI ${operation} did not return JSON output`)
  }
  return JSON.parse(trimmed)
}

function parseJsonLines(stdout: string, operation: string): readonly Record<string, unknown>[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) throw new Error(`Gas City CLI ${operation} returned a non-object JSONL record`)
      return parsed
    })
}

function eventContainsConfigDrift(event: WaypointGasCityEventObservation): boolean {
  return [event.type, event.message, JSON.stringify(event.payload ?? {})].some((value) => typeof value === 'string' && value.includes('config-drift'))
}

function gasCitySessionMatchesAssignee(session: WaypointGasCitySessionObservation, assignee: string): boolean {
  return [
    session.id,
    session.sessionName,
    session.alias,
    session.agentName,
    session.name,
    session.template,
    session.target,
  ].some((identity) => identity === assignee)
}

function isInactiveGasCitySessionStatus(status: string): boolean {
  return ['drained', 'closed', 'suspended', 'asleep', 'stopped'].includes(status)
}

function firstLine(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ')
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}
