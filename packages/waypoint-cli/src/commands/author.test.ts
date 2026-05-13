import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { runWaypointCli } from '../bin'

function makeIo(cwd?: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      cwd,
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('waypoint author command', () => {
  it('prints the brainstorming questionnaire as JSON without writing files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'brainstorm', '--kind', 'quest', '--domain', 'firmvault', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; groups: Array<{ slug: string }>; approval: { required_before: string[] } }
    expect(parsed.kind).toBe('quest')
    expect(parsed.groups[0]?.slug).toBe('brainstorming-context')
    expect(parsed.approval.required_before).toContain('quest_manifest')
  })

  it('writes a pending design spec only under a safe relative docs path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        title: 'FirmVault Followup Workflow',
        kind: 'quest',
        domain: 'firmvault',
        inspected_paths: ['quests/firmvault.yaml'],
        goal: 'Track follow-up tasks after demand package review.',
        constraints: ['No external side effects'],
        approaches: [
          { slug: 'extend', title: 'Extend FirmVault Quest', tradeoffs: ['Fastest'], recommended: true },
          { slug: 'separate', title: 'Separate Quest', tradeoffs: ['Cleaner boundary'], recommended: false },
        ],
        lifecycle: { workstreams: [] },
        roles: ['firmvault-paralegal'],
        tool_boundaries: ['Waypoint safe tools only'],
        verification: ['pnpm test'],
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(
      await runWaypointCli(
        ['author', 'design', '--answers', answersPath, '--write-spec', 'docs/plans/generated-firmvault-followup-design.md', '--json'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { approval: { status: string }; written_path: string; blocked_next_steps: string[] }
    expect(parsed.approval.status).toBe('pending')
    expect(parsed.written_path).toBe('docs/plans/generated-firmvault-followup-design.md')
    expect(parsed.blocked_next_steps).toContain('implementation_plan')
    const written = await readFile(join(temp, 'docs/plans/generated-firmvault-followup-design.md'), 'utf8')
    expect(written).toContain('# FirmVault Followup Workflow')
    expect(written).toContain('status: pending')
  })

  it('refuses unsafe absolute design-spec output paths', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'answers.json')
    await writeFile(answersPath, JSON.stringify({ title: 'Bad', approaches: [] }))
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'design', '--answers', answersPath, '--write-spec', '/tmp/generated.md', '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Refusing to write outside a safe relative authoring path')
  })

  it('prints a recipe manifest draft as JSON without writing files when explicitly allowed', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'recipe.answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        slug: 'firmvault-client-followup',
        name: 'FirmVault Client Follow-up',
        domain: 'firmvault',
        description: 'Prepare a local client follow-up checklist from case evidence.',
        prompt: 'Review case-local evidence and prepare a client follow-up handoff. Do not contact the client.',
        tools: ['file_read', 'search_files'],
        source: {
          design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
          inspected_paths: ['quests/firmvault.yaml'],
        },
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'recipe', '--answers', answersPath, '--allow-unapproved-draft', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; path: string; yaml: string; write_default: boolean; validation: { ok: boolean } }
    expect(parsed.kind).toBe('recipe')
    expect(parsed.path).toBe('recipes/firmvault-client-followup.yaml')
    expect(parsed.write_default).toBe(false)
    expect(parsed.validation.ok).toBe(true)
    expect(parsed.yaml).toContain('slug: firmvault-client-followup')
    await expect(readFile(join(temp, 'recipes/firmvault-client-followup.yaml'), 'utf8')).rejects.toThrow()
  })

  it('prints a quest manifest draft as JSON without writing files when explicitly allowed', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'quest.answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        slug: 'firmvault-followup',
        name: 'FirmVault Follow-up Quest',
        domain: 'firmvault',
        workflow: 'workflows/firmvault-followup.yaml',
        recipes: ['firmvault-client-followup'],
        source: {
          design_spec_path: 'docs/plans/generated-firmvault-followup-design.md',
          inspected_paths: ['quests/firmvault.yaml'],
        },
        phases: [
          {
            key: 'followup',
            title: 'Follow-up',
            tasks: [
              { ref: 'client-followup-task', title: 'Prepare client follow-up', type: 'recipe', recipe: 'firmvault-client-followup' },
              { ref: 'human-review-gate', title: 'Human review before contact', type: 'gate', gate_kind: 'human_review' },
            ],
          },
        ],
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'quest', '--answers', answersPath, '--allow-unapproved-draft', '--json'], io)).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; path: string; yaml: string; write_default: boolean; validation: { ok: boolean } }
    expect(parsed.kind).toBe('quest')
    expect(parsed.path).toBe('quests/firmvault-followup.yaml')
    expect(parsed.write_default).toBe(false)
    expect(parsed.validation.ok).toBe(true)
    expect(parsed.yaml).toContain('workflow: workflows/firmvault-followup.yaml')
    await expect(readFile(join(temp, 'quests/firmvault-followup.yaml'), 'utf8')).rejects.toThrow()
  })

  it('blocks recipe and quest draft generation without approved design or explicit escape hatch', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'recipe.answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        slug: 'firmvault-client-followup',
        name: 'FirmVault Client Follow-up',
        prompt: 'Review case-local evidence.',
        source: { inspected_paths: ['quests/firmvault.yaml'] },
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(await runWaypointCli(['author', 'recipe', '--answers', answersPath, '--json'], io)).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Draft generation requires an approved design spec or --allow-unapproved-draft')
  })

  it('prints an implementation plan draft from a design spec when explicitly allowed', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const designPath = join(temp, 'docs/plans/generated-firmvault-followup-design.md')
    await mkdir(join(temp, 'docs/plans'), { recursive: true })
    await writeFile(
      designPath,
      '# FirmVault Followup Workflow\n\n## Approval\n\nstatus: pending\n\n## Verification Strategy\n\n- pnpm test\n',
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(
      await runWaypointCli(
        ['author', 'plan', '--design', 'docs/plans/generated-firmvault-followup-design.md', '--allow-unapproved-draft', '--json'],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; write_default: boolean; markdown: string; warnings: string[] }
    expect(parsed.kind).toBe('implementation_plan')
    expect(parsed.write_default).toBe(false)
    expect(parsed.markdown).toContain('# Implementation Plan Draft')
    expect(parsed.markdown).toContain('docs/plans/generated-firmvault-followup-design.md')
    expect(parsed.warnings).toContain('draft only: not written or installed')
  })

  it('writes a quest manifest draft only when --write-draft names a safe relative path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'quest.answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        slug: 'firmvault-followup',
        name: 'FirmVault Follow-up Quest',
        domain: 'firmvault',
        workflow: 'workflows/firmvault-followup.yaml',
        recipes: ['firmvault-client-followup'],
        source: { inspected_paths: ['quests/firmvault.yaml'] },
        phases: [{ key: 'followup', title: 'Follow-up', tasks: [{ ref: 'human-review-gate', title: 'Human review before contact', type: 'gate' }] }],
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(
      await runWaypointCli(
        [
          'author',
          'quest',
          '--answers',
          answersPath,
          '--allow-unapproved-draft',
          '--write-draft',
          'docs/plans/generated-firmvault-followup-draft.md',
          '--json',
        ],
        io,
      ),
    ).toBe(0)

    expect(stderr).toEqual([])
    const parsed = JSON.parse(stdout.join('\n')) as { kind: string; written_path: string; validation: { ok: boolean }; write_default: boolean }
    expect(parsed.kind).toBe('quest')
    expect(parsed.written_path).toBe('docs/plans/generated-firmvault-followup-draft.md')
    expect(parsed.write_default).toBe(false)
    expect(parsed.validation.ok).toBe(true)
    const written = await readFile(join(temp, 'docs/plans/generated-firmvault-followup-draft.md'), 'utf8')
    expect(written).toContain('schema_version: 1')
    expect(written).toContain('slug: firmvault-followup')
  })

  it('refuses unsafe draft output paths', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'waypoint-author-'))
    const answersPath = join(temp, 'recipe.answers.json')
    await writeFile(
      answersPath,
      JSON.stringify({
        slug: 'firmvault-client-followup',
        name: 'FirmVault Client Follow-up',
        prompt: 'Review case-local evidence.',
        source: { inspected_paths: ['quests/firmvault.yaml'] },
      }),
    )
    const { io, stdout, stderr } = makeIo(temp)

    expect(
      await runWaypointCli(
        ['author', 'recipe', '--answers', answersPath, '--allow-unapproved-draft', '--write-draft', '/tmp/unsafe.yaml', '--json'],
        io,
      ),
    ).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('Refusing to write outside a safe relative authoring path')
  })

  it('runs the bundled FirmVault authoring fixture as a dry-run Quest draft', async () => {
    const repoRoot = resolve(__dirname, '../../../..')
    const answersPath = 'examples/authoring/firmvault-followup.answers.json'
    const questIo = makeIo(repoRoot)

    expect(await runWaypointCli(['author', 'quest', '--answers', answersPath, '--allow-unapproved-draft', '--json'], questIo.io)).toBe(0)
    expect(questIo.stderr).toEqual([])
    const quest = JSON.parse(questIo.stdout.join('\n')) as { kind: string; path: string; validation: { ok: boolean }; yaml: string; warnings: string[] }
    expect(quest.kind).toBe('quest')
    expect(quest.path).toBe('quests/firmvault-followup.yaml')
    expect(quest.validation.ok).toBe(true)
    expect(quest.yaml).toContain('firmvault-client-followup')
    expect(quest.yaml).toContain('legal_landmarks_updated_by_default: false')
    expect(quest.warnings).toContain('draft only: not written or installed')
  })
})
