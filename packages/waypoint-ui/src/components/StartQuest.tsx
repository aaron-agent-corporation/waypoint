import { useState } from 'react'

import { useClient } from '../engine/context'
import { useEngineCommand } from '../engine/useEngineCommand'
import { listField } from '../lib/engine'

interface CatalogQuest {
  readonly slug: string
  readonly name?: string
}

export function StartQuest() {
  const client = useClient()
  const { run, pending } = useEngineCommand()
  const [open, setOpen] = useState(false)
  const [quests, setQuests] = useState<CatalogQuest[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const openPicker = async () => {
    setOpen(true)
    if (quests === null) {
      try {
        const env = (await client.cmd('catalog.quests')) as { ok: boolean; error?: string; quests?: CatalogQuest[] }
        setQuests(listField<'quests', CatalogQuest[]>(env, 'catalog.quests', 'quests') ?? [])
      } catch {
        setQuests([])
      }
    }
  }

  const startSelected = async (slug: string) => {
    // install (workspace-wins) THEN start; a failed install rejects and skips start.
    await run('catalog.install', { quest: slug })
    await run('run.start', { quest: slug })
    setOpen(false)
    setSelected(null)
  }

  return (
    <div style={{ fontSize: 12 }}>
      {!open ? (
        <button type="button" onClick={openPicker}>Start quest</button>
      ) : (
        <div>
          {quests === null ? (
            <span>Loading quests…</span>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {quests.map((q) => (
                <li key={q.slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button type="button" onClick={() => setSelected(q.slug)} style={{ fontWeight: q.slug === selected ? 700 : 400 }}>
                    {q.name || q.slug}
                  </button>
                  {q.slug === selected ? (
                    <button type="button" disabled={pending} onClick={() => { startSelected(q.slug).catch(() => undefined) }}>
                      Confirm
                    </button>
                  ) : null}
                </li>
              ))}
              {quests.length === 0 ? <li>No quests.</li> : null}
            </ul>
          )}
          <button type="button" onClick={() => { setOpen(false); setSelected(null) }}>Close</button>
        </div>
      )}
    </div>
  )
}
