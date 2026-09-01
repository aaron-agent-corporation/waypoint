export type ValidationIssue = { code: string; path: PropertyKey[]; message: string }

export type NormalizedValidationDetail = {
  code: string
  path: string
  message: string
}

export function normalizeValidationDetails(issues: ValidationIssue[]): NormalizedValidationDetail[] {
  return issues.map((issue) => ({
    code: issue.code,
    path: issue.path.length > 0 ? issue.path.join('.') : '$',
    message: issue.message,
  }))
}
