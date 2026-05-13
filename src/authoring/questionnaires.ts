import type { AuthoringKind } from './draft'

export type AuthoringQuestion = {
  readonly id: string
  readonly prompt: string
  readonly one_at_a_time: true
}

export type AuthoringQuestionGroup = {
  readonly slug: string
  readonly title: string
  readonly order: number
  readonly questions: readonly AuthoringQuestion[]
}

export type AuthoringQuestionnaire = {
  readonly schema_version: 1
  readonly kind: AuthoringKind
  readonly domain: string
  readonly groups: readonly AuthoringQuestionGroup[]
  readonly approach_comparison: {
    readonly minimum_approaches: 2
    readonly required_fields: readonly string[]
  }
  readonly approval: {
    readonly required_before: readonly string[]
  }
}

export function getAuthoringQuestionnaire(input: { readonly kind: AuthoringKind; readonly domain?: string }): AuthoringQuestionnaire {
  return {
    schema_version: 1,
    kind: input.kind,
    domain: input.domain ?? 'general',
    groups: QUESTION_GROUPS,
    approach_comparison: {
      minimum_approaches: 2,
      required_fields: ['slug', 'title', 'tradeoffs', 'recommended'],
    },
    approval: {
      required_before: ['implementation_plan', 'quest_manifest', 'recipe_manifest', 'operator_manifest'],
    },
  }
}

const QUESTION_GROUPS: readonly AuthoringQuestionGroup[] = [
  {
    slug: 'brainstorming-context',
    title: 'Brainstorming and context',
    order: 0,
    questions: [
      q('context_paths', 'Which existing Quest/Recipe/docs should be inspected first?'),
      q('decomposition', 'Is this one workflow or multiple independent subsystems that need decomposition?'),
      q('plain_language_goal', 'What is the user trying to accomplish in plain language?'),
      q('constraints', 'What constraints are non-negotiable?'),
    ],
  },
  {
    slug: 'quest-lifecycle',
    title: 'Quest lifecycle intent',
    order: 1,
    questions: [
      q('workflow_goal', 'What is the workflow goal?'),
      q('workstreams', 'What workstreams are involved?'),
      q('milestones', 'Which milestones prove meaningful product/user progress?'),
      q('phases', 'What phases sit under each milestone?'),
      q('plans', 'Which plans/tasks belong under each phase?'),
      q('done', 'What counts as done?'),
      q('human_gates', 'What human gates are required?'),
    ],
  },
  {
    slug: 'roles-operators',
    title: 'Roles and operators',
    order: 2,
    questions: [
      q('operators', 'Who operates this workflow?'),
      q('allowed_tools', 'What tools may they use?'),
      q('never_do', 'What must they never do?'),
    ],
  },
  {
    slug: 'recipes-tasks',
    title: 'Recipes and tasks',
    order: 3,
    questions: [
      q('repeatable_tasks', 'What repeatable tasks exist?'),
      q('required_artifacts', 'What evidence/artifacts are required?'),
      q('automation_boundary', 'Which tasks are automated vs human gate?'),
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations and side effects',
    order: 4,
    questions: [
      q('local_only', 'Local-only?'),
      q('external_services', 'External services?'),
      q('required_credentials', 'Required credentials?'),
      q('side_effects', 'Are side effects allowed?'),
    ],
  },
  {
    slug: 'verification',
    title: 'Verification',
    order: 5,
    questions: [
      q('tests', 'Which tests/smokes prove success?'),
      q('source_of_truth', 'Which source-of-truth files should be checked?'),
    ],
  },
] as const

function q(id: string, prompt: string): AuthoringQuestion {
  return { id, prompt, one_at_a_time: true }
}
