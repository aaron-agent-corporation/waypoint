import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@waypoint/core': resolve(__dirname, 'src/index.ts'),
      '@waypoint/folder-host': resolve(__dirname, 'packages/waypoint-folder-host/src/index.ts'),
      '@waypoint/cli': resolve(__dirname, 'packages/waypoint-cli/src/index.ts'),
      '@waypoint/engine-host': resolve(__dirname, 'packages/waypoint-engine-host/src/index.ts'),
      '@waypoint/pi-extension': resolve(__dirname, 'packages/waypoint-pi-extension/src/index.ts'),
    },
  },
  test: {
    testTimeout: 30000,
    include: [
      'src/**/*.test.ts',
      'examples/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
  },
})
