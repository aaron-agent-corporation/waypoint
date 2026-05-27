import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled.ts'
import {
  compileQuestToBeadsFormula,
  compileWaypointCatalogToBeadsFormulas,
  exportWaypointCatalogAsBeadsFormulaFiles,
  serializeWaypointBeadsFormulaJson,
} from './formula.ts'

describe('Waypoint Beads formula exporter', () => {
  it('exports a Quest scaffold as a reusable poured Beads workflow formula', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const formula = compileQuestToBeadsFormula(catalog, {
      quest: 'referral-package',
    })

    expect(formula).toMatchObject({
      formula: 'waypoint-referral-package',
      version: 1,
      type: 'workflow',
      pour: true,
    })
    expect(formula.vars.route_id).toMatchObject({
      required: true,
      type: 'string',
    })

    const chronology = formula.steps.find((step) => step.id === 'medical-chronology-update')
    expect(chronology).toMatchObject({
      type: 'task',
      metadata: {
        waypoint: {
          route_id: '{{route_id}}',
          subject: { type: '{{subject_type}}', id: '{{subject_id}}' },
          kind: 'recipe',
          recipe_slug: 'firmvault-medical-chronology-update',
          policy: { external_side_effects: 'forbidden' },
        },
      },
    })
    expect(chronology?.metadata?.waypoint.artifacts).toContainEqual({
      path: '03-medical/medical-chronology-output/medical-chronology.html',
      required: true,
      required_when: 'medical_records_present',
      verifier: {
        kind: 'required_paths',
        checks: ['exists', 'non_empty', 'directory_non_empty'],
      },
    })

    const startHere = formula.steps.find((step) => step.id === 'start-here-draft')
    expect(startHere?.needs).toEqual(['medical-chronology-update', 'medical-chronology-adversarial-qc'])

    const gate = formula.steps.find((step) => step.id === 'attorney-handoff-gate')
    expect(gate).toMatchObject({
      metadata: {
        waypoint: {
          kind: 'gate',
          policy: { requires_human_review: true },
        },
      },
    })

    const parsed = JSON.parse(serializeWaypointBeadsFormulaJson(formula)) as typeof formula
    expect(parsed.steps.find((step) => step.id === 'medical-chronology-update')?.metadata?.waypoint.source).toEqual(
      chronology?.metadata?.waypoint.source,
    )
  })

  it('exports the bundled catalog as deterministic Beads formula file specs', async () => {
    const catalog = await loadBundledWaypointCatalog()

    const formulas = compileWaypointCatalogToBeadsFormulas(catalog)
    const files = exportWaypointCatalogAsBeadsFormulaFiles(catalog)

    expect(formulas).toHaveLength(catalog.quests.size)
    expect(files).toHaveLength(catalog.quests.size)
    expect(files.map((file) => file.relativePath)).toContain('formulas/waypoint-referral-package.formula.json')

    const referralFile = files.find((file) => file.relativePath === 'formulas/waypoint-referral-package.formula.json')
    expect(referralFile?.formula.formula).toBe('waypoint-referral-package')
    expect(JSON.parse(referralFile?.content ?? '{}')).toMatchObject({
      formula: 'waypoint-referral-package',
      type: 'workflow',
      pour: true,
    })
  })
})
