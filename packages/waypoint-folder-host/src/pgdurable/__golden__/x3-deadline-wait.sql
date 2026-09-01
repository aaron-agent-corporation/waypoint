SELECT df.start(

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'prep', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-x3' $n1$

  -- wave 10: Prepare (checkpoint prep)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x3' AND plan_ref = 'prep' $n2$
  ~> $n3$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-x3', 'task.done', '{"plan_ref":"prep"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x3' AND dedupe_key = '{sys_instance_id}:ev-001') $n3$

  -- wave 20: Wait for the response or the clock (wait response-window)
  ~> $n4$ UPDATE waypoint.routes SET status = 'blocked', current_node = 'response-window', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = 'route-x3' $n4$
  ~> $n5$ UPDATE waypoint.tasks SET status = 'blocked', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x3' AND plan_ref = 'response-window' $n5$
  ~> df.race(
  df.wait_for_signal('wait:response-window'),
  df.sleep(604800)
  ~> $n6$ SELECT '{"elapsed":true,"days":7}' $n6$
  ) |=> 'sig'
  ~> $n7$ UPDATE waypoint.tasks
          SET status = 'done',
              evidence = CASE WHEN ($sig::jsonb ? 'data') THEN ($sig::jsonb)->'data' ELSE ($sig::jsonb) END,
              updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x3' AND plan_ref = 'response-window' $n7$
  ~> $n8$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e002', 'route-x3', CASE WHEN ($sig::jsonb ? 'data') THEN 'task.wait.resolved' ELSE 'task.wait.elapsed' END, jsonb_build_object('node', 'response-window', 'result', CASE WHEN ($sig::jsonb ? 'data') THEN ($sig::jsonb)->'data' ELSE ($sig::jsonb) END), to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-002'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x3' AND dedupe_key = '{sys_instance_id}:ev-002') $n8$
  ~> $n9$ UPDATE waypoint.routes SET status = 'active', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = 'route-x3' $n9$

  -- wave 30: Wrap up (checkpoint wrap)
  ~> $n10$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-x3' AND plan_ref = 'wrap' $n10$
  ~> $n11$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e003', 'route-x3', 'task.done', '{"plan_ref":"wrap"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-003'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x3' AND dedupe_key = '{sys_instance_id}:ev-003') $n11$

  -- route terminal state
  ~> $n12$ UPDATE waypoint.routes SET status = 'complete', current_node = NULL, updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-x3' $n12$
  ~> $n13$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e004', 'route-x3', 'route.complete', '{"quest":"x3-synthetic"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-004'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x3' AND dedupe_key = '{sys_instance_id}:ev-004') $n13$,

  'route-x3'
);
