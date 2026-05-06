import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@waypoint/core': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'examples/**/*.test.ts',
    ],
  },
})
