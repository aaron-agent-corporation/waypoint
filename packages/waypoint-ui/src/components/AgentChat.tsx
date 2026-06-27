import { useState } from 'react'

import { useClient } from '../engine/context'
import { useEngineCommand } from '../engine/useEngineCommand'
import { useStore } from '../store'
import type { AgentEventRecord } from '../engine/types'
import { ConfirmAction } from './ConfirmAction'

const EMPTY_TRANSCRIPT: AgentEventRecord[] = []

function renderEvent(event: AgentEventRecord) {
  const data = event.data ?? {}
  if (event.kind === 'agent.message') return <em>{String(data.text ?? '')}</em>
  if (event.kind === 'agent.toolcall') return <span>→ tool: {String(data.toolName ?? '')}</span>
  if (event.kind === 'agent.end') return <strong>done</strong>
  return <span>{event.kind}</span>
}

function proposalIdOf(data: { toolName?: unknown; text?: unknown }): string | null {
  if (typeof data?.text !== 'string') return null
  try {
    const parsed = JSON.parse(data.text) as { proposalId?: unknown }
    return typeof parsed.proposalId === 'string' ? parsed.proposalId : null
  } catch {
    return null
  }
}

export function AgentChat() {
  const client = useClient()
  const activeSessionId = useStore((s) => s.activeSessionId)
  const transcript = useStore((s) => (s.activeSessionId ? s.transcripts[s.activeSessionId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT))
  const setActiveSession = useStore((s) => s.setActiveSession)
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [approvedProposalIds, setApprovedProposalIds] = useState<Set<string>>(() => new Set())
  const approve = useEngineCommand()

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
        {transcript.map((event) => {
          const data = event.data ?? {}
          if (event.kind === 'agent.tool_result') {
            const pid = proposalIdOf(data)
            return (
              <li key={`${event.sessionId}-${event.idx ?? event.id}`}>
                <span>← {String(data.toolName ?? '')}: {String(data.text ?? '')}</span>
                {pid ? (
                  approvedProposalIds.has(pid) ? (
                    <span style={{ color: '#666' }}>Proposal approved</span>
                  ) : (
                    <ConfirmAction
                      label="Approve proposal"
                      confirmLabel="Confirm"
                      disabled={approve.pending}
                      onConfirm={() => void approve.run('author.approveProposal', { id: pid }).then(() => {
                        setApprovedProposalIds((prev) => new Set(prev).add(pid))
                      })}
                    />
                  )
                ) : null}
              </li>
            )
          }
          return <li key={`${event.sessionId}-${event.idx ?? event.id}`}>{renderEvent(event)}</li>
        })}
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
