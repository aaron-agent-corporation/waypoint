import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `--help` is load-bearing for agents by explicit design — it is how a worker
 * discovers what the runner can do — and it had drifted both ways: implemented
 * verbs undocumented (including `route cancel`, the only way to stop a
 * repeating quest) while readers had to open source to learn them
 * (docs/PLAN.md item 49; ruled: gate --help against the dispatch, no separate
 * document to keep honest).
 *
 * The verb lists are DERIVED from the dispatch sources at test time, so a new
 * verb that lands without a help line fails here — there is no second list to
 * maintain.
 */

const srcDir = fileURLToPath(new URL('.', import.meta.url))

async function helpText(): Promise<string> {
  const bin = await readFile(join(srcDir, 'bin.ts'), 'utf8')
  const match = bin.match(/const helpText = `([\s\S]*?)`\n/)
  if (!match) throw new Error('helpText template literal not found in bin.ts')
  return match[1]!
}

/** Top-level verbs, from bin.ts's own dispatch chain. */
async function topLevelVerbs(): Promise<string[]> {
  const bin = await readFile(join(srcDir, 'bin.ts'), 'utf8')
  const verbs = new Set<string>()
  for (const m of bin.matchAll(/command === '([a-z][a-z-]*)'/g)) verbs.add(m[1]!)
  verbs.delete('help') // an alias for --help, not a verb of its own
  return [...verbs].sort()
}

/** Subverbs per command module: commands/<verb>.ts dispatching on args[0]. */
async function subVerbs(): Promise<Map<string, string[]>> {
  const commandsDir = join(srcDir, 'commands')
  const out = new Map<string, string[]>()
  for (const file of await readdir(commandsDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const source = await readFile(join(commandsDir, file), 'utf8')
    const subs = [...source.matchAll(/args\[0\] === '([a-z][a-z-]*)'/g)].map((m) => m[1]!)
    if (subs.length > 0) out.set(file.replace(/\.ts$/, ''), [...new Set(subs)].sort())
  }
  return out
}

describe('--help is gated against the dispatch (item 49)', () => {
  it('documents every implemented top-level verb', async () => {
    const help = await helpText()
    const undocumented = (await topLevelVerbs()).filter(
      (verb) => !new RegExp(`^\\s*waypoint ${verb}( |$)`, 'm').test(help),
    )
    expect(undocumented, 'implemented but absent from --help').toEqual([])
  })

  it('documents every implemented subverb of every command module', async () => {
    const help = await helpText()
    const undocumented: string[] = []
    for (const [verb, subs] of await subVerbs()) {
      for (const sub of subs) {
        // "waypoint <verb> <sub>" — allowing flags between is NOT accepted:
        // the sub must be the verb's first word, the way it is invoked.
        if (!new RegExp(`^\\s*waypoint ${verb} ${sub}( |$)`, 'm').test(help)) {
          undocumented.push(`waypoint ${verb} ${sub}`)
        }
      }
    }
    expect(undocumented, 'implemented but absent from --help').toEqual([])
  })

  it('documents no verb that is not implemented', async () => {
    const help = await helpText()
    const implemented = new Set(await topLevelVerbs())
    const phantom: string[] = []
    for (const m of help.matchAll(/^\s*waypoint ([a-z][a-z-]*)/gm)) {
      if (!implemented.has(m[1]!) && m[1] !== 'help') phantom.push(m[1]!)
    }
    expect([...new Set(phantom)], 'documented but not implemented').toEqual([])
  })
})
