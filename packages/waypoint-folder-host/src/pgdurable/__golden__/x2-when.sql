SELECT df.start(

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'prep', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-x2' $n1$

  -- wave 10: Prepare inputs (checkpoint prep)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x2' AND plan_ref = 'prep' $n2$
  ~> $n3$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-x2', 'task.done', '{"plan_ref":"prep"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x2' AND dedupe_key = '{sys_instance_id}:ev-001') $n3$

  -- wave 20: Sync the index when prep landed (recipe recipe-sync) [when-guarded]
  ~> df.if(
  $n4$ SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE plan_ref = 'prep' AND status = 'done') $n4$,
  (
  $n5$ UPDATE waypoint.tasks SET status = 'in_progress', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE route_id = 'route-x2' AND plan_ref = 'maybe-sync' $n5$
  ~> $n6$ INSERT INTO waypoint.dispatches (route_id, task_ref, recipe, instance_id)
          SELECT 'route-x2', 'maybe-sync', 'recipe-sync', '{sys_instance_id}'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.dispatches
                            WHERE instance_id = '{sys_instance_id}' AND task_ref = 'maybe-sync') $n6$
  ~> df.wait_for_signal('task:maybe-sync') |=> 'sig'
  ~> $n7$ UPDATE waypoint.tasks
          SET status = 'done', evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x2' AND plan_ref = 'maybe-sync' $n7$
  ~> $n8$ UPDATE waypoint.routes SET status = 'active', current_node = 'maybe-sync', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = 'route-x2' $n8$
  ~> $n9$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e002', 'route-x2', 'task.signal', $sig::jsonb, to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-002'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x2' AND dedupe_key = '{sys_instance_id}:ev-002') $n9$
  ),
  (
  $n10$ UPDATE waypoint.tasks
        SET status = 'done', evidence = '{"skipped":true,"when":"SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE plan_ref = ''prep'' AND status = ''done'')"}', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        WHERE route_id = 'route-x2' AND plan_ref = 'maybe-sync' $n10$
  ~> $n11$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e003', 'route-x2', 'route.task.skipped', '{"plan_ref":"maybe-sync","when":"SELECT EXISTS (SELECT 1 FROM waypoint.tasks WHERE plan_ref = ''prep'' AND status = ''done'')"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-003'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x2' AND dedupe_key = '{sys_instance_id}:ev-003') $n11$
  )
  )

  -- wave 30: Wrap up (checkpoint wrap)
  ~> $n12$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-x2' AND plan_ref = 'wrap' $n12$
  ~> $n13$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e004', 'route-x2', 'task.done', '{"plan_ref":"wrap"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-004'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x2' AND dedupe_key = '{sys_instance_id}:ev-004') $n13$

  -- route terminal state
  ~> $n14$ UPDATE waypoint.routes SET status = 'complete', current_node = NULL, updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-x2' $n14$
  ~> $n15$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e005', 'route-x2', 'route.complete', '{"quest":"x2-synthetic"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-005'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-x2' AND dedupe_key = '{sys_instance_id}:ev-005') $n15$,

  'route-x2'
);
