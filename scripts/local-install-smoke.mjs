import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(import.meta.dirname, '..')
const tempRoot = await mkdtemp(join(tmpdir(), 'runner-install-smoke-'))
const packDir = join(tempRoot, 'packs')
const projectDir = join(tempRoot, 'project')

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(' ')
  console.log(`$ ${rendered}`)
  const output = execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (output.trim()) console.log(output.trim())
  return output
}

async function packPackage(packageDir, tarballPrefix) {
  run('pnpm', ['pack', '--pack-destination', packDir], { cwd: packageDir })
  const files = await readdir(packDir)
  const tarballs = files
    .filter((file) => file.startsWith(tarballPrefix) && file.endsWith('.tgz'))
    .map((file) => join(packDir, file))
    .sort()
  const latest = tarballs.at(-1)
  if (!latest) throw new Error(`pnpm pack did not create ${tarballPrefix}*.tgz for ${packageDir}`)
  return latest
}

function fileSpec(path) {
  return `file:${path}`
}

try {
  await mkdir(packDir, { recursive: true })
  await mkdir(projectDir, { recursive: true })

  run('pnpm', ['build'])

  const coreTarball = await packPackage(repoRoot, 'runner-core-')
  const folderHostTarball = await packPackage(join(repoRoot, 'packages/waypoint-folder-host'), 'waypoint-folder-host-')
  const cliTarball = await packPackage(join(repoRoot, 'packages/waypoint-cli'), 'waypoint-cli-')

  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        private: true,
        dependencies: {
          '@waypoint-engine/core': fileSpec(coreTarball),
          '@waypoint-engine/folder-host': fileSpec(folderHostTarball),
          '@waypoint-engine/cli': fileSpec(cliTarball),
        },
        pnpm: {
          overrides: {
            '@waypoint-engine/core': fileSpec(coreTarball),
            '@waypoint-engine/folder-host': fileSpec(folderHostTarball),
          },
        },
      },
      null,
      2,
    )}\n`,
  )

  run('pnpm', ['install'], { cwd: projectDir })
  // This install smoke intentionally exercises the installed bin, equivalent to `pnpm add` of the three packed tarballs.

  run('pnpm', ['exec', 'runner', '--version'], { cwd: projectDir })
  run('pnpm', ['exec', 'runner', 'init', '--quest', 'runner'], { cwd: projectDir })
  run('pnpm', ['exec', 'runner', 'start', '--quest', 'runner'], { cwd: projectDir })
  run('pnpm', ['exec', 'runner', 'routes'], { cwd: projectDir })
  run('pnpm', ['exec', 'runner', 'tasks', '--route-id', 'route-001'], { cwd: projectDir })

  console.log(`Installed tarballs: ${[coreTarball, folderHostTarball, cliTarball].map((tarball) => basename(tarball)).join(', ')}`)
  console.log(`Install smoke project: ${projectDir}`)
  console.log('Waypoint local install smoke passed')
} finally {
  if (process.env.WAYPOINT_KEEP_INSTALL_SMOKE !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
