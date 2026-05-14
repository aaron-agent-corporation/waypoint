import { describe, expect, it } from 'vitest'

import { runWizardCommand } from './wizard'

describe('wizard CLI', () => {
  it('creates markdown shadows and returns JSON output', async () => {
    const { mkdtemp, mkdir, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-shadow-source-'))
    const targetRoot = await mkdtemp(join(tmpdir(), 'wizard-shadow-case-'))
    await mkdir(join(sourceRoot, 'Medical'), { recursive: true })
    await writeFile(join(sourceRoot, 'Intake Docs.pdf'), 'intake packet')
    await writeFile(join(sourceRoot, 'Medical', 'Dr Smith Records.pdf'), 'medical records')

    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(
      ['shadow', '--source', sourceRoot, '--target', targetRoot, '--domain', 'firmvault', '--json'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])

    const json = JSON.parse(outputs.join('\n'))
    expect(json.domain).toBe('firmvault')
    expect(json.source_root).toBe(sourceRoot)
    expect(json.target_root).toBe(targetRoot)
    expect(json.shadows_created).toBe(2)
    expect(json.shadow_paths).toHaveLength(2)
    expect(json.shadows).toHaveLength(2)

    const intakeShadowPath = json.shadow_paths.find((shadowPath: string) => shadowPath.includes('intake-docs.md'))
    expect(intakeShadowPath).toBeTruthy()
    const shadowMarkdown = await readFile(intakeShadowPath, 'utf-8')
    expect(shadowMarkdown).toContain('shadow_type: document')
    expect(shadowMarkdown).toContain('path:')
    expect(shadowMarkdown).toContain('Docs.pdf')
    expect(shadowMarkdown).toContain('Source contents were not copied')
  })

  it('scans a source folder and returns JSON output', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-scan-'))
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(join(sourceRoot, 'Medical'), { recursive: true })
    await writeFile(join(sourceRoot, 'Intake Docs.pdf'), 'intake packet')
    await writeFile(join(sourceRoot, 'Medical', 'Dr Smith Records.pdf'), 'medical records')

    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(
      ['scan', '--source', sourceRoot, '--domain', 'firmvault', '--json'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])

    const json = JSON.parse(outputs.join('\n'))
    expect(json.domain).toBe('firmvault')
    expect(json.source_root).toBe(sourceRoot)
    expect(json.files_found).toBe(2)
    expect(Array.isArray(json.files)).toBe(true)
  })

  it('returns the next pending Wizard question for a case', async () => {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-questions-case-'))
    await mkdir(join(caseRoot, '.waypoint', 'wizard'), { recursive: true })
    await writeFile(
      join(caseRoot, '.waypoint', 'wizard', 'questions.yaml'),
      `schema_version: 1
questions:
  - id: question-b
    prompt: Second question?
    status: pending
    domain: firmvault
    related_shadow_paths: []
  - id: question-a
    prompt: First question?
    status: pending
    domain: firmvault
    related_shadow_paths: []
`,
      'utf8',
    )

    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(['questions', '--case', caseRoot, '--json'], io)

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])
    const json = JSON.parse(outputs.join('\n'))
    expect(json.case_root).toBe(caseRoot)
    expect(json.questions_found).toBe(2)
    expect(json.next_question).toMatchObject({
      id: 'question-a',
      prompt: 'First question?',
      status: 'pending',
      domain: 'firmvault',
    })
  })

  it('rejects unknown domains', async () => {
    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(
      ['scan', '--source', '/tmp', '--domain', 'bad', '--json'],
      io,
    )

    expect(exitCode).toBe(1)
    expect(errors.some((e) => e.includes('Unsupported Wizard domain'))).toBe(true)
  })

  it('requires --source option', async () => {
    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(['scan', '--domain', 'firmvault'], io)

    expect(exitCode).toBe(1)
    expect(errors.some((e) => e.includes('--source'))).toBe(true)
  })

  it('requires --domain option', async () => {
    const outputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const exitCode = await runWizardCommand(['scan', '--source', '/tmp'], io)

    expect(exitCode).toBe(1)
    expect(errors.some((e) => e.includes('--domain'))).toBe(true)
  })
})