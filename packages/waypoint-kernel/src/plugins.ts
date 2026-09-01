/**
 * Base agent plugins — the plumbing every composed Cordis agent shares
 * (docs/designs/cordis-adoption-plan.md, Phase A). Each is a Cordis plugin
 * object ({ name, inject?, apply }): registrations go through revertible
 * effects, so disposing a fiber removes exactly what it mounted.
 *
 * Ported from the parent project's kernel with two Waypoint-kept behaviors:
 * prompt sections carry `source` provenance, and the closed-policy denial
 * names the granted surface (a refusal that only says "no" makes the model
 * guess again; one that lists the surface ends the loop).
 */
import type { Context } from 'cordis'

import type {
  CordisAgentLoopService,
  CordisLlmAdapter,
  CordisLlmService,
  CordisSessionEvent,
  CordisSessionsService,
  CordisSystemPromptService,
  CordisToolHandler,
  CordisToolOutcome,
  CordisToolSchema,
  CordisToolsService,
  CordisTurnStep,
  CordisUsage,
} from './kernel.ts'

/** ctx.sessions — append-only neutral event log, the loop's transcript. */
export const sessionsPlugin = {
  name: 'cordis-sessions',
  apply(ctx: Context) {
    const events: CordisSessionEvent[] = []
    const service: CordisSessionsService = {
      append(event) {
        events.push(event)
      },
      all() {
        return events
      },
      compact(keepFrom, digest) {
        if (!Number.isInteger(keepFrom) || keepFrom <= 0 || keepFrom > events.length) {
          throw new Error(`compact boundary ${keepFrom} out of range (log has ${events.length} events)`)
        }
        const removed = events.splice(0, keepFrom)
        events.unshift({ type: 'user', text: digest })
        return removed
      },
      rewriteToolResult(index, output) {
        const event = events[index]
        if (!Number.isInteger(index) || event === undefined) {
          throw new Error(`rewriteToolResult index ${index} out of range (log has ${events.length} events)`)
        }
        if (event.type !== 'tool_result') {
          throw new Error(`rewriteToolResult index ${index} holds a '${event.type}' event, not a tool_result`)
        }
        events[index] = { type: 'tool_result', call: event.call, outcome: { status: event.outcome.status, output } }
        return event
      },
    }
    ctx.provide('sessions', service)
  },
}

/** ctx.tools — schema registry + guarded execute pipeline. Execution runs
 *  through the 'waypoint/cordis-tool-execute' waterfall so policy plugins can
 *  short-circuit (deny) without touching providers. Registration refuses to
 *  shadow: a second registration that silently won would make the surface
 *  depend on activation order. */
export const toolsCorePlugin = {
  name: 'cordis-tools-core',
  apply(ctx: Context) {
    const registry = new Map<string, { schema: CordisToolSchema; handler: CordisToolHandler }>()
    const service: CordisToolsService = {
      register(schema, handler) {
        if (registry.has(schema.name)) {
          throw new Error(`tool '${schema.name}' is already registered — refusing to shadow it`)
        }
        registry.set(schema.name, { schema, handler })
        return () => registry.delete(schema.name)
      },
      list() {
        return [...registry.values()].map((entry) => entry.schema).sort((a, b) => a.name.localeCompare(b.name))
      },
      async execute(call): Promise<CordisToolOutcome> {
        return ctx.waterfall('waypoint/cordis-tool-execute', { call }, async (): Promise<CordisToolOutcome> => {
          const entry = registry.get(call.name)
          if (!entry) {
            return { status: 'error', output: `unknown tool: ${call.name}` }
          }
          try {
            return { status: 'ok', output: await entry.handler(call.args) }
          } catch (error) {
            return { status: 'error', output: error instanceof Error ? error.message : String(error) }
          }
        })
      },
    }
    ctx.provide('tools', service)
  },
}

/** ctx.systemPrompt — ordered prompt sections; contributors add via effect. */
export const systemPromptPlugin = {
  name: 'cordis-system-prompt',
  apply(ctx: Context) {
    const sections: { id: string; title: string; body: string; source?: string }[] = []
    const service: CordisSystemPromptService = {
      addSection(id, title, body, source) {
        const section = { id, title, body, ...(source !== undefined ? { source } : {}) }
        sections.push(section)
        return () => {
          const index = sections.indexOf(section)
          if (index >= 0) sections.splice(index, 1)
        }
      },
      render() {
        return sections.map((s) => `## ${s.title}\n\n${s.body.trim()}`).join('\n\n')
      },
      sectionIds() {
        return sections.map((s) => s.id)
      },
      sections() {
        return sections.map((s) => ({ ...s }))
      },
    }
    ctx.provide('systemPrompt', service)
  },
}

/** ctx.llm — adapter broker: one stable entrypoint, providers register via
 *  revertible effects so a swap does not perturb consumers. Refuses to
 *  shadow: the live-swap discipline is dispose-then-register, and a silent
 *  replacement would hide a composition holding two adapters at once. */
export const llmCorePlugin = {
  name: 'cordis-llm-core',
  apply(ctx: Context) {
    let adapter: CordisLlmAdapter | undefined
    const service: CordisLlmService = {
      registerAdapter(next) {
        if (adapter !== undefined) {
          throw new Error(`llm adapter already registered: ${adapter.id} — refusing to shadow it`)
        }
        adapter = next
        return () => {
          if (adapter === next) adapter = undefined
        }
      },
      adapterId() {
        return adapter?.id
      },
      async generate(req) {
        if (!adapter) throw new Error('no llm adapter registered — fail closed')
        return adapter.generate(req)
      },
    }
    ctx.provide('llm', service)
  },
}

export interface PolicyClosedConfig {
  /** The complete allow-list (the composer includes the report seam). */
  readonly allow: readonly string[]
  /** Denied call names accumulate here — the runtime's blocked_tools audit. */
  readonly onDeny?: (name: string) => void
}

/** Closed-surface policy: denies any tool call not in the allowlist.
 *  Deliberately REDUNDANT with least privilege — only granted tools are
 *  mounted at all, so in a correct composition this never refuses anything.
 *  It exists for the incorrect one, where the difference between "mounted"
 *  and "allowed" is the whole protection. The denial is monotonic: it
 *  short-circuits the waterfall, so no later listener can reverse it. */
export const policyClosedPlugin = {
  name: 'cordis-policy-closed',
  inject: ['tools'],
  apply(ctx: Context, config: PolicyClosedConfig) {
    const allow = new Set(config.allow)
    ctx.on('waypoint/cordis-tool-execute', (req, next) => {
      if (!allow.has(req.call.name)) {
        config.onDeny?.(req.call.name)
        return Promise.resolve({
          status: 'denied' as const,
          output:
            `'${req.call.name}' is not in this recipe's named tool surface ` +
            `(${[...allow].sort().join(', ') || 'none'}). It was NOT run.`,
        })
      }
      return next()
    })
  },
}

export interface PromptSectionConfig {
  readonly id: string
  readonly title: string
  readonly body: string
  /** Provenance: the file the body came from, or 'composed'. */
  readonly source?: string
}

/** Generic prompt-section contributor: one section, revertible. */
export const promptSectionPlugin = {
  name: 'cordis-prompt-section',
  inject: ['systemPrompt'],
  apply(ctx: Context, config: PromptSectionConfig) {
    ctx.effect(() => ctx.systemPrompt.addSection(config.id, config.title, config.body, config.source))
  },
}

export interface ToolPluginConfig {
  readonly schema: CordisToolSchema
  readonly handler: CordisToolHandler
}

/** Generic tool contributor: one vetted tool, revertible. */
export const toolPlugin = {
  name: 'cordis-tool',
  inject: ['tools'],
  apply(ctx: Context, config: ToolPluginConfig) {
    ctx.effect(() => ctx.tools.register(config.schema, config.handler))
  },
}

/**
 * Slice that never splits a UTF-16 surrogate pair: `end` slides left past a
 * trailing high surrogate, `start` slides right past a leading low
 * surrogate. A dropped half-character beats an invalid one on the wire —
 * every truncation in the kernel (and the brain's pruner) cuts through this.
 */
export function sliceSurrogateSafe(text: string, start: number, end: number): string {
  let s = Math.max(0, start)
  let e = Math.min(text.length, end)
  if (e > s && e < text.length) {
    const last = text.charCodeAt(e - 1)
    if (last >= 0xd800 && last <= 0xdbff) e -= 1
  }
  if (s > 0 && s < text.length && s < e) {
    const first = text.charCodeAt(s)
    if (first >= 0xdc00 && first <= 0xdfff) s += 1
  }
  return text.slice(s, e)
}

export interface OutputBudgetConfig {
  /** Outputs longer than this are clamped head+tail (chars, not tokens). */
  readonly maxChars: number
  /** Share of the budget kept from the head (rest from the tail). */
  readonly headShare?: number
  /**
   * Writable directory to SPILL oversized outputs into. When set, the full
   * text is persisted to a file there and the inline result becomes a
   * bounded preview plus the real path — nothing is lost, and re-reading
   * beats re-running the tool. Unset (or on a write failure), plain
   * elision is the fallback.
   */
  readonly spillDir?: string
}

/** Tool-output budget: token economics for chatty tools. A waterfall
 *  middleware that lets every tool run untouched but clamps oversized OUTPUT
 *  before it enters the transcript: head + tail with an explicit marker
 *  naming the original size, so the model knows content was cut rather than
 *  silently missing. With a writable `spillDir` the full text is parked at a
 *  real path first (the spill upgrade); a failed spill degrades to elision,
 *  never to a lost turn. Deterministic; node:fs only when spilling. */
export const outputBudgetPlugin = {
  name: 'cordis-output-budget',
  inject: ['tools'],
  apply(ctx: Context, config: OutputBudgetConfig) {
    const maxChars = Math.max(1000, config.maxChars)
    const headShare = config.headShare !== undefined ? Math.min(0.9, Math.max(0.1, config.headShare)) : 0.7
    let spillSerial = 0
    ctx.on('waypoint/cordis-tool-execute', async (req, next) => {
      const outcome = await next()
      if (outcome.output.length <= maxChars) return outcome
      let marker: string
      if (config.spillDir !== undefined) {
        spillSerial += 1
        const safeName = req.call.name.replace(/[^a-zA-Z0-9_-]/g, '_')
        const spillPath = `${config.spillDir}/tool-output-${String(spillSerial).padStart(3, '0')}-${safeName}.txt`
        try {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(spillPath, outcome.output, 'utf8')
          marker =
            `\n... [output spilled: ${outcome.output.length} chars total; full text at ` +
            `${spillPath}; head+tail preview within the ${maxChars}-char budget] ...\n`
        } catch {
          // A spill that cannot write degrades to elision — the budget
          // still holds, and the marker stays honest about what happened.
          marker = `\n... [output elided (spill unavailable): ${outcome.output.length} chars total, showing head+tail within the ${maxChars}-char budget] ...\n`
        }
      } else {
        marker = `\n... [output elided: ${outcome.output.length} chars total, showing head+tail within the ${maxChars}-char budget] ...\n`
      }
      const keep = maxChars - marker.length
      const head = Math.floor(keep * headShare)
      const tail = keep - head
      return {
        status: outcome.status,
        output:
          sliceSurrogateSafe(outcome.output, 0, head) +
          marker +
          sliceSurrogateSafe(outcome.output, outcome.output.length - tail, outcome.output.length),
      }
    })
  },
}

export interface AgentLoopConfig {
  /** Tool names whose successful execution ends the run (the report seam). */
  readonly terminateTools: readonly string[]
  readonly maxSteps?: number
}

const DEFAULT_MAX_STEPS = 24

/** ctx.agentLoop — default model ↔ tool turn driver. The kernel carries the
 *  CONTRACT (CordisAgentLoopService); this is one driver behind it, and it
 *  stays swappable — nothing else may import the driver, only the service. */
export const agentLoopPlugin = {
  name: 'cordis-agent-loop',
  inject: ['llm', 'tools', 'sessions', 'systemPrompt'],
  apply(ctx: Context, config: AgentLoopConfig) {
    const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS
    const terminate = new Set(config.terminateTools)

    const service: CordisAgentLoopService = {
      async runTurn(input, signal) {
        ctx.sessions.append({ type: 'user', text: input })
        const steps: CordisTurnStep[] = []
        // Cost metering: sum every generate's provider-reported usage into
        // the turn result.
        let usage: CordisUsage | undefined
        const addUsage = (u: CordisUsage | undefined): void => {
          if (!u) return
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + u.inputTokens,
            outputTokens: (usage?.outputTokens ?? 0) + u.outputTokens,
            totalTokens: (usage?.totalTokens ?? 0) + u.totalTokens,
            ...(u.cacheReadTokens !== undefined || usage?.cacheReadTokens !== undefined
              ? { cacheReadTokens: (usage?.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0) }
              : {}),
            ...(u.cacheWriteTokens !== undefined || usage?.cacheWriteTokens !== undefined
              ? { cacheWriteTokens: (usage?.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0) }
              : {}),
            ...(u.costUsd !== undefined || usage?.costUsd !== undefined
              ? { costUsd: (usage?.costUsd ?? 0) + (u.costUsd ?? 0) }
              : {}),
          }
        }
        const withUsage = (result: { text: string; steps: CordisTurnStep[]; terminated: boolean }) => ({
          ...result,
          ...(usage ? { usage } : {}),
        })

        for (let i = 0; i < maxSteps; i++) {
          if (signal?.aborted) throw new Error('run aborted')
          const reply = await ctx.llm.generate({
            systemPrompt: ctx.systemPrompt.render(),
            tools: ctx.tools.list(),
            transcript: [...ctx.sessions.all()],
            ...(signal ? { signal } : {}),
          })
          addUsage(reply.usage)

          if (reply.toolCalls?.length) {
            for (const call of reply.toolCalls) {
              if (signal?.aborted) throw new Error('run aborted')
              ctx.sessions.append({ type: 'tool_call', call })
              const outcome = await ctx.tools.execute(call)
              ctx.sessions.append({ type: 'tool_result', call, outcome })
              steps.push({ call, outcome })
              if (outcome.status === 'ok' && terminate.has(call.name)) {
                return withUsage({ text: '', steps, terminated: true })
              }
            }
            continue
          }

          const text = reply.text ?? ''
          ctx.sessions.append({ type: 'assistant', text })
          return withUsage({ text, steps, terminated: false })
        }

        throw new Error(`agent loop exceeded ${maxSteps} steps without terminating`)
      },
    }
    ctx.provide('agentLoop', service)
  },
}
