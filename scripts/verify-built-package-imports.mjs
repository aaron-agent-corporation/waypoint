import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

function requireBuiltFile(path) {
  const absolute = resolve(repoRoot, path)
  if (!existsSync(absolute)) {
    throw new Error(`Missing built file: ${path}. Run pnpm build first.`)
  }
  return absolute
}

async function importBuilt(path) {
  return import(pathToFileURL(requireBuiltFile(path)).href)
}

const core = await importBuilt('dist/src/index.js')
if (typeof core.parseQuestManifest !== 'function') throw new Error('core parseQuestManifest export missing')
if (typeof core.parseRecipeManifest !== 'function') throw new Error('core parseRecipeManifest export missing')
console.log('built core import: ok')

const folderHost = await importBuilt('packages/waypoint-folder-host/dist/index.js')
if (typeof folderHost.initWaypointProject !== 'function') throw new Error('folder-host initWaypointProject export missing')
if (typeof folderHost.startQuestRoute !== 'function') throw new Error('folder-host startQuestRoute export missing')
console.log('built folder-host import: ok')

const cli = await importBuilt('packages/waypoint-cli/dist/index.js')
if (typeof cli.runWaypointCli !== 'function') throw new Error('cli runWaypointCli export missing')
console.log('built cli import: ok')

const version = execFileSync('node', ['packages/waypoint-cli/dist/bin.js', '--version'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`unexpected CLI version output: ${version}`)
console.log('built cli bin: ok')
