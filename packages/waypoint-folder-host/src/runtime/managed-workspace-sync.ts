import { spawn } from 'node:child_process'

import { DEFAULT_MOUNT_PATH } from '../sandbox/runtime.ts'
import type { ProjectSandboxBinding, ProjectSandboxProvider } from '../sandbox/provider.ts'
import { FlySpritesProjectSandboxProvider } from '../sandbox/providers/fly-sprites.ts'

/**
 * Stage the project tree at `mountPath` inside a cloud sprite before enter.
 * Fly-sprites has no bind mounts; without this step `cd /work` fails closed.
 */
export async function stageManagedWorkspaceForEnter(
  provider: ProjectSandboxProvider,
  binding: ProjectSandboxBinding,
  projectRoot: string,
  mountPath: string = DEFAULT_MOUNT_PATH,
): Promise<void> {
  if (binding.provider === 'fly-sprites') {
    await (provider as FlySpritesProjectSandboxProvider).syncProjectWorkspace(binding, {
      projectRoot,
      mountPath,
    })
  }
}

/**
 * Pull the attempt's results home after enter (S1 finding: the guide synced
 * host→guest and then read the claim from the host tree — nothing ever came
 * back; sprites have no bind mounts). `relPaths` is the granted return
 * surface — the claim file plus the task's rw-granted roots — so this leg
 * enforces the same write confinement the jail does: a guest write outside it
 * never lands on the host. Extraction relies on bsdtar/GNU tar's default
 * refusal of absolute and `..` member names (no -P is ever passed).
 *
 * Providers without a pull seam (fake, injected test doubles) are a no-op —
 * their enter() writes host-side directly.
 */
export async function pullManagedResultsAfterEnter(
  provider: ProjectSandboxProvider,
  binding: ProjectSandboxBinding,
  projectRoot: string,
  mountPath: string,
  relPaths: readonly string[],
): Promise<void> {
  if (binding.provider !== 'fly-sprites') return
  const sprites = provider as FlySpritesProjectSandboxProvider
  if (typeof sprites.pullGuestPaths !== 'function') return
  const tarBuffer = await sprites.pullGuestPaths(binding, { mountPath, relPaths })
  if (tarBuffer !== null) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xf', '-', '-C', projectRoot], { stdio: ['pipe', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else {
          // "Unrecognized archive format" (route-008/-009, intermittent) means
          // the FIRST bytes are wrong, not that the stream truncated — so name
          // what actually arrived: length plus a bounded head preview (a valid
          // tar's head is the first entry's PATH, and garbage here is shell
          // profile noise or a transport error frame — diagnostic, not case
          // content).
          const head = tarBuffer.subarray(0, 64)
          const printable = head.toString('latin1').replace(/[^\x20-\x7e]/g, '.')
          reject(
            new Error(
              `managed result pull: host tar extract exited ${code}${stderr ? `: ${stderr.trim()}` : ''} ` +
                `(received ${tarBuffer.length} bytes; head: "${printable}")`,
            ),
          )
        }
      })
      child.stdin.end(tarBuffer)
    })
  }

  // Delete-after-pull (L2): the attempt is over and its results are home (or
  // there were none) — the workspace must not linger on a warm shared sprite.
  // A delete failure is loud but never fails the finished attempt: the next
  // attempt's wipe-before-sync clears any residue. A pull THROW above skips
  // this on purpose — the failed attempt's workspace stays for forensics.
  if (typeof sprites.deleteGuestWorkspace === 'function') {
    try {
      await sprites.deleteGuestWorkspace(binding, { guestPath: mountPath })
    } catch (error) {
      console.error(
        `managed result pull: delete-after-pull failed for ${mountPath} on ${binding.sandbox_name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
