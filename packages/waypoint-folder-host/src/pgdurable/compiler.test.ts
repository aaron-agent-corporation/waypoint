import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadBundledWaypointCatalog } from '../catalog/bundled'
import { registerArtifactContract } from '../runtime/artifact-contracts.ts'
import { compileQuestToDurableGraph } from './compiler'

// A test-local vetted contract — the registry ships empty; hosts register
// their own. Registered once for the whole file (re-registration replaces).
registerArtifactContract('test-placement-plan', async () => [])

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '__golden__')

async function bundledQuest(slug: string): Promise<{ readonly slug: string; readonly scaffolds?: unknown }> {
  const catalog = await loadBundledWaypointCatalog()
  const quest = catalog.quests.get(slug)
  if (!quest) throw new Error(`bundled quest not found: ${slug}`)
  return quest
}

/**
 * Golden comparison, tools/prose gate style: byte-for-byte against the stored
 * file. Regenerate (after manual review of the emitted shape) with
 * `UPDATE_PGDURABLE_GOLDENS=1 npx vitest run .../compiler.test.ts`.
 */
async function expectGolden(name: string, actual: string): Promise<void> {
  const path = join(goldenDir, name)
  if (process.env.UPDATE_PGDURABLE_GOLDENS === '1') {
    await mkdir(goldenDir, { recursive: true })
    await writeFile(path, actual, 'utf8')
    return
  }
  expect(actual).toBe(await readFile(path, 'utf8'))
}

describe('scaffold → pg_durable graph compiler', () => {
  it('compiles the bundled runner quest to its golden graph', async () => {
    const quest = await bundledQuest('runner')
    const sql = compileQuestToDurableGraph({ routeId: 'route-golden-runner', schema: 'waypoint', quest })
    await expectGolden('runner.sql', sql)
  })


/**
 * The corpus' recipe-and-gate-bearing quest: two recipe dispatches across
 * sequential waves and a human review gate — everything the compiler's
 * dispatch/gate contracts need, with no waits, no when-predicates, and no
 * repeat. Synthetic since the bundled catalog slimmed to the scaffold alone.
 */
function pipelineQuest() {
  return {
    slug: 'document-pipeline-synthetic',
    scaffolds: {
      workstreams: [
        {
          milestones: [
            {
              phases: [
                {
                  phase_slug: 'intake',
                  plans: [
                    {
                      plan_ref: 'document-intake-record-source',
                      title: 'Record the source document',
                      wave: 10,
                      metadata: { runner: { recipe: { slug: 'record-source' }, node: { type: 'recipe' } } },
                    },
                    {
                      plan_ref: 'document-intake-classify',
                      title: 'Classify the document',
                      wave: 20,
                      metadata: { runner: { recipe: { slug: 'classify-document' }, node: { type: 'recipe' } } },
                    },
                    {
                      plan_ref: 'document-review-gate',
                      title: 'A human reviews the classification',
                      wave: 30,
                      metadata: { runner: { gate: { kind: 'approval' }, node: { type: 'gate' } } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

  // The corpus needs a recipe-and-gate-bearing quest with no waits and no
  // when-predicates (this harness compiles without a schema binding).
  it('compiles a recipe-and-gate pipeline quest to its golden graph', async () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-golden-document-pipeline', schema: 'waypoint', quest: pipelineQuest() })
    await expectGolden('document-pipeline.sql', sql)
  })

  it('is byte-deterministic: compiling the same input twice yields identical strings', async () => {
    const quest = await bundledQuest('runner')
    const input = { routeId: 'route-golden-runner', schema: 'waypoint', quest } as const
    expect(compileQuestToDurableGraph(input)).toBe(compileQuestToDurableGraph(input))
  })

  it('escapes quotes and escalates dollar-quote tags on collision', () => {
    const scaffolds = {
      workstreams: [
        {
          milestones: [
            {
              phases: [
                {
                  phase_slug: 'p',
                  plans: [
                    {
                      plan_ref: 'first-step',
                      // The first plan's first OWN node is n2 (n1 is the
                      // hoisted instance-registration node, X1) — collide
                      // with THAT tag to exercise escalation.
                      title: "Kick off with a literal '$n2$' inside the title",
                      wave: 10,
                      metadata: { runner: { node: { type: 'checkpoint' } } },
                    },
                    {
                      plan_ref: "step-with'quote",
                      title: 'Plain second step',
                      wave: 20,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const quest = { slug: 'synthetic', scaffolds }

    const sql = compileQuestToDurableGraph({ routeId: 'route-esc-001', schema: 'waypoint', quest })

    // Tag escalation happened: the plan's first node is quoted with $n2x$,
    // not $n2$ (its header comment carries the verbatim title containing
    // '$n2$').
    expect(sql).not.toContain('$n2$ UPDATE')
    expect(sql).toContain('$n2x$ UPDATE waypoint.tasks')
    expect(sql.split('$n2x$')).toHaveLength(3) // exactly one open + one close
    // The colliding literal survives verbatim, only in the comment line.
    for (const line of sql.split('\n')) {
      if (line.includes('$n2$') && !line.includes('$n2x$')) expect(line.trimStart().startsWith('--')).toBe(true)
    }
    // Single quotes in interpolated values are doubled for SQL string context.
    expect(sql).toContain("plan_ref = 'step-with''quote'")
    expect(sql).toContain('{"plan_ref":"step-with\'\'quote"}')
    // No unescaped odd quoting: statement still terminates in the template shape.
    expect(sql.endsWith(");\n")).toBe(true)
  })

  it('compiles recipes as single indefinite waits — the graph is the happy path (B4)', () => {
    // Needs a quest that dispatches. The `runner` scaffold is not one — its
    // only agent step is a discussion, which compiles to no dispatch wait.
    const sql = compileQuestToDurableGraph({ routeId: 'route-golden-document-pipeline', schema: 'waypoint', quest: pipelineQuest() })

    // No df.loop anywhere: loop iterations are ContinuedAsNew and re-execute
    // the whole graph (executed finding 2026-07-12) — retries live at the
    // signal layer (bridge records non-finished attempts off-graph).
    expect(sql).not.toContain('df.loop(')
    // The attempt wait is indefinite — no budget timeout on the wait; attempt
    // budgets belong to the recipe runtimes.
    expect(sql).toContain("df.wait_for_signal('task:document-intake-record-source') |=> 'sig'")
    expect(sql).not.toContain("df.wait_for_signal('task:document-intake-record-source',")
    // The signal only ever carries a finished outcome; the graph records it
    // and advances.
    expect(sql).toContain("SET status = 'done', evidence = ($sig::jsonb)->'data'")
  })

  it('emits idempotent engine INSERTs — nodes are at-least-once (B4.5)', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-golden-document-pipeline', schema: 'waypoint', quest: pipelineQuest() })

    // A re-executed dispatch node must not enqueue a second worker run: the
    // insert is guarded on (instance_id, task_ref). Retry rows are inserted
    // by the CLI after this row exists, so the guard never blocks them.
    expect(sql).not.toMatch(/INSERT INTO waypoint\.dispatches[^$]*VALUES/)
    const dispatchGuards = sql.match(
      /INSERT INTO waypoint\.dispatches[^$]*WHERE NOT EXISTS \(SELECT 1 FROM waypoint\.dispatches[^$]*instance_id = '\{sys_instance_id\}' AND task_ref = /g,
    )
    expect(dispatchGuards?.length).toBeGreaterThanOrEqual(2)

    // Every engine event insert carries a compile-time dedupe key and its
    // NOT EXISTS guard; keys are unique per node (no reuse across events).
    const eventInserts = sql.match(/INSERT INTO waypoint\.route_events/g) ?? []
    const dedupeKeys = sql.match(/dedupe_key = '\{sys_instance_id\}:ev-\d{3}'/g) ?? []
    expect(eventInserts.length).toBeGreaterThan(0)
    expect(dedupeKeys.length).toBe(eventInserts.length)
    expect(new Set(dedupeKeys).size).toBe(dedupeKeys.length)
    expect(sql).not.toMatch(/INSERT INTO waypoint\.route_events \(id, route_id, kind, payload, created_at\)\s*\n\s*VALUES/)
  })

  it('rejects invalid schema names and route ids', async () => {
    const quest = await bundledQuest('runner')
    expect(() => compileQuestToDurableGraph({ routeId: 'route-ok', schema: 'Bad-Schema', quest })).toThrow(/invalid schema name/)
    expect(() => compileQuestToDurableGraph({ routeId: 'route-ok', schema: '1spine', quest })).toThrow(/invalid schema name/)
    expect(() => compileQuestToDurableGraph({ routeId: "route'; drop", schema: 'waypoint', quest })).toThrow(/invalid route id/)
    expect(() => compileQuestToDurableGraph({ routeId: 'Route_001', schema: 'waypoint', quest })).toThrow(/invalid route id/)
  })

  it('parks gates with no timeout; only an approve signal ever arrives and advances (B4)', async () => {
    const quest = await bundledQuest('runner')
    const sql = compileQuestToDurableGraph({ routeId: 'route-golden-runner', schema: 'waypoint', quest })

    // The gate signal wait has NO timeout argument — gates park indefinitely.
    expect(sql).toContain("df.wait_for_signal('gate:plan-approval-gate') |=> 'sig'")
    expect(sql).not.toContain("df.wait_for_signal('gate:plan-approval-gate',")

    // Approve ⇒ done (lineage-derived contract); the CASE keeps the record
    // truthful for a hand-sent signal, but `waypoint gate --reject` records
    // off-graph and never signals — only approve advances the graph.
    expect(sql).toContain("SET status = CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'done' ELSE 'failed' END,")
    // Three-way since 2026-08-18: a confirmation gate the workflow already
    // answered is RETIRED by the reconcile sweep, which rides the approve
    // signal (the engine understands nothing else) with an actor marker. It
    // must never be recorded as an approval — the system approves nothing.
    expect(sql).toContain(
      "CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' AND ($sig::jsonb->'data'->>'actor') = 'system-reconcile' THEN 'route.gate.moot' WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'route.gate.approved' ELSE 'route.gate.rejected' END",
    )
  })

  // ---- X1: parallel-join from waves (docs/designs/df-operator-coverage.md) --

  function parallelQuest(overrides: { gateInWave?: boolean } = {}) {
    return {
      slug: 'x1-synthetic',
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'fanout',
                    plans: [
                      {
                        plan_ref: 'prep',
                        title: 'Prepare inputs',
                        wave: 10,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                      {
                        plan_ref: 'fan-a',
                        title: 'Fan-out branch A',
                        wave: 20,
                        metadata: { runner: { recipe: { slug: 'recipe-a' }, node: { type: 'recipe' } } },
                      },
                      overrides.gateInWave === true
                        ? {
                            plan_ref: 'fan-gate',
                            title: 'A gate wrongly sharing the wave',
                            wave: 20,
                            metadata: { runner: { gate: { kind: 'approval' }, node: { type: 'gate' } } },
                          }
                        : {
                            plan_ref: 'fan-b',
                            title: 'Fan-out branch B',
                            wave: 20,
                            metadata: { runner: { recipe: { slug: 'recipe-b' }, node: { type: 'recipe' } } },
                          },
                      {
                        plan_ref: 'wrap',
                        title: 'Join and wrap up',
                        wave: 30,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  it('compiles a same-wave group to a parallel join (golden)', async () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x1', schema: 'waypoint', quest: parallelQuest() })
    await expectGolden('x1-parallel.sql', sql)
  })

  it('parallel wave: & join present, branches never write the routes row, marker holds current_node', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x1', schema: 'waypoint', quest: parallelQuest() })

    // One & for two branches, both waits present.
    expect(sql.split('\n  & (')).toHaveLength(2)
    expect(sql).toContain("df.wait_for_signal('task:fan-a')")
    expect(sql).toContain("df.wait_for_signal('task:fan-b')")
    // Branch recipes skip the post-wait routes UPDATE (X1 contract): with both
    // recipes inside the wave there is no active-status write anywhere.
    expect(sql).not.toContain("SET status = 'active'")
    // The wave marker pins current_node to the group's first plan before the join.
    expect(sql).toContain("SET current_node = 'fan-a'")
    // Engine event ids are unique compile-time literals (the count-derived id
    // raced under parallel INSERT).
    const ids = [...sql.matchAll(/'event-e(\d{3})'/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(5)
  })

  it('fails closed on a gate inside a parallel wave', () => {
    expect(() => compileQuestToDurableGraph({ routeId: 'route-x1', schema: 'waypoint', quest: parallelQuest({ gateInWave: true }) })).toThrow(
      /gate 'fan-gate'.*fail closed/,
    )
  })

  it('distinct waves stay sequential: no join appears in the corpus quests', async () => {
    for (const quest of [await bundledQuest('runner'), pipelineQuest()]) {
      const sql = compileQuestToDurableGraph({ routeId: `route-seq-${quest.slug}`, schema: 'waypoint', quest })
      expect(sql, quest.slug).not.toContain('\n  & (')
    }
  })

  it('is byte-deterministic for a parallel quest', () => {
    const input = { routeId: 'route-x1', schema: 'waypoint', quest: parallelQuest() } as const
    expect(compileQuestToDurableGraph(input)).toBe(compileQuestToDurableGraph(input))
  })

  // ---- X2: when predicate → df.if (docs/designs/df-operator-coverage.md) ----

  const GUARD_PREDICATE = "SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE plan_ref = 'prep' AND status = 'done')"

  function whenQuest(overrides: { when?: unknown; onGate?: boolean } = {}) {
    const when = 'when' in overrides ? overrides.when : GUARD_PREDICATE
    const guarded =
      overrides.onGate === true
        ? {
            plan_ref: 'guarded-gate',
            title: 'A gate wrongly guarded by a predicate',
            wave: 20,
            metadata: { runner: { gate: { kind: 'approval' }, node: { type: 'gate' }, when } },
          }
        : {
            plan_ref: 'maybe-sync',
            title: 'Sync the index when prep landed',
            wave: 20,
            metadata: { runner: { recipe: { slug: 'recipe-sync' }, node: { type: 'recipe' }, when } },
          }
    return {
      slug: 'x2-synthetic',
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'guard',
                    plans: [
                      {
                        plan_ref: 'prep',
                        title: 'Prepare inputs',
                        wave: 10,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                      guarded,
                      {
                        plan_ref: 'wrap',
                        title: 'Wrap up',
                        wave: 30,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  it('compiles a when-guarded plan to df.if (golden)', async () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x2', schema: 'waypoint', quest: whenQuest() })
    await expectGolden('x2-when.sql', sql)
  })

  it('when: predicate verbatim in the condition; skip arm records evidence + event, never dispatches', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x2', schema: 'waypoint', quest: whenQuest() })

    // The predicate is copied verbatim into the df.if condition node.
    expect(sql).toContain('df.if(')
    expect(sql).toContain(GUARD_PREDICATE)
    // Skip arm: task done with skipped evidence + a route.task.skipped event.
    expect(sql).toContain('"skipped":true')
    expect(sql).toContain("'route.task.skipped'")
    // The dispatch INSERT exists exactly once — inside the then arm only.
    expect(sql.match(/INSERT INTO waypoint\.dispatches/g)).toHaveLength(1)
    // Event ids stay unique compile-time literals across both arms.
    const ids = [...sql.matchAll(/'event-e(\d{3})'/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fails closed on inadmissible when predicates', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['DELETE FROM waypoint.tasks', /must be a single SELECT/],
      ['SELECT 1; DROP TABLE waypoint.tasks', /';' is not allowed/],
      ['SELECT $sig_1::jsonb IS NOT NULL', /'\$' is not allowed/],
      ["SELECT '{sys_instance_id}' <> ''", /allowed only as the start-time variables/],
      ["SELECT jsonb_build_object() = '{}'::jsonb", /allowed only as the start-time variables/],
      ['SELECT 1 -- always', /comments are not allowed/],
      ['SELECT 1 /* always */', /comments are not allowed/],
      ["SELECT df.cancel('x') IS NOT NULL", /'df\.' calls are not allowed/],
      ['   ', /non-string or empty when predicate/],
      [5, /non-string or empty when predicate/],
    ]
    for (const [when, message] of cases) {
      expect(
        () => compileQuestToDurableGraph({ routeId: 'route-x2', schema: 'waypoint', quest: whenQuest({ when }) }),
        String(when),
      ).toThrow(message)
    }
  })

  it('fails closed on a when predicate attached to a gate', () => {
    expect(() => compileQuestToDurableGraph({ routeId: 'route-x2', schema: 'waypoint', quest: whenQuest({ onGate: true }) })).toThrow(
      /gate with a when predicate.*fail closed/,
    )
  })

  it('a when-guarded plan composes inside a parallel wave', () => {
    const quest = parallelQuest()
    const plans = quest.scaffolds.workstreams[0]!.milestones[0]!.phases[0]!.plans as Array<{
      plan_ref: string
      metadata?: { runner: Record<string, unknown> }
    }>
    const fanB = plans.find((plan) => plan.plan_ref === 'fan-b')!
    fanB.metadata!.runner.when = 'SELECT 1 = 1'
    const sql = compileQuestToDurableGraph({ routeId: 'route-x2-wave', schema: 'waypoint', quest })

    expect(sql.split('\n  & (')).toHaveLength(2)
    expect(sql).toContain('df.if(')
    // The X1 wave contract holds through the guard: no branch (either arm)
    // writes the routes row.
    expect(sql).not.toContain("SET status = 'active'")
  })

  it('the corpus quests carry no when predicate: they compile without df.if', async () => {
    for (const quest of [await bundledQuest('runner'), pipelineQuest()]) {
      const sql = compileQuestToDurableGraph({ routeId: `route-when-${quest.slug}`, schema: 'waypoint', quest })
      expect(sql, quest.slug).not.toContain('df.if(')
    }
  })

  it('X5: start-time variables resolve into the condition; evidence keeps the authored text', () => {
    const when = "SELECT EXISTS (SELECT 1 FROM {waypoint_schema}.tasks WHERE route_id = '{waypoint_route_id}' AND plan_ref = 'prep')"
    const variables = {
      waypoint_schema: 'waypoint',
      waypoint_route_id: 'route-x5',
      waypoint_quest: 'x2-synthetic',
      waypoint_subject_type: 'project',
      waypoint_subject_id: 'local',
    }
    const sql = compileQuestToDurableGraph({ routeId: 'route-x5', schema: 'waypoint', quest: whenQuest({ when }), variables })
    // The df.if condition runs the RESOLVED predicate (compile-time
    // substitution — df.setvar breaks df.race on 0.2.4, executed finding).
    expect(sql).toContain("SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE route_id = 'route-x5' AND plan_ref = 'prep') $")
    // The record keeps the AUTHORED predicate: skip evidence and the skip
    // event carry the {waypoint_*} text the author wrote.
    expect(sql).toContain('{waypoint_schema}')
  })

  it('X5 fails closed: a variable-bearing predicate without provided values, and unsafe values', () => {
    const when = "SELECT '{waypoint_quest}' = 'other'"
    expect(() => compileQuestToDurableGraph({ routeId: 'route-x5', schema: 'waypoint', quest: whenQuest({ when }) })).toThrow(
      /references \{waypoint_quest\} but no value/,
    )
    expect(() =>
      compileQuestToDurableGraph({
        routeId: 'route-x5',
        schema: 'waypoint',
        quest: whenQuest({ when }),
        variables: { waypoint_quest: "x'; DROP TABLE waypoint.tasks; --" },
      }),
    ).toThrow(/unsafe value/)
  })

  it('is byte-deterministic for a when-guarded quest', () => {
    const input = { routeId: 'route-x2', schema: 'waypoint', quest: whenQuest() } as const
    expect(compileQuestToDurableGraph(input)).toBe(compileQuestToDurableGraph(input))
  })

  // ---- X3: deadline waits → df.race (docs/designs/df-operator-coverage.md) --

  function waitQuest(wait: Record<string, unknown>, node = 'wait') {
    return {
      slug: 'x3-synthetic',
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'clock',
                    plans: [
                      {
                        plan_ref: 'prep',
                        title: 'Prepare',
                        wave: 10,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                      {
                        plan_ref: 'response-window',
                        title: 'Wait for the response or the clock',
                        wave: 20,
                        metadata: { runner: { wait, node: { type: node } } },
                      },
                      {
                        plan_ref: 'wrap',
                        title: 'Wrap up',
                        wave: 30,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  const DEADLINE_WAIT = { kind: 'duration_or_landmark', landmark: 'response_received', days: 7 }

  /** Three deadline waits + a gate: the deadline-bearing corpus quest. */
  function deadlineCorpusQuest() {
    const waitPlan = (ref: string, wave: number) => ({
      plan_ref: ref,
      title: `Wait — ${ref}`,
      wave,
      metadata: { runner: { wait: DEADLINE_WAIT, node: { type: 'wait' } } },
    })
    return {
      slug: 'x3-corpus-synthetic',
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'clock',
                    plans: [
                      waitPlan('first-window', 10),
                      waitPlan('second-window', 20),
                      waitPlan('third-window', 30),
                      {
                        plan_ref: 'review-gate',
                        title: 'A human reviews',
                        wave: 40,
                        metadata: { runner: { gate: { kind: 'approval' }, node: { type: 'gate' } } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  it('compiles a deadline wait (days + landmark) to df.race (golden)', async () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x3', schema: 'waypoint', quest: waitQuest(DEADLINE_WAIT) })
    await expectGolden('x3-deadline-wait.sql', sql)
  })

  it('deadline wait: race arms, truthful CASE record, gate-style parking', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x3', schema: 'waypoint', quest: waitQuest(DEADLINE_WAIT) })

    expect(sql).toContain('df.race(')
    expect(sql).toContain("df.wait_for_signal('wait:response-window'),")
    expect(sql).toContain(`df.sleep(${7 * 86400})`)
    // The elapsed marker makes the winner distinguishable — engine signal
    // values carry a 'data' envelope, the marker never does.
    expect(sql).toContain('{"elapsed":true,"days":7}')
    // The record states WHY the wait ended.
    expect(sql).toContain("CASE WHEN ($sig::jsonb ? 'data') THEN 'task.wait.resolved' ELSE 'task.wait.elapsed' END")
    // Parked visibly, gate-style: blocked at the wait, active after.
    expect(sql).toContain("SET status = 'blocked', current_node = 'response-window'")
    expect(sql).toContain("SET status = 'active',")
  })

  it('timer-only waits keep the plain sleep; landmark-only waits park indefinitely', () => {
    const timer = compileQuestToDurableGraph({
      routeId: 'route-x3',
      schema: 'waypoint',
      quest: waitQuest({ kind: 'duration', days: 7 }),
    })
    expect(timer).toContain(`df.sleep(${7 * 86400})`)
    expect(timer).not.toContain('df.race(')

    const landmarkOnly = compileQuestToDurableGraph({
      routeId: 'route-x3',
      schema: 'waypoint',
      quest: waitQuest({ kind: 'passive_landmark', landmark: 'response_received' }),
    })
    expect(landmarkOnly).toContain("df.wait_for_signal('wait:response-window') |=> 'sig'")
    expect(landmarkOnly).not.toContain('df.race(')
    expect(landmarkOnly).not.toContain('df.sleep(')
  })

  it('fails closed on a wait with neither days nor landmark, and on a clock-bound gate', () => {
    expect(() =>
      compileQuestToDurableGraph({ routeId: 'route-x3', schema: 'waypoint', quest: waitQuest({ kind: 'unbounded' }) }),
    ).toThrow(/neither wait\.days nor a landmark.*fail closed/)
    expect(() =>
      compileQuestToDurableGraph({
        routeId: 'route-x3',
        schema: 'waypoint',
        quest: (() => {
          const quest = waitQuest(DEADLINE_WAIT, 'gate')
          const plans = quest.scaffolds.workstreams[0]!.milestones[0]!.phases[0]!.plans as Array<{
            plan_ref: string
            metadata: { runner: Record<string, unknown> }
          }>
          plans.find((plan) => plan.plan_ref === 'response-window')!.metadata.runner.gate = { kind: 'approval' }
          return quest
        })(),
      }),
    ).toThrow(/humans decide, never the clock/)
  })

  it('deadline semantics appear only where authored: a deadline quest races, the scaffold does not', async () => {
    // The scaffold authors no wait at all, so it must compile without a race.
    const scaffold = await bundledQuest('runner')
    expect(
      compileQuestToDurableGraph({ routeId: 'route-x3-runner', schema: 'waypoint', quest: scaffold }),
    ).not.toContain('df.race(')

    // A quest that authors deadline waits races EVERY one of them — before X3
    // the landmark half was silently dropped — and gates stay indefinite
    // everywhere: no gate wait ever carries a timeout.
    const sql = compileQuestToDurableGraph({ routeId: 'route-x3-corpus', schema: 'waypoint', quest: deadlineCorpusQuest() })
    expect(sql.match(/df\.race\(/g)?.length).toBeGreaterThanOrEqual(3)
    expect(sql).not.toMatch(/df\.wait_for_signal\('gate:[^']+',/)
  })

  it('is byte-deterministic for a deadline-wait quest', () => {
    const input = { routeId: 'route-x3', schema: 'waypoint', quest: waitQuest(DEADLINE_WAIT) } as const
    expect(compileQuestToDurableGraph(input)).toBe(compileQuestToDurableGraph(input))
  })

  // ---- X4: guardrailed repeat loops (docs/designs/df-operator-coverage.md) --

  function repeatQuest(
    repeat: unknown,
    extraPlan?: Record<string, unknown>,
  ) {
    return {
      slug: 'x4-synthetic',
      ...(repeat === undefined ? {} : { repeat }),
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'maintain',
                    plans: [
                      {
                        plan_ref: 'sweep',
                        title: 'Sweep the workspace',
                        wave: 10,
                        metadata: { runner: { node: { type: 'checkpoint' } } },
                      },
                      ...(extraPlan === undefined ? [] : [extraPlan]),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  it('compiles a repeating quest to a whole-graph @> loop (golden)', async () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }) })
    await expectGolden('x4-repeat.sql', sql)
  })

  it('repeat: outermost @>, per-iteration tick with runtime id, no terminal state', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }) })

    // The loop is the OUTERMOST construct — ContinuedAsNew re-executes the
    // whole graph, so nothing may sit outside it.
    expect(sql.startsWith('SELECT df.start(\n\n  @> (')).toBe(true)
    expect(sql).toContain(`df.sleep(${3 * 86400})`)
    // A repeating route never completes.
    expect(sql).not.toContain("SET status = 'complete'")
    expect(sql).not.toContain('route.complete')
    // The tick id is derived at RUN time in its own namespace — compile-time
    // ids would collide on iteration two — and carries no dedupe key: a
    // replayed iteration re-executes the body, so an extra tick is truthful.
    expect(sql).toContain("'event-r' || ((SELECT count(*) FROM waypoint.route_events")
    expect(sql).toContain("'route.repeat.tick'")
    const tick = sql.split('route.repeat.tick')[0]!.split('repeat: iteration tick')[1] ?? ''
    expect(tick).not.toContain('dedupe_key')
  })

  it('repeat admits timer waits and when-guards; refuses recipes, gates, landmark waits', () => {
    const timerWait = {
      plan_ref: 'pace',
      title: 'Pace the loop',
      wave: 20,
      metadata: { runner: { wait: { kind: 'duration', days: 1 }, node: { type: 'wait' } } },
    }
    expect(
      compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }, timerWait) }),
    ).toContain(`df.sleep(${86400})`)

    const guarded = {
      plan_ref: 'maybe-sweep',
      title: 'Sweep only when stale rows exist',
      wave: 20,
      metadata: { runner: { when: 'SELECT EXISTS (SELECT 1 FROM waypoint.tasks)', node: { type: 'checkpoint' } } },
    }
    expect(
      compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }, guarded) }),
    ).toContain('df.if(')

    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [
        { plan_ref: 'work', title: 'Work', wave: 20, metadata: { runner: { recipe: { slug: 'r' }, node: { type: 'recipe' } } } },
        /recipe 'work'.*re-enqueue.*ContinuedAsNew/s,
      ],
      [
        { plan_ref: 'ok', title: 'Approve', wave: 20, metadata: { runner: { gate: { kind: 'approval' }, node: { type: 'gate' } } } },
        /gate 'ok'.*signals are lost.*ContinuedAsNew/s,
      ],
      [
        {
          plan_ref: 'window',
          title: 'Window',
          wave: 20,
          metadata: { runner: { wait: { kind: 'duration_or_landmark', days: 7, landmark: 'seen' }, node: { type: 'wait' } } },
        },
        /wait 'window'.*signals are lost.*ContinuedAsNew/s,
      ],
    ]
    for (const [plan, message] of cases) {
      expect(
        () => compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }, plan) }),
        String(plan.plan_ref),
      ).toThrow(message)
    }
  })

  it('fails closed on a malformed repeat block', () => {
    for (const repeat of [{}, { every_days: 0 }, { every_days: -1 }, { every_days: 'weekly' }, { every_days: Infinity }, 7, 'daily']) {
      expect(
        () => compileQuestToDurableGraph({ routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest(repeat) }),
        JSON.stringify(repeat),
      ).toThrow(/repeat\.every_days must be a positive finite number/)
    }
  })

  it('no corpus quest repeats: the corpus compiles without @>', async () => {
    for (const quest of [await bundledQuest('runner'), pipelineQuest(), deadlineCorpusQuest()]) {
      const sql = compileQuestToDurableGraph({ routeId: `route-x4-${quest.slug}`, schema: 'waypoint', quest })
      expect(sql, quest.slug).not.toContain('@> (')
    }
  })

  it('is byte-deterministic for a repeating quest', () => {
    const input = { routeId: 'route-x4', schema: 'waypoint', quest: repeatQuest({ every_days: 3 }) } as const
    expect(compileQuestToDurableGraph(input)).toBe(compileQuestToDurableGraph(input))
  })

  // ---- Q2: durable admission (docs/designs/q-quest-proving.md, rsc-e1b) ----
  // Before Q2, `artifact`/`handoff`/unknown node types silently compiled to
  // auto-done checkpoints — the hollis-vantry referral-package run marked
  // verifier-bearing plans done with their artifacts absent from disk.

  function questWithPlan(plan: Record<string, unknown>) {
    return {
      slug: 'q2-synthetic',
      scaffolds: {
        workstreams: [
          { milestones: [{ phases: [{ phase_slug: 'p1', plans: [plan] }] }] },
        ],
      },
    }
  }

  it('Q2: node types without a durable mapping refuse to compile', () => {
    for (const type of ['artifact', 'handoff', 'delay', 'timer', 'dependency', 'system', 'made-up']) {
      expect(
        () =>
          compileQuestToDurableGraph({
            routeId: 'route-q2',
            schema: 'waypoint',
            quest: questWithPlan({
              plan_ref: 'orphan',
              title: 'Work with no executor',
              wave: 1,
              metadata: { runner: { node: { type } } },
            }),
          }),
        type,
      ).toThrow(/no durable execution mapping.*silently auto-complete/s)
    }
  })

  it('Q2: artifact_verifier on an auto-done plan refuses to compile', () => {
    expect(() =>
      compileQuestToDurableGraph({
        routeId: 'route-q2',
        schema: 'waypoint',
        quest: questWithPlan({
          plan_ref: 'inventory',
          title: 'Inventory source documents',
          wave: 1,
          metadata: {
            runner: {
              node: { type: 'checkpoint' },
              artifact_verifier: { kind: 'required_paths', checks: ['exists'] },
            },
          },
        }),
      }),
    ).toThrow(/artifact_verifier.*auto-done checkpoint.*verifier would never run/s)
  })

  it('rsc-6al: an artifact_contract not in the vetted registry refuses to compile', () => {
    expect(() =>
      compileQuestToDurableGraph({
        routeId: 'route-q2',
        schema: 'waypoint',
        quest: questWithPlan({
          plan_ref: 'placement',
          title: 'Propose placements',
          wave: 1,
          metadata: {
            runner: {
              recipe: { slug: 'placement-reviewer' },
              artifact_contract: 'not-a-vetted-contract',
              node: { type: 'recipe' },
            },
          },
        }),
      }),
    ).toThrow(/artifact_contract 'not-a-vetted-contract'.*not in the vetted contract registry/s)
  })

  it('rsc-6al: an artifact_contract on an auto-done plan refuses to compile', () => {
    expect(() =>
      compileQuestToDurableGraph({
        routeId: 'route-q2',
        schema: 'waypoint',
        quest: questWithPlan({
          plan_ref: 'placement',
          title: 'Propose placements',
          wave: 1,
          metadata: {
            runner: {
              node: { type: 'checkpoint' },
              artifact_contract: 'test-placement-plan',
            },
          },
        }),
      }),
    ).toThrow(/artifact_contract.*auto-done checkpoint.*contract would never run/s)
  })

  it('rsc-6al: a vetted artifact_contract on a recipe plan compiles', () => {
    const sql = compileQuestToDurableGraph({
      routeId: 'route-q2',
      schema: 'waypoint',
      quest: questWithPlan({
        plan_ref: 'placement',
        title: 'Propose placements',
        wave: 1,
        metadata: {
          runner: {
            recipe: { slug: 'placement-reviewer' },
            artifact_contract: 'test-placement-plan',
            node: { type: 'recipe' },
          },
        },
      }),
    })
    expect(sql).toContain("'placement-reviewer'")
  })

  it('Q2: artifact_verifier on a recipe plan is fine — the worker produces, the verifier can run', () => {
    const sql = compileQuestToDurableGraph({
      routeId: 'route-q2',
      schema: 'waypoint',
      quest: questWithPlan({
        plan_ref: 'build',
        title: 'Build the artifact',
        wave: 1,
        metadata: {
          runner: {
            recipe: { slug: 'builder' },
            artifact_verifier: { kind: 'required_paths', checks: ['exists'] },
            node: { type: 'recipe' },
          },
        },
      }),
    })
    expect(sql).toContain("'builder'")
  })

  // ---- Q3: long-chain chunking (pg_durable 0.2.4 parser limit) -------------
  // Bisected in vivo: 127 linearly chained elements parse, 128 break (the
  // tail is swallowed into one mis-parsed SQL leaf failing at runtime with
  // `syntax error at or near "{"`); parentheses reset the counter. Long
  // top-level chains are chunked into parenthesized groups at plan
  // boundaries; graphs at or under the limit assemble exactly as before.

  function manyCheckpointQuest(count: number) {
    return {
      slug: 'q3-synthetic',
      scaffolds: {
        workstreams: [
          {
            milestones: [
              {
                phases: [
                  {
                    phase_slug: 'bulk',
                    plans: Array.from({ length: count }, (_, index) => ({
                      plan_ref: `step-${String(index + 1).padStart(3, '0')}`,
                      title: `Step ${index + 1}`,
                      wave: index + 1,
                      metadata: { runner: { node: { type: 'checkpoint' } } },
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  it('Q3: a >100-element chain compiles to parenthesized chunks with every linear run under the parser limit', () => {
    // 70 checkpoints = 1 register + 140 task/event elements + 2 terminal.
    const sql = compileQuestToDurableGraph({ routeId: 'route-q3', schema: 'waypoint', quest: manyCheckpointQuest(70) })
    expect(sql).toContain('  )\n  ~> (')
    // Longest linear run between parentheses stays under the measured limit.
    const runs = sql
      .split(/[()]/)
      .map((segment) => (segment.match(/~>/g) ?? []).length)
    expect(Math.max(...runs)).toBeLessThanOrEqual(110)
    // Chunking is deterministic.
    expect(sql).toBe(compileQuestToDurableGraph({ routeId: 'route-q3', schema: 'waypoint', quest: manyCheckpointQuest(70) }))
  })

  it('Q3: graphs at or under the limit assemble without chunk groups (goldens unchanged)', () => {
    const sql = compileQuestToDurableGraph({ routeId: 'route-q3', schema: 'waypoint', quest: manyCheckpointQuest(40) })
    expect(sql).not.toContain('  ~> (')
  })

  it('Q2: explicit checkpoint markers still compile (the documented deliberate auto-done)', () => {
    const sql = compileQuestToDurableGraph({
      routeId: 'route-q2',
      schema: 'waypoint',
      quest: questWithPlan({
        plan_ref: 'marker',
        title: 'Phase marker',
        wave: 1,
        metadata: { runner: { node: { type: 'checkpoint' } } },
      }),
    })
    expect(sql).toContain("'marker'")
  })

})
