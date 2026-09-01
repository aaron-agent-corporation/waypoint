/**
 * The two capabilities a recipe names directly: skills and references.
 *
 * Both exist to move something out of prompt prose and into something the
 * runtime can enforce. The distinction is worth being precise about, because
 * "put it in the prompt" is the status quo they replace:
 *
 *   - a SKILL was advice. It is now a file, read verbatim, mounted as a prompt
 *     section that carries its own source path, and fatal by name if missing.
 *   - a REFERENCE was a sentence saying "consult the vocabulary doc" and a hope.
 *     It is now the only readable thing in the worker's world, reachable through
 *     a tool whose schema enumerates exactly the named documents.
 */
import type { Context } from 'cordis'
import { readFile } from 'node:fs/promises'

import type { CordisResolvedReference, CordisResolvedSkill } from './composition.ts'

export interface SkillsPluginConfig {
  readonly skills: readonly CordisResolvedSkill[]
}

/**
 * Each skill becomes its own prompt section. Its `source` is the file path, so
 * a reader of the assembled prompt can answer "who wrote this?" for every
 * line — and the answer is always a file, never the composer.
 */
export function cordisSkillsPlugin(ctx: Context, config: SkillsPluginConfig): void {
  for (const skill of config.skills) {
    ctx.effect(
      () => ctx.systemPrompt.addSection(`skill:${skill.name}`, `Skill — ${skill.name}`, skill.content, skill.path),
      `prompt:skill:${skill.name}`,
    )
  }
}

cordisSkillsPlugin.inject = ['systemPrompt']

export interface ReferencesPluginConfig {
  readonly references: readonly CordisResolvedReference[]
}

/**
 * The closed read surface.
 *
 * With references declared, `read_reference` is mounted and its schema `enum`
 * is exactly the named documents — the model cannot even express a request for
 * anything else, and the runtime refuses it a second time if it tries.
 *
 * With NO references declared, no tool is mounted at all. A capability that was
 * not granted should be absent, not present-and-always-refusing: an empty tool
 * invites the model to keep trying, and it puts a permanently failing call in
 * the audit trail that means nothing.
 */
export function cordisReferencesPlugin(ctx: Context, config: ReferencesPluginConfig): void {
  const names = config.references.map((r) => r.name)
  const byName = new Map(config.references.map((r) => [r.name, r]))

  if (names.length === 0) {
    ctx.effect(
      () =>
        ctx.systemPrompt.addSection(
          'references:index',
          'Documents you can read',
          'You have no reading tool on this task. Work from the instruction and your tools alone.',
          'composed',
        ),
      'prompt:references:index',
    )
    return
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.addSection(
        'references:index',
        'Documents you can read',
        `Use read_reference to read any of these, and only these:\n\n` +
          names.map((n) => `- ${n}`).join('\n') +
          `\n\nThere is no other way to read a file on this task.`,
        'composed',
      ),
    'prompt:references:index',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        {
          name: 'read_reference',
          description: `Read one of this task's references. Allowed names: ${names.join(', ')}. No other path is readable.`,
          parameters: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: { name: { type: 'string', enum: names } },
          },
        },
        async (args) => {
          const requested = typeof args.name === 'string' ? args.name : ''
          const match = byName.get(requested)
          if (!match) {
            // The refusal names what IS available. A refusal that only says
            // "no" makes the model guess again; one that lists the surface
            // ends the loop. Thrown, so the outcome is status 'error'.
            throw new Error(
              `'${requested}' is not a reference on this task. Available: ${names.join(', ')}`,
            )
          }
          return readFile(match.path, 'utf8')
        },
      ),
    'tool:read_reference',
  )
}

cordisReferencesPlugin.inject = ['systemPrompt', 'tools']
