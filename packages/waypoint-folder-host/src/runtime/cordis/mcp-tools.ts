/**
 * The cordis worker's tool surface: an MCP server over stdio (the bundled
 * worker server, or a host's own via `toolServer`), sliced by `tool_group`,
 * registered into `ctx.tools` through `ctx.effect` so disposing the fiber
 * unregisters every tool AND kills the server.
 *
 * ── THE JAIL ────────────────────────────────────────────────────────────────
 * This is the part a naive port gets wrong, and the defect is worth naming
 * because the review of Waypoint's own cordis design flagged exactly it:
 * **an in-process worker silently leaves the Seatbelt jail.**
 *
 * Today a closed-surface worker is a jailed `claude -p` child that spawns the
 * MCP server INSIDE its own jail, so the server inherits the write boundary.
 * A cordis worker runs its loop in the bridge process, so if the bridge spawned
 * the MCP server directly, the server — the only thing here that writes — would
 * run with the bridge's authority over the whole machine. Every fence in the
 * composition would still pass, and the actual boundary would be gone.
 *
 * So the server is spawned under the SAME seatbelt profile a jailed worker gets,
 * built from the same declared roots crossed with the same plan-node access map.
 * And it fails CLOSED: when the project expects a jail and the jail cannot be
 * prepared, there is no spawn and no tools — never an unjailed run.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { Context } from 'cordis'

import { prepareSeatbeltJail, seatbeltEnabledForProject } from '../../seatbelt/jail.ts'
import type { WaypointProjectRootConfig } from '../../project/config.ts'

export interface CordisMcpToolsConfig {
  /** Absolute path to the MCP server entry. */
  readonly server: string
  readonly projectRoot: string
  readonly caseRoot: string
  /** The WAYPOINT_TOOL_GROUP slice. Omitted = whole surface (a shell worker's default). */
  readonly group?: string
  /** Declared roots — the jail's base capability set. */
  readonly roots: Readonly<Record<string, WaypointProjectRootConfig>> | undefined
  /** The plan node's access map. The jail refuses to guess when this is absent. */
  readonly access: Readonly<Record<string, string>> | undefined
  /** The attempt's private temp dir (rw, becomes the server's TMPDIR). */
  readonly tmpDir: string
  /** The attempt's scratch write root (verify-then-apply staging) — always rw. */
  readonly scratchDir: string
  /**
   * The fan-out item this dispatch owns, if any.
   *
   * This MUST reach the server: a host tool surface can enforce per-item
   * ownership by reading `WAYPOINT_FANOUT_ITEM`, so a sibling arm that never
   * received it cannot write another arm's data. The fence lives at the
   * tool, and the tool only sees what the spawn hands it.
   */
  readonly fanoutItem?: string
  /** The attempt's claim dir (rw) — the report seam. */
  readonly claimDir?: string
  /**
   * Where the worker's report lands. The `report` tool reads this from
   * `WAYPOINT_CLAIM_PATH` and refuses to file without it, so a runtime that
   * granted the claim DIRECTORY to the jail but never named the FILE would
   * produce a worker that could do all the work and never be heard — every run
   * failing with "the run ended without a report". Granting the write and
   * naming the target are two different things.
   */
  readonly claimPath?: string
  /** A stable name for the generated profile, so a run is traceable to one. */
  readonly jailName: string
  /** Spawn env base. Test seam; defaults to the real process env. */
  readonly env?: NodeJS.ProcessEnv
  /** Milliseconds a single MCP request may take before it is a visible failure. */
  readonly requestTimeoutMs?: number
  /** Inside a sprite VM (S1): the VM is the jail; the macOS seatbelt launcher
   *  does not exist in the Linux guest, so the wrap is skipped BY DECLARATION
   *  — set only through the guest entry, never to dodge the jail on a host. */
  readonly alreadyJailed?: boolean
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

class McpClient {
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  readonly stderr: string[] = []

  // NOT a parameter property: the bridge runs under --experimental-strip-types,
  // which refuses them. The spike tripped this on its very first run.
  private readonly child: ChildProcessWithoutNullStreams
  private readonly timeoutMs: number

  constructor(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
    this.child = child
    this.timeoutMs = timeoutMs
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (line.trim() === '') return
      let message: { id?: number; result?: unknown; error?: { message: string } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        return
      }
      if (message.id === undefined) return
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
    // A DEAD SERVER MUST NOT PRESENT AS A TIMEOUT. Without this the spike sat
    // 15 seconds on a server that had already exited, and the error named the
    // wrong thing. With it the failure is immediate and carries the stderr.
    child.on('exit', (code) => {
      const why = this.stderr.length > 0 ? this.stderr.join(' | ') : `exit ${code}, no stderr`
      for (const [id, waiter] of [...this.pending]) {
        this.pending.delete(id)
        waiter.reject(new Error(`MCP server died before replying — ${why}`))
      }
    })
    // A failure must be visible: a server that dies on startup must never read
    // as an empty tool list.
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (l) => this.stderr.push(l))
  }

  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise as (value: unknown) => void, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new Error(
              `MCP ${method} timed out${this.stderr.length ? ` — server said: ${this.stderr.join(' | ')}` : ''}`,
            ),
          )
        }
      }, this.timeoutMs).unref()
    })
  }

  kill(): void {
    this.child.kill('SIGTERM')
  }
}

interface ServedTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

/**
 * MCP tool result → the string the transcript carries.
 *
 * The server replies `{content: [{type:'text', text}...], isError?}`. Text
 * parts are joined; a non-text or unexpected shape is serialized rather than
 * dropped. An `isError` result THROWS, so the kernel records the outcome as
 * status 'error' with the server's own words — the model sees the failure as
 * a failure, not as content that happens to complain.
 */
function mcpResultToOutput(result: Record<string, unknown> | undefined): { text: string; isError: boolean } {
  if (result === undefined) return { text: '', isError: false }
  const content = result.content
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type: string; text: string } =>
        typeof c === 'object' && c !== null && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text)
    if (texts.length === content.length) {
      return { text: texts.join('\n'), isError: result.isError === true }
    }
  }
  return { text: JSON.stringify(result), isError: result.isError === true }
}

/**
 * NOTE the `await` on ctx.effect. Returning the effect handle instead of
 * awaiting it composes "successfully" with an EMPTY tool surface — the fiber
 * reports ready, the agent runs, and the model is simply offered nothing. The
 * spike shipped that bug and it cost two runs to find, because nothing failed.
 * It is the `tool_group` incident in a new costume: the registration was
 * written, the wiring was never awaited.
 */
export async function cordisMcpTools(ctx: Context, config: CordisMcpToolsConfig): Promise<void> {
  await ctx.effect(async () => {
    const hostEnv = config.env ?? process.env
    const argv = [
      process.execPath,
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      config.server,
      '--case-root',
      config.caseRoot,
    ]

    let spawnArgv = argv
    if (!config.alreadyJailed && seatbeltEnabledForProject(config.roots, hostEnv)) {
      // FAIL CLOSED. A jail that cannot be prepared is not a reason to run
      // without one — the whole point of the boundary is that its absence is
      // never the quiet outcome.
      let wrap: (a: readonly string[]) => readonly string[]
      try {
        const prepared = await prepareSeatbeltJail({
          projectRoot: config.projectRoot,
          roots: config.roots,
          access: config.access,
          tmpDir: config.tmpDir,
          scratchDir: config.scratchDir,
          ...(config.claimDir ? { claimDir: config.claimDir } : {}),
          name: config.jailName,
        })
        wrap = prepared.wrapArgv
      } catch (error) {
        throw new Error(
          `seatbelt jail refused the cordis tool surface (no spawn): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      spawnArgv = [...wrap(argv)]
    }

    const [command, ...args] = spawnArgv
    const child = spawn(command as string, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.projectRoot,
      env: {
        ...hostEnv,
        // The group rides in as env, exactly as worker-runtime.ts sets it.
        ...(config.group ? { WAYPOINT_TOOL_GROUP: config.group } : {}),
        // Per-item ownership is enforced AT THE TOOL from this variable.
        ...(config.fanoutItem ? { WAYPOINT_FANOUT_ITEM: config.fanoutItem } : {}),
        ...(config.claimPath ? { WAYPOINT_CLAIM_PATH: config.claimPath } : {}),
        WAYPOINT_CASE_ROOT: config.caseRoot,
        TMPDIR: config.tmpDir,
      },
    }) as ChildProcessWithoutNullStreams

    const client = new McpClient(child, config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
    const disposers: Array<() => void> = []
    try {
      await client.request('initialize', {})
      const listed = await client.request('tools/list')
      const served = ((listed?.tools as ServedTool[] | undefined) ?? []).filter((t) => typeof t?.name === 'string')

      for (const tool of served) {
        disposers.push(
          ctx.tools.register(
            {
              name: tool.name,
              description: tool.description ?? '',
              // The MCP server already publishes JSON Schema; pass it through
              // rather than re-deriving it — a second derivation is a second
              // thing to drift.
              parameters: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
            },
            async (args) => {
              const result = await client.request('tools/call', { name: tool.name, arguments: args })
              const { text, isError } = mcpResultToOutput(result)
              if (isError) throw new Error(text)
              return text
            },
          ),
        )
      }
    } catch (error) {
      // Same rule as the composer: a refusal that leaves a child process behind
      // has traded a visible failure for an invisible one.
      for (const dispose of disposers) dispose()
      client.kill()
      throw error
    }

    return () => {
      for (const dispose of disposers) dispose()
      client.kill()
    }
  }, `mcp:${config.group ?? 'all'}`)
}

// 'tools' MUST be declared: Cordis throws on an undeclared property GET, so
// optional chaining does not save you. An undeclared dependency is a hard error
// here, not a silent undefined — stricter than pi, and the spike learned it the
// loud way.
cordisMcpTools.inject = ['tools']
