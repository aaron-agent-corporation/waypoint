SELECT df.start(

  -- register engine instance on the route row
  $n1$ UPDATE waypoint.routes
       SET instance_id = '{sys_instance_id}', current_node = 'document-intake-record-source', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = 'route-golden-document-pipeline' $n1$

  -- wave 10: Record the source document (recipe record-source)
  ~> $n2$ UPDATE waypoint.tasks SET status = 'in_progress', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-intake-record-source' $n2$
  ~> $n3$ INSERT INTO waypoint.dispatches (route_id, task_ref, recipe, instance_id)
          SELECT 'route-golden-document-pipeline', 'document-intake-record-source', 'record-source', '{sys_instance_id}'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.dispatches
                            WHERE instance_id = '{sys_instance_id}' AND task_ref = 'document-intake-record-source') $n3$
  ~> df.wait_for_signal('task:document-intake-record-source') |=> 'sig'
  ~> $n4$ UPDATE waypoint.tasks
          SET status = 'done', evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-intake-record-source' $n4$
  ~> $n5$ UPDATE waypoint.routes SET status = 'active', current_node = 'document-intake-record-source', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = 'route-golden-document-pipeline' $n5$
  ~> $n6$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
          SELECT 'event-e001', 'route-golden-document-pipeline', 'task.signal', $sig::jsonb, to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-001'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                            WHERE route_id = 'route-golden-document-pipeline' AND dedupe_key = '{sys_instance_id}:ev-001') $n6$

  -- wave 20: Classify the document (recipe classify-document)
  ~> $n7$ UPDATE waypoint.tasks SET status = 'in_progress', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-intake-classify' $n7$
  ~> $n8$ INSERT INTO waypoint.dispatches (route_id, task_ref, recipe, instance_id)
          SELECT 'route-golden-document-pipeline', 'document-intake-classify', 'classify-document', '{sys_instance_id}'
          WHERE NOT EXISTS (SELECT 1 FROM waypoint.dispatches
                            WHERE instance_id = '{sys_instance_id}' AND task_ref = 'document-intake-classify') $n8$
  ~> df.wait_for_signal('task:document-intake-classify') |=> 'sig'
  ~> $n9$ UPDATE waypoint.tasks
          SET status = 'done', evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-intake-classify' $n9$
  ~> $n10$ UPDATE waypoint.routes SET status = 'active', current_node = 'document-intake-classify', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-document-pipeline' $n10$
  ~> $n11$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e002', 'route-golden-document-pipeline', 'task.signal', $sig::jsonb, to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-002'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-document-pipeline' AND dedupe_key = '{sys_instance_id}:ev-002') $n11$

  -- wave 30: A human reviews the classification (gate document-review-gate)
  ~> $n12$ UPDATE waypoint.routes SET status = 'blocked', current_node = 'document-review-gate', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-document-pipeline' $n12$
  ~> $n13$ UPDATE waypoint.tasks SET status = 'blocked', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-review-gate' $n13$
  ~> df.wait_for_signal('gate:document-review-gate') |=> 'sig'
  ~> $n14$ UPDATE waypoint.tasks
           SET status = CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'done' ELSE 'failed' END,
               evidence = ($sig::jsonb)->'data', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE route_id = 'route-golden-document-pipeline' AND plan_ref = 'document-review-gate' $n14$
  ~> $n15$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e003', 'route-golden-document-pipeline', CASE WHEN ($sig::jsonb->'data'->>'decision') = 'approve' AND ($sig::jsonb->'data'->>'actor') = 'system-reconcile' THEN 'route.gate.moot' WHEN ($sig::jsonb->'data'->>'decision') = 'approve' THEN 'route.gate.approved' ELSE 'route.gate.rejected' END, jsonb_build_object('node', 'document-review-gate', 'decision', ($sig::jsonb)->'data'), to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-003'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-document-pipeline' AND dedupe_key = '{sys_instance_id}:ev-003') $n15$
  ~> $n16$ UPDATE waypoint.routes SET status = 'active', updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-document-pipeline' $n16$

  -- route terminal state
  ~> $n17$ UPDATE waypoint.routes SET status = 'complete', current_node = NULL, updated_at = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           WHERE id = 'route-golden-document-pipeline' $n17$
  ~> $n18$ INSERT INTO waypoint.route_events (id, route_id, kind, payload, created_at, dedupe_key)
           SELECT 'event-e004', 'route-golden-document-pipeline', 'route.complete', '{"quest":"document-pipeline-synthetic"}', to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '{sys_instance_id}:ev-004'
           WHERE NOT EXISTS (SELECT 1 FROM waypoint.route_events
                             WHERE route_id = 'route-golden-document-pipeline' AND dedupe_key = '{sys_instance_id}:ev-004') $n18$,

  'route-golden-document-pipeline'
);
