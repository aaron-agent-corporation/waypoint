import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const exampleRoot = resolve(__dirname)

function readExampleFile(path: string): string {
  return readFileSync(resolve(exampleRoot, path), 'utf8')
}

describe('folder host Quest example', () => {
  it('documents a direct Node CLI walkthrough and ignores generated state', () => {
    const readme = readExampleFile('README.md')
    const gitignore = readExampleFile('.gitignore')

    expect(gitignore).toContain('.waypoint/')
    expect(readme).toContain('Waypoint folder-host Quest example')
    expect(readme).toContain('node ../../packages/waypoint-cli/src/bin.ts init --quest runner')
    expect(readme).toContain('node ../../packages/waypoint-cli/src/bin.ts start --quest runner')
    expect(readme).toContain('node ../../packages/waypoint-cli/src/bin.ts discuss --task-id task-003')
    expect(readme).toContain('node ../../packages/waypoint-cli/src/bin.ts auto --route-id route-001')
    expect(readme).toContain('rm -rf .waypoint')
    expect(readme).toContain('runtime.recipe: local')
  })
})
