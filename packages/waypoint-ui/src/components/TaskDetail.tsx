import { useStore } from '../store'

export function TaskDetail() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const task = useStore((s) => s.tasks.find((t) => t.id === selectedTaskId))

  if (!task) return <div style={{ padding: 12, fontSize: 13 }}>Select a task to see details.</div>

  return (
    <div style={{ padding: 12, fontSize: 13, borderTop: '1px solid #ddd' }}>
      <h4 style={{ margin: '0 0 8px' }}>{task.plan_ref}</h4>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0 }}>
        <dt>id</dt><dd>{task.id}</dd>
        <dt>kind</dt><dd>{task.kind}</dd>
        <dt>status</dt><dd>{task.status}</dd>
        <dt>phase</dt><dd>{task.phase}</dd>
        <dt>wave</dt><dd>{task.wave ?? '—'}</dd>
      </dl>
      {task.metadata ? (
        <details style={{ marginTop: 8 }}>
          <summary>metadata</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(task.metadata, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  )
}
