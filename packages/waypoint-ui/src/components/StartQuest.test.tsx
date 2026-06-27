import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClientProvider } from '../engine/context'
import { StartQuest } from './StartQuest'
import { FakeEngineClient } from '../test/fake-client'
import { useStore } from '../store'

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

function renderWith(client: FakeEngineClient) {
  return render(<ClientProvider client={client}><StartQuest /></ClientProvider>)
}

describe('StartQuest', () => {
  it('lists catalog quests, then installs and starts on confirm in order', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'add-tests', name: 'Add Tests' }], warnings: [] } as never
    client.responses['catalog.install'] = { ok: true, action: 'catalog.install', quest: { slug: 'add-tests' }, recipes: [], installedQuestPaths: [], installedRecipePaths: [] } as never
    client.responses['run.start'] = { ok: true, action: 'run.start', route: { id: 'route-9' } } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Add Tests')
    fireEvent.click(screen.getByText('Add Tests'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const names = client.calls.map((c) => c.name)
      expect(names).toContain('catalog.install')
      expect(names).toContain('run.start')
      expect(names.indexOf('catalog.install')).toBeLessThan(names.indexOf('run.start'))
    })
    expect(client.calls.find((c) => c.name === 'run.start')?.payload).toEqual({ quest: 'add-tests' })
  })

  it('does not start when install fails', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'add-tests', name: 'Add Tests' }], warnings: [] } as never
    client.responses['catalog.install'] = { ok: false, action: 'catalog.install', error: 'install boom' } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Add Tests')
    fireEvent.click(screen.getByText('Add Tests'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(useStore.getState().controlError).toBe('install boom'))
    expect(client.calls.some((c) => c.name === 'run.start')).toBe(false)
  })

  it('starts an authored-only quest: calls catalog.install then run.start (no-op install)', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = {
      ok: true,
      action: 'catalog.quests',
      quests: [{ slug: 'authored-quest', name: 'Authored Quest' }],
      warnings: [],
    } as never
    // Authored-only install: no-op (empty installedQuestPaths / installedRecipePaths)
    client.responses['catalog.install'] = {
      ok: true,
      action: 'catalog.install',
      quest: { slug: 'authored-quest' },
      recipes: [],
      installedQuestPaths: [],
      installedRecipePaths: [],
    } as never
    client.responses['run.start'] = { ok: true, action: 'run.start', route: { id: 'route-10' } } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Authored Quest')
    fireEvent.click(screen.getByText('Authored Quest'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const names = client.calls.map((c) => c.name)
      expect(names).toContain('catalog.install')
      expect(names).toContain('run.start')
      expect(names.indexOf('catalog.install')).toBeLessThan(names.indexOf('run.start'))
    })
    expect(client.calls.find((c) => c.name === 'catalog.install')?.payload).toEqual({ quest: 'authored-quest' })
    expect(client.calls.find((c) => c.name === 'run.start')?.payload).toEqual({ quest: 'authored-quest' })
  })

  it('surfaces catalog.quests fetch error to controlError', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: false, action: 'catalog.quests', error: 'quests boom' } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))

    await waitFor(() => expect(useStore.getState().controlError).toBe('quests boom'))
  })

  it('shows quests-error line when catalog.quests fails, not a false-empty state', async () => {
    const client = new FakeEngineClient()
    client.responses['catalog.quests'] = { ok: false, action: 'catalog.quests', error: 'quests boom' } as never

    renderWith(client)
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))

    expect(await screen.findByText(/Failed to load quests: quests boom/)).toBeInTheDocument()
    expect(screen.queryByText('No quests.')).toBeNull()
  })

  it('re-fetches catalog.quests after recipesEpoch advances (cache invalidation on approval)', async () => {
    const client = new FakeEngineClient()
    // First fetch: one quest; second fetch (after epoch bump): two quests
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'quest-a', name: 'Quest A' }], warnings: [] } as never

    renderWith(client)
    // Open picker — triggers first fetch
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Quest A')
    const firstFetchCount = client.calls.filter((c) => c.name === 'catalog.quests').length
    expect(firstFetchCount).toBe(1)

    // Close picker
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // Simulate approval adding a new quest to the catalog
    client.responses['catalog.quests'] = { ok: true, action: 'catalog.quests', quests: [{ slug: 'quest-a', name: 'Quest A' }, { slug: 'quest-b', name: 'Quest B' }], warnings: [] } as never

    // Bump recipesEpoch (what author.approveProposal now does)
    act(() => { useStore.getState().bumpRecipesEpoch() })

    // Re-open picker — must trigger a fresh fetch
    fireEvent.click(screen.getByRole('button', { name: /start quest/i }))
    await screen.findByText('Quest B')

    const secondFetchCount = client.calls.filter((c) => c.name === 'catalog.quests').length
    expect(secondFetchCount).toBe(2)
  })
})
