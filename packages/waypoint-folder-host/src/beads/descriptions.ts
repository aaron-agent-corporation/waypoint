import type { WaypointBeadsIssueSpec } from './compiler.ts'

export function describeWaypointBeadsIssue(issue: WaypointBeadsIssueSpec): string {
  const waypoint = issue.metadata.waypoint
  const lines = [`Waypoint ${waypoint.kind} node for Quest ${waypoint.quest_slug}.`]
  if (waypoint.recipe_slug) {
    lines.push(`Recipe: ${waypoint.recipe_slug}.`)
  }
  if (waypoint.scaffold) {
    lines.push(
      `Scaffold: ${waypoint.scaffold.workstream}/${waypoint.scaffold.milestone}/${waypoint.scaffold.phase}/${waypoint.scaffold.plan_ref}.`,
    )
  }
  if (waypoint.policy.requires_human_review) {
    lines.push('Requires human review before downstream work proceeds.')
  }
  if (waypoint.artifacts && waypoint.artifacts.length > 0) {
    lines.push(`Required artifact(s): ${waypoint.artifacts.map((artifact) => artifact.path).join(', ')}.`)
  }
  return lines.join('\n')
}
