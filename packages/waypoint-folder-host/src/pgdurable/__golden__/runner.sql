SELECT df.start(

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'initialize-context', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-golden-runner' $n1$

  -- wave 10: Gather project context and starting constraints (checkpoint initialize-context)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-runner' AND plan_ref = 'initialize-context' $n2$
  ~> $n3$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-golden-runner', 'task.done', '{"plan_ref":"initialize-context"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-001') $n3$

  -- wave 20: Draft initial roadmap and Quest adoption notes (checkpoint initialize-roadmap)
  ~> $n4$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-runner' AND plan_ref = 'initialize-roadmap' $n4$
  ~> $n5$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e002', 'route-golden-runner', 'task.done', '{"plan_ref":"initialize-roadmap"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-002'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-002') $n5$

  -- wave 10: Clarify the objective and acceptance criteria (discussion discuss-objective)
  ~> $n6$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-runner' AND plan_ref = 'discuss-objective' $n6$
  ~> $n7$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e003', 'route-golden-runner', 'task.done', '{"plan_ref":"discuss-objective"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-003'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-003') $n7$

  -- wave 20: Surface assumptions, risks, and open decisions (checkpoint discuss-assumptions)
  ~> $n8$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-runner' AND plan_ref = 'discuss-assumptions' $n8$
  ~> $n9$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e004', 'route-golden-runner', 'task.done', '{"plan_ref":"discuss-assumptions"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-004'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-004') $n9$

  -- wave 10: Research the phase and draft an executable plan (checkpoint plan-research)
  ~> $n10$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'plan-research' $n10$
  ~> $n11$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e005', 'route-golden-runner', 'task.done', '{"plan_ref":"plan-research"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-005'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-005') $n11$

  -- wave 20: Human approval gate before execution begins (gate plan-approval-gate)
  ~> $n12$ UPDATE waypoint.routes SET status = 'blocked', current_node = 'plan-approval-gate', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n12$
  ~> $n13$ UPDATE waypoint.tasks SET status = 'blocked', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'plan-approval-gate' $n13$
  ~> df.wait_for_signal('gate:plan-approval-gate') |=> 'sig'
  ~> $n14$ UPDATE waypoint.tasks
           SET status = CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'done' ELSE 'failed' END,
               evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'plan-approval-gate' $n14$
  ~> $n15$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e006', 'route-golden-runner', CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' AND ($sig::jsonb->'data'->>'actor') = 'system-reconcile' THEN 'route.gate.moot' WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'route.gate.approved' ELSE 'route.gate.rejected' END, jsonb_build_object('node', 'plan-approval-gate', 'decision', ($sig::jsonb)->'data'), to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-006'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-006') $n15$
  ~> $n16$ UPDATE waypoint.routes SET status = 'active', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n16$

  -- wave 10: Execute approved work in dependency-aware slices (checkpoint execute-slice)
  ~> $n17$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'execute-slice' $n17$
  ~> $n18$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e007', 'route-golden-runner', 'task.done', '{"plan_ref":"execute-slice"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-007'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-007') $n18$

  -- wave 20: Checkpoint evidence, commits, and remaining work (checkpoint execute-checkpoint)
  ~> $n19$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'execute-checkpoint' $n19$
  ~> $n20$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e008', 'route-golden-runner', 'task.done', '{"plan_ref":"execute-checkpoint"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-008'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-008') $n20$

  -- wave 10: Validate deliverables against acceptance criteria (checkpoint verify-work)
  ~> $n21$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'verify-work' $n21$
  ~> $n22$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e009', 'route-golden-runner', 'task.done', '{"plan_ref":"verify-work"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-009'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-009') $n22$

  -- wave 20: Human verification gate and issue triage (gate verify-approval-gate)
  ~> $n23$ UPDATE waypoint.routes SET status = 'blocked', current_node = 'verify-approval-gate', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n23$
  ~> $n24$ UPDATE waypoint.tasks SET status = 'blocked', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'verify-approval-gate' $n24$
  ~> df.wait_for_signal('gate:verify-approval-gate') |=> 'sig'
  ~> $n25$ UPDATE waypoint.tasks
           SET status = CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'done' ELSE 'failed' END,
               evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'verify-approval-gate' $n25$
  ~> $n26$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e010', 'route-golden-runner', CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' AND ($sig::jsonb->'data'->>'actor') = 'system-reconcile' THEN 'route.gate.moot' WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'route.gate.approved' ELSE 'route.gate.rejected' END, jsonb_build_object('node', 'verify-approval-gate', 'decision', ($sig::jsonb)->'data'), to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-010'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-010') $n26$
  ~> $n27$ UPDATE waypoint.routes SET status = 'active', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n27$

  -- wave 10: Prepare docs, review notes, and final handoff (checkpoint ship-prep)
  ~> $n28$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'ship-prep' $n28$
  ~> $n29$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e011', 'route-golden-runner', 'task.done', '{"plan_ref":"ship-prep"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-011'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-011') $n29$

  -- wave 20: Final human ship approval gate (gate ship-approval-gate)
  ~> $n30$ UPDATE waypoint.routes SET status = 'blocked', current_node = 'ship-approval-gate', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n30$
  ~> $n31$ UPDATE waypoint.tasks SET status = 'blocked', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'ship-approval-gate' $n31$
  ~> df.wait_for_signal('gate:ship-approval-gate') |=> 'sig'
  ~> $n32$ UPDATE waypoint.tasks
           SET status = CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'done' ELSE 'failed' END,
               evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-runner' AND plan_ref = 'ship-approval-gate' $n32$
  ~> $n33$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e012', 'route-golden-runner', CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' AND ($sig::jsonb->'data'->>'actor') = 'system-reconcile' THEN 'route.gate.moot' WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'route.gate.approved' ELSE 'route.gate.rejected' END, jsonb_build_object('node', 'ship-approval-gate', 'decision', ($sig::jsonb)->'data'), to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-012'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-012') $n33$
  ~> $n34$ UPDATE waypoint.routes SET status = 'active', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n34$

  -- route terminal state
  ~> $n35$ UPDATE waypoint.routes SET status = 'complete', current_node = NULL, updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-runner' $n35$
  ~> $n36$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e013', 'route-golden-runner', 'route.complete', '{"quest":"runner"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-013'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-runner' AND dedupe_key = '{sys_instance_id}:ev-013') $n36$,

  'route-golden-runner'
);
