#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const cli = join(repoRoot, 'packages/waypoint-cli/src/bin.ts')
const sourceRoot = process.env.FIRMVAULT_CASES_ROOT
  ? resolve(process.env.FIRMVAULT_CASES_ROOT)
  : '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/cases'
const outputRoot = process.env.FIRMVAULT_WAYPOINT_CASES_ROOT
  ? resolve(process.env.FIRMVAULT_WAYPOINT_CASES_ROOT)
  : '/Users/aaronwhaley/.hermes/agents/paralegal/workspace/FirmVault/waypoint_cases'
const overwrite = process.env.FIRMVAULT_EXPORT_OVERWRITE === '1'
const limit = process.env.FIRMVAULT_EXPORT_LIMIT ? Number.parseInt(process.env.FIRMVAULT_EXPORT_LIMIT, 10) : null

function runWaypoint(args, cwd) {
  const output = execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (process.env.WAYPOINT_VERBOSE_SMOKE === '1') {
    process.stdout.write(`$ waypoint ${args.join(' ')} [cwd=${cwd}]\n${output}`)
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

function requireTruthy(value, label) {
  if (!value) throw new Error(`Expected ${label}`)
}

function isCaseDirectoryName(name) {
  if (name.startsWith('.')) return false
  if (name === 'waypoint_cases') return false
  const lower = name.toLowerCase()
  if (lower.includes('template')) return false
  return true
}

async function listCaseDirectories(root) {
  const entries = await readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && isCaseDirectoryName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function landmarkSummary(guidance) {
  const satisfied = guidance?.landmarks?.satisfied ?? '?'
  const total = guidance?.landmarks?.total ?? '?'
  return `${satisfied}/${total}`
}

try {
  requireTruthy(existsSync(sourceRoot), `FirmVault source case root at ${sourceRoot}`)
  await mkdir(outputRoot, { recursive: true })

  const allCases = await listCaseDirectories(sourceRoot)
  const selectedCases = limit && Number.isFinite(limit) && limit > 0 ? allCases.slice(0, limit) : allCases
  requireTruthy(selectedCases.length > 0, `at least one case directory under ${sourceRoot}`)

  const results = []
  for (const slug of selectedCases) {
    const sourceCase = join(sourceRoot, slug)
    const outputCase = join(outputRoot, slug)

    if (existsSync(outputCase) && overwrite) {
      await rm(outputCase, { recursive: true, force: true })
    }

    const copied = !existsSync(outputCase)
    if (copied) {
      await cp(sourceCase, outputCase, { recursive: true })
    }

    const adopted = parseJson('waypoint firmvault adopt init --apply-safe --json', runWaypoint([
      'firmvault',
      'adopt',
      'init',
      '--apply-safe',
      '--json',
    ], outputCase))
    requireTruthy(adopted.schema_version === 1, `${slug} adoption schema_version`)
    requireTruthy(adopted.mutates_state === true, `${slug} adoption mutates_state`)
    requireTruthy(existsSync(join(outputCase, '.waypoint', 'firmvault', 'case.yaml')), `${slug} generated Waypoint case state`)

    const guidance = parseJson('waypoint firmvault guidance --json', runWaypoint([
      'firmvault',
      'guidance',
      '--json',
    ], outputCase))
    requireTruthy(guidance.stage !== 'needs_adoption', `${slug} adopted guidance stage`)

    const result = {
      slug,
      copied,
      applied: Array.isArray(adopted.applied_facts) ? adopted.applied_facts.length : 0,
      skipped: Array.isArray(adopted.skipped_facts) ? adopted.skipped_facts.length : 0,
      landmarks: landmarkSummary(guidance),
      stage: guidance.stage,
    }
    results.push(result)
    process.stdout.write(`exported ${slug}: copied=${copied ? 'yes' : 'no'}, applied=${result.applied}, skipped=${result.skipped}, landmarks=${result.landmarks}, stage=${result.stage}\n`)
  }

  const generatedStateCount = results.filter((result) => existsSync(join(outputRoot, result.slug, '.waypoint', 'firmvault', 'case.yaml'))).length
  requireTruthy(generatedStateCount === results.length, `Waypoint state for all exported cases (${generatedStateCount}/${results.length})`)

  process.stdout.write(`source_cases_seen: ${allCases.length}\n`)
  process.stdout.write(`cases_exported: ${results.length}\n`)
  process.stdout.write(`output_root: ${outputRoot}\n`)
  process.stdout.write('Waypoint FirmVault case export passed\n')
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
