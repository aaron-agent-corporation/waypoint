/**
 * Recipe + project + dispatch -> a composed cordis worker, on the shared
 * kernel (`@waypoint-engine/kernel`, Phase A of
 * docs/designs/cordis-adoption-plan.md).
 *
 * Every refusal here is a COMPOSE-TIME failure with the cause named. The
 * alternative — a worker that starts with a quietly wrong shape — is the
 * `tool_group` incident, where the field was declared, the parser dropped it,
 * and every worker silently got the full surface for months.
 *
 * Two guards do most of the work, and neither is obvious:
 *
 *  1. THE ACTIVATION GUARD. Cordis's reversible effects guarantee clean
 *     teardown; they guarantee nothing about activation having done anything.
 *     A recipe naming tools that never mounted passes every "unlisted tools are
 *     refused" check vacuously — the surface is empty, so of course nothing
 *     unlisted got through. So the composer checks that every named tool is
 *     actually present, and refuses if not.
 *
 *  2. CLEAN REFUSAL. Once the MCP child is spawned, every later failure must
 *     tear it down before throwing. A composer that fails loudly but leaks a
 *     child process has traded a visible failure for an invisible one — the
 *     spike's own test suite hung 157 seconds on exactly this.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { Context } from 'cordis'
import type { RecipeManifest } from '@waypoint-engine/core'
import {
  llmCorePlugin,
  outputBudgetPlugin,
  policyClosedPlugin,
  promptSectionPlugin,
  sessionsPlugin,
  systemPromptPlugin,
  toolsCorePlugin,
} from '@waypoint-engine/kernel'

import { cordisReferencesPlugin, cordisSkillsPlugin } from './capabilities.ts'
import { cordisMcpTools } from './mcp-tools.ts'
import {
  CordisCompositionError,
  cordisPlanDigest,
  mergeCordisLayers,
  resolveCordisReferences,
  resolveCordisSkills,
  type CordisCompositionPlan,
  type CordisDispatchLayer,
  type CordisProjectLayer,
  type CordisResolvedReference,
  type CordisResolvedSkill,
} from './composition.ts'

export { CordisCompositionError }

/** Granted by the runtime on every cordis worker — see the layer 1 note below. */
const RUNTIME_PROVIDED_TOOLS = ['read_reference', 'report'] as const

/** Tool outputs beyond this spill to the attempt's scratch dir (full text at
 *  a real path, bounded preview inline). Matches the guide's default. */
const DEFAULT_OUTPUT_BUDGET_CHARS = 32_000

export interface ComposedCordisWorker {
  readonly ctx: Context
  readonly plan: CordisCompositionPlan
  /** Stable across dispatches of the same recipe on the same project. */
  readonly digest: string
  /** The assembled system prompt — every section traceable to a file. */
  readonly systemPrompt: string
  readonly skills: readonly CordisResolvedSkill[]
  readonly references: readonly CordisResolvedReference[]
  /** Tool calls the policy fence denied — the blocked_tools audit trail. */
  readonly blockedTools: readonly string[]
  dispose(): Promise<void>
}

export interface ComposeCordisOptions {
  readonly recipe: RecipeManifest
  readonly project: CordisProjectLayer
  readonly dispatch: CordisDispatchLayer
  /** Absolute path to the MCP server entry. */
  readonly toolServer: string
  /** The attempt's private temp dir (the jailed server's TMPDIR). */
  readonly tmpDir: string
  /** The attempt's scratch write root (verify-then-apply staging). */
  readonly scratchDir: string
  /** The attempt's claim dir — the report seam. */
  readonly claimDir?: string
  /** The claim FILE the worker's report must land in. */
  readonly claimPath?: string
  /** Spawn env base. Test seam; defaults to the real process env. */
  readonly env?: NodeJS.ProcessEnv
  readonly requestTimeoutMs?: number
  /** Tool-output budget in chars; oversized outputs spill to scratchDir. */
  readonly outputBudgetChars?: number
  /** Inside a sprite VM already (S1): the VM is the jail, so the MCP child
   *  spawns without the macOS-only seatbelt wrap. Set only by the guest entry. */
  readonly alreadyJailed?: boolean
}

export async function composeCordisWorker(options: ComposeCordisOptions): Promise<ComposedCordisWorker> {
  const plan = mergeCordisLayers(options.recipe, options.project, options.dispatch)

  // Resolve the named capabilities BEFORE booting anything. A recipe naming a
  // skill that is not on disk should fail before a model is reached — not after
  // it has been billed for a turn, and not silently.
  const skills = await resolveCordisSkills(options.recipe.skills ?? [], options.project.skillsRoots)
  const references = await resolveCordisReferences(options.recipe.references ?? [], plan.caseRoot, plan.roots)
  const digest = cordisPlanDigest(plan, skills)

  // Create every directory the jail is about to grant. A granted path that
  // does not exist is a write the worker cannot make, and the failure surfaces
  // far downstream as "the run ended without a report".
  await mkdir(options.tmpDir, { recursive: true })
  await mkdir(options.scratchDir, { recursive: true })
  if (options.claimDir) await mkdir(options.claimDir, { recursive: true })

  const ctx = new Context()

  // ── Layer 1: base (the shared kernel) ─────────────────────────────────────
  // The fence exists for every worker; the recipe decides where it stands.
  //
  // Two names are always allowed because the RUNTIME grants them, not the
  // recipe. `read_reference` is only ever mounted when references were
  // declared, so allowing it costs nothing when there are none. `report` is
  // the claim seam: every tool group serves it, and a worker that cannot
  // report is recorded as having done nothing — so a recipe that simply forgot
  // to list it would fail with "never filed a claim", which names the symptom
  // and hides the cause. The report seam is not a capability a recipe grants
  // itself; it is how the host hears back at all.
  const blockedTools: string[] = []
  await Promise.all([
    ctx.plugin(sessionsPlugin),
    ctx.plugin(toolsCorePlugin),
    ctx.plugin(systemPromptPlugin),
    ctx.plugin(llmCorePlugin),
  ])
  await ctx.plugin(policyClosedPlugin, {
    allow: [...(options.recipe.tools ?? []), ...RUNTIME_PROVIDED_TOOLS],
    onDeny: (name: string) => blockedTools.push(name),
  })
  // Tool-output budget, spill mode: an oversized output parks its FULL text
  // in the attempt's scratch dir (a granted write root the worker can
  // re-read) and enters the transcript as a bounded preview + the real
  // path. Elision is the in-plugin fallback when the write fails.
  await ctx.plugin(outputBudgetPlugin, {
    maxChars: options.outputBudgetChars ?? DEFAULT_OUTPUT_BUDGET_CHARS,
    spillDir: options.scratchDir,
  })

  // ── Layer 2: recipe ───────────────────────────────────────────────────────
  // Section order IS render order on the kernel's systemPrompt: the recipe's
  // own role prompt leads, then the reference index, then the skills. The
  // composer translates — every body below is copied verbatim from a layer.
  await ctx.plugin(promptSectionPlugin, {
    id: 'role',
    title: 'Role',
    body: options.recipe.prompt,
    source: `recipe:${options.recipe.slug}`,
  })
  await ctx.plugin(cordisReferencesPlugin, { references })
  await ctx.plugin(cordisSkillsPlugin, { skills })

  const toolFiber = ctx.plugin(cordisMcpTools, {
    server: options.toolServer,
    projectRoot: plan.projectRoot,
    caseRoot: plan.caseRoot,
    ...(plan.toolGroup ? { group: plan.toolGroup } : {}),
    roots: options.project.roots,
    access: options.dispatch.access,
    tmpDir: options.tmpDir,
    scratchDir: options.scratchDir,
    // Ownership is enforced at the tool, so the item has to reach the spawn.
    ...(options.dispatch.fanoutItem ? { fanoutItem: options.dispatch.fanoutItem.slug } : {}),
    ...(options.claimDir ? { claimDir: options.claimDir } : {}),
    ...(options.claimPath ? { claimPath: options.claimPath } : {}),
    jailName: `cordis-${options.recipe.slug}-${options.dispatch.taskId}`,
    ...(options.env ? { env: options.env } : {}),
    ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
    ...(options.alreadyJailed ? { alreadyJailed: true } : {}),
  })
  await toolFiber

  /**
   * Every failure from here on tears the tool fiber down before it throws.
   * The MCP server is a live child process by this point; a refusal is only
   * clean if it leaves nothing behind.
   */
  const refuse = async (message: string): Promise<never> => {
    await (await toolFiber).dispose()
    throw new CordisCompositionError(message)
  }

  const mounted = new Set(ctx.tools.list().map((schema) => schema.name))
  const missing = plan.tools.filter((name) => !mounted.has(name))
  if (missing.length > 0) {
    await refuse(
      `recipe '${options.recipe.slug}' names ${missing.length} tool(s) the surface did not mount: ` +
        `${missing.join(', ')}. Mounted: ${[...mounted].sort().join(', ') || 'none'}. ` +
        `A named capability that is absent is a broken worker, not a quiet downgrade` +
        `${plan.toolGroup ? ` — check whether tool_group '${plan.toolGroup}' serves them` : ''}.`,
    )
  }

  // Tools mounted but not named by the recipe are NOT a defect: they are
  // served by the group and fenced by policy. `blockedTools` records any
  // attempt to use one, which is the audit trail that matters.

  const systemPrompt = ctx.systemPrompt.render()

  return {
    ctx,
    plan,
    digest,
    systemPrompt,
    skills,
    references,
    blockedTools,
    async dispose() {
      await (await toolFiber).dispose()
    },
  }
}

/** Where a cordis attempt's private temp dir lives. */
export function cordisTmpDir(projectRoot: string, routeId: string, taskId: string): string {
  return join(projectRoot, '.waypoint', 'tmp', routeId, taskId)
}

/** Where a cordis attempt stages artifacts — the same layout every other kind uses. */
export function cordisScratchDir(projectRoot: string, routeId: string, taskId: string): string {
  return join(projectRoot, '.waypoint', 'scratch', routeId, taskId)
}
