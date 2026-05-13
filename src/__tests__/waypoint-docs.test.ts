import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadQuestsFromDirectory, loadRecipesFromDirectory } from '../index.js'

const repoRoot = resolve(__dirname, '../..')
const questsDir = resolve(repoRoot, 'quests')
const recipesDir = resolve(repoRoot, 'recipes')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('Waypoint Quest operator documentation', () => {
  it('links the operator guide and command map from the README', () => {
    const readme = readRepoFile('README.md')

    expect(readme).toContain('docs/quests/waypoint.md')
    expect(readme).toContain('docs/quests/waypoint-command-map.md')
  })

  it('explains the operator workflow, human gates, recipes, adaptations, and deferred scope', () => {
    const guide = readRepoFile('docs/quests/waypoint.md')

    for (const phrase of [
      'initialize → discuss → plan → execute → verify → ship',
      'Quest is the user-facing journey template',
      'Recipe is the reusable agent definition',
      'Humans intervene',
      'task-scoped discussion',
      'plan approval gate',
      'verification gate',
      'ship approval gate',
      'not implemented yet',
      'does not implement a standalone source CLI',
    ]) {
      expect(guide).toContain(phrase)
    }
  })

  it('publishes a human-readable command map backed by all 65 YAML mappings', () => {
    const sourceMap = readRepoFile('docs/quests/waypoint-command-map.yaml')
    const markdownMap = readRepoFile('docs/quests/waypoint-command-map.md')
    const sourceCommands = Array.from(
      sourceMap.matchAll(/^\s+- source_command: commands\/gsd\/(.+)$/gm),
      ([, command]) => command,
    )

    expect(sourceCommands).toHaveLength(65)
    expect(markdownMap).toContain('Generated from `docs/quests/waypoint-command-map.yaml`')

    for (const command of sourceCommands) {
      expect(markdownMap).toContain(`commands/gsd/${command}`)
    }

    for (const phrase of [
      '`/waypoint pause`',
      '`/waypoint resume`',
      '`/waypoint auto`',
      'deferred optional namespace commands',
      '`quests/waypoint.yaml`',
    ]) {
      expect(markdownMap).toContain(phrase)
    }
  })

  async function loadCatalogCounts() {
    const quests = await loadQuestsFromDirectory(questsDir)
    expect(quests.ok).toBe(true)
    if (!quests.ok) throw new Error(JSON.stringify(quests.errors))

    const recipes = await loadRecipesFromDirectory(recipesDir)
    expect(recipes.ok).toBe(true)
    if (!recipes.ok) throw new Error(JSON.stringify(recipes.errors))

    const questSlugs = quests.registry.list().map((quest) => quest.slug).sort()
    const recipeSlugs = recipes.registry.list().map((recipe) => recipe.slug).sort()
    const gsdRecipeSlugs = recipeSlugs.filter((slug) => slug.startsWith('waypoint-'))

    return { questSlugs, recipeSlugs, gsdRecipeSlugs }
  }

  it('publishes a catalog with loader-backed Quest and Recipe counts plus attribution', async () => {
    const { questSlugs, recipeSlugs, gsdRecipeSlugs } = await loadCatalogCounts()
    const catalog = readRepoFile('docs/waypoint-quest-catalog.md')

    expect(catalog).toContain(`Total Quests loaded from disk: ${questSlugs.length}`)
    expect(catalog).toContain(`Total Recipes loaded from disk: ${recipeSlugs.length}`)
    expect(catalog).toContain(`Waypoint source-derived Recipes: ${gsdRecipeSlugs.length}`)
    expect(catalog).toContain('MIT License')
    expect(catalog).toContain('Copyright (c) 2025 Lex Christopherson')
    expect(catalog).toContain('third_party/gsd/LICENSE')
    expect(catalog).toContain('third_party/gsd/NOTICE.md')

    for (const slug of [...questSlugs, ...recipeSlugs]) {
      expect(catalog).toContain(`\`${slug}\``)
    }
  })

  it('records the P8 close-out gate with loader-backed counts, verification commands, and deferred work', async () => {
    const { questSlugs, recipeSlugs, gsdRecipeSlugs } = await loadCatalogCounts()
    const status = readRepoFile('docs/plans/waypoint-source-port-status.md')
    const resumePlan = readRepoFile('WAYPOINT_RESUME_PLAN.md')

    for (const doc of [status, resumePlan]) {
      expect(doc).toContain('P8 close-out gate')
      expect(doc).toContain(`Actual Quest count: ${questSlugs.length}`)
      expect(doc).toContain(`Actual Recipe count: ${recipeSlugs.length}`)
      expect(doc).toContain(`Waypoint source-derived Recipe count: ${gsdRecipeSlugs.length}`)
      expect(doc).toContain('pnpm test')
      expect(doc).toContain('pnpm typecheck')
      expect(doc).toContain('Explicit deferred work')
      expect(doc).toContain('folder-host runtime')
      expect(doc).toContain('live Recipe execution')
    }
  })

  it('publishes a FirmVault document ingestion runbook and smoke command', () => {
    const runbook = readRepoFile('docs/firmvault-document-ingestion-runbook.md')
    const plan = readRepoFile('docs/plans/firmvault-document-pipeline-waypoint-integration-plan.md')
    const packageJson = JSON.parse(readRepoFile('package.json'))

    expect(packageJson.scripts['smoke:firmvault-document-ingestion']).toBe('node scripts/firmvault-document-ingestion-smoke.mjs')
    expect(plan).toContain('Phase D8 — Operator runbook and injected end-to-end smoke')
    expect(plan).toContain('docs/firmvault-document-ingestion-runbook.md')
    expect(plan).toContain('scripts/firmvault-document-ingestion-smoke.mjs')

    for (const phrase of [
      'bootstrap or select a trusted FirmVault case',
      'waypoint firmvault add-document',
      'firmvault-document-pipeline',
      'Forgejo PR',
      'waypoint firmvault document-handoff',
      'sync the PR result',
      'legalLandmarksUpdated: false',
      'does not satisfy legal workflow landmarks',
      'pnpm smoke:firmvault-document-ingestion',
    ]) {
      expect(runbook).toContain(phrase)
    }
  })

  it('publishes a FirmVault paralegal state operator runbook', () => {
    const runbook = readRepoFile('docs/firmvault-paralegal-state-operator-runbook.md')
    const plan = readRepoFile('docs/plans/2026-05-10-firmvault-state-cli-and-lifecycle-simulation-plan.md')

    expect(plan).toContain('Milestone FVL3 — Hermes/paralegal state adapter wiring')
    expect(plan).toContain('docs/firmvault-paralegal-state-operator-runbook.md')

    for (const phrase of [
      'Never edit `.waypoint/firmvault/*.yaml` directly',
      'Always inspect state and landmarks before mutation',
      'waypoint firmvault evidence check',
      'waypoint firmvault state set',
      'waypoint firmvault document-handoff',
      'does not satisfy legal landmarks',
      'newly_satisfied',
      'trusted `casesRootKey`',
      '`paralegal` profile',
    ]) {
      expect(runbook).toContain(phrase)
    }
  })

  it('publishes the FirmVault full lifecycle simulation fixture and smoke command', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'))
    const fixture = readRepoFile('examples/firmvault-lifecycle-simulation/fixture.yaml')
    const readme = readRepoFile('examples/firmvault-lifecycle-simulation/README.md')
    const smoke = readRepoFile('scripts/firmvault-lifecycle-simulation-smoke.mjs')
    const plan = readRepoFile('docs/plans/2026-05-10-firmvault-state-cli-and-lifecycle-simulation-plan.md')

    expect(packageJson.scripts['smoke:firmvault-lifecycle-simulation']).toBe('node scripts/firmvault-lifecycle-simulation-smoke.mjs')
    expect(plan).toContain('Milestone FVL4 — Full lifecycle simulation harness, fixture-first')
    expect(fixture).toContain('schema_version: 1')
    expect(fixture).toContain('case:')
    expect(fixture).toContain('steps:')
    expect(fixture).toContain('fact: settlement.closing.case')
    expect(readme).toContain('waypoint firmvault bootstrap')
    expect(readme).toContain('waypoint firmvault state set')
    expect(readme).toContain('all 82 deterministic legal landmarks')
    expect(readme).toContain('does not edit `.waypoint/firmvault/*.yaml` directly')
    expect(smoke).toContain('Waypoint FirmVault lifecycle simulation smoke passed')
    expect(smoke).toContain('firmvault.state.updated')
  })

  it('publishes the FirmVault completed-case replay plan with sandbox and redaction guardrails', () => {
    const plan = readRepoFile('docs/plans/firmvault-completed-case-replay-plan.md')

    for (const phrase of [
      'FVL5 — Completed-Case Replay',
      'read-only source case',
      'temporary sandbox case',
      'No external sends, faxes, API calls, Forgejo writes, or trust-account actions',
      'Never commit copied case documents',
      '[REDACTED]',
      'mapping manifest',
      'waypoint firmvault state set',
      'does not edit `.waypoint/firmvault/*.yaml` directly',
      'pnpm smoke:firmvault-completed-case-replay',
    ]) {
      expect(plan).toContain(phrase)
    }
  })

  it('publishes the FirmVault completed-case replay template, synthetic example, and smoke command', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'))
    const template = readRepoFile('examples/firmvault-lifecycle-simulation/completed-case-replay.template.yaml')
    const example = readRepoFile('examples/firmvault-lifecycle-simulation/completed-case-replay.example.yaml')
    const smoke = readRepoFile('scripts/firmvault-completed-case-replay.mjs')

    expect(packageJson.scripts['smoke:firmvault-completed-case-replay']).toBe('node scripts/firmvault-completed-case-replay.mjs')
    expect(template).toContain('[REDACTED]')
    expect(template).toContain('source:')
    expect(template).toContain('root:')
    expect(template).toContain('steps:')
    expect(template).toContain('fact: settlement.closing.case')
    expect(example).toContain('Synthetic Completed Case Replay')
    expect(example).toContain('fact: case.setup')
    expect(example).toContain('fact: settlement.closing.case')
    expect(smoke).toContain('Waypoint FirmVault completed-case replay smoke passed')
    expect(smoke).toContain('FIRMVAULT_COMPLETED_CASE_REPLAY_MANIFEST')
    expect(smoke).toContain('firmvault.state.updated')
  })

  it('publishes the authoring fixture for FirmVault dry-run draft generation', () => {
    const readme = readRepoFile('examples/authoring/README.md')
    const answers = JSON.parse(readRepoFile('examples/authoring/firmvault-followup.answers.json')) as {
      slug: string
      source: { inspected_paths: string[] }
      phases: Array<{ tasks: Array<{ type: string }> }>
    }

    expect(readme).toContain('waypoint author quest --answers examples/authoring/firmvault-followup.answers.json --allow-unapproved-draft --json')
    expect(readme).toContain('valid Quest YAML draft')
    expect(readme).toContain('draft only: not written or installed')
    expect(answers.slug).toBe('firmvault-followup')
    expect(answers.source.inspected_paths).toContain('quests/firmvault.yaml')
    expect(answers.phases.flatMap((phase) => phase.tasks).some((task) => task.type === 'gate')).toBe(true)
  })

  it('publishes a clickable FirmVault case-folder blueprint with per-file fill guidance', () => {
    const blueprint = readRepoFile('docs/firmvault-case-folder-blueprint.html')

    for (const phrase of [
      'FirmVault Case Folder Blueprint v2',
      'Click a markdown file to see what you add',
      'What you add',
      'Source documents usually live in',
      'Supports state facts',
      'Example completed stub',
      'Blank starter file',
      'Summary file',
      'Index file',
      'Evidence file',
      'Machine-generated / do not edit',
      'client/intake.md',
      'settlement/closing/case-closed.md',
      'waypoint firmvault state set',
    ]) {
      expect(blueprint).toContain(phrase)
    }
  })
})
