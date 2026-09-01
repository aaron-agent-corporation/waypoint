/**
 * The VM conformance floor, live against fly-sprites — the item-43 revival
 * (S2, item 52; docs/designs/sprite-worker-isolation.md).
 *
 * Item 43 (D12) shelved the microsandbox VM tier because its env-gated suites
 * had never run in a recorded evidence run — an unproven claim. This suite is
 * the revival point exercised: the SAME conformance contract (deny-by-default
 * egress, host-secret isolation, raw-IP denial, workspace round-trip), run
 * against the tier that is actually live, writing a lifecycle witness file
 * into deploy/sandbox/provider-admission/ so the run IS recorded evidence.
 *
 * Two layers:
 *   - always-on: the admission boundary refuses unverifiable construction —
 *     no record, no egress allowlist, no provider. Runs in every suite pass.
 *   - live (WAYPOINT_SPRITES_LIVE=1 + SPRITES_TOKEN): the full admitted
 *     lifecycle on a scratch conformance sprite. Opt-in because it spends
 *     real sprite minutes; the gate is named here so a skip reads as
 *     "not attempted this run", never as a passing floor.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  REQUIRED_PROBES,
  canonicalizeSandboxEgressAllowlist,
  guestWorkspacePath,
  policyHashForEgress,
} from '../provider.ts'
import {
  createCloudProjectSandboxProvider,
  loadSandboxAdmissionRecord,
  qualificationEvidenceProblem,
} from './cloud.ts'
import { FlySpritesProjectSandboxProvider } from './fly-sprites.ts'

const LIVE = process.env.WAYPOINT_SPRITES_LIVE === '1' && (process.env.SPRITES_TOKEN ?? '').trim() !== ''
const EGRESS = canonicalizeSandboxEgressAllowlist(['api.openai.com'])
const ADMISSION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../deploy/sandbox/provider-admission',
)

describe('fly-sprites VM conformance floor (item-43 revival)', () => {
  it('the floor itself is non-trivial: every boundary the probes exist to hold is required', () => {
    // The contract the live half proves. If a probe leaves this set, the
    // conformance claim narrows and this assertion makes that reviewable.
    expect(Object.keys(REQUIRED_PROBES).sort()).toEqual(
      [
        'allowlisted-model-egress',
        'denied-host-egress',
        'forged-managed-start',
        'host-home-secret-read',
        'managed-host-fallback',
        'manager-brief-read',
        'other-project-read',
        'parallel-write-collision',
        'portfolio-store-read',
        'raw-ip-egress',
      ].sort(),
    )
  })

  it('refuses production construction without an admission record', () => {
    expect(() =>
      createCloudProjectSandboxProvider('fly-sprites', {
        token: 'x',
        egressAllow: EGRESS,
        admissionPath: '/tmp/does-not-exist-admission.json',
      }),
    ).toThrow(/cannot read admission record/)
  })

  it('refuses production construction with no egress allowlist — empty is unrestricted, never deny', () => {
    expect(() => createCloudProjectSandboxProvider('fly-sprites', { token: 'x' })).toThrow(/no egress allowlist/)
  })

  it('refuses a direct construction with no token — never invent live evidence', () => {
    const token = process.env.SPRITES_TOKEN
    const priorFile = process.env.SPRITES_TOKEN_FILE
    delete process.env.SPRITES_TOKEN
    // Nowhere: the operator's installed token file must not satisfy this.
    process.env.SPRITES_TOKEN_FILE = '/nonexistent/sprites-token'
    try {
      expect(() => new FlySpritesProjectSandboxProvider({ egressAllow: EGRESS })).toThrow(/no Sprites token/)
    } finally {
      if (token !== undefined) process.env.SPRITES_TOKEN = token
      if (priorFile === undefined) delete process.env.SPRITES_TOKEN_FILE
      else process.env.SPRITES_TOKEN_FILE = priorFile
    }
  })

  it.runIf(LIVE)(
    'admitted lifecycle: create → conformance floor → enter → pull-back → stop, witnessed',
    async () => {
      // Admission first: the committed record must verify (digest re-checked,
      // floor re-checked) before anything live is touched.
      const admission = loadSandboxAdmissionRecord()
      expect(admission.selected_provider).toBe('fly-sprites')

      const provider = createCloudProjectSandboxProvider('fly-sprites', { egressAllow: EGRESS })
      // pullGuestPaths is fly-sprites-specific (the interface has no pull);
      // the admitted production provider IS a FlySpritesProjectSandboxProvider.
      expect(provider).toBeInstanceOf(FlySpritesProjectSandboxProvider)
      const sprites = provider as FlySpritesProjectSandboxProvider
      const scratch = await mkdtemp(path.join(tmpdir(), 'sprites-conformance-'))
      try {
        const state = await sprites.create({
          project_id: 'prj_conformance',
          project_root: scratch,
          image_digest: `localhost/waypoint/conformance@sha256:${'0'.repeat(64)}`,
          policy_hash: policyHashForEgress(EGRESS),
          mount_hash: 'c'.repeat(64),
          workspace_id: 'ws-conformance',
        })

        // The floor, live. verify() throws unless every required probe lands
        // in its admitted set; the explicit re-check below keeps the assertion
        // in the test, not only inside the provider.
        const verification = await sprites.verify(state)
        expect(qualificationEvidenceProblem(JSON.parse(JSON.stringify(verification)))).toBeUndefined()

        // Enter round-trip.
        const entered = await sprites.enter(state, {
          argv: ['/bin/sh', '-lc', 'mkdir -p /work/conformance && printf conformance-pull-payload > /work/conformance/canary.txt && printf enter-ok'],
        })
        expect(entered.exit_code).toBe(0)
        expect(entered.stdout).toContain('enter-ok')

        // Pull-back — the S1 result-return leg, live: only named guest paths
        // come home, as a tar stream.
        const pulled = await sprites.pullGuestPaths(state, {
          mountPath: '/work',
          relPaths: ['conformance/canary.txt'],
        })
        expect(pulled).not.toBeNull()
        expect(pulled!.toString('latin1')).toContain('conformance-pull-payload')

        // L2 shared-lane hygiene, live. The project's slug dir under the mount
        // base is the whole workspace world: wipe-before-sync means a
        // host-deleted file can never resurrect (the S2 additive finding),
        // delete-after-pull means nothing lingers, and the bare base refuses.
        const slugDir = guestWorkspacePath('/work', 'prj_conformance')
        const hostWs = path.join(scratch, 'ws')
        await mkdir(hostWs, { recursive: true })
        await writeFile(path.join(hostWs, 'kept.txt'), 'kept', 'utf8')
        const plant = await sprites.enter(state, {
          argv: ['/bin/sh', '-lc', `mkdir -p ${slugDir} && printf stale > ${slugDir}/stale.txt`],
        })
        expect(plant.exit_code).toBe(0)
        await sprites.syncProjectWorkspace(state, { projectRoot: hostWs, mountPath: slugDir })
        const hygiene = await sprites.enter(state, {
          argv: ['/bin/sh', '-lc', `[ -f ${slugDir}/kept.txt ] && [ ! -e ${slugDir}/stale.txt ] && printf no-resurrection`],
        })
        expect(hygiene.exit_code).toBe(0)
        expect(hygiene.stdout).toContain('no-resurrection')

        await expect(sprites.deleteGuestWorkspace(state, { guestPath: '/work' })).rejects.toThrow(
          /guest wipe refused/,
        )
        await sprites.deleteGuestWorkspace(state, { guestPath: slugDir })
        const gone = await sprites.enter(state, {
          argv: ['/bin/sh', '-lc', `[ ! -e ${slugDir} ] && printf deleted`],
        })
        expect(gone.exit_code).toBe(0)
        expect(gone.stdout).toContain('deleted')

        // Ensure-install: fresh → installed; unchanged → verified (marker AND
        // tree); a missing required file over a matching marker → reinstalls.
        const bundleDir = path.join(scratch, 'bundle')
        await mkdir(bundleDir, { recursive: true })
        await writeFile(path.join(bundleDir, 'bundle.mjs'), '// live hygiene bundle', 'utf8')
        const revision = `sha256:${createHash('sha256').update('l2-hygiene-bundle').digest('hex')}`
        const bundleGuest = `${slugDir}-bundle`
        const ensureInput = {
          hostDist: bundleDir,
          guestPath: bundleGuest,
          revision,
          requiredFiles: ['bundle.mjs'],
        }
        expect(await sprites.ensureGuestBundle(state, ensureInput)).toBe('installed')
        expect(await sprites.ensureGuestBundle(state, ensureInput)).toBe('verified')
        const corrupt = await sprites.enter(state, {
          argv: ['/bin/sh', '-lc', `rm ${bundleGuest}/bundle.mjs`],
        })
        expect(corrupt.exit_code).toBe(0)
        expect(await sprites.ensureGuestBundle(state, ensureInput)).toBe('installed')
        await sprites.deleteGuestWorkspace(state, { guestPath: bundleGuest })

        await sprites.stop(state)

        const witness = {
          schema_version: 1,
          suite: 'fly-sprites.live.test.ts (item-43 revival)',
          provider: admission.selected_provider,
          qualification_digest: admission.qualification_digest,
          sandbox_instance_id: state.sandbox_instance_id,
          sandbox_name: state.sandbox_name,
          probes: verification.probes,
          steps: [
            { name: 'admission-verify', verdict: 'pass' },
            { name: 'create', verdict: 'pass' },
            { name: 'conformance-floor', verdict: 'pass' },
            { name: 'enter', verdict: 'pass' },
            { name: 'pull-back', verdict: 'pass' },
            { name: 'hygiene-no-resurrection', verdict: 'pass' },
            { name: 'hygiene-bare-base-refusal', verdict: 'pass' },
            { name: 'hygiene-delete-after-pull', verdict: 'pass' },
            { name: 'hygiene-ensure-tree-probe', verdict: 'pass' },
            { name: 'stop', verdict: 'pass' },
          ],
          observed_at: new Date().toISOString(),
        }
        await writeFile(
          path.join(ADMISSION_DIR, 'conformance-lifecycle.json'),
          `${JSON.stringify(witness, null, 2)}\n`,
          'utf8',
        )
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
    300_000,
  )
})
