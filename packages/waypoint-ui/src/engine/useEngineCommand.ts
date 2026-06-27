import { useCallback, useState } from 'react'

import { useClient } from './context'
import { listField } from '../lib/engine'
import { useStore } from '../store'

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useEngineCommand(): {
  run: (name: string, payload?: unknown, opts?: { field?: string }) => Promise<unknown>
  pending: boolean
} {
  const client = useClient()
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (name: string, payload?: unknown, opts?: { field?: string }): Promise<unknown> => {
      setPending(true)
      try {
        const env = (await client.cmd(name, payload)) as { ok: boolean; error?: string }
        const value = opts?.field ? listField(env, name, opts.field) : (assertOk(env, name), env)
        useStore.getState().bumpRoutesEpoch()
        useStore.getState().setControlError(null)
        return value
      } catch (err) {
        useStore.getState().setControlError(toMessage(err))
        throw err
      } finally {
        setPending(false)
      }
    },
    [client],
  )

  return { run, pending }
}

/** Throw on a non-ok envelope when no field is requested. */
function assertOk(env: { ok: boolean; error?: string }, name: string): void {
  if (!env.ok) throw new Error(env.error ?? `${name} failed`)
}
