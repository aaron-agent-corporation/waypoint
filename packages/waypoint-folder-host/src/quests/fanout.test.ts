import { describe, expect, it } from 'vitest'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  expandQuestFanout,
  expandQuestFanoutFromDisk,
  fanoutItemsFrom,
  fanoutSpecFor,
  readFanoutDirectory,
  type FanoutItem,
  type FanoutSpec,
} from './fanout.ts'

const PROVIDERS: FanoutSpec = { dir: 'medical-providers', ends_with: '.md' }

function questWith(plans: unknown[]): unknown {
  return { workstreams: [{ milestones: [{ phases: [{ phase_slug: 'build', plans }] }] }] }
}

function plansOf(scaffolds: unknown): Record<string, unknown>[] {
  const ws = (scaffolds as { workstreams: { milestones: { phases: { plans: Record<string, unknown>[] }[] }[] }[] })
  return ws.workstreams[0]!.milestones[0]!.phases[0]!.plans
}

const extractPlan = {
  plan_ref: 'extract',
  title: 'Page every encounter for {item}',
  wave: 2,
  metadata: {
    runner: {
      node: { type: 'recipe' },
      recipe: { slug: 'medical-layer-extract' },
      fanout: { dir: 'medical-providers', ends_with: '.md' },
    },
  },
}

describe('resolving a fan-out list', () => {
  it('sorts before slugging, so readdir order never reaches the graph', () => {
    const a = fanoutItemsFrom(PROVIDERS, ['starlite-chiropractic.md', 'audubon-hospital.md', 'amin.md'])
    const b = fanoutItemsFrom(PROVIDERS, ['amin.md', 'starlite-chiropractic.md', 'audubon-hospital.md'])

    expect(a.map((i) => i.slug)).toEqual(['amin', 'audubon-hospital', 'starlite-chiropractic'])
    expect(a).toEqual(b)
  })

  it('drops entries that do not match the suffix, and keeps the path for the work order', () => {
    const items = fanoutItemsFrom(PROVIDERS, ['audubon-hospital.md', 'README.txt', '.DS_Store'])

    expect(items).toEqual([{ slug: 'audubon-hospital', label: 'audubon-hospital', path: 'medical-providers/audubon-hospital.md' }])
  })

  it('refuses an entry that would not make a usable task key', () => {
    expect(() => fanoutItemsFrom(PROVIDERS, ["O'Brien Clinic.md"])).toThrow(/must be a plain slug/)
  })
})

describe('reading the fan-out block', () => {
  it('is absent for an ordinary plan', () => {
    expect(fanoutSpecFor({ runner: { node: { type: 'recipe' } } })).toBeUndefined()
  })

  it('refuses a fan-out with nothing to expand over', () => {
    expect(() => fanoutSpecFor({ runner: { fanout: { ends_with: '.md' } } })).toThrow(/no `dir` to expand over/)
  })
})

describe('expanding a quest', () => {
  const eight: FanoutItem[] = ['amin-family-medical-center', 'audubon-hospital', 'starlite-chiropractic'].map((slug) => ({
    slug,
    label: slug,
    path: `medical-providers/${slug}.md`,
  }))

  it('makes one plan per item and leaves every other plan alone', () => {
    const expanded = plansOf(
      expandQuestFanout(questWith([{ plan_ref: 'seed', title: 'Seed the layer', wave: 1 }, extractPlan, { plan_ref: 'verify', title: 'Verify', wave: 3 }]), () => eight),
    )

    expect(expanded.map((p) => p.plan_ref)).toEqual([
      'seed',
      'extract--amin-family-medical-center',
      'extract--audubon-hospital',
      'extract--starlite-chiropractic',
      'verify',
    ])
  })

  it('keeps the source wave on every sibling, which is what makes them a parallel join', () => {
    const expanded = plansOf(expandQuestFanout(questWith([extractPlan]), () => eight))

    expect(expanded.every((p) => p.wave === 2)).toBe(true)
  })

  it('fills the author’s blank rather than writing a title of its own', () => {
    const expanded = plansOf(expandQuestFanout(questWith([extractPlan]), () => eight))

    expect(expanded.map((p) => p.title)).toEqual([
      'Page every encounter for amin-family-medical-center',
      'Page every encounter for audubon-hospital',
      'Page every encounter for starlite-chiropractic',
    ])
  })

  it('hands each sibling its one item and drops the fanout block it came from', () => {
    const expanded = plansOf(expandQuestFanout(questWith([extractPlan]), () => eight))
    const runner = (expanded[1]!.metadata as { runner: Record<string, unknown> }).runner

    expect(runner.fanout_item).toEqual({
      slug: 'audubon-hospital',
      label: 'audubon-hospital',
      path: 'medical-providers/audubon-hospital.md',
    })
    // The block is consumed by the expansion; a sibling carrying it would
    // expand again on any re-read.
    expect(runner.fanout).toBeUndefined()
    expect(runner.recipe).toEqual({ slug: 'medical-layer-extract' })
  })

  it('is byte-stable for identical input', () => {
    const once = expandQuestFanout(questWith([extractPlan]), () => eight)
    const twice = expandQuestFanout(questWith([extractPlan]), () => eight)

    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })

  it('refuses a fan-out that resolved to nothing, rather than silently doing no work', () => {
    // The whole point: a step that quietly covers zero items is the failure
    // this primitive exists to prevent, so it must never be startable.
    expect(() => expandQuestFanout(questWith([extractPlan]), () => [])).toThrow(/would silently do nothing/)
  })

  it('accepts an empty run only where the author said so, and drops the plan', () => {
    const optional = {
      ...extractPlan,
      metadata: { runner: { ...extractPlan.metadata.runner, fanout: { dir: 'medical-providers', ends_with: '.md', allow_empty: true } } },
    }

    expect(plansOf(expandQuestFanout(questWith([optional]), () => []))).toEqual([])
  })

  it('refuses two items that would collide on one task key', () => {
    const dupes: FanoutItem[] = [
      { slug: 'audubon-hospital', label: 'audubon-hospital' },
      { slug: 'audubon-hospital', label: 'Audubon again' },
    ]

    expect(() => expandQuestFanout(questWith([extractPlan]), () => dupes)).toThrow(/duplicate ref/)
  })

  it('leaves a quest with no fan-out plans exactly as it was', () => {
    const plain = questWith([{ plan_ref: 'seed', title: 'Seed the layer', wave: 1 }])

    expect(JSON.stringify(expandQuestFanout(plain, () => eight))).toBe(JSON.stringify(plain))
  })
})


describe('reading the fan-out list off disk', () => {
  async function caseWithRegistry(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'waypoint-fanout-'))
    // The registry's real shape: one DIRECTORY per provider, plus loose files
    // that are documentation, not providers.
    for (const provider of ['audubon-hospital', 'starlite-chiropractic', 'amin-family-medical-center']) {
      await mkdir(join(root, 'medical-providers', provider), { recursive: true })
      await writeFile(join(root, 'medical-providers', provider, 'provider.md'), '# provider\n')
    }
    await writeFile(join(root, 'medical-providers', 'README.md'), '# how this registry works\n')
    await writeFile(join(root, 'medical-providers', 'unidentified-providers.md'), '# unidentified\n')
    return root
  }

  it('fans out over the provider DIRECTORIES, not the registry’s own notes', async () => {
    // The bug this pins: matched as files on '.md', the registry yields README
    // and unidentified-providers — a fan-out resolving to the wrong two items,
    // which is worse than one resolving to none because it looks like it worked.
    const root = await caseWithRegistry()

    const items = await readFanoutDirectory(root, { dir: 'medical-providers', directories: true }, 'extract')

    expect(items.map((i) => i.slug)).toEqual(['amin-family-medical-center', 'audubon-hospital', 'starlite-chiropractic'])
  })

  it('refuses a directory that leaves the project', async () => {
    const root = await caseWithRegistry()

    await expect(readFanoutDirectory(root, { dir: '../elsewhere', directories: true }, 'extract')).rejects.toThrow(
      /leaves the project/,
    )
  })

  it('refuses a directory that is not there, rather than covering nothing', async () => {
    const root = await caseWithRegistry()

    await expect(readFanoutDirectory(root, { dir: 'no-such-registry', directories: true }, 'extract')).rejects.toThrow(
      /could not be read/,
    )
  })

  it('expands a whole quest manifest against the project on disk', async () => {
    const root = await caseWithRegistry()
    const quest = {
      slug: 'medical-knowledge-layer-tools',
      scaffolds: questWith([
        { plan_ref: 'seed', title: 'Seed the layer', wave: 1 },
        {
          plan_ref: 'extract-encounters',
          title: 'Page every clinical encounter for {item}',
          wave: 2,
          metadata: {
            runner: {
              node: { type: 'recipe' },
              recipe: { slug: 'medical-layer-extractor-tools' },
              fanout: { dir: 'medical-providers', directories: true },
            },
          },
        },
      ]),
    }

    const expanded = await expandQuestFanoutFromDisk(root, quest)

    expect(plansOf(expanded.scaffolds).map((p) => p.plan_ref)).toEqual([
      'seed',
      'extract-encounters--amin-family-medical-center',
      'extract-encounters--audubon-hospital',
      'extract-encounters--starlite-chiropractic',
    ])
    // The quest is otherwise untouched — expansion is the only edit.
    expect(expanded.slug).toBe('medical-knowledge-layer-tools')
  })
})
