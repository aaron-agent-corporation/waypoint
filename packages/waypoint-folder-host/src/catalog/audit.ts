/**
 * Catalog-load audit: what is wrong with a recipe that parsing cannot see.
 *
 * `parseRecipeManifest` answers "is this well-formed YAML with the right
 * fields". It cannot answer "does the skill this recipe names exist" or "will
 * the runtime that runs this recipe read the field the author wrote", because
 * both are facts about the world outside the file. Those went unchecked, and
 * both have already cost something:
 *
 *  - A named skill that does not resolve fails at COMPOSE — correct, but that
 *    is the moment a case is already running, and only for a recipe someone
 *    dispatches. A recipe nobody has run yet is not verified, it is untested.
 *    (H-7.)
 * These are findings, not errors. The audit reports; it does not refuse.
 *
 * The `inert-tools` finding this audit used to carry (H-6) retired with item
 * 29: `parseRecipeManifest` now refuses `tools:` on any kind outside
 * `toolsConsumingRuntimeKinds()`, so such a recipe never reaches this audit —
 * it lands in the loader's `recipeErrors` instead.
 */

import { readFile } from 'node:fs/promises'

import { parseRecipeManifest } from '@waypoint-engine/core'

import { resolveCordisSkills } from '../runtime/cordis/composition.ts'
import type { BundledWaypointCatalog } from './bundled.ts'

export type CatalogFindingCode = 'unresolvable-skill' | 'invalid-manifest'

export interface CatalogFinding {
  readonly code: CatalogFindingCode
  readonly recipe: string
  /** One sentence, naming the recipe and what about it does not hold. */
  readonly message: string
}

export interface AuditCatalogOptions {
  /**
   * Extra skills roots to search before the catalog's own, in order — the same
   * precedence the cordis runtime uses, so the audit and the composer cannot
   * disagree about whether a name resolves.
   */
  readonly skillsRoots?: readonly string[]
}

/**
 * Check every recipe in a catalog against the world it will run in.
 *
 * Skill resolution goes through `resolveCordisSkills`, the function the
 * composer itself calls, rather than a second implementation of the same
 * search. A lint that re-derives the rule it is checking drifts from it, and
 * then reports confidently about a rule nobody enforces — which is the defect
 * in the row above it, not a good way to fix it.
 */
export async function auditCatalogRecipes(
  catalog: BundledWaypointCatalog,
  options: AuditCatalogOptions = {},
): Promise<readonly CatalogFinding[]> {
  const findings: CatalogFinding[] = []
  const skillsRoots = [...(options.skillsRoots ?? []), catalog.skillsDir].filter((root) => root !== '')

  for (const entry of [...catalog.recipeEntries].sort((a, b) => a.slug.localeCompare(b.slug))) {
    // Re-parse through the AUTHORITATIVE parser rather than reading the
    // catalog's own view. The catalog keeps a deliberately loose shape for
    // discovery and its parser drops `skills:` on the floor entirely, so an
    // audit built on it would have reported "no skill problems" for a bundle
    // whose skills it could not see — a lint that cannot fail, which is the
    // thing the prose linter has a rule against.
    const parsed = parseRecipeManifest(await readFile(entry.path, 'utf8').catch(() => ''))
    // Broken YAML never reaches recipeEntries (the loader reports it in
    // recipeErrors), so anything failing HERE was accepted by the loose
    // discovery loader but refused by the authoritative parser — the parser
    // every dispatch goes through. Silence would mean a recipe that lists
    // fine and refuses at start (e.g. tools: on a kind that never reads it,
    // item 29). Report it; no double-count is possible.
    if (!parsed.ok) {
      findings.push({
        code: 'invalid-manifest',
        recipe: entry.slug,
        message: `${entry.slug}: ${entry.relativePath}: ${parsed.error.message}`,
      })
      continue
    }
    const recipe = parsed.manifest

    const skills = recipe.skills ?? []
    if (skills.length > 0) {
      try {
        await resolveCordisSkills(skills, skillsRoots)
      } catch (error) {
        findings.push({
          code: 'unresolvable-skill',
          recipe: recipe.slug,
          // The resolver's message already names the skill and every path it
          // searched; re-wording it here would lose the paths.
          message: `${recipe.slug}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

  }
  return findings
}

/** The findings of one code, for a caller that cares about a single class. */
export function findingsOfCode(
  findings: readonly CatalogFinding[],
  code: CatalogFindingCode,
): readonly CatalogFinding[] {
  return findings.filter((finding) => finding.code === code)
}
