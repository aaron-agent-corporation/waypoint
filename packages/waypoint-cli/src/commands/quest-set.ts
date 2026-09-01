/**
 * Quest sets — the at-a-glance taxonomy for the quests menu.
 *
 * Waypoint ships one internal set (`core`) for the bundled scaffold quests.
 * A host embedding the runner can declare its own sets by setting
 * `metadata.runner.quest_set` on its authored quest manifests; the set is
 * derived from manifest metadata only, never from filenames or paths.
 */

export const QUEST_SETS = ['core'] as const

export type QuestSet = (typeof QUEST_SETS)[number]

export const QUEST_SET_LABELS: Record<QuestSet, string> = {
  core: 'Available quests',
}

function isQuestSet(value: unknown): value is QuestSet {
  return typeof value === 'string' && (QUEST_SETS as readonly string[]).includes(value)
}

function metadataSection(metadata: unknown, key: string): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const section = (metadata as Record<string, unknown>)[key]
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null
  return section as Record<string, unknown>
}

export function questSetFor(metadata: unknown): QuestSet {
  const runner = metadataSection(metadata, 'runner')
  if (runner && isQuestSet(runner.quest_set)) return runner.quest_set
  return 'core'
}

/** Ordering within a set. Plain alphabetical. */
export function compareWithinSet(a: string, b: string): number {
  return a.localeCompare(b)
}

/**
 * One menu line per quest. Prefers the authored selection summary; otherwise
 * derives one from the manifest description, stripping any port boilerplate
 * ("Waypoint sub-Quest port of gsd:debug for ..." -> "...").
 */
export function questMenuSummary(description: string | undefined, selectionSummary: string | null): string | null {
  if (selectionSummary) return selectionSummary
  if (!description) return null
  const stripped = description.replace(/^Waypoint (?:catalog Quest|sub-Quest) port of \S+ for\s+/i, '').replace(/\s+/g, ' ').trim()
  if (!stripped) return null
  const line = stripped[0].toUpperCase() + stripped.slice(1)
  return line.length > 100 ? `${line.slice(0, 97)}...` : line
}
