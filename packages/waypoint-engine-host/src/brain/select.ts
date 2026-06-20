import { FakeBrainAdapter } from './fake-adapter.ts'
import { PiCliBrainAdapter } from './pi-cli-adapter.ts'
import { piVersionOk, PI_PINNED_RANGE, type VersionProbe } from './pi-version.ts'
import type { BrainAdapterFactory } from './brain-adapter.ts'

export type BrainKind = 'pi' | 'fake'

export interface BrainSelection {
  readonly factory: BrainAdapterFactory
  readonly brain: BrainKind
  readonly version?: string
}

export interface SelectBrainOptions {
  /** The `WAYPOINT_BRAIN` value (`'pi'` selects the real Pi adapter). */
  readonly brain?: string
  /** Path to the built Waypoint Pi extension (`WAYPOINT_PI_EXTENSION`). */
  readonly piExtensionPath?: string
  /** Injectable `pi --version` probe (tests). */
  readonly versionProbe?: VersionProbe
}

/**
 * Fail-loud brain selection. `WAYPOINT_BRAIN=pi` REQUIRES a present, in-range
 * `pi` CLI and an extension path — a missing/mismatched `pi` throws a
 * problem+cause+fix error rather than silently falling back to the fake
 * (MAR Contract Lock / decision 9). Anything else selects the FakeBrainAdapter.
 */
export function selectBrain(options: SelectBrainOptions): BrainSelection {
  if (options.brain === 'pi') {
    const probe = options.versionProbe
    const { ok, version } = probe ? piVersionOk(probe) : piVersionOk()
    if (!ok) {
      throw new Error(
        `WAYPOINT_BRAIN=pi but the 'pi' CLI is ${version ? `version ${version}` : 'not available'}.\n` +
          `Cause: the Pi brain requires a pi CLI in the ${PI_PINNED_RANGE} range on PATH.\n` +
          `Fix: install the pinned pi (npm i -g @mariozechner/pi-coding-agent@${PI_PINNED_RANGE}) ` +
          `or unset WAYPOINT_BRAIN to use the fake brain.`,
      )
    }
    if (!options.piExtensionPath) {
      throw new Error(
        'WAYPOINT_BRAIN=pi but WAYPOINT_PI_EXTENSION is unset.\n' +
          'Cause: the Pi adapter must load the Waypoint extension that registers the granted tools.\n' +
          "Fix: build the workspace (pnpm build) and set WAYPOINT_PI_EXTENSION to packages/waypoint-pi-extension/dist/index.js.",
      )
    }
    const extensionPath = options.piExtensionPath
    const factory: BrainAdapterFactory = {
      forSession: (conn) => new PiCliBrainAdapter({ hostUrl: conn.hostUrl, hostToken: conn.hostToken, extensionPath }),
    }
    return { factory, brain: 'pi', ...(version ? { version } : {}) }
  }

  return { factory: new FakeBrainAdapter({ events: [], result: { status: 'completed' } }), brain: 'fake' }
}
