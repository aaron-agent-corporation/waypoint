import { createContext, useContext, type ReactNode } from 'react'

import type { BrowserEngineClient } from './client'

const ClientContext = createContext<BrowserEngineClient | null>(null)

export function ClientProvider({ client, children }: { client: BrowserEngineClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useClient(): BrowserEngineClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('useClient must be used within a ClientProvider')
  return client
}
