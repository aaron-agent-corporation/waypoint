import { useEffect, useState, type ReactNode } from 'react'

import { useClient } from '../engine/context'

export function ConnectionGate({ children }: { children: ReactNode }) {
  const client = useClient()
  const [workspaceOpen, setWorkspaceOpen] = useState<boolean | null>(null)
  const [brain, setBrain] = useState<string | null>(null)
  const [root, setRoot] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refreshHealth() {
    const health = (await client.cmd('meta.health')) as { ok: boolean; workspaceOpen?: boolean; brain?: string }
    if (!health.ok) {
      setError('Engine not reachable — start the engine host first.')
      return
    }
    setBrain(health.brain ?? null)
    setWorkspaceOpen(Boolean(health.workspaceOpen))
  }

  useEffect(() => {
    void refreshHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  async function openWorkspace(e: React.FormEvent) {
    e.preventDefault()
    const res = (await client.cmd('workspace.open', { root, backend: 'folder' })) as {
      ok: boolean
      error?: string
      details?: { message?: string }
    }
    if (res.ok) {
      setError(null)
      setWorkspaceOpen(true)
    } else {
      setError(res.details?.message ?? res.error ?? 'workspace.open failed')
    }
  }

  if (error && workspaceOpen === null) return <div role="alert">{error}</div>
  if (workspaceOpen === null) return <div>Connecting…</div>

  if (!workspaceOpen) {
    return (
      <form onSubmit={openWorkspace} style={{ padding: 24 }}>
        <h2>Open a Waypoint workspace</h2>
        <label>
          Workspace path
          <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/path/to/project" />
        </label>
        <button type="submit">Open</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: '4px 12px', borderBottom: '1px solid #ddd', fontSize: 12 }}>
        Waypoint · brain: <strong>{brain ?? 'unknown'}</strong>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  )
}
