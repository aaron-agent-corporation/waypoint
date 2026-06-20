import { mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEngineHost } from '../core/engine-host.ts'
import { piAvailable } from './pi-version.ts'
import { selectBrain } from './select.ts'

// Built extension dist (produced by `pnpm build`). Required for a real pi run.
const EXTENSION_PATH = resolve(import.meta.dirname, '../../../waypoint-pi-extension/dist/index.js')

/**
 * Real-Pi end-to-end. Gated on BOTH a present `pi` CLI and an explicit opt-in
 * (`WAYPOINT_PI_E2E=1`) because it spawns the real agent and makes live model
 * calls (costs tokens + needs provider credentials). Structural assertions only.
 * Run with: `pnpm build && WAYPOINT_PI_E2E=1 pnpm vitest run integration.pi`.
 */
function realPiE2eEnabled(): boolean {
  return piAvailable() && process.env.WAYPOINT_PI_E2E === '1' && existsSync(EXTENSION_PATH)
}

describe.runIf(realPiE2eEnabled())('PiCliBrainAdapter real e2e', () => {
  it('drives a real pi session that returns a terminal result', async () => {
    const selection = selectBrain({ brain: 'pi', piExtensionPath: EXTENSION_PATH })
    expect(selection.brain).toBe('pi')

    const host = createEngineHost({ brainAdapterFactory: selection.factory, brain: 'pi', ...(selection.version ? { brainVersion: selection.version } : {}) })
    await host.start()
    try {
      const root = await mkdtemp(join(tmpdir(), 'wp-pi-e2e-'))
      await host.dispatch('workspace.open', { root, backend: 'folder' })
      const result = (await host.dispatch('agent.run', {
        intent: 'List the available catalog quests using your tools, then stop.',
      })) as Record<string, unknown>
      expect(result.ok).toBe(true)
      expect(typeof result.sessionId).toBe('string')
      expect(['completed', 'error', 'cancelled']).toContain(result.status)
    } finally {
      await host.stop()
    }
  }, 120_000)
})
