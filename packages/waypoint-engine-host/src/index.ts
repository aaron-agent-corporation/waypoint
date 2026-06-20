const WAYPOINT_CORE_PACKAGE = 'waypoint-core'

export const WAYPOINT_ENGINE_HOST_PACKAGE = '@waypoint/engine-host'

export interface EngineHostInfo {
  readonly packageName: typeof WAYPOINT_ENGINE_HOST_PACKAGE
  readonly corePackage: typeof WAYPOINT_CORE_PACKAGE
}

export function getEngineHostInfo(): EngineHostInfo {
  return {
    packageName: WAYPOINT_ENGINE_HOST_PACKAGE,
    corePackage: WAYPOINT_CORE_PACKAGE,
  }
}

export { createEngineHost } from './core/engine-host.ts'
export type { EngineHost, EngineHostConfig, EngineContext } from './core/engine-host.ts'
export { AGENT_TOOL_GRANT } from './core/commands/agent.ts'

// Brain (agent driver) public surface — Task 9 / slice 2.
export type { BrainAdapter, BrainAdapterFactory, BrainEvent, BrainResult, BrainRunInput } from './brain/brain-adapter.ts'
export { FakeBrainAdapter } from './brain/fake-adapter.ts'
export type { FakeBrainScript } from './brain/fake-adapter.ts'
export { PiCliBrainAdapter, buildPiArgs } from './brain/pi-cli-adapter.ts'
export type { PiCliBrainAdapterOptions, SpawnFn } from './brain/pi-cli-adapter.ts'
export { PiStreamDecoder, extractBrainResult } from './brain/pi-stream-decoder.ts'
export { PI_PINNED_RANGE, piAvailable, piVersionOk } from './brain/pi-version.ts'
export { selectBrain } from './brain/select.ts'
export type { BrainKind, BrainSelection, SelectBrainOptions } from './brain/select.ts'
export type { AgentEventRecord } from './types.ts'
export { createEngineClient } from './client.ts'
export type { EngineClient, EngineClientConfig } from './client.ts'
export { startEngineHostFromEnv } from './bin.ts'
export type { EngineHostHandle } from './bin.ts'
export { ok, fail, EngineError } from './envelope.ts'
export type {
  EngineBackend,
  EngineEnvelope,
  EngineSuccessEnvelope,
  EngineErrorCode,
  EngineErrorDetails,
  EngineEvent,
} from './types.ts'
export type { Transport, TransportStartResult } from './transport/transport.ts'
