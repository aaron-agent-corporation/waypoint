import { useCallback, useEffect, useState } from 'react'

import { useClient } from '../engine/context'
import { useEngineCommand } from '../engine/useEngineCommand'
import type { TaskDiscussionMessagePage, WaypointTaskDiscussionMessage } from '../engine/types'
import { listField } from '../lib/engine'

export function DiscussionThread({ taskId }: { taskId: string }) {
  const client = useClient()
  const { run, pending } = useEngineCommand()
  const [items, setItems] = useState<readonly WaypointTaskDiscussionMessage[] | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    try {
      const env = (await client.cmd('discuss.list', { taskId })) as { ok: boolean; error?: string; discussion?: TaskDiscussionMessagePage }
      const page = listField<'discussion', TaskDiscussionMessagePage>(env, 'discuss.list', 'discussion')
      setItems(page?.items ?? [])
    } catch {
      setItems([])
    }
  }, [client, taskId])

  useEffect(() => { void load() }, [load])

  const post = async () => {
    const message = draft.trim()
    if (!message) return
    await run('discuss.post', { taskId, message }) // no author — engine applies default identity
    setDraft('')
    await load()
  }

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h4 style={{ margin: '0 0 8px' }}>Discussion</h4>
      {items === null ? (
        <div style={{ color: '#666' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#666' }}>No messages yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((m) => (
            <li key={m.id} style={{ marginBottom: 6 }}>
              <span style={{ color: '#666', fontSize: 12, marginRight: 6 }}>{m.author}</span>
              {m.content}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
        <input type="text" placeholder="Add a message…" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
        <button type="button" disabled={pending || draft.trim() === ''} onClick={() => void post()}>Post</button>
      </div>
    </div>
  )
}
