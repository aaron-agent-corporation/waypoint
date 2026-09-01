SELECT df.start(

  @> (

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'sweep', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-x4' $n1$

  -- wave 10: Sweep the workspace (checkpoint sweep)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'done', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-x4' AND plan_ref = 'sweep' $n2$
  ~> $n3$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-x4', 'task.done', '{"plan_ref":"sweep"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-x4' AND dedupe_key = '{sys_instance_id}:ev-001') $n3$

  -- repeat: iteration tick, then park until the next pass
  ~> $n4$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at)
          SELECT 'event-r' || ((SELECT count(*) FROM waypoint.route_events
                               WHERE route_id = 'route-x4' AND id LIKE 'event-r%') + 1)::text,
                 'route-x4', 'route.repeat.tick', '{"quest":"x4-synthetic","every_days":3}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $n4$
  ~> df.sleep(259200)

  ),

  'route-x4'
);
