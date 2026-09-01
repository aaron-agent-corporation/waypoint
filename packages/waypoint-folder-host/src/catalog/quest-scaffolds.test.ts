import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'

import { validateQuestScaffolds } from './quest-scaffolds.ts'

const questsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../quests')

describe('validateQuestScaffolds', () => {
  it('accepts every bundled quest', async () => {
    const entries = (await readdir(questsDir)).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    expect(entries.length).toBeGreaterThan(0)
    for (const name of entries) {
      const value = parseYaml(await readFile(join(questsDir, name), 'utf8')) as Record<string, unknown>
      const errors = validateQuestScaffolds(value.scaffolds)
      expect(errors, `${name}: ${errors.join('; ')}`).toEqual([])
    }
  })

  it('accepts absent scaffolds (bare recipe roster quest)', () => {
    expect(validateQuestScaffolds(undefined)).toEqual([])
  })

  const base = () => ({
    workstreams: [
      {
        key: 'q',
        name: 'Q',
        milestones: [
          {
            version_label: 'v1',
            title: 'M',
            phases: [
              {
                phase_key: 'Q1',
                phase_slug: 'one',
                lifecycle_phase: 'execute',
                plans: [
                  {
                    plan_ref: 'step-one',
                    title: 'Step one',
                    wave: 1,
                    metadata: { runner: { node: { type: 'checkpoint' } } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  it('accepts a minimal well-formed tree', () => {
    expect(validateQuestScaffolds(base())).toEqual([])
  })

  it('rejects a plan missing node.type with an annotated path', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata = { runner: {} } as never
    const errors = validateQuestScaffolds(tree)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('plans[0].metadata.runner.node.type: required')
  })

  it('rejects an unknown node type', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner.node.type = 'vibes'
    expect(validateQuestScaffolds(tree)[0]).toContain("unknown type 'vibes'")
  })

  it('rejects a recipe node without recipe.slug', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner.node.type = 'recipe'
    expect(validateQuestScaffolds(tree)[0]).toContain('recipe.slug: required for recipe nodes')
  })

  it('rejects a gate node without gate.kind', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner.node.type = 'gate'
    expect(validateQuestScaffolds(tree)[0]).toContain('gate.kind: required for gate nodes')
  })

  it('accepts an admissible when predicate (X2)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.when = "SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE status = 'done')"
    expect(validateQuestScaffolds(tree)).toEqual([])
  })

  it('rejects an inadmissible when predicate with the fail-closed rules (X2)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.when = 'DELETE FROM waypoint.tasks; SELECT $x FROM {sys_instance_id} -- df.cancel'
    const errors = validateQuestScaffolds(tree)
    expect(errors.join('\n')).toContain('when: predicate must be a single SELECT statement')
    expect(errors.join('\n')).toContain("';' is not allowed")
    expect(errors.join('\n')).toContain("'$' is not allowed")
    expect(errors.join('\n')).toContain("allowed only as the start-time variables")
    expect(errors.join('\n')).toContain('SQL comments are not allowed')
  })

  it('rejects a non-string when (X2)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.when = 5
    expect(validateQuestScaffolds(tree)[0]).toContain('when: expected a non-empty string')
  })

  it('rejects a when predicate on a gate (X2)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.node = { type: 'gate' }
    runner.gate = { kind: 'approval' }
    runner.when = 'SELECT 1 = 1'
    expect(validateQuestScaffolds(tree)[0]).toContain('gates are human decision points and are never machine-skipped')
  })

  it('rejects a wait that can never end (X3)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.node = { type: 'wait' }
    runner.wait = { kind: 'unbounded' }
    expect(validateQuestScaffolds(tree)[0]).toContain('one with neither can never end')
  })

  it('rejects a wait block on a gate (X3): humans decide, never the clock', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.node = { type: 'gate' }
    runner.gate = { kind: 'approval' }
    runner.wait = { kind: 'deadline', days: 7 }
    expect(validateQuestScaffolds(tree)[0]).toContain('humans decide, never the clock')
  })

  it('accepts a deadline wait (days + landmark) (X3)', () => {
    const tree = base()
    const runner = tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner as Record<string, unknown>
    runner.node = { type: 'wait' }
    runner.wait = { kind: 'duration_or_landmark', days: 7, landmark: 'response_received' }
    expect(validateQuestScaffolds(tree)).toEqual([])
  })

  it('rejects duplicate plan_refs across phases of one milestone', () => {
    const tree = base()
    const phase = tree.workstreams[0].milestones[0].phases[0]
    tree.workstreams[0].milestones[0].phases.push({
      ...phase,
      phase_key: 'Q2',
      phase_slug: 'two',
    })
    expect(validateQuestScaffolds(tree)[0]).toContain("duplicate 'step-one'")
  })

  it('rejects a non-integer wave', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].wave = 1.5 as never
    expect(validateQuestScaffolds(tree)[0]).toContain('wave: expected positive integer')
  })

  it('accepts a well-formed per-plan access map (rsc-8ip)', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner = {
      node: { type: 'checkpoint' },
      access: { case_source: 'ro', med_out: 'rw' },
    } as never
    expect(validateQuestScaffolds(tree)).toEqual([])
  })

  it('rejects an access mode that is not ro or rw', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner = {
      node: { type: 'checkpoint' },
      access: { case_source: 'readwrite' },
    } as never
    expect(validateQuestScaffolds(tree)[0]).toContain("access.case_source: expected 'ro', 'rw', 'ro?', or 'rw?'")
  })

  it('rejects a non-mapping access value', () => {
    const tree = base()
    tree.workstreams[0].milestones[0].phases[0].plans[0].metadata.runner = {
      node: { type: 'checkpoint' },
      access: ['case_source'],
    } as never
    expect(validateQuestScaffolds(tree)[0]).toContain('access: expected mapping')
  })
})
