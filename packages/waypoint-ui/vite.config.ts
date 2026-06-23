import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { resolveEngineTarget } from './src/engine/target'

const target = resolveEngineTarget(process.env, readFileSync)

if (!target) {
  // eslint-disable-next-line no-console
  console.warn(
    '[waypoint-ui] No engine handshake found. Set WAYPOINT_ENGINE_HANDSHAKE to the engine host handshake file and start the engine host. The proxy is inert until then.',
  )
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: target
      ? {
          '/cmd': {
            target: target.url,
            changeOrigin: true,
            headers: { authorization: `Bearer ${target.token}` },
          },
          '/ws': {
            target: target.url,
            ws: true,
            changeOrigin: true,
            headers: { authorization: `Bearer ${target.token}` },
          },
        }
      : undefined,
  },
})
