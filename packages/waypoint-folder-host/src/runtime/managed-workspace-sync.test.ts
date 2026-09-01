import { describe, expect, it } from 'vitest'

import { createHostProjectTarStream } from './host-project-tar.ts'

describe('createHostProjectTarStream', () => {
  it('streams a tar archive from the host project root', async () => {
    const { stdout, done } = createHostProjectTarStream(process.cwd())
    const chunks: Buffer[] = []
    for await (const chunk of stdout) chunks.push(Buffer.from(chunk))
    await expect(done).resolves.toBe(0)
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0)
  })
})
