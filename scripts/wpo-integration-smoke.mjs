#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-wpo-integration-'))

function runWaypoint(args, cwd = repoRoot) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (process.env.WAYPOINT_VERBOSE_SMOKE === '1') {
    process.stdout.write(`$ waypoint ${args.join(' ')}\n${output}`)
    if (!output.endsWith('\n')) process.stdout.write('\n')
  }
  return output
}

function parseJson(command, output) {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`Expected ${command} to print JSON. Output:\n${output}\nParse error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Expected ${label} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function requireIncludes(values, expected, label) {
  if (!values.includes(expected)) throw new Error(`Expected ${label} to include ${expected}; got ${values.join(', ')}`)
}

function requireContains(text, expected, label) {
  if (!text.includes(expected)) throw new Error(`Expected ${label} to contain ${expected}. Output:\n${text}`)
}

try {
  const help = runWaypoint(['--help'])
  requireContains(help, 'waypoint operators show <slug> [--json]', 'CLI help')
  requireContains(help, 'waypoint handoffs list [--quest <slug>] [--json]', 'CLI help')
  requireContains(help, 'waypoint author handoff --answers <path>', 'CLI help')

  const operator = parseJson('waypoint operators show firmvault-paralegal --json', runWaypoint(['operators', 'show', 'firmvault-paralegal', '--json']))
  requireEqual(operator.slug, 'firmvault-paralegal', 'operator slug')
  requireIncludes(operator.allowed_tools.map((tool) => tool.slug), 'firmvault.state.set', 'operator allowed tools')

  const instructions = parseJson(
    'waypoint operators instructions firmvault-paralegal --json',
    runWaypoint(['operators', 'instructions', 'firmvault-paralegal', '--json']),
  )
  requireEqual(instructions.operator_slug, 'firmvault-paralegal', 'instruction operator slug')
  requireIncludes(
    instructions.layers.map((layer) => layer.ref),
    'case-management/firmvault-waypoint-case-operations',
    'instruction layers',
  )

  const tools = parseJson('waypoint tools list --operator firmvault-paralegal --json', runWaypoint(['tools', 'list', '--operator', 'firmvault-paralegal', '--json']))
  requireEqual(tools.operator_slug, 'firmvault-paralegal', 'tool operator slug')
  requireIncludes(tools.tools.map((tool) => tool.slug), 'firmvault.document.add', 'operator safe tool list')

  const stateTool = parseJson('waypoint tools explain firmvault.state.set --json', runWaypoint(['tools', 'explain', 'firmvault.state.set', '--json']))
  requireEqual(stateTool.slug, 'firmvault.state.set', 'explained tool slug')
  requireIncludes(stateTool.inputs.map((input) => input.name), 'evidence', 'state.set inputs')

  const questHandoffs = parseJson(
    'waypoint handoffs list --quest firmvault --json',
    runWaypoint(['handoffs', 'list', '--quest', 'firmvault', '--json']),
  )
  requireEqual(questHandoffs.quest, 'firmvault', 'handoff quest filter')
  requireEqual(questHandoffs.handoffs.length, 1, 'FirmVault resolved handoff manifest count')
  requireEqual(questHandoffs.handoffs[0].slug, 'firmvault-paralegal-handoffs', 'FirmVault handoff manifest slug')

  const handoffManifest = parseJson(
    'waypoint handoffs show firmvault-paralegal-handoffs --json',
    runWaypoint(['handoffs', 'show', 'firmvault-paralegal-handoffs', '--json']),
  )
  requireEqual(handoffManifest.slug, 'firmvault-paralegal-handoffs', 'shown handoff manifest slug')
  requireIncludes(
    handoffManifest.handoffs.map((handoff) => handoff.slug),
    'paralegal-to-attorney-demand-review',
    'FirmVault handoff steps',
  )

  const answersPath = join(tempRoot, 'handoff.answers.json')
  await writeFile(
    answersPath,
    JSON.stringify(
      {
        slug: 'firmvault-closeout-smoke-handoffs',
        name: 'FirmVault Closeout Smoke Handoffs',
        domain: 'firmvault',
        description: 'Temporary dry-run handoff graph for the WPO integration smoke.',
        source: {
          design_spec_path: 'docs/plans/2026-05-13-wpo-closeout-integration-smoke-plan.md',
          inspected_paths: ['operators/firmvault/paralegal.yaml', 'handoffs/firmvault/paralegal.yaml', 'quests/firmvault.yaml'],
        },
        handoffs: [
          {
            slug: 'paralegal-to-attorney-closeout-smoke-review',
            from: 'firmvault-paralegal',
            to: 'attorney-review',
            trigger: 'closeout_smoke_ready',
            gate: 'human_attorney_review',
            required_artifacts: ['docs/closeout-smoke-summary.md'],
          },
        ],
      },
      null,
      2,
    ),
  )

  const draft = parseJson(
    'waypoint author handoff --answers <temp> --allow-unapproved-draft --write-draft examples/authoring/closeout-smoke-handoff.yaml --json',
    runWaypoint(
      ['author', 'handoff', '--answers', answersPath, '--allow-unapproved-draft', '--write-draft', 'examples/authoring/closeout-smoke-handoff.yaml', '--json'],
      tempRoot,
    ),
  )
  requireEqual(draft.kind, 'handoff', 'author handoff draft kind')
  requireEqual(draft.write_default, false, 'author handoff write default')
  requireEqual(draft.validation.ok, true, 'author handoff draft validation')
  requireEqual(draft.written_path, 'examples/authoring/closeout-smoke-handoff.yaml', 'author handoff written path')

  const writtenDraftPath = join(tempRoot, 'examples/authoring/closeout-smoke-handoff.yaml')
  if (!existsSync(writtenDraftPath)) throw new Error(`Expected handoff draft to be written at ${writtenDraftPath}`)
  const writtenDraft = await readFile(writtenDraftPath, 'utf8')
  requireContains(writtenDraft, 'slug: firmvault-closeout-smoke-handoffs', 'written handoff draft')
  requireContains(writtenDraft, 'install_default: false', 'written handoff draft')

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        operator: operator.slug,
        instruction_layers: instructions.layers.length,
        safe_tools: tools.tools.length,
        quest_handoffs: questHandoffs.handoffs.map((manifest) => manifest.slug),
        handoff_steps: handoffManifest.handoffs.length,
        authored_draft: draft.written_path,
      },
      null,
      2,
    ),
  )
  process.stdout.write('\nWaypoint WPO integration smoke passed\n')
} finally {
  if (process.env.WAYPOINT_KEEP_SMOKE_PROJECT !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
