import { stat } from 'node:fs/promises'
import path from 'node:path'

import { resolveAccessRoots, type AccessRoot, type AccessMapInput } from '../seatbelt/jail.ts'

/** The path's kind, or null when it does not exist. */
async function kindOf(p: string): Promise<'dir' | 'file' | null> {
  try {
    return (await stat(p)).isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

/**
 * The sandbox's write jail (rsc-wxk). Where the host spawn compiles the access
 * map into SBPL rules, the sandbox compiles the SAME roots (`resolveAccessRoots`
 * — one resolver, both backends) into microVM mounts: rw roots mount writable,
 * ro roots mount `:ro`.
 *
 * This exists because the seatbelt CANNOT run inside the sandbox: SBPL is macOS
 * and the sandbox interior is Linux (probed 2026-07-16 — `sandbox-exec` is
 * absent there). Mount flags are the Linux-native idiom for the same policy.
 *
 * **`ro` is enforced HOST-side, not by a guest mount flag** — proven in the
 * spike: the guest's `mount -o remount,rw` was refused, and the host file was
 * byte-identical afterwards. That is what makes this a boundary rather than a
 * request, and it is why the rsc-dqj mandatory holes survive the backend swap
 * unchanged.
 *
 * Two properties the SBPL profile cannot match:
 * - **Unmounted paths are invisible**, not merely unwritable. The seatbelt
 *   leaves reads wide open; here the worker sees only what the access map named.
 * - **Ro-holes need no ordering trick.** SBPL is last-match-wins, so a ro root
 *   nested in a rw root needs a deny rule emitted after the allow. A nested ro
 *   mount simply overlays the parent. (We still order ancestor-first, because
 *   the mount sequence itself must establish the parent before the hole.)
 */

/** One host path mounted into the microVM (`msb --mount-dir|--mount-file SRC:DST[:ro]`). */
export interface SandboxMount {
  readonly hostPath: string
  readonly mountPath: string
  readonly readOnly: boolean
  /**
   * Directories take `--mount-dir`, files take `--mount-file`. msb refuses the
   * wrong one outright ("mount-dir source is not a directory"), and a mandatory
   * hole is exactly where this bites: `.git/hooks` and `.git/modules` are
   * directories but **`.git/config` is a FILE**, so a dir-only compiler refuses
   * every dispatch into a real git repo — which is every real case vault, since
   * `git init` always writes that file. Caught by the in-vivo run (rsc-wxk).
   */
  readonly isDirectory: boolean
}

export interface SandboxMountInput extends AccessMapInput {
  /** Where the case tree is mounted inside the sandbox (e.g. `/work`). */
  readonly mountPath: string
  /**
   * The attempt's claim dir (`.waypoint/claims/<route>`), mounted rw so the worker
   * can file its report claim REGARDLESS of what the access map grants (rsc-clm).
   * The seatbelt jail already grants this explicitly; without it here, a recipe
   * whose access map covers only a narrow rw root (e.g. just `shadow/`) has no
   * writable path for `.waypoint/claims/...`, the claim lands in the guest's
   * ephemeral overlay, the host reads null, and the attempt is derived `failed`
   * despite the work being done. Must live under the project root, like scratch.
   */
  readonly claimDir: string
}

/**
 * Compile the access map into the sandbox's mount set.
 *
 * Every root must live under the project root: the sandbox addresses paths by
 * their position inside the mounted case tree, so a root outside it has no
 * container path to mount at. The seatbelt can grant such a root (it names
 * absolute host paths); here it is a refusal rather than a silent omission,
 * because silently dropping a root the plan asked for would hand the worker a
 * missing directory instead of a boundary — and the fail-closed rule is that an
 * unjailable attempt does not spawn.
 *
 * Mounts are ordered ancestor-before-descendant so a nested ro hole overlays its
 * rw parent rather than being shadowed by it.
 */
export async function assembleSandboxMounts(input: SandboxMountInput): Promise<SandboxMount[]> {
  const projectRoot = path.resolve(input.projectRoot)
  const resolved: AccessRoot[] = resolveAccessRoots(input)

  // A mount needs its host path to exist. For a DECLARED root, absence is an
  // author error and failing closed is right. For a MANDATORY hole (rsc-dqj)
  // absence just means this project has no such execution surface — a case
  // vault that is not a git repo has no .git/hooks — and refusing every
  // dispatch over it would be absurd. Skipping is sound here in a way it would
  // not be for the seatbelt: an SBPL deny covers a path that does not exist yet
  // (it refuses the creation too), whereas a mount cannot. The residue is a
  // non-git project whose worker creates .git/hooks itself — harmless while
  // there is no repo for git to run in, and the seatbelt path covers it fully.
  const kinds = new Map<string, 'dir' | 'file' | null>()
  const roots: AccessRoot[] = []
  for (const root of resolved) {
    const kind = await kindOf(root.path)
    if (root.mandatory === true && kind === null) continue
    kinds.set(path.resolve(root.path), kind)
    roots.push(root)
  }
  // The scratch dir is the attempt's own write root (verify-then-apply staging),
  // exactly as in the seatbelt jail.
  roots.push({ name: 'scratch', path: path.resolve(input.scratchDir), access: 'rw' })
  // The claim dir is granted rw explicitly (rsc-clm), exactly as the seatbelt jail
  // does — so filing the report claim never depends on a broad rw root in the
  // access map. Nested under the case tree; the ancestor-first ordering below lets
  // it overlay whatever the map mounted at its parent.
  roots.push({ name: 'claim', path: path.resolve(input.claimDir), access: 'rw' })

  const mounts: SandboxMount[] = []
  const claimed = new Map<string, { readonly name: string; readonly readOnly: boolean }>()
  for (const root of roots) {
    const hostPath = path.resolve(root.path)
    const rel = path.relative(projectRoot, hostPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `sandbox: root ${JSON.stringify(root.name)} resolves to ${hostPath}, which is outside the project root ${projectRoot} — ` +
          'the sandbox mounts the case tree and has no container path for it (fail closed, no spawn)',
      )
    }
    const mountPath = rel === '' ? input.mountPath : path.posix.join(input.mountPath, ...rel.split(path.sep))
    const readOnly = root.access === 'ro'

    // Two roots at one path with different capabilities: the mount would be one
    // or the other, so the policy is unrepresentable. Refuse rather than pick.
    const existing = claimed.get(mountPath)
    if (existing !== undefined) {
      if (existing.readOnly !== readOnly) {
        throw new Error(
          `sandbox: roots ${JSON.stringify(existing.name)} and ${JSON.stringify(root.name)} both mount at ${mountPath} with different ` +
            'capabilities (rw and ro) — unrepresentable as mounts (fail closed, no spawn)',
        )
      }
      continue
    }
    claimed.set(mountPath, { name: root.name, readOnly })
    // A declared root we have not stat'd (or that does not exist yet) is treated
    // as a directory: roots are directories by convention, and the scratch dir is
    // created before the spawn. Only a path we KNOW is a file takes --mount-file.
    mounts.push({ hostPath, mountPath, readOnly, isDirectory: kinds.get(hostPath) !== 'file' })
  }

  mounts.sort((a, b) => depth(a.mountPath) - depth(b.mountPath) || (a.mountPath < b.mountPath ? -1 : a.mountPath > b.mountPath ? 1 : 0))
  return mounts
}

/**
 * Render the mount set as `msb` argv.
 *
 * A `:` in either path would split into a bogus third field and silently change
 * the mount's options — so refuse rather than emit something the CLI would
 * misparse. This cannot be quoted around: the separator is positional.
 */
export function toMountArgs(mounts: readonly SandboxMount[]): string[] {
  const args: string[] = []
  for (const mount of mounts) {
    for (const [label, value] of [
      ['host path', mount.hostPath],
      ['mount path', mount.mountPath],
    ] as const) {
      if (value.includes(':')) {
        throw new Error(
          `sandbox: ${label} ${JSON.stringify(value)} contains ':', which is the --mount-dir field separator — ` +
            'the mount would be misparsed (fail closed, no spawn)',
        )
      }
    }
    args.push(mount.isDirectory ? '--mount-dir' : '--mount-file', `${mount.hostPath}:${mount.mountPath}${mount.readOnly ? ':ro' : ''}`)
  }
  return args
}

function depth(p: string): number {
  return p.split('/').filter((segment) => segment !== '').length
}
