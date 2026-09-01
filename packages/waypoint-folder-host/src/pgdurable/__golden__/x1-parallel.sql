SELECT df.start(

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'prep', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-x1' $n1$

  -- wave 10: Prepare inputs (checkpoint prep)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x1' AND plan_ref = 'prep' $n2$
  ~> $n3$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-x1', 'task.done', '{"plan_ref":"prep"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x1' AND dedupe_key = '{sys_instance_id}:ev-001') $n3$

  -- wave 20 (parallel): fan-a, fan-b
  ~> $n4$ UPDATE waypoint.routes SET current_node = 'fan-a', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = 'route-x1' $n4$
  ~> (
  (
  -- wave 20: Fan-out branch A (recipe recipe-a)
  $n5$ UPDATE waypoint.tasks SET status = 'in_progress', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE route_id = 'route-x1' AND plan_ref = 'fan-a' $n5$
  ~> $n6$ INSERT INTO waypoint.dispatches (route_id, task_ref, recipe, instance_id)
          SELECT 'route-x1', 'fan-a', 'recipe-a', '{sys_instance_id}'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.dispatches
                            WHERE instance_id = '{sys_instance_id}' AND task_ref = 'fan-a') $n6$
  ~> df.wait_for_signal('task:fan-a') |=> 'sig'
  ~> $n7$ UPDATE waypoint.tasks
          SET status = 'done', evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x1' AND plan_ref = 'fan-a' $n7$
  ~> $n8$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e002', 'route-x1', 'task.signal', $sig::jsonb, to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-002'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x1' AND dedupe_key = '{sys_instance_id}:ev-002') $n8$
  )
  & (
  -- wave 20: Fan-out branch B (recipe recipe-b)
  $n9$ UPDATE waypoint.tasks SET status = 'in_progress', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE route_id = 'route-x1' AND plan_ref = 'fan-b' $n9$
  ~> $n10$ INSERT INTO waypoint.dispatches (route_id, task_ref, recipe, instance_id)
           SELECT 'route-x1', 'fan-b', 'recipe-b', '{sys_instance_id}'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.dispatches
                             WHERE instance_id = '{sys_instance_id}' AND task_ref = 'fan-b') $n10$
  ~> df.wait_for_signal('task:fan-b') |=> 'sig'
  ~> $n11$ UPDATE waypoint.tasks
           SET status = 'done', evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-x1' AND plan_ref = 'fan-b' $n11$
  ~> $n12$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e003', 'route-x1', 'task.signal', $sig::jsonb, to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-003'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x1' AND dedupe_key = '{sys_instance_id}:ev-003') $n12$
  )
  )

  -- wave 30: Join and wrap up (checkpoint wrap)
  ~> $n13$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-x1' AND plan_ref = 'wrap' $n13$
  ~> $n14$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e004', 'route-x1', 'task.done', '{"plan_ref":"wrap"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-004'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x1' AND dedupe_key = '{sys_instance_id}:ev-004') $n14$

  -- route terminal state
  ~> $n15$ UPDATE waypoint.routes SET status = 'complete', current_node = NULL, updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-x1' $n15$
  ~> $n16$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e005', 'route-x1', 'route.complete', '{"quest":"x1-synthetic"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-005'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x1' AND dedupe_key = '{sys_instance_id}:ev-005') $n16$,

  'route-x1'
);
