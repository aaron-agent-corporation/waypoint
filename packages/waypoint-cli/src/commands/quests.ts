import { questIsAvailable } from '@waypoint-engine/core'
import { formatCatalogEntryWarning } from '@waypoint-engine/folder-host'

import type { WaypointCliIo } from '../bin.ts'
import { loadCliCatalog } from './catalog-io.ts'
import {
  QUEST_SETS,
  QUEST_SET_LABELS,
  compareWithinSet,
  questMenuSummary,
  questSetFor,
  type QuestSet,
} from './quest-set.ts'

export async function runQuestsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  if (args.length > 0) {
    io.stderr(`Unknown quests option: ${args[0]}`)
    return 1
  }

  const catalog = await loadCliCatalog(io)
  if (!catalog) return 1
  // Skip-and-warn: a malformed authored manifest is reported, not fatal to the list.
  for (const error of catalog.questErrors) io.stderr(formatCatalogEntryWarning(error))
  const quests = catalog.quests.list()

  io.stdout('Quests')

  const primary = quests.filter((quest) => isPrimaryStarterQuest(quest.metadata))
  if (primary.length > 0) {
    io.stdout('Primary starter Quests')
    for (const quest of primary) {
      io.stdout(`- ${quest.slug}: ${quest.name}${availabilityTag(quest.metadata)}`)
      const summary = getQuestSelectionSummary(quest.slug, quest.metadata)
      if (summary) io.stdout(`  Best for: ${summary}`)
    }
  }

  const bySet = new Map<QuestSet, Array<(typeof quests)[number]>>()
  for (const quest of quests) {
    const set = questSetFor(quest.metadata)
    const bucket = bySet.get(set)
    if (bucket) bucket.push(quest)
    else bySet.set(set, [quest])
  }

  for (const set of QUEST_SETS) {
    const bucket = bySet.get(set)
    if (!bucket || bucket.length === 0) continue
    io.stdout('')
    io.stdout(`${QUEST_SET_LABELS[set]} (${bucket.length})`)
    bucket.sort((a, b) => compareWithinSet(a.slug, b.slug))
    for (const quest of bucket) {
      const summary = questMenuSummary(
        quest.description,
        getQuestSelectionSummary(quest.slug, quest.metadata),
      )
      io.stdout(`  - ${quest.slug}${availabilityTag(quest.metadata)}${summary ? `: ${summary}` : ''}`)
    }
  }
  return 0
}

/**
 * D5: a Quest that has never been proven end to end stays on the list — it is
 * real, authored work — but says so, and `waypoint start` refuses it.
 */
function availabilityTag(metadata: unknown): string {
  return questIsAvailable(metadata) ? '' : ' [not yet available]'
}

function isPrimaryStarterQuest(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const runner = (metadata as { runner?: unknown }).runner
  if (!runner || typeof runner !== 'object' || Array.isArray(runner)) return false
  return (runner as { quest_family?: unknown }).quest_family === 'primary_starter'
}

function getQuestSelectionSummary(_slug: string, metadata: unknown): string | null {
  return readWaypointMetadataString(metadata, 'selection_summary')
}

function readWaypointMetadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const runner = (metadata as { runner?: unknown }).runner
  if (!runner || typeof runner !== 'object' || Array.isArray(runner)) return null
  const value = (runner as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
