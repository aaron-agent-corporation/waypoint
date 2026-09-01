/**
 * @waypoint/kernel — the shared Cordis agent kernel
 * (docs/designs/cordis-adoption-plan.md, Phase A).
 *
 * This package is the substrate BOTH sides compose on: the Waypoint worker
 * runtime (kind: cordis recipes) today, and the Waypoint brain (Phase B of the
 * adoption plan) as it lands. Contracts are ported from the parent project's
 * kernel and owned here — they are the interoperability surface every
 * plugin, adapter and the brain are written against. It carries only:
 *
 *  - the service DEFINITIONS (kernel.ts): tools / llm / sessions /
 *    systemPrompt / agentLoop contracts and the tool-execute waterfall; and
 *  - the base PLUGINS (plugins.ts): the plumbing every composed agent
 *    shares, all registrations behind revertible effects.
 *
 * Deliberately absent: recipe composition, filesystem tools, provider
 * adapters, model routing — those are host concerns (worker: folder-host;
 * brain: its harness package). One dependency: cordis itself, pinned exact.
 */
export type {
  CordisAgentLoopService,
  CordisLlmAdapter,
  CordisLlmReply,
  CordisLlmRequest,
  CordisLlmService,
  CordisSessionEvent,
  CordisSessionsService,
  CordisSystemPromptService,
  CordisToolCall,
  CordisToolExecRequest,
  CordisToolHandler,
  CordisToolOutcome,
  CordisToolSchema,
  CordisToolStatus,
  CordisToolsService,
  CordisTurnResult,
  CordisTurnStep,
  CordisUsage,
  ToolParameters,
} from './kernel.ts'

export {
  agentLoopPlugin,
  llmCorePlugin,
  outputBudgetPlugin,
  policyClosedPlugin,
  promptSectionPlugin,
  sessionsPlugin,
  sliceSurrogateSafe,
  systemPromptPlugin,
  toolPlugin,
  toolsCorePlugin,
  type AgentLoopConfig,
  type OutputBudgetConfig,
  type PolicyClosedConfig,
  type PromptSectionConfig,
  type ToolPluginConfig,
} from './plugins.ts'

export {
  compactionToRecord,
  promptSectionsToRecords,
  sessionEventsToRecords,
  sourceFromUserText,
  usageToRecord,
  type PromptSection,
  type TrajectoryCall,
  type TrajectoryOutcome,
  type TrajectoryRecord,
  type TrajectoryScope,
  type TrajectoryType,
  type TrajectoryUsage,
  type SessionEventsToRecordsOptions,
} from './trajectory.ts'
