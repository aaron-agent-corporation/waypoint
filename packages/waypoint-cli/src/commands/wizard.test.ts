import { describe, expect, it } from 'vitest'

import { runWizardCommand } from './wizard'

describe('wizard scan CLI', () => {
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