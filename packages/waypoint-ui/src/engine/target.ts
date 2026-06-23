export interface EngineTarget {
  url: string
  token: string
}

/**
 * Resolve the engine loopback target from the handshake file the engine host
 * writes (see engine-host bin.ts). Returns null (no magic default) when the env
 * var is unset or the file is missing/malformed — the proxy then stays inert and
 * the UI shows an "engine not reachable" state.
 */
export function resolveEngineTarget(
  env: NodeJS.ProcessEnv,
  readFileSync: (path: string, encoding: 'utf8') => string,
): EngineTarget | null {
  const handshakePath = env.WAYPOINT_ENGINE_HANDSHAKE
  if (!handshakePath) return null
  try {
    const parsed = JSON.parse(readFileSync(handshakePath, 'utf8')) as { url?: unknown; token?: unknown }
    if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string') return null
    return { url: parsed.url, token: parsed.token }
  } catch {
    return null
  }
}
