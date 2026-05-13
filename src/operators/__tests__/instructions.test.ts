import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import type { OperatorManifest } from '../manifest'
import { resolveOperatorInstructions } from '../instructions'

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'waypoint-operator-instructions-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'required-runbook.md'), '# Required\n')
  await writeFile(join(root, 'docs', 'optional-runbook.md'), '# Optional\n')
  return root
}

function operatorWithLayers(layers: OperatorManifest['instructions']['layers']): OperatorManifest {
  return {
    schema_version: 1,
    slug: 'firmvault-paralegal',
    name: 'FirmVault Paralegal',
    role: 'Paralegal Case Operator',
    instructions: { layers },
  }
}

describe('operator instruction resolver', () => {
  it('returns ordered layers for an operator manifest', async () => {
    const repoRoot = await makeRepo()
    const operator = operatorWithLayers([
      { kind: 'shared', ref: 'docs/required-runbook.md', required: true },
      { kind: 'runbook', ref: 'docs/optional-runbook.md', required: false },
    ])

    const resolved = await resolveOperatorInstructions(operator, { repoRoot })

    expect(resolved.operator_slug).toBe('firmvault-paralegal')
    expect(resolved.layers.map((layer) => `${layer.kind}:${layer.ref}:${layer.exists}`)).toEqual([
      'shared:docs/required-runbook.md:true',
      'runbook:docs/optional-runbook.md:true',
    ])
    expect(resolved.warnings).toEqual([])
    expect(resolved.errors).toEqual([])
  })

  it('marks missing optional layers as warnings', async () => {
    const repoRoot = await makeRepo()
    const operator = operatorWithLayers([{ kind: 'runbook', ref: 'docs/missing-optional.md', required: false }])

    const resolved = await resolveOperatorInstructions(operator, { repoRoot })

    expect(resolved.layers[0]).toMatchObject({ ref: 'docs/missing-optional.md', exists: false, required: false })
    expect(resolved.warnings).toEqual(['optional instruction layer missing: docs/missing-optional.md'])
    expect(resolved.errors).toEqual([])
  })

  it('marks missing required layers as errors', async () => {
    const repoRoot = await makeRepo()
    const operator = operatorWithLayers([{ kind: 'shared', ref: 'docs/missing-required.md', required: true }])

    const resolved = await resolveOperatorInstructions(operator, { repoRoot })

    expect(resolved.layers[0]).toMatchObject({ ref: 'docs/missing-required.md', exists: false, required: true })
    expect(resolved.warnings).toEqual([])
    expect(resolved.errors).toEqual(['required instruction layer missing: docs/missing-required.md'])
  })

  it('resolves skill layers against explicit skill roots', async () => {
    const repoRoot = await makeRepo()
    const skillRoot = await mkdtemp(join(tmpdir(), 'waypoint-skill-root-'))
    await mkdir(join(skillRoot, 'case-management', 'firmvault-waypoint-case-operations'), { recursive: true })
    await writeFile(join(skillRoot, 'case-management', 'firmvault-waypoint-case-operations', 'SKILL.md'), '# Skill\n')
    const operator = operatorWithLayers([
      { kind: 'skill', ref: 'case-management/firmvault-waypoint-case-operations', required: true },
    ])

    const resolved = await resolveOperatorInstructions(operator, { repoRoot, skillRoots: [skillRoot] })

    expect(resolved.layers[0]).toMatchObject({ kind: 'skill', ref: 'case-management/firmvault-waypoint-case-operations', exists: true })
    expect(resolved.errors).toEqual([])
  })

  it('does not read secrets or .env refs', async () => {
    const repoRoot = await makeRepo()
    await writeFile(join(repoRoot, '.env'), 'SECRET=value\n')
    const operator = operatorWithLayers([{ kind: 'shared', ref: '.env', required: true }])

    const resolved = await resolveOperatorInstructions(operator, { repoRoot })

    expect(resolved.layers[0]).toMatchObject({ ref: '.env', exists: false })
    expect(resolved.errors).toEqual(['instruction layer ref is disallowed because it points to a secret-like path: .env'])
  })
})
