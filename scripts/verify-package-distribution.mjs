import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const tempRoot = await mkdtemp(join(tmpdir(), 'waypoint-package-distribution-'))
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

function readPackedJson(tarball, path) {
  const raw = execFileSync('tar', ['-xOf', tarball, path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(raw)
}

function dependencyEntries(manifest) {
  return [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.devDependencies ?? {}),
    ...Object.entries(manifest.peerDependencies ?? {}),
    ...Object.entries(manifest.optionalDependencies ?? {}),
  ]
}

function assertPublishablePackedManifest({ manifest, tarball }) {
  if (manifest.private === true) {
    throw new Error(`${manifest.name} packed manifest from ${basename(tarball)} has private: true`)
  }

  for (const [name, specifier] of dependencyEntries(manifest)) {
    if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
      throw new Error(`${manifest.name} packed dependency ${name} leaked workspace specifier ${specifier}`)
    }
  }
}

function fileSpec(path) {
  return `file:${path}`
}

try {
  await mkdir(packDir, { recursive: true })
  await mkdir(projectDir, { recursive: true })

  run('pnpm', ['build'])

  const coreTarball = await packPackage(repoRoot, 'waypoint-core-')
  const folderHostTarball = await packPackage(join(repoRoot, 'packages/waypoint-folder-host'), 'waypoint-folder-host-')
  const cliTarball = await packPackage(join(repoRoot, 'packages/waypoint-cli'), 'waypoint-cli-')

  const packedPackages = [
    { tarball: coreTarball, manifest: readPackedJson(coreTarball, 'package/package.json') },
    { tarball: folderHostTarball, manifest: readPackedJson(folderHostTarball, 'package/package.json') },
    { tarball: cliTarball, manifest: readPackedJson(cliTarball, 'package/package.json') },
  ]

  for (const packedPackage of packedPackages) {
    assertPublishablePackedManifest(packedPackage)
  }

  await writeFile(
    join(projectDir, 'package.json'),
    `${JSON.stringify(
      {
        type: 'module',
        private: true,
        dependencies: {
          '@waypoint/core': fileSpec(coreTarball),
          '@waypoint/folder-host': fileSpec(folderHostTarball),
          '@waypoint/cli': fileSpec(cliTarball),
        },
        pnpm: {
          // Local tarballs do not provide a registry index for exact transitive @waypoint/* deps.
          // The manifest checks above prove packed packages are publishable; these overrides let the
          // clean temp project simulate registry resolution without reaching npmjs.org.
          overrides: {
            '@waypoint/core': fileSpec(coreTarball),
            '@waypoint/folder-host': fileSpec(folderHostTarball),
          },
        },
      },
      null,
      2,
    )}\n`,
  )

  run('pnpm', ['install', '--ignore-scripts'], { cwd: projectDir })

  await writeFile(
    join(projectDir, 'verify.mjs'),
    `import { parseQuestManifest, createQuestRegistry } from '@waypoint/core'\n` +
      `import { loadBundledWaypointCatalog, runReferralPackageBuilder } from '@waypoint/folder-host'\n` +
      `import { runWaypointCli } from '@waypoint/cli'\n` +
      `const checks = { parseQuestManifest, createQuestRegistry, loadBundledWaypointCatalog, runReferralPackageBuilder, runWaypointCli }\n` +
      `for (const [name, value] of Object.entries(checks)) {\n` +
      `  if (typeof value !== 'function') throw new Error(name + ' export missing')\n` +
      `}\n` +
      `const catalog = await loadBundledWaypointCatalog()\n` +
      `if (!catalog.quests.has('referral-package')) throw new Error('referral-package quest missing')\n` +
      `const resolved = catalog.resolveQuestRecipes('referral-package')\n` +
      `if (!resolved.ok) throw new Error(resolved.message)\n` +
      `console.log('installed package imports and bundled catalog: ok')\n`,
  )
  run('node', ['verify.mjs'], { cwd: projectDir })
  run('pnpm', ['exec', 'waypoint', '--version'], { cwd: projectDir })

  for (const { manifest, tarball } of packedPackages) {
    console.log(`${manifest.name}@${manifest.version}: ${basename(tarball)}`)
  }
  console.log(`Package distribution project: ${projectDir}`)
  console.log('Waypoint package distribution verification passed')
} finally {
  if (process.env.WAYPOINT_KEEP_PACKAGE_DISTRIBUTION_SMOKE !== '1') {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
