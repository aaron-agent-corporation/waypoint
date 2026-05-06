export interface BuildWaypointRouteKeyInput {
  subjectType: string
  subjectId: string | number
  definitionSlug: string
  definitionVersion: string | number
}

export function buildWaypointRouteKey(input: BuildWaypointRouteKeyInput): string {
  return [
    'waypoint',
    input.subjectType,
    String(input.subjectId),
    input.definitionSlug,
    `v${String(input.definitionVersion).replace(/^v/i, '')}`,
  ].join(':')
}
