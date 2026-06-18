import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function collectFiles(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files)
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function resolveRelativeJsSpecifier(filePath, specifier) {
  if (!specifier.startsWith('.') || extname(specifier) !== '') {
    return specifier
  }

  const base = resolve(dirname(filePath), specifier)
  if (await pathExists(`${base}.js`)) {
    return `${specifier}.js`
  }
  if (await pathExists(resolve(base, 'index.js'))) {
    return `${specifier}/index.js`
  }
  return specifier
}

async function rewriteRuntimeImportSpecifiers() {
  const files = (await collectFiles(resolve(repoRoot, 'dist'))).filter((file) => file.endsWith('.js'))
  const importExportPattern = /((?:from\s+|import\s*\(\s*)["'])(\.{1,2}\/[^"']+)(["'])/g

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const replacements = []
    for (const match of source.matchAll(importExportPattern)) {
      const [, prefix, specifier, suffix] = match
      const rewritten = await resolveRelativeJsSpecifier(file, specifier)
      if (rewritten !== specifier) {
        replacements.push([match[0], `${prefix}${rewritten}${suffix}`])
      }
    }

    if (replacements.length === 0) {
      continue
    }

    let rewrittenSource = source
    for (const [oldText, newText] of replacements) {
      rewrittenSource = rewrittenSource.replaceAll(oldText, newText)
    }
    await writeFile(file, rewrittenSource)
  }
}

async function stagePackageBuild(packagePath) {
  const source = resolve(repoRoot, 'dist', packagePath, 'src')
  const target = resolve(repoRoot, packagePath, 'dist')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true })
}

await rewriteRuntimeImportSpecifiers()
await stagePackageBuild('packages/waypoint-folder-host')
await stagePackageBuild('packages/waypoint-cli')
await stagePackageBuild('packages/waypoint-engine-host')
