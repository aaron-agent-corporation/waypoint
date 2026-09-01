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
      ['shadow', '--source', sourceRoot, '--target', targetRoot, '--domain', 'documents', '--json'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])

    const json = JSON.parse(outputs.join('\n'))
    expect(json.domain).toBe('documents')
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

  it('organizes messy source files into a clean case package only copying files when requested', async () => {
    const { mkdtemp, mkdir, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-organize-source-'))
    const shadowOnlyTarget = await mkdtemp(join(tmpdir(), 'wizard-organize-shadow-only-'))
    const copyTarget = await mkdtemp(join(tmpdir(), 'wizard-organize-copy-'))
    await mkdir(join(sourceRoot, 'Insurance'), { recursive: true })
    await writeFile(join(sourceRoot, 'Insurance', 'Policy.pdf'), 'insurance policy')
    await writeFile(join(sourceRoot, 'Mystery Scan.bin'), 'unknown document')

    const shadowOnlyOutputs: string[] = []
    const shadowOnlyErrors: string[] = []
    const shadowOnlyExit = await runWizardCommand(
      ['organize', '--source', sourceRoot, '--target', shadowOnlyTarget, '--domain', 'documents', '--json'],
      {
        stdout: (line: string) => shadowOnlyOutputs.push(line),
        stderr: (line: string) => shadowOnlyErrors.push(line),
      },
    )

    expect(shadowOnlyExit, shadowOnlyErrors.join('\n')).toBe(0)
    expect(shadowOnlyErrors).toEqual([])
    const shadowOnlyJson = JSON.parse(shadowOnlyOutputs.join('\n'))
    expect(shadowOnlyJson.source_files_copied).toBe(0)
    expect(shadowOnlyJson.documents_copied).toEqual([])
    expect(shadowOnlyJson.artifacts).toContain('.waypoint/wizard/organization-plan.yaml')
    expect(await readFile(join(shadowOnlyTarget, 'README.md'), 'utf8')).toContain('Wizard organized case package')
    await expect(readFile(join(shadowOnlyTarget, 'documents', 'documents', 'policy.pdf'))).rejects.toThrow()

    const copyOutputs: string[] = []
    const copyErrors: string[] = []
    const copyExit = await runWizardCommand(
      ['organize', '--source', sourceRoot, '--target', copyTarget, '--domain', 'documents', '--copy-files', '--json'],
      {
        stdout: (line: string) => copyOutputs.push(line),
        stderr: (line: string) => copyErrors.push(line),
      },
    )

    expect(copyExit).toBe(0)
    expect(copyErrors).toEqual([])
    const copyJson = JSON.parse(copyOutputs.join('\n'))
    expect(copyJson.source_files_copied).toBe(2)
    expect(copyJson.documents_copied).toContain('documents/documents/policy.pdf')
    expect(await readFile(join(copyTarget, 'documents', 'documents', 'policy.pdf'), 'utf8')).toBe('insurance policy')
    expect(copyJson.domain_facts_from_organization).toBe('forbidden')
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
      ['scan', '--source', sourceRoot, '--domain', 'documents', '--json'],
      io,
    )

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])

    const json = JSON.parse(outputs.join('\n'))
    expect(json.domain).toBe('documents')
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
    domain: documents
    related_shadow_paths: []
  - id: question-a
    prompt: First question?
    status: pending
    domain: documents
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
      domain: 'documents',
    })
  })

  it('generates and writes a Wizard adoption plan for existing shadows', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { parse: parseYaml } = await import('yaml')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-case-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(sourceRoot, 'Agreement.pdf'), 'signed agreement')
    await writeFile(join(sourceRoot, 'Mystery Scan.bin'), 'unknown scan')

    const shadowErrors: string[] = []
    const shadowExitCode = await runWizardCommand(
      ['shadow', '--source', sourceRoot, '--target', caseRoot, '--domain', 'documents', '--json'],
      { stdout: () => undefined, stderr: (line: string) => shadowErrors.push(line) },
    )
    expect(shadowExitCode).toBe(0)
    expect(shadowErrors).toEqual([])

    const outputs: string[] = []
    const errors: string[] = []
    const exitCode = await runWizardCommand(['plan', '--case', caseRoot, '--json'], {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    })

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])
    const json = JSON.parse(outputs.join('\n'))
    expect(json.case_root).toBe(caseRoot)
    expect(json.domain).toBe('documents')
    expect(json.plan_path).toBe(join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml'))
    // Domain facts are host-supplied: the generic CLI proposes none on its own.
    expect(json.proposed_facts_count).toBe(0)
    expect(json.shadows_count).toBe(2)
    expect(json.plan.safety).toMatchObject({
      external_side_effects: 'forbidden',
      source_mutation: 'forbidden',
      domain_facts_from_shadows: 'forbidden',
    })

    const rawPlan = await readFile(join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml'), 'utf8')
    const parsedPlan = parseYaml(rawPlan) as { shadow_map: Array<{ shadow_path: string }> }
    expect(parsedPlan.shadow_map).toHaveLength(2)
  })

  it('writes adoption plans that reference organized copied evidence paths when an organization plan exists', async () => {
    const { mkdtemp, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { parse: parseYaml } = await import('yaml')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-organized-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-organized-case-'))
    await writeFile(join(sourceRoot, 'Agreement.pdf'), 'signed agreement')

    const organizeErrors: string[] = []
    expect(await runWizardCommand(
      ['organize', '--source', sourceRoot, '--target', caseRoot, '--domain', 'documents', '--copy-files', '--json'],
      { stdout: () => undefined, stderr: (line: string) => organizeErrors.push(line) },
    )).toBe(0)
    expect(organizeErrors).toEqual([])

    const outputs: string[] = []
    const errors: string[] = []
    expect(await runWizardCommand(['plan', '--case', caseRoot, '--json'], {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    })).toBe(0)
    expect(errors).toEqual([])

    const json = JSON.parse(outputs.join('\n'))
    expect(json.plan.shadow_map[0]).toMatchObject({
      canonical_document_path: 'documents/documents/agreement.pdf',
      copied_evidence_path: 'documents/documents/agreement.pdf',
      copy_status: 'copied',
    })

    const rawPlan = await readFile(join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml'), 'utf8')
    const parsedPlan = parseYaml(rawPlan) as { shadow_map: Array<{ copied_evidence_path?: string }> }
    expect(parsedPlan.shadow_map[0]).toMatchObject({
      copied_evidence_path: 'documents/documents/agreement.pdf',
    })
  })

  it('records a Wizard answer and suppresses the answered question', async () => {
    const { mkdir, mkdtemp, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { parse: parseYaml } = await import('yaml')

    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-answer-case-'))
    await mkdir(join(caseRoot, '.waypoint', 'wizard'), { recursive: true })
    await writeFile(
      join(caseRoot, '.waypoint', 'wizard', 'questions.yaml'),
      `schema_version: 1
questions:
  - id: question-a
    prompt: First question?
    status: pending
    domain: documents
    related_shadow_paths: []
  - id: question-b
    prompt: Second question?
    status: pending
    domain: documents
    related_shadow_paths: []
`,
      'utf8',
    )

    const answerOutputs: string[] = []
    const errors: string[] = []
    const io = {
      stdout: (line: string) => answerOutputs.push(line),
      stderr: (line: string) => errors.push(line),
    }

    const answerExitCode = await runWizardCommand(
      ['answer', '--case', caseRoot, '--question', 'question-a', '--answer', 'Use the signed agreement.', '--json'],
      io,
    )

    expect(answerExitCode).toBe(0)
    expect(errors).toEqual([])
    const answerJson = JSON.parse(answerOutputs.join('\n'))
    expect(answerJson.answers_written).toBe(1)
    expect(answerJson.answer).toMatchObject({
      question_id: 'question-a',
      answer: 'Use the signed agreement.',
    })

    const answersRaw = await readFile(join(caseRoot, '.waypoint', 'wizard', 'answers.yaml'), 'utf8')
    const answersYaml = parseYaml(answersRaw) as { answers: Array<{ question_id: string; answer: string }> }
    expect(answersYaml.answers).toEqual([
      expect.objectContaining({ question_id: 'question-a', answer: 'Use the signed agreement.' }),
    ])

    const questionOutputs: string[] = []
    const questionExitCode = await runWizardCommand(['questions', '--case', caseRoot, '--json'], {
      stdout: (line: string) => questionOutputs.push(line),
      stderr: (line: string) => errors.push(line),
    })

    expect(questionExitCode).toBe(0)
    const questionsJson = JSON.parse(questionOutputs.join('\n'))
    expect(questionsJson.next_question).toMatchObject({ id: 'question-b' })
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

    const exitCode = await runWizardCommand(['scan', '--domain', 'documents'], io)

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
