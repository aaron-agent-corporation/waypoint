import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { maskCredentials, maskEvidencePayload, redactionFor } from './credential-mask.ts'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const TOOLS = path.join(REPO_ROOT, 'tools/safe-evidence')

/**
 * EVERY SECRET HERE IS FABRICATED, and assembled at runtime rather than written
 * as a literal — the same discipline as tools/safe-evidence/test_credentials.py,
 * for the same reason: this file is committed, and a contiguous credential
 * literal in a committed file is the exact thing the guard exists to stop. The
 * shapes are real; the bodies are typed filler.
 */
const ANTHROPIC = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
const GITHUB = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.dBjftJeZ4CVPmB92K27uhbUJU1p1r'

describe('maskCredentials (rsc-xam)', () => {
  it('redacts a key and names the category, so the evidence stays legible', () => {
    expect(maskCredentials(`ANTHROPIC_API_KEY=${ANTHROPIC}`)).toBe(
      `ANTHROPIC_API_KEY=${redactionFor('Anthropic API key')}`,
    )
  })

  it('the secret is GONE, not merely annotated', () => {
    const masked = maskCredentials(`export KEY=${ANTHROPIC}\nexport GH=${GITHUB}\n`)
    expect(masked).not.toContain(ANTHROPIC)
    expect(masked).not.toContain(GITHUB)
    // Not even a fragment: a partial key is still a partial key.
    expect(masked).not.toContain(ANTHROPIC.slice(20))
  })

  it('keeps the surrounding diagnostic text intact — evidence must stay readable', () => {
    // The whole reason this redacts instead of refusing. An operator has to be
    // able to read what the agent did (2026-05-06: verified outcomes, never
    // say-so), so everything that is not the secret survives byte-for-byte.
    const masked = maskCredentials(`Error: auth failed for key ${ANTHROPIC} against api.anthropic.com`)
    expect(masked).toBe(`Error: auth failed for key ${redactionFor('Anthropic API key')} against api.anthropic.com`)
  })

  it('returns the SAME string when there is nothing to redact', () => {
    const clean = 'ran 42 tests, all passed\nwrote out/report.md\n'
    expect(maskCredentials(clean)).toBe(clean)
  })

  it('redacts only group 1 of an anchored shape, keeping the structure', () => {
    // `"accessToken": "` is structure; the operator should still see that an
    // OAuth blob was present and where.
    const blob = '{"accessToken":"' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4' + '"}'
    expect(maskCredentials(blob)).toBe(`{"accessToken":"${redactionFor('agent OAuth credential')}"}`)
  })

  it('redacts a bearer token but keeps the header shape', () => {
    expect(maskCredentials(`Authorization: Bearer ${GITHUB}`)).toContain('Authorization: Bearer <REDACTED:')
  })

  it('handles several secrets on one line without corrupting offsets', () => {
    const masked = maskCredentials(`a=${ANTHROPIC} b=${GITHUB} end`)
    expect(masked).not.toContain(ANTHROPIC)
    expect(masked).not.toContain(GITHUB)
    expect(masked.startsWith('a=<REDACTED:')).toBe(true)
    expect(masked.endsWith(' end')).toBe(true)
  })

  it('leaves placeholders alone — redacting docs helps nobody', () => {
    for (const text of ['Authorization: Bearer <your-token>', 'Authorization: Bearer ${TOKEN}', 'Bearer YOUR_API_KEY_HERE']) {
      expect(maskCredentials(text)).toBe(text)
    }
  })

  it('leaves a JWT inside a URL alone — that is evidence, not a leak', () => {
    // The rule the repo sweep forced: 155 findings, all vendor invoice links in
    // client email. Redacting them would corrupt the record it protects.
    const link = `https://my.freshbooks.com/#/link/${JWT}?invoiceNumber=0000088`
    expect(maskCredentials(`View your invoice: ${link}`)).toBe(`View your invoice: ${link}`)
  })

  it('still redacts a BARE jwt — that is the leak shape', () => {
    expect(maskCredentials(`id_token=${JWT}`)).toBe(`id_token=${redactionFor('JWT')}`)
  })
})

describe('maskEvidencePayload — the fields an agent can write into (rsc-xam)', () => {
  it('masks stdout, stderr, error and close_reason', () => {
    const masked = maskEvidencePayload({
      status: 'failed',
      stdout: `key=${ANTHROPIC}`,
      stderr: `Bearer ${GITHUB}`,
      error: `spawn failed with ${ANTHROPIC}`,
      close_reason: `failed: ${ANTHROPIC}`,
    })
    for (const field of ['stdout', 'stderr', 'error', 'close_reason']) {
      expect(String(masked[field]), field).not.toContain(ANTHROPIC)
      expect(String(masked[field]), field).not.toContain(GITHUB)
    }
  })

  it('does NOT touch the engine\'s own fields', () => {
    // The mask must not rewrite our data to protect it from a secret that cannot
    // be in it. exit_code 0 stays 0; the apply record stays byte-identical.
    const apply = { mode: 'verify_then_apply', applied: ['out/report.md'], missing: [] }
    const masked = maskEvidencePayload({ status: 'finished', exit_code: 0, apply, stdout: 'clean' })
    expect(masked.exit_code).toBe(0)
    expect(masked.apply).toBe(apply)
    expect(masked.status).toBe('finished')
  })

  it('returns the SAME object when nothing was masked — no needless churn', () => {
    const payload = { status: 'finished', stdout: 'wrote out/report.md', stderr: '' }
    expect(maskEvidencePayload(payload)).toBe(payload)
  })

  it('survives a payload whose fields are absent or not strings', () => {
    expect(() => maskEvidencePayload({ status: 'failed', stdout: undefined, stderr: 42 })).not.toThrow()
  })

  it('THE SCENARIO: an env dump never reaches the durable row', () => {
    // What the bead is actually about. This payload is what the bridge signals
    // into pg_durable and writes to metadata.runner.evidence — and on a retry,
    // reads back into the NEXT agent's prompt as output_tail.
    const masked = maskEvidencePayload({
      status: 'failed',
      stdout: [
        '$ env',
        'PATH=/usr/bin:/bin',
        `ANTHROPIC_API_KEY=${ANTHROPIC}`,
        'WAYPOINT_POSTGRES_URL=postgres://waypoint@localhost:5433/postgres',
      ].join('\n'),
    })
    const stdout = String(masked.stdout)
    expect(stdout, 'the key would have been written to Postgres AND re-injected into a prompt').not.toContain(ANTHROPIC)
    expect(stdout, 'the diagnostic value of the dump survives').toContain('PATH=/usr/bin:/bin')
  })
})

/**
 * The claim rsc-xam rests on: ONE pattern set, not two that drift. These prove
 * it rather than asserting it — the generated TS is byte-compared against a fresh
 * render of the JSON, and both engines are run over the same corpus.
 */
describe('one pattern set: the Python guard and this mask agree (rsc-889/rsc-xam)', () => {
  it('the generated TS matches the JSON — no hand-edit survives', async () => {
    // Same shape as the prose drift gate: recompile, byte-diff, refuse.
    await expect(
      execFileAsync('python3', [path.join(TOOLS, 'gen-ts-patterns.py'), '--check']),
      'credential-patterns.generated.ts is stale — run tools/safe-evidence/gen-ts-patterns.py',
    ).resolves.toBeDefined()
  })

  it('the mask consumes the SAME json the guard does', async () => {
    const spec = JSON.parse(await readFile(path.join(TOOLS, 'credential-patterns.json'), 'utf8'))
    const generated = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'credential-patterns.generated.ts'), 'utf8')
    for (const entry of spec.simple) expect(generated).toContain(entry.category)
    expect(generated).toContain(spec.jwt.category)
  })

  it('BOTH ENGINES find the same categories in the same corpus', async () => {
    // The real conformance check. Python `re` and JS RegExp are different
    // engines; the JSON is dialect-clean by rule (no named groups, no inline
    // flags), and this is what proves the rule held.
    const corpus = [
      `ANTHROPIC_API_KEY=${ANTHROPIC}`,
      `token: ${GITHUB}`,
      `id_token=${JWT}`,
      `https://vendor.example.com/pay/${JWT}?x=1`,
      'Authorization: Bearer <your-token>',
      `Authorization: Bearer ${GITHUB}`,
      '{"accessToken":"' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4' + '"}',
      'AWS_ACCESS_KEY_ID=' + 'AKIA' + 'IOSFODNN7EXAMPLE',
      'nothing to see here',
      'the token begins ghp_ and lives in 1Password',
    ].join('\n')

    // The corpus rides in on argv, not stdin: execFile has no `input` option, so
    // a stdin-reading child just hangs until the test times out.
    const { stdout } = await execFileAsync('python3', [
      '-c',
      [
        'import sys, json',
        `sys.path.insert(0, ${JSON.stringify(TOOLS)})`,
        'from credentials import scan_credentials',
        'print(json.dumps(sorted({(f.category, f.line) for f in scan_credentials(sys.argv[1])})))',
      ].join('\n'),
      corpus,
    ])
    const pythonFindings: [string, number][] = JSON.parse(stdout)

    // The mask does not report findings, so derive category + line from what it
    // redacted.
    const tsFindings: [string, number][] = []
    corpus.split('\n').forEach((line, i) => {
      const masked = maskCredentials(line)
      if (masked === line) return
      for (const m of masked.matchAll(/<REDACTED:([^>]+)>/g)) tsFindings.push([m[1]!, i + 1])
    })

    // AGREEMENT IS ON LINES, NOT ON CATEGORY SETS — and that is not the test
    // being lenient, it is the two verbs differing where spans overlap.
    // `Authorization: Bearer ghp_...` is ONE secret with TWO true names: the
    // bearer pattern's group 1 IS the GitHub token, the same span. The guard
    // DETECTS and reports both, because an operator wants every reason a line was
    // flagged. The mask REDACTS and can only replace that span once, under one
    // label. Demanding equal category sets would force one engine to lie.
    //
    // What must hold, and what actually catches drift: neither engine may miss a
    // line the other catches (a pattern present in one and not the other moves a
    // line), and the mask may never invent a category the guard does not know.
    const lines = (xs: [string, number][]): number[] => [...new Set(xs.map(([, l]) => l))].sort((a, b) => a - b)
    expect(lines(tsFindings), 'a line is flagged by one engine and not the other — the patterns have drifted').toEqual(
      lines(pythonFindings),
    )

    const pythonCategories = new Set(pythonFindings.map(([c]) => c))
    for (const [category] of tsFindings) {
      expect(pythonCategories, `the mask redacted a category the guard does not know: ${category}`).toContain(category)
    }
  })
})
