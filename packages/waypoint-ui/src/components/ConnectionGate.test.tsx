import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { FakeEngineClient } from '../test/fake-client'
import { ConnectionGate } from './ConnectionGate'

function renderGate(client: FakeEngineClient) {
  return render(
    <ClientProvider client={client}>
      <ConnectionGate>
        <div data-testid="console">CONSOLE</div>
      </ConnectionGate>
    </ClientProvider>,
  )
}

describe('ConnectionGate', () => {
  it('renders children once a workspace is open', async () => {
    const client = new FakeEngineClient()
    client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: true, brain: 'fake' }
    renderGate(client)
    expect(await screen.findByTestId('console')).toBeInTheDocument()
  })

  it('shows an open-workspace form when none is open and opens on submit', async () => {
    const client = new FakeEngineClient()
    client.responses['meta.health'] = { ok: true, action: 'meta.health', workspaceOpen: false, brain: 'fake' }
    client.responses['workspace.open'] = { ok: true, action: 'workspace.open', workspace: { root: '/x', backend: 'folder', initialized: true } }
    renderGate(client)
    const input = await screen.findByLabelText(/workspace path/i)
    await userEvent.type(input, '/tmp/project')
    await userEvent.click(screen.getByRole('button', { name: /open/i }))
    await waitFor(() => expect(client.calls.find((c) => c.name === 'workspace.open')).toBeTruthy())
    expect(await screen.findByTestId('console')).toBeInTheDocument()
  })
})
