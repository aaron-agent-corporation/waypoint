#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cliPackage from '../package.json' with { type: 'json' }
import { runAdhocCommand } from './commands/adhoc.ts'
import { runAuthorCommand } from './commands/author.ts'
import { runAutoCommand } from './commands/auto.ts'
import { runBridgeCommand } from './commands/bridge.ts'
import { runDiscussCommand } from './commands/discuss.ts'
import { runGateCommand } from './commands/gate.ts'
import { runHandoffsCommand } from './commands/handoffs.ts'
import { runInitCommand } from './commands/init.ts'
import { runLifecycleCommand } from './commands/lifecycle.ts'
import { runOperatorsCommand } from './commands/operators.ts'
import { runPauseCommand } from './commands/pause.ts'
import { runProvisionCommand } from './commands/provision.ts'
import { runQuestsCommand } from './commands/quests.ts'
import { runRouteCommand } from './commands/route.ts'
import { runRouteEventsCommand } from './commands/route-events.ts'
import { runRecipesCommand } from './commands/recipes.ts'
import { runResumeCommand } from './commands/resume.ts'
import { runRoutesCommand } from './commands/routes.ts'
import { runStartCommand } from './commands/start.ts'
import { runMigrateCommand } from './commands/migrate.ts'
import { runDossierCommand } from './commands/dossier.ts'
import { runProvidersCommand } from './commands/providers.ts'
import { runWorkersCommand } from './commands/workers.ts'
import { runTierReportCommand } from './commands/tier-report.ts'
import { runStatusCommand } from './commands/status.ts'
import { runTasksCommand } from './commands/tasks.ts'
import { runToolsCommand } from './commands/tools.ts'
import { runWizardCommand } from './commands/wizard.ts'
import { guardDistFreshness } from './dist-staleness.ts'

const rootPackageVersion = cliPackage.version

export interface WaypointCliIo {
  stdout: (line: string) => void
  stdoutBytes?: (bytes: Uint8Array) => void
  stderr: (line: string) => void
  stdin?: () => Promise<string>
  cwd?: string
}

const helpText = `Runner — local quest host

Usage:
  waypoint --help
  waypoint --version
  waypoint init [--quest <slug>] [--postgres-url <url>] [--postgres-schema <schema>] [--postgres-no-durable]
              [--worker-command "<agent cmd>" | --simulated]    (recipe-bearing quests need a runtime — flag, or the global config's runner.worker_command, or start refuses)
  waypoint migrate [--json]
  waypoint provision     (write the version-matched CLI shim into ~/.waypoint/bin so workers spawned under
                        launchd or a bare PATH invoke THIS checkout's CLI)
  waypoint status [--json]
  waypoint quests
  waypoint recipes [--quest <slug>]
  waypoint recipes refresh [--quest <slug>] [--adopt]
              # Re-install this project's recipes from the bundle. Refreshes only files the installer
              # wrote; a file that differs is reported and kept. --adopt takes the bundled copy anyway
              # (discards local edits) — the repair for cases predating the install manifest.
  waypoint start [--quest <slug>] [--json]
  waypoint adhoc --recipe <slug> [--produces <path>]... [--contract <name>] [--access <binding>:ro|rw]... [--title <text>] [--dry-run]
  # Run ONE catalog recipe as its own route (bridge-executed on durable projects). Use when an artifact must be
  # regenerated under a fixed recipe without re-running its quest — a done durable node cannot be reopened.
  # --produces declares verify-then-apply artifacts; --contract adds the vetted content check (rsc-6al).
  waypoint tier-report [--json]
  waypoint providers [--json]
  waypoint workers [--json]
  # Model-routing readout: the provider registry + each class->provider/model resolution (rsc-bpg).
  waypoint dossier --route-id <id> [--session <conv-id>]... [--note <text>]... [--console-url <url>] [--json]
  # The run's reviewable record (docs/designs/run-dossier.md): run record + operator session transcripts → .waypoint/reports/<route-id>/. Snapshot; rerun to refresh.
  waypoint routes [--json]
  waypoint route --route-id <id> [--json]
  waypoint route cancel --route-id <id> [--reason <text>]
  # Stop a run (and the only sanctioned way to end a repeating quest): cancels the durable engine instance, records route.cancelled.
  waypoint route reap [--stale-hours N] [--cancel] [--json]
  # Find abandoned runs (active, no dispatch, nothing progressing). DRY-RUN by default; --cancel stops them. Gate/wait/timer-parked runs are never reaped by age.
  waypoint route-events --route-id <id> [--limit N] [--offset N] [--json]
  waypoint tasks [--route-id <id>] [--json]
  waypoint tasks retry --task-id <id>
  # Durable run: re-dispatches the failed/blocked/cancelled task (the bridge runs it). Plain run: resets it so the next "waypoint auto" re-dispatches.
  waypoint tasks show <task-id> [--json]
  waypoint tasks report <task-id> --status finished|failed --summary <text> [--evidence key=value]...
  waypoint discuss --task-id <id> [--message <text>] [--author user|agent]
  waypoint auto [--route-id <id>] [--max-iterations N] [--json]
  # Plain (--postgres-no-durable) runs only — durable runs advance via the engine + bridge (A-track); "waypoint auto" refuses them.
  waypoint bridge [--once] [--json] [--concurrency <n>] [--idle-exit-s <n>]
  waypoint auto status [--limit N] [--offset N] [--json]
  # Safety: the local quest runtime executes configured commands only when .waypoint/config.yaml explicitly sets runtime.recipe: local.
  waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
  waypoint pause --route-id <id> [--reason <text>]
  waypoint resume --route-id <id> [--resolve-blocker] [--note <text>]
  # Use --resolve-blocker after the operator resolves the missing artifact or other blocked Quest input; a durable run resumes on its own (plain runs need "waypoint auto" again).
  waypoint lifecycle add workstream --key <key> --name <name>
  waypoint lifecycle add milestone --workstream <key> --key <key> --title <title>
  waypoint lifecycle add phase --milestone <key> --key <key> --lifecycle <name>
  waypoint lifecycle add plan --phase <key> --ref <ref> --title <title>
  waypoint lifecycle list
  waypoint operators list [--json]
  waypoint operators show <slug> [--json]
  waypoint operators instructions <slug> [--json]
  waypoint handoffs list [--quest <slug>] [--json]
  waypoint handoffs show <slug> [--json]
  waypoint tools list --operator <slug> [--json]
  waypoint tools explain <tool-slug> [--json]
  waypoint author brainstorm --kind quest|recipe|operator|handoff_graph [--domain <domain>] [--json]
  waypoint author design --answers <path> --write-spec docs/plans/<file>.md [--json]
  waypoint author plan --design docs/plans/<file>.md [--allow-unapproved-draft] [--json]
  waypoint author recipe --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
  waypoint author quest --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
  waypoint author handoff --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
  waypoint wizard scan --source <path> --domain <domain> [--json]
  waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
  waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
  waypoint wizard questions --case <case-root> [--json]
  waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
  waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
  waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
`

export async function runWaypointCli(args: readonly string[], io: WaypointCliIo = defaultIo()): Promise<number> {
  const [command] = args

  if (command === '--version' || command === '-v') {
    io.stdout(rootPackageVersion)
    return 0
  }

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(helpText.trimEnd())
    return 0
  }

  // Subcommands have no help handlers of their own; without this guard,
  // `waypoint auto --help` would START A LIVE AUTOPILOT RUN with --help
  // silently ignored (which phantom-dispatched a task on 2026-07-04).
  // Any --help/-h anywhere in the argument list prints usage and exits.
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout(helpText.trimEnd())
    return 0
  }

  if (command === 'init') {
    return runInitCommand(args.slice(1), io)
  }

  if (command === 'migrate') {
    return runMigrateCommand(args.slice(1), io)
  }

  if (command === 'status') {
    return runStatusCommand(args.slice(1), io)
  }

  if (command === 'provision') {
    return runProvisionCommand(args.slice(1), io)
  }

  if (command === 'quests') {
    return runQuestsCommand(args.slice(1), io)
  }

  if (command === 'recipes') {
    return runRecipesCommand(args.slice(1), io)
  }

  if (command === 'operators') {
    return runOperatorsCommand(args.slice(1), io)
  }

  if (command === 'handoffs') {
    return runHandoffsCommand(args.slice(1), io)
  }

  if (command === 'tools') {
    return runToolsCommand(args.slice(1), io)
  }

  if (command === 'author') {
    return runAuthorCommand(args.slice(1), io)
  }

  if (command === 'lifecycle') {
    return runLifecycleCommand(args.slice(1), io)
  }

  if (command === 'start') {
    return runStartCommand(args.slice(1), io)
  }

  if (command === 'adhoc') {
    return runAdhocCommand(args.slice(1), io)
  }

  if (command === 'tier-report') {
    return runTierReportCommand(args.slice(1), io)
  }

  if (command === 'workers') {
    return runWorkersCommand(args.slice(1), io)
  }

  if (command === 'providers') {
    return runProvidersCommand(args.slice(1), io)
  }

  if (command === 'dossier') {
    return runDossierCommand(args.slice(1), io)
  }

  if (command === 'routes') {
    return runRoutesCommand(args.slice(1), io)
  }

  if (command === 'route') {
    return runRouteCommand(args.slice(1), io)
  }

  if (command === 'route-events') {
    return runRouteEventsCommand(args.slice(1), io)
  }

  if (command === 'tasks') {
    return runTasksCommand(args.slice(1), io)
  }

  if (command === 'discuss') {
    return runDiscussCommand(args.slice(1), io)
  }

  if (command === 'auto') {
    return runAutoCommand(args.slice(1), io)
  }

  if (command === 'bridge') {
    return runBridgeCommand(args.slice(1), io)
  }

  if (command === 'gate') {
    return runGateCommand(args.slice(1), io)
  }

  if (command === 'pause') {
    return runPauseCommand(args.slice(1), io)
  }

  if (command === 'resume') {
    return runResumeCommand(args.slice(1), io)
  }

  if (command === 'wizard') {
    return runWizardCommand(args.slice(1), io)
  }

  io.stderr(`Unknown Waypoint command: ${command}`)
  io.stderr('Run waypoint --help for usage.')
  return 1
}

function defaultIo(): WaypointCliIo {
  return {
    stdout: (line) => console.log(line),
    stdoutBytes: (bytes) => { process.stdout.write(bytes) },
    stderr: (line) => console.error(line),
    stdin: readDefaultStdin,
  }
}

async function readDefaultStdin(): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  const maxBytes = 1024 * 1024
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new Error('stdin input exceeds the size limit')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** npm exposes the bin as a .bin SYMLINK, so argv[1] is the shim path while
 *  import.meta.url is the realpath — a naive string compare silently skips the
 *  whole CLI (exit 0, no output) for every npm-installed user. Compare
 *  realpaths; if the entry cannot be resolved, fall back to the raw path. */
function invokedAsMain(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  let resolvedEntry = entry
  try {
    resolvedEntry = realpathSync(entry)
  } catch {
    // keep the raw path
  }
  return self === resolvedEntry || self === entry
}

if (invokedAsMain()) {
  // rsc-2ff: fail loud (dev checkout only) when the built dist is older than
  // src — a stale dist runs old code and errors nowhere near the cause.
  if (guardDistFreshness(import.meta.url, (line) => console.error(line))) {
    process.exitCode = 1
  } else {
    const exitCode = await runWaypointCli(process.argv.slice(2))
    process.exitCode = exitCode
  }
}
