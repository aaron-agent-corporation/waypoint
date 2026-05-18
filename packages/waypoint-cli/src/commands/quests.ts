import { loadBundledWaypointCatalog } from '@waypoint/folder-host'

import type { WaypointCliIo } from '../bin.ts'

export async function runQuestsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  if (args.length > 0) {
    io.stderr(`Unknown quests option: ${args[0]}`)
    return 1
  }

  const catalog = await loadBundledWaypointCatalog()
  const quests = catalog.quests.list()
  const primary = quests.filter((quest) => isPrimaryStarterQuest(quest.metadata))
  const additional = quests.filter((quest) => !isPrimaryStarterQuest(quest.metadata))

  io.stdout('Waypoint Quests')
  if (primary.length > 0) {
    io.stdout('Primary starter Quests')
    for (const quest of primary) {
      io.stdout(`- ${quest.slug}: ${quest.name}`)
      const summary = getQuestSelectionSummary(quest.slug, quest.metadata)
      if (summary) io.stdout(`  Best for: ${summary}`)
    }
  }

  if (additional.length > 0) {
    io.stdout('Additional bundled Quests')
    for (const quest of additional) {
      io.stdout(`- ${quest.slug}: ${quest.name}`)
    }
  }
  return 0
}

function isPrimaryStarterQuest(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const waypoint = (metadata as { waypoint?: unknown }).waypoint
  if (!waypoint || typeof waypoint !== 'object' || Array.isArray(waypoint)) return false
  return (waypoint as { quest_family?: unknown }).quest_family === 'primary_starter'
}

function getQuestSelectionSummary(slug: string, metadata: unknown): string | null {
  const metadataSummary = readWaypointMetadataString(metadata, 'selection_summary')
  if (metadataSummary) return metadataSummary

  switch (slug) {
    case 'firmvault':
      return 'legal case workflow with evidence-backed FirmVault state'
    case 'waypoint':
      return 'general project planning and execution'
    default:
      return null
  }
}

function readWaypointMetadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const waypoint = (metadata as { waypoint?: unknown }).waypoint
  if (!waypoint || typeof waypoint !== 'object' || Array.isArray(waypoint)) return null
  const value = (waypoint as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
