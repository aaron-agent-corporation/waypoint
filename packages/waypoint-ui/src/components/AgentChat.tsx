import { useState } from 'react'

import { useClient } from '../engine/context'
import { useStore } from '../store'
import type { AgentEventRecord } from '../engine/types'

const EMPTY_TRANSCRIPT: AgentEventRecord[] = []

function renderEvent(event: AgentEventRecord) {
  const data = event.data ?? {}
  if (event.kind === 'agent.message') return <em>{String(data.text ?? '')}</em>
  if (event.kind === 'agent.toolcall') return <span>→ tool: {String(data.toolName ?? '')}</span>
  if (event.kind === 'agent.tool_result') return <span>← {String(data.toolName ?? '')}: {String(data.text ?? '')}</span>
  if (event.kind === 'agent.end') return <strong>done</strong>
  return <span>{event.kind}</span>
}

export function AgentChat() {
  const client = useClient()
  const activeSessionId = useStore((s) => s.activeSessionId)
  const transcript = useStore((s) => (s.activeSessionId ? s.transcripts[s.activeSessionId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT))
  const setActiveSession = useStore((s) => s.setActiveSession)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!intent.trim()) return
    setBusy(true)
    try {
      const res = (await client.cmd('agent.author', { intent })) as { ok: boolean; sessionId?: string }
      if (res.ok && res.sessionId) setActiveSession(res.sessionId)
      setIntent('')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (activeSessionId) await client.cmd('agent.cancel', { sessionId: activeSessionId })
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid #ddd' }}>
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
        <span>Agent {activeSessionId ?? '(new)'}</span>
        {activeSessionId ? <button type="button" onClick={cancel}>Cancel</button> : null}
      </div>
      <ol style={{ flex: 1, overflowY: 'auto', margin: 0, padding: 8, fontSize: 13, listStyle: 'none' }}>
        {transcript.map((event) => (
          <li key={`${event.sessionId}-${event.idx ?? event.id}`}>{renderEvent(event)}</li>
        ))}
      </ol>
      <form onSubmit={send} style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid #eee' }}>
        <input
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Describe what to build…"
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </section>
  )
}
