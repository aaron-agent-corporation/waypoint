import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The write jail is macOS Seatbelt: successful composition spawns the
 * worker under /usr/bin/sandbox-exec, so spawn-bearing cases run on darwin
 * only. Refusal cases stay unguarded — they never reach spawn. */
const itOnMac = it.skipIf(process.platform !== 'darwin')

import { composeCordisWorker, cordisScratchDir, cordisTmpDir, CordisCompositionError } from './compose.ts'
import { CordisCompositionError as MergeError } from './composition.ts'
import type { RecipeManifest } from '@waypoint-engine/core'
import type { CordisToolCall } from '@waypoint-engine/kernel'
import type { WaypointProjectRootConfig } from '../../project/config.ts'

/**
 * These drive composition against a REAL fixture MCP server — a live child
 * process, no mock. A mocked tool surface would pass the activation guard
 * vacuously, which is the one thing these tests exist to catch.
 *
 * The seatbelt is deliberately OFF here (no roots crossing the gate, no
 * WAYPOINT_SEATBELT in the injected env): the jail's own behaviour is proven in
 * seatbelt/jail tests, and wrapping every case in `sandbox-exec` would make
 * these tests measure the jail rather than the composition. The one thing
 * asserted about it below is the fail-closed posture.
 */

const TOOL_SERVER = join(import.meta.dirname, '__fixtures__', 'test-mcp-server.ts')

/**
 * The jail is ON for every case below, because it cannot be turned off: a
 * project that declares roots is jailed regardless of WAYPOINT_SEATBELT. So every
 * dispatch carries an explicit `access:` map — an absent one is a refusal to
 * spawn, which the first case here asserts outright.
 */
const ENV: NodeJS.ProcessEnv = { ...process.env }
const ACCESS = { case: 'ro', skills: 'ro' } as const

/** Execute by name — the kernel contract takes a full call, the tests care
 *  about name + args. */
function call(name: string, args: Record<string, unknown> = {}): CordisToolCall {
  return { id: `test-${name}`, name, args }
}

async function fixture(): Promise<{ projectRoot: string; roots: Record<string, WaypointProjectRootConfig> }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cordis-worker-'))
  await mkdir(join(projectRoot, 'case', 'reference'), { recursive: true })
  await mkdir(join(projectRoot, 'skills'), { recursive: true })
  await writeFile(
    join(projectRoot, 'case', 'reference', 'vocabulary.md'),
    '# Project vocabulary\n\nwidget — a unit of work, not a UI element.\n',
  )
  await writeFile(join(projectRoot, 'case', 'reference', 'other.md'), 'not a declared reference\n')
  await writeFile(
    join(projectRoot, 'skills', 'cite-discipline.md'),
    'Every factual claim carries a pin-cite to a document and page.\n',
  )
  await writeFile(join(projectRoot, 'skills', 'terse-reporting.md'), 'Report the finding, not the search.\n')
  await writeFile(join(projectRoot, 'skills', 'empty.md'), '   \n')
  return {
    projectRoot,
    roots: { case: { path: 'case', access: 'rw' }, skills: { path: 'skills', access: 'ro' } } satisfies Record<string, WaypointProjectRootConfig>,
  }
}

function recipe(over: Partial<RecipeManifest> = {}): RecipeManifest {
  return {
    schema_version: 1,
    slug: 'extractor',
    name: 'Extractor',
    prompt: 'You process the project inputs.',
    runtime: { kind: 'cordis', model_class: 'medium', tool_group: 'one' },
    skills: ['cite-discipline'],
    references: ['reference/vocabulary.md'],
    tools: ['alpha'],
    ...over,
  } as RecipeManifest
}

async function compose(
  over: Partial<RecipeManifest> = {},
  dispatchOver: Record<string, unknown> = {},
  fx?: Awaited<ReturnType<typeof fixture>>,
) {
  const f = fx ?? (await fixture())
  const dispatch = { routeId: 'r1', taskId: 't1', prompt: 'go', access: { ...ACCESS }, ...dispatchOver }
  return composeCordisWorker({
    recipe: recipe(over),
    project: {
      projectRoot: f.projectRoot,
      roots: f.roots,
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      skillsRoots: [join(f.projectRoot, 'skills')],
      caseRoot: join(f.projectRoot, 'case'),
    },
    dispatch: dispatch as never,
    toolServer: TOOL_SERVER,
    tmpDir: cordisTmpDir(f.projectRoot, 'r1', 't1'),
    scratchDir: cordisScratchDir(f.projectRoot, 'r1', 't1'),
    claimDir: join(f.projectRoot, '.waypoint', 'claims', 'r1'),
    claimPath: join(f.projectRoot, '.waypoint', 'claims', 'r1', 't1.json'),
    env: ENV,
  })
}

describe('cordis composition — skills are loaded, not prose', () => {
  itOnMac('mounts a prompt section carrying the file content verbatim, with its source path', async () => {
    const worker = await compose()
    try {
      const section = worker.ctx.systemPrompt.sections().find((s) => s.id === 'skill:cite-discipline')
      expect(section, 'the skill section is mounted').toBeTruthy()
      expect(section?.body).toContain('pin-cite to a document and page')
      expect(section?.source).toMatch(/skills\/cite-discipline\.md$/)
      expect(worker.systemPrompt).toContain('## Skill — cite-discipline')
      // The recipe's own prompt still leads; skills are additive, not a
      // replacement. On the kernel the role section renders first.
      expect(worker.systemPrompt.startsWith('## Role\n\nYou process the project inputs')).toBe(true)
      expect(worker.systemPrompt.indexOf('You process the project inputs')).toBeLessThan(
        worker.systemPrompt.indexOf('## Skill — cite-discipline'),
      )
    } finally {
      await worker.dispose()
    }
  })

  it('refuses a skill that names no file, naming every root it searched', async () => {
    await expect(compose({ skills: ['no-such-skill'] })).rejects.toThrow(
      /skill 'no-such-skill' names no file in any skills root/,
    )
    await expect(compose({ skills: ['no-such-skill'] })).rejects.toThrow(/Searched, in order: .*no-such-skill\.md/)
  })

  it('refuses a skill name that climbs out of its root, before any root is consulted', async () => {
    await expect(compose({ skills: ['../../../../etc/passwd'] })).rejects.toThrow(/escapes its skills root/)
    await expect(compose({ skills: ['/etc/passwd'] })).rejects.toThrow(/escapes its skills root/)
  })

  itOnMac('resolves a NAMESPACED skill name, which is how the bundle groups them', async () => {
    const fx = await fixture()
    await mkdir(join(fx.projectRoot, 'skills', 'bundle'), { recursive: true })
    await writeFile(join(fx.projectRoot, 'skills', 'bundle', 'cite-discipline.md'), 'Namespaced.\n')
    const worker = await compose({ skills: ['bundle/cite-discipline'] }, {}, fx)
    try {
      expect(worker.skills[0]?.content).toContain('Namespaced')
      expect(worker.ctx.systemPrompt.sections().some((s) => s.id === 'skill:bundle/cite-discipline')).toBe(true)
    } finally {
      await worker.dispose()
    }
  })

  itOnMac('takes the FIRST root that has the skill, so an operator copy beats the bundle', async () => {
    const fx = await fixture()
    const override = join(fx.projectRoot, 'override')
    await mkdir(override, { recursive: true })
    await writeFile(join(override, 'cite-discipline.md'), 'The operator tuned this one.\n')
    const worker = await composeCordisWorker({
      recipe: recipe(),
      project: {
        projectRoot: fx.projectRoot,
        roots: fx.roots,
        provider: 'openai-codex',
        model: 'gpt-5.6-terra',
        skillsRoots: [override, join(fx.projectRoot, 'skills')],
        caseRoot: join(fx.projectRoot, 'case'),
      },
      dispatch: { routeId: 'r1', taskId: 't1', prompt: 'go', access: { ...ACCESS } } as never,
      toolServer: TOOL_SERVER,
      tmpDir: cordisTmpDir(fx.projectRoot, 'r1', 't1'),
      scratchDir: cordisScratchDir(fx.projectRoot, 'r1', 't1'),
      env: ENV,
    })
    try {
      expect(worker.skills[0]?.content).toContain('The operator tuned this one')
      expect(worker.skills[0]?.path).toBe(join(override, 'cite-discipline.md'))
    } finally {
      await worker.dispose()
    }
  })

  itOnMac('falls through to a later root when the first does not have the skill', async () => {
    const fx = await fixture()
    const worker = await composeCordisWorker({
      recipe: recipe(),
      project: {
        projectRoot: fx.projectRoot,
        roots: fx.roots,
        provider: 'openai-codex',
        model: 'gpt-5.6-terra',
        skillsRoots: [join(fx.projectRoot, 'empty-root'), join(fx.projectRoot, 'skills')],
        caseRoot: join(fx.projectRoot, 'case'),
      },
      dispatch: { routeId: 'r1', taskId: 't1', prompt: 'go', access: { ...ACCESS } } as never,
      toolServer: TOOL_SERVER,
      tmpDir: cordisTmpDir(fx.projectRoot, 'r1', 't1'),
      scratchDir: cordisScratchDir(fx.projectRoot, 'r1', 't1'),
      env: ENV,
    })
    try {
      expect(worker.skills[0]?.path).toBe(join(fx.projectRoot, 'skills', 'cite-discipline.md'))
    } finally {
      await worker.dispose()
    }
  })

  it('refuses an empty skill rather than mounting an empty section', async () => {
    await expect(compose({ skills: ['empty'] })).rejects.toThrow(/skill 'empty' is empty at/)
  })
})

describe('cordis composition — references are enforced, not described', () => {
  itOnMac('reads a named reference and refuses everything else, naming what is available', async () => {
    const worker = await compose()
    try {
      const ok = await worker.ctx.tools.execute(call('read_reference', { name: 'reference/vocabulary.md' }))
      expect(ok.status).toBe('ok')
      expect(ok.output).toContain('# Project vocabulary')

      // A real file, inside the case root, that the recipe did not declare.
      const denied = await worker.ctx.tools.execute(call('read_reference', { name: 'reference/other.md' }))
      expect(denied.status).toBe('error')
      expect(denied.output).toContain('is not a reference on this task')
      expect(denied.output).toContain('reference/vocabulary.md')
    } finally {
      await worker.dispose()
    }
  })

  itOnMac('mounts NO read tool at all when the recipe declares no references', async () => {
    const worker = await compose({ references: [] })
    try {
      expect(worker.ctx.tools.list().map((t) => t.name)).not.toContain('read_reference')
      expect(worker.systemPrompt).toContain('You have no reading tool on this task')
    } finally {
      await worker.dispose()
    }
  })

  it('refuses a reference that escapes the declared roots', async () => {
    await expect(compose({ references: ['../../../../etc/hosts'] })).rejects.toThrow(
      /outside the project's declared roots|names no file/,
    )
  })
})

describe('cordis composition — the four layers', () => {
  it('refuses a dispatch that widens the project roots', async () => {
    await expect(compose({}, { access: { secrets: 'rw' } })).rejects.toThrow(MergeError)
    await expect(compose({}, { access: { secrets: 'rw' } })).rejects.toThrow(/does not declare/)
  })

  itOnMac('accepts a dispatch that narrows them', async () => {
    const worker = await compose({}, { access: { case: 'ro' } })
    try {
      expect(Object.keys(worker.plan.roots)).toEqual(['case'])
      // Narrowing the worker's data access does NOT cost it its skills: those
      // are read by the composer against the project's declared roots.
      expect(worker.skills.map((s) => s.name)).toEqual(['cite-discipline'])
    } finally {
      await worker.dispose()
    }
  })

  it('refuses to spawn a tool surface when the plan declares no access map at all', async () => {
    // Fail closed: with the jail enabled, an undeclared boundary is not a
    // reason to run without one.
    await expect(compose({}, { access: undefined })).rejects.toThrow(/no access map|no spawn/)
  })
})

describe('cordis composition — the activation guard', () => {
  itOnMac('refuses a named tool the surface did not mount, rather than downgrading quietly', async () => {
    // `beta` is real, but group 'one' does not serve it.
    await expect(compose({ tools: ['alpha', 'beta'] })).rejects.toThrow(CordisCompositionError)
    await expect(compose({ tools: ['alpha', 'beta'] })).rejects.toThrow(
      /did not mount: beta/,
    )
  })

  itOnMac('names the tool_group in the refusal, since that is nearly always the cause', async () => {
    await expect(compose({ tools: ['beta'] })).rejects.toThrow(/tool_group 'one'/)
  })

  itOnMac('does not treat surface tools the recipe left unnamed as a failure', async () => {
    const worker = await compose({ tools: [] })
    try {
      expect(worker.ctx.tools.list().length).toBeGreaterThan(1)
    } finally {
      await worker.dispose()
    }
  })
})

describe('cordis composition — the policy fence', () => {
  itOnMac('refuses a mounted tool the recipe never named, and says so by name', async () => {
    // `gamma` is served by group 'one' but not named by this recipe. Least
    // privilege alone would not catch it — the tool IS mounted.
    const worker = await compose({ tools: ['alpha'] })
    try {
      expect(worker.ctx.tools.list().map((t) => t.name)).toContain('gamma')
      const denied = await worker.ctx.tools.execute(call('gamma'))
      expect(denied.status).toBe('denied')
      expect(denied.output).toMatch(/not in this recipe's named tool surface/)
      // The denial is on the audit trail, not just in the model's transcript.
      expect(worker.blockedTools).toContain('gamma')
    } finally {
      await worker.dispose()
    }
  })

  itOnMac('always lets the report seam through, even when the recipe never named it', async () => {
    // A recipe that forgot `report` would otherwise fail with "never filed a
    // claim" — a message that names the symptom and hides the cause.
    const worker = await compose({ tools: ['alpha'] })
    try {
      expect(worker.ctx.tools.list().map((t) => t.name)).toContain('report')
      // It reaches the tool: any failure below is the SERVER's (bad arguments),
      // never the policy's.
      const outcome = await worker.ctx.tools.execute(call('report'))
      expect(outcome.status).not.toBe('denied')
      expect(outcome.output).not.toContain("not in this recipe's named tool surface")
    } finally {
      await worker.dispose()
    }
  })

  itOnMac('lets a named tool through', async () => {
    const worker = await compose({ tools: ['alpha'] })
    try {
      const outcome = await worker.ctx.tools.execute(call('alpha'))
      expect(outcome.status).toBe('ok')
    } finally {
      await worker.dispose()
    }
  })
})

describe('cordis composition — the report seam', () => {
  itOnMac('names the claim FILE to the tool server, not just the directory to the jail', async () => {
    // Found in vivo, not in a test: the first real run granted the claim dir to
    // the jail and never set WAYPOINT_CLAIM_PATH, so the worker did all the work
    // and could not be heard — every run would have failed with "the run ended
    // without a report". Granting the write and naming the target are two
    // different things.
    const fx = await fixture()
    const worker = await compose({}, {}, fx)
    try {
      const outcome = await worker.ctx.tools.execute(
        call('report', { status: 'failed', summary: 'checking the seam is wired' }),
      )
      expect(outcome.output).not.toContain('WAYPOINT_CLAIM_PATH unset')
      const claim = JSON.parse(
        await readFile(join(fx.projectRoot, '.waypoint', 'claims', 'r1', 't1.json'), 'utf8'),
      ) as { status: string }
      expect(claim.status).toBe('failed')
    } finally {
      await worker.dispose()
    }
  })
})

describe('cordis composition — determinism', () => {
  itOnMac('gives two dispatches of one recipe an identical digest and byte-identical prompt', async () => {
    const fx = await fixture()
    const a = await compose({}, { routeId: 'r1', taskId: 't1', prompt: 'first instruction' }, fx)
    const b = await compose({}, { routeId: 'r9', taskId: 't9', prompt: 'a totally different instruction' }, fx)
    try {
      expect(a.digest).toBe(b.digest)
      expect(a.systemPrompt).toBe(b.systemPrompt)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  itOnMac('changes the digest when a skill is added', async () => {
    const fx = await fixture()
    const a = await compose({}, {}, fx)
    const b = await compose({ skills: ['cite-discipline', 'terse-reporting'] }, {}, fx)
    try {
      expect(a.digest).not.toBe(b.digest)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  itOnMac('changes the digest when a skill FILE changes, though the recipe did not', async () => {
    const fx = await fixture()
    const a = await compose({}, {}, fx)
    await writeFile(join(fx.projectRoot, 'skills', 'cite-discipline.md'), 'A different discipline entirely.\n')
    const b = await compose({}, {}, fx)
    try {
      // A digest that missed this would certify a shape that had quietly
      // changed underneath the person who approved it.
      expect(a.digest).not.toBe(b.digest)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })
})

describe('cordis composition — teardown', () => {
  itOnMac('removes the MCP tools on dispose, and keeps the sections that are not the MCP fiber’s', async () => {
    const worker = await compose()
    expect(worker.ctx.tools.list().map((t) => t.name)).toContain('alpha')
    await worker.dispose()
    expect(worker.ctx.tools.list().map((t) => t.name)).not.toContain('alpha')
    // read_reference belongs to the references fiber, not the MCP fiber.
    expect(worker.ctx.tools.list().map((t) => t.name)).toContain('read_reference')
  })
})
