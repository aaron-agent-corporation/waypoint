import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

/**
 * Clear a Quest's `not_yet_available` marker in an initialized test project.
 *
 * D5 (2026-08-24) refuses to start a Quest that has never been proven end to
 * end, and several suites drive the generic machinery — autopilot, resume —
 * through `referral-package`, which is one of them. Those tests are about the
 * machinery, not about the Quest's readiness, so they say so here rather than
 * the product growing a bypass flag: the ONLY way to start an unavailable
 * Quest is to edit the manifest, and a test that does it does it in the open.
 */
export async function clearQuestAvailabilityForTest(projectRoot: string, slug: string): Promise<void> {
  const path = join(projectRoot, '.waypoint/quests', `${slug}.yaml`)
  const manifest = yamlParse(await readFile(path, 'utf8')) as Record<string, unknown>
  const metadata = (manifest.metadata ?? {}) as Record<string, unknown>
  const runner = (metadata.runner ?? {}) as Record<string, unknown>
  if (runner.availability === undefined) return
  delete runner.availability
  await writeFile(path, yamlStringify({ ...manifest, metadata: { ...metadata, runner } }), 'utf8')
}
