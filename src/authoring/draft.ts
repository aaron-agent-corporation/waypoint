export type AuthoringKind = 'quest' | 'recipe' | 'operator' | 'handoff_graph'
export type AuthoringSource = 'questionnaire' | 'prompt' | 'existing_plan'
export type AuthoringApprovalStatus = 'pending' | 'approved' | 'changes_requested'

export type AuthoringGeneratedFile = {
  readonly path: string
  readonly purpose: string
  readonly content: string
  readonly install_default: false
}

export type AuthoringQuestionAnswer = {
  readonly id: string
  readonly prompt: string
  readonly order: number
  readonly answer?: unknown
}

export type AuthoringApproach = {
  readonly slug: string
  readonly title: string
  readonly tradeoffs: readonly string[]
  readonly recommended: boolean
}

export type WaypointAuthoringDraft = {
  readonly schema_version: 1
  readonly kind: AuthoringKind
  readonly title: string
  readonly source: AuthoringSource
  readonly answers: Readonly<Record<string, unknown>>
  readonly generated_files: readonly AuthoringGeneratedFile[]
  readonly warnings: readonly string[]
  readonly next_actions: readonly string[]
  readonly brainstorm_context: {
    readonly inspected_paths: readonly string[]
  }
  readonly questions: readonly AuthoringQuestionAnswer[]
  readonly approaches: readonly AuthoringApproach[]
  readonly design_spec_path?: string
  readonly approval: {
    readonly required: true
    readonly status: AuthoringApprovalStatus
  }
}

export type CreateAuthoringDraftInput = Omit<
  WaypointAuthoringDraft,
  'schema_version' | 'warnings' | 'next_actions' | 'approval' | 'generated_files'
> & {
  readonly generated_files: readonly (Omit<AuthoringGeneratedFile, 'install_default'> & { readonly install_default?: boolean })[]
  readonly warnings?: readonly string[]
  readonly next_actions?: readonly string[]
  readonly approval?: { readonly status?: AuthoringApprovalStatus }
}

export type ValidateAuthoringDraftResult =
  | { readonly ok: true; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly string[] }

export function createAuthoringDraft(input: CreateAuthoringDraftInput): WaypointAuthoringDraft {
  return {
    schema_version: 1,
    kind: input.kind,
    title: input.title,
    source: input.source,
    answers: input.answers,
    brainstorm_context: input.brainstorm_context,
    questions: [...input.questions].sort((left, right) => left.order - right.order),
    approaches: input.approaches,
    design_spec_path: input.design_spec_path,
    generated_files: input.generated_files.map((file) => ({
      path: file.path,
      purpose: file.purpose,
      content: file.content,
      install_default: false,
      ...(file.install_default === true ? { install_default: true as never } : {}),
    })),
    warnings: input.warnings ?? [],
    next_actions: input.next_actions ?? [
      'Review and approve the design spec before implementation planning or manifest generation.',
    ],
    approval: { required: true, status: input.approval?.status ?? 'pending' },
  }
}

export function validateAuthoringDraft(draft: WaypointAuthoringDraft): ValidateAuthoringDraftResult {
  const errors: string[] = []

  if (draft.generated_files.some((file) => file.install_default !== false)) {
    errors.push('generated files must be drafts with install_default: false')
  }
  if (draft.brainstorm_context.inspected_paths.length === 0) {
    errors.push('draft must preserve brainstorm_context.inspected_paths')
  }
  if (!questionsAreOneAtATimeOrdered(draft.questions)) {
    errors.push('questions must preserve one-question-at-a-time ordering')
  }
  if (draft.approaches.length < 2) {
    errors.push('draft must include at least two approaches before recommending one')
  }
  if (draft.approaches.length >= 2 && !draft.approaches.some((approach) => approach.recommended)) {
    errors.push('draft must mark one recommended approach')
  }
  if (draft.approval.required !== true) {
    errors.push('approval.required must be true')
  }
  if (!['pending', 'approved', 'changes_requested'].includes(draft.approval.status)) {
    errors.push('approval.status must be pending, approved, or changes_requested')
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

function questionsAreOneAtATimeOrdered(questions: readonly AuthoringQuestionAnswer[]): boolean {
  if (questions.length === 0) return false
  let previousOrder = -Infinity
  const seen = new Set<number>()
  for (const question of questions) {
    if (!Number.isInteger(question.order) || question.order <= previousOrder || seen.has(question.order)) return false
    seen.add(question.order)
    previousOrder = question.order
  }
  return true
}
