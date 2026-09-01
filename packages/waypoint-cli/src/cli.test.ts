import { describe, expect, it } from 'vitest'

import { runWaypointCli } from './bin'
import rootPackage from '../../../package.json' with { type: 'json' }

const rootPackageVersion = rootPackage.version

describe('Waypoint CLI scaffold', () => {
  it('prints the package version for --version', async () => {
    const output: string[] = []

    const exitCode = await runWaypointCli(['--version'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })

    expect(exitCode).toBe(0)
    expect(output.join('\n')).toContain(rootPackageVersion)
  })

  it('prints help that names the local folder host', async () => {
    const output: string[] = []

    const exitCode = await runWaypointCli(['--help'], {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
    })

    expect(exitCode).toBe(0)
    expect(output.join('\n')).toContain('Runner — local quest host')
  })
})
