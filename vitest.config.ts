import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@waypoint-engine/core': resolve(import.meta.dirname, 'src/index.ts'),
      '@waypoint-engine/folder-host': resolve(import.meta.dirname, 'packages/waypoint-folder-host/src/index.ts'),
      '@waypoint-engine/cli': resolve(import.meta.dirname, 'packages/waypoint-cli/src/index.ts'),
      '@waypoint-engine/kernel': resolve(import.meta.dirname, 'packages/waypoint-kernel/src/index.ts'),
    },
  },
  test: {
    // Drops every per-project schema this run creates. Without it the local
    // Postgres accretes one schema per temp project forever — 6,664 of them
    // and 525,817 relations by 2026-08-22, enough catalog pressure to fail
    // the suite with "out of shared memory". See testing/schema-reaper.ts.
    // Drops each test file's per-project schemas as it finishes. Without it
    // the local Postgres accretes one schema per temp project forever —
    // 6,664 of them and 525,817 relations by 2026-08-22.
    setupFiles: ['./packages/waypoint-folder-host/src/testing/schema-reaper.ts'],
    testTimeout: 30000,
    // The schema reaper runs in `afterAll` and issues one round trip per
    // schema the file created. Under vitest's default 10s hook timeout a
    // heavy file's teardown is KILLED PART-WAY: the schemas it had not yet
    // reached are stranded, and the run reports nothing, because a timed-out
    // hook aborts the reaper before its own failure report can print. That is
    // how 2,034 residual schemas accumulated with a reaper installed.
    // Teardown gets the same budget as a test.
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // Postgres allows 100 connections; this machine has 18 cores. At full
    // parallelism the pg-heavy files exhaust the connection slots and the lock
    // table, and the SAME SUITE reported 15 failures idle and 294 under load —
    // failure counts stopped being evidence. Six workers is the cap that makes
    // a run's result reproducible, which is the whole point of Phase 0. Raise
    // it only with a connection-count argument.
    // (Top-level since vitest 4; `poolOptions.threads.maxThreads` was removed.)
    maxWorkers: 6,
    minWorkers: 1,
    include: [
      'src/**/*.test.ts',
      'examples/**/*.test.ts',
      'packages/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    // Sibling git worktrees checked out inside the repo (`.worktrees/`, and the
    // `.claude/worktrees/` ones) hold whole second copies of the tree, including
    // older branches that still carry `archive/`. Collecting their test files
    // inflates the failure count and makes regression comparison meaningless.
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/archive/**',
    ],
  },
})
