import { describe, expect, it } from 'vitest'

import { getAuthoringQuestionnaire } from '../questionnaires'

describe('Waypoint authoring questionnaires', () => {
  it('keeps brainstorming first and lifecycle intent before execution tasks', () => {
    const questionnaire = getAuthoringQuestionnaire({ kind: 'quest', domain: 'firmvault' })

    expect(questionnaire.kind).toBe('quest')
    expect(questionnaire.domain).toBe('firmvault')
    expect(questionnaire.groups[0]).toMatchObject({ slug: 'brainstorming-context', order: 0 })

    const slugs = questionnaire.groups.map((group) => group.slug)
    expect(slugs.indexOf('quest-lifecycle')).toBeLessThan(slugs.indexOf('recipes-tasks'))
    expect(slugs.indexOf('roles-operators')).toBeLessThan(slugs.indexOf('integrations'))

    expect(questionnaire.groups.flatMap((group) => group.questions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prompt: 'Which existing Quest/Recipe/docs should be inspected first?', one_at_a_time: true }),
        expect.objectContaining({ prompt: 'What workstreams are involved?', one_at_a_time: true }),
        expect.objectContaining({ prompt: 'Which tests/smokes prove success?', one_at_a_time: true }),
      ]),
    )
  })

  it('includes the required approach comparison and approval gate shape', () => {
    const questionnaire = getAuthoringQuestionnaire({ kind: 'recipe', domain: 'general' })

    expect(questionnaire.approach_comparison.minimum_approaches).toBe(2)
    expect(questionnaire.approach_comparison.required_fields).toEqual(
      expect.arrayContaining(['slug', 'title', 'tradeoffs', 'recommended']),
    )
    expect(questionnaire.approval.required_before).toEqual(
      expect.arrayContaining(['implementation_plan', 'quest_manifest', 'recipe_manifest', 'operator_manifest', 'handoff_manifest']),
    )
  })

  it('adds handoff graph questions when brainstorming handoff manifests', () => {
    const questionnaire = getAuthoringQuestionnaire({ kind: 'handoff_graph', domain: 'firmvault' })

    const slugs = questionnaire.groups.map((group) => group.slug)
    expect(slugs).toContain('handoff-graph')
    expect(questionnaire.groups.flatMap((group) => group.questions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prompt: 'Which operators or human roles hand work to each other?', one_at_a_time: true }),
        expect.objectContaining({ prompt: 'Which triggers start each handoff?', one_at_a_time: true }),
        expect.objectContaining({ prompt: 'Which artifacts must exist before each handoff?', one_at_a_time: true }),
      ]),
    )
  })
})
