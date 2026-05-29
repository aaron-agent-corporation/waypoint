import type { WaypointBeadsIssueSpec } from './compiler.ts'

export function describeWaypointBeadsIssue(issue: WaypointBeadsIssueSpec): string {
  const waypoint = issue.metadata.waypoint
  const lines = [
    `# ${issue.title}`,
    '',
    `Waypoint ${waypoint.kind} node for Quest ${waypoint.quest_slug}.`,
    '',
    '## Objective',
    issue.title,
  ]

  const scaffold = formatScaffold(waypoint.scaffold)
  if (waypoint.node_key || scaffold || waypoint.source.quest_path || waypoint.source.recipe_path) {
    lines.push('', '## Route Context')
    if (waypoint.node_key) lines.push(`- Node: ${waypoint.node_key}`)
    if (scaffold) lines.push(`- Scaffold: ${scaffold}`)
    lines.push(`- Route: ${waypoint.route_id}`)
    lines.push(`- Subject: ${waypoint.subject.type}/${waypoint.subject.id}`)
    lines.push(`- Quest source: ${waypoint.source.quest_path}`)
    if (waypoint.source.recipe_path) lines.push(`- Recipe source: ${waypoint.source.recipe_path}`)
  }

  if (waypoint.recipe_slug || waypoint.recipe) {
    lines.push('', '## Recipe')
    if (waypoint.recipe?.name) lines.push(`Name: ${waypoint.recipe.name}`)
    if (waypoint.recipe_slug) lines.push(`Slug: ${waypoint.recipe_slug}`)
    if (waypoint.recipe?.description) lines.push('', 'Description:', waypoint.recipe.description.trim())
    if (waypoint.recipe?.prompt) lines.push('', 'Prompt:', waypoint.recipe.prompt.trim())
    if (waypoint.recipe?.tools && waypoint.recipe.tools.length > 0) {
      lines.push('', 'Allowed tools:', ...waypoint.recipe.tools.map((tool) => `- ${tool}`))
    }
  }

  lines.push('', '## Policy')
  lines.push(`- External side effects: ${waypoint.policy.external_side_effects}`)
  if (waypoint.policy.requires_human_review) {
    lines.push('- Requires human review before downstream work proceeds.')
  }

  if (waypoint.artifacts && waypoint.artifacts.length > 0) {
    lines.push('', '## Required Artifacts')
    for (const artifact of waypoint.artifacts) {
      const details = [
        artifact.required ? 'required' : '',
        artifact.required_when ? `required when ${artifact.required_when}` : '',
        artifact.verifier ? `verifier ${artifact.verifier.kind}` : '',
        artifact.verifier?.checks && artifact.verifier.checks.length > 0 ? `checks ${artifact.verifier.checks.join(', ')}` : '',
      ].filter(Boolean)
      lines.push(`- ${artifact.path}${details.length > 0 ? ` (${details.join('; ')})` : ''}`)
    }
  }

  if (waypoint.gate) {
    lines.push('', '## Gate')
    lines.push('This is a gate node. Do not approve or bypass it unless the required human review has already been recorded.')
    if (waypoint.gate.kind) lines.push(`Gate kind: ${waypoint.gate.kind}`)
  }

  if (waypoint.wait) {
    lines.push('', '## Wait')
    lines.push('This is a wait node. Do not mark it complete until its wait condition is satisfied.')
    if (waypoint.wait.kind) lines.push(`Wait kind: ${waypoint.wait.kind}`)
    if (waypoint.wait.condition) lines.push(`Condition: ${waypoint.wait.condition}`)
  }

  if (waypoint.handoff) {
    lines.push('', '## Handoff')
    lines.push(`Handoff kind: ${waypoint.handoff.kind}`)
    if (waypoint.handoff.gate_required) lines.push('Gate required before handoff completion.')
    if (waypoint.handoff.gate_ref) lines.push(`Gate reference: ${waypoint.handoff.gate_ref}`)
    if (waypoint.handoff.required_artifacts && waypoint.handoff.required_artifacts.length > 0) {
      lines.push('Required handoff artifacts:', ...waypoint.handoff.required_artifacts.map((artifact) => `- ${artifact}`))
    }
  }

  lines.push('', '## Completion')
  lines.push('- Work only this issue unless the task explicitly tells you to create or update related artifacts.')
  lines.push('- Do not close downstream gates, waits, handoffs, or sibling tasks unless this issue explicitly requires it.')
  lines.push('- When the objective and required artifacts are complete, leave a concise Beads note/comment summarizing the result.')
  lines.push('- Close this Beads issue when the work is complete.')

  return lines.join('\n')
}

function formatScaffold(scaffold: WaypointBeadsIssueSpec['metadata']['waypoint']['scaffold']): string | undefined {
  if (!scaffold) return undefined
  const parts = [scaffold.workstream, scaffold.milestone, scaffold.phase, scaffold.plan_ref].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
  return parts.length > 0 ? parts.join('/') : undefined
}
