#!/usr/bin/env node

const KNOWN_ROUTES = new Map([
  ['waypoint-planner', 'planner-capable Hermes/Gary execution'],
  ['waypoint-verifier', 'verifier-capable Hermes/Gary execution'],
  ['waypoint-doc-writer', 'doc-writer-capable Hermes/Gary execution'],
])

export async function readRecipeRuntimePayloadFromStdin(stdin = process.stdin) {
  let source = ''
  for await (const chunk of stdin) source += chunk
  return parseRecipeRuntimePayload(source)
}

export function parseRecipeRuntimePayload(source) {
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(`Invalid Hermes Recipe runtime payload: JSON parse failed: ${error.message}`)
  }

  const problems = []
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push('payload must be an object')
  } else {
    if (parsed.schema_version !== 1) problems.push('schema_version must be 1')
    for (const field of ['recipe_slug', 'prompt', 'task_id', 'route_id', 'project_root']) {
      if (typeof parsed[field] !== 'string' || parsed[field].trim() === '') problems.push(`${field} is required`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid Hermes Recipe runtime payload: ${problems.join('; ')}`)
  }

  return {
    schema_version: 1,
    recipe_slug: parsed.recipe_slug,
    prompt: parsed.prompt,
    task_id: parsed.task_id,
    route_id: parsed.route_id,
    project_root: parsed.project_root,
  }
}

export function routeRecipeToHermesCapability(recipeSlug) {
  return KNOWN_ROUTES.get(recipeSlug) ?? 'Gary/orchestrator fallback'
}

export function buildHermesRecipeRuntimeOutput(payload) {
  const routedTo = routeRecipeToHermesCapability(payload.recipe_slug)
  const known = KNOWN_ROUTES.has(payload.recipe_slug)
  return {
    ok: true,
    adapter: 'hermes-recipe-runtime-reference',
    schema_version: 1,
    recipe_slug: payload.recipe_slug,
    task_id: payload.task_id,
    route_id: payload.route_id,
    project_root: payload.project_root,
    routed_to: routedTo,
    summary: known
      ? `Hermes reference adapter accepted ${payload.recipe_slug} for ${payload.task_id} on ${payload.route_id}. Route to ${routedTo}.`
      : `Hermes reference adapter accepted unknown recipe_slug ${payload.recipe_slug} for ${payload.task_id}; route to Gary/orchestrator fallback with explicit uncertainty.`,
    artifacts: [],
    messages: [
      {
        role: 'agent',
        content: `Recipe ${payload.recipe_slug} payload received for task ${payload.task_id} on route ${payload.route_id}.`,
      },
    ],
  }
}

export async function runHermesRecipeRuntime(stdin = process.stdin, stdout = process.stdout, stderr = process.stderr) {
  try {
    const payload = await readRecipeRuntimePayloadFromStdin(stdin)
    stdout.write(`${JSON.stringify(buildHermesRecipeRuntimeOutput(payload), null, 2)}\n`)
    return 0
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runHermesRecipeRuntime()
}
