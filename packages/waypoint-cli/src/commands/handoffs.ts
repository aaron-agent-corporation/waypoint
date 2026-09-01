import { loadBundledHandoffManifests, type HandoffManifest } from '@waypoint-engine/core'

import type { WaypointCliIo } from '../bin.ts'
import { loadCliCatalog } from './catalog-io.ts'

const usage = `Waypoint handoffs

Usage:
  waypoint handoffs list [--quest <slug>] [--json]
  waypoint handoffs show <slug> [--json]
`

type HandoffSummary = {
  readonly slug: string
  readonly name: string
  readonly description?: string
  readonly handoff_count: number
}

export async function runHandoffsCommand(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const [subcommand] = args
  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    io.stdout(usage.trimEnd())
    return 0
  }

  if (subcommand === 'list') return runList(args.slice(1), io)
  if (subcommand === 'show') return runShow(args.slice(1), io)

  io.stderr(`Unknown handoffs command: ${subcommand}`)
  io.stderr(usage.trimEnd())
  return 1
}

async function runList(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const parsedArgs = parseListArgs(args)
  if (parsedArgs.ok === false) {
    io.stderr(parsedArgs.error)
    return 1
  }

  const loaded = await loadBundledHandoffManifests()
  if (loaded.ok === false) {
    io.stderr(`Failed to load handoff manifests: ${loaded.errors.map((error) => error.message).join('; ')}`)
    return 1
  }

  let manifests = loaded.manifests
  if (parsedArgs.quest) {
    // Workspace-aware + clean-error, consistent with quests/recipes (runner-sga NB6):
    // a workspace-authored quest can list its handoffs, and a catalog-load failure
    // surfaces as a clean message rather than an unhandled rejection.
    const catalog = await loadCliCatalog(io)
    if (!catalog) return 1
    const quest = catalog.quests.get(parsedArgs.quest)
    if (!quest) {
      io.stderr(`Unknown quest: ${parsedArgs.quest}`)
      return 1
    }
    const questHandoffSlugs = quest.handoff_manifests ?? []
    const questHandoffSlugSet = new Set(questHandoffSlugs)
    manifests = loaded.manifests.filter((manifest) => questHandoffSlugSet.has(manifest.slug))
    const missing = questHandoffSlugs.filter((slug) => !loaded.manifests.some((manifest) => manifest.slug === slug))
    if (missing.length > 0) {
      io.stderr(`Unresolved handoff manifest slug(s) for quest ${parsedArgs.quest}: ${missing.join(', ')}`)
      return 1
    }
  }

  const summaries = manifests.map(toSummary)
  if (parsedArgs.json) {
    io.stdout(JSON.stringify({ ...(parsedArgs.quest ? { quest: parsedArgs.quest } : {}), handoffs: summaries }, null, 2))
    return 0
  }

  io.stdout(parsedArgs.quest ? `Handoff graphs for ${parsedArgs.quest}` : 'Handoff graphs')
  for (const manifest of manifests) {
    io.stdout(`- ${manifest.slug}: ${manifest.name} (${manifest.handoffs.length} handoffs)`)
  }
  return 0
}

async function runShow(args: readonly string[], io: WaypointCliIo): Promise<number> {
  const json = args.includes('--json')
  const positional = args.filter((arg) => arg !== '--json')
  const slug = positional[0]
  const extras = positional.slice(1)
  if (!slug) {
    io.stderr('Missing handoff manifest slug')
    return 1
  }
  if (extras.length > 0) {
    io.stderr(`Unexpected argument(s): ${extras.join(', ')}`)
    return 1
  }

  const loaded = await loadBundledHandoffManifests()
  if (loaded.ok === false) {
    io.stderr(`Failed to load handoff manifests: ${loaded.errors.map((error) => error.message).join('; ')}`)
    return 1
  }

  const manifest = loaded.manifests.find((candidate) => candidate.slug === slug)
  if (!manifest) {
    io.stderr(`Unknown handoff manifest: ${slug}`)
    return 1
  }

  if (json) {
    io.stdout(JSON.stringify(manifest, null, 2))
    return 0
  }

  printHandoffManifest(manifest, io)
  return 0
}

function parseListArgs(args: readonly string[]):
  | { readonly ok: true; readonly json: boolean; readonly quest?: string }
  | { readonly ok: false; readonly error: string } {
  let json = false
  let quest: string | undefined

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--quest') {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) return { ok: false, error: 'Missing value for --quest' }
      quest = value
      i += 1
      continue
    }
    return { ok: false, error: `Unknown option: ${arg}` }
  }

  return { ok: true, json, ...(quest ? { quest } : {}) }
}

function toSummary(manifest: HandoffManifest): HandoffSummary {
  return {
    slug: manifest.slug,
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    handoff_count: manifest.handoffs.length,
  }
}

function printHandoffManifest(manifest: HandoffManifest, io: WaypointCliIo): void {
  io.stdout(`${manifest.name} (${manifest.slug})`)
  if (manifest.description) io.stdout(`description: ${manifest.description}`)
  io.stdout('handoffs:')
  for (const handoff of manifest.handoffs) {
    io.stdout(`- ${handoff.slug}: ${handoff.from} -> ${handoff.to}`)
    io.stdout(`  trigger: ${handoff.trigger}`)
    if (handoff.gate) io.stdout(`  gate: ${handoff.gate}`)
    if (handoff.required_artifacts && handoff.required_artifacts.length > 0) {
      io.stdout('  required artifacts:')
      for (const artifact of handoff.required_artifacts) io.stdout(`    - ${artifact}`)
    }
  }
}
