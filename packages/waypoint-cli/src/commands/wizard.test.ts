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

  it('generates and writes a Wizard adoption plan for existing shadows', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { parse: parseYaml } = await import('yaml')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-plan-case-'))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(sourceRoot, 'Fee Agreement.pdf'), 'signed fee agreement')
    await writeFile(join(sourceRoot, 'Mystery Scan.pdf'), 'unknown scan')

    const shadowErrors: string[] = []
    const shadowExitCode = await runWizardCommand(
      ['shadow', '--source', sourceRoot, '--target', caseRoot, '--domain', 'firmvault', '--json'],
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
    expect(json.plan_path).toBe(join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml'))
    expect(json.proposed_facts_count).toBe(1)
    expect(json.missing_expected_documents).toContain('client.authorizations.hipaa')
    expect(json.plan.proposed_facts[0]).toMatchObject({
      fact: 'client.contracts.fee_agreement',
      approved: false,
      evidence_shadow: expect.stringContaining('.waypoint/shadows/firmvault/contracts/fee-agreement.md'),
    })

    const rawPlan = await readFile(join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml'), 'utf8')
    const parsedPlan = parseYaml(rawPlan) as { proposed_facts: Array<{ approved: boolean }> }
    expect(parsedPlan.proposed_facts[0]?.approved).toBe(false)
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
    domain: firmvault
    related_shadow_paths: []
  - id: question-b
    prompt: Second question?
    status: pending
    domain: firmvault
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
      ['answer', '--case', caseRoot, '--question', 'question-a', '--answer', 'Use the signed fee agreement.', '--json'],
      io,
    )

    expect(answerExitCode).toBe(0)
    expect(errors).toEqual([])
    const answerJson = JSON.parse(answerOutputs.join('\n'))
    expect(answerJson.answers_written).toBe(1)
    expect(answerJson.answer).toMatchObject({
      question_id: 'question-a',
      answer: 'Use the signed fee agreement.',
    })

    const answersRaw = await readFile(join(caseRoot, '.waypoint', 'wizard', 'answers.yaml'), 'utf8')
    const answersYaml = parseYaml(answersRaw) as { answers: Array<{ question_id: string; answer: string }> }
    expect(answersYaml.answers).toEqual([
      expect.objectContaining({ question_id: 'question-a', answer: 'Use the signed fee agreement.' }),
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

  it('applies only approved Wizard facts from a persisted adoption plan', async () => {
    const { mkdir, mkdtemp, readFile, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { stringify: stringifyYaml } = await import('yaml')
    const { approveWizardProposedFacts } = await import('@waypoint/core')
    const { initFirmVaultCaseState, readFirmVaultCaseState } = await import('@waypoint/folder-host')

    const sourceRoot = await mkdtemp(join(tmpdir(), 'wizard-apply-source-'))
    const caseRoot = await mkdtemp(join(tmpdir(), 'wizard-apply-cli-case-'))
    await initFirmVaultCaseState(caseRoot, { caseType: 'personal_injury', caseSlug: 'wizard-apply-cli-case' })
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'Fee Agreement.pdf'), 'signed fee agreement')
    await writeFile(join(sourceRoot, 'HIPAA Authorization.pdf'), 'signed hipaa')

    const shadowErrors: string[] = []
    expect(await runWizardCommand(
      ['shadow', '--source', sourceRoot, '--target', caseRoot, '--domain', 'firmvault', '--json'],
      { stdout: () => undefined, stderr: (line: string) => shadowErrors.push(line) },
    )).toBe(0)
    expect(shadowErrors).toEqual([])

    const planOutputs: string[] = []
    const planErrors: string[] = []
    expect(await runWizardCommand(['plan', '--case', caseRoot, '--json'], {
      stdout: (line: string) => planOutputs.push(line),
      stderr: (line: string) => planErrors.push(line),
    })).toBe(0)
    expect(planErrors).toEqual([])

    const planJson = JSON.parse(planOutputs.join('\n'))
    const approvedPlan = approveWizardProposedFacts(planJson.plan, ['client.contracts.fee_agreement'])
    const planPath = join(caseRoot, '.waypoint', 'wizard', 'adoption-plan.yaml')
    await writeFile(planPath, stringifyYaml(approvedPlan), 'utf8')

    const outputs: string[] = []
    const errors: string[] = []
    const exitCode = await runWizardCommand(['apply', '--case', caseRoot, '--plan', '.waypoint/wizard/adoption-plan.yaml', '--json'], {
      stdout: (line: string) => outputs.push(line),
      stderr: (line: string) => errors.push(line),
    })

    expect(exitCode).toBe(0)
    expect(errors).toEqual([])
    const json = JSON.parse(outputs.join('\n'))
    expect(json.applied_facts).toEqual([
      expect.objectContaining({ fact: 'client.contracts.fee_agreement', status: 'signed' }),
    ])
    expect(json.skipped_facts).toEqual([
      expect.objectContaining({ fact: 'client.authorizations.hipaa', reason: 'unapproved' }),
    ])
    expect(json.guidance.stage).toBeTruthy()

    const clientState = await readFirmVaultCaseState(caseRoot, { section: 'client' })
    const client = clientState.state.client as {
      contracts?: { fee_agreement?: { status?: string } }
      authorizations?: { hipaa?: { status?: string } }
    }
    expect(client.contracts?.fee_agreement?.status).toBe('signed')
    expect(client.authorizations?.hipaa?.status).not.toBe('signed')
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