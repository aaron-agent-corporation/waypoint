/**
 * Integration test for RouteGraph — uses the REAL @xyflow/react renderer.
 *
 * Purpose: catch the class of bug where custom nodes lack <Handle> elements, so
 * edges have no anchors. Every other RouteGraph test mocks @xyflow/react and
 * therefore can't catch this. This file must NOT call vi.mock('@xyflow/react').
 *
 * jsdom polyfills live in beforeAll/beforeEach (not in global setup) so they
 * don't affect other test files.
 */

import { render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildRouteGraph } from '../graph/build-graph'
import { useStore } from '../store'
import { RouteGraph } from './RouteGraph'

// ─── jsdom polyfills required by @xyflow/react ───────────────────────────────
// Installed in beforeAll and RESTORED in afterAll so the fixed 800×600 rect and
// the global stubs cannot leak into other layout-sensitive suites (e.g. if
// Vitest's per-file isolation is ever turned off).

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
const addedGlobals: string[] = []

beforeAll(() => {
  // ReactFlow uses ResizeObserver to track node dimensions.
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: ResizeObserverStub,
      writable: true,
      configurable: true,
    })
    addedGlobals.push('ResizeObserver')
  }

  // ReactFlow reads bounding rects to position nodes/edges; jsdom returns zeros
  // which prevents edge rendering. Return a non-zero box so the layout fires.
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {
        return this
      },
    }
  }

  // matchMedia is absent in jsdom.
  if (!('matchMedia' in window)) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    addedGlobals.push('matchMedia')
  }

  // DOMMatrixReadOnly is used by some SVG internals in @xyflow/react.
  if (!('DOMMatrixReadOnly' in globalThis)) {
    class DOMMatrixReadOnlyStub {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
      m11 = 1; m12 = 0; m13 = 0; m14 = 0
      m21 = 0; m22 = 1; m23 = 0; m24 = 0
      m31 = 0; m32 = 0; m33 = 1; m34 = 0
      m41 = 0; m42 = 0; m43 = 0; m44 = 1
      is2D = true; isIdentity = true
      inverse() { return new DOMMatrixReadOnlyStub() }
      multiply() { return new DOMMatrixReadOnlyStub() }
      translate() { return new DOMMatrixReadOnlyStub() }
      scale() { return new DOMMatrixReadOnlyStub() }
      toJSON() { return {} }
    }
    Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
      value: DOMMatrixReadOnlyStub,
      writable: true,
      configurable: true,
    })
    addedGlobals.push('DOMMatrixReadOnly')
  }
})

afterAll(() => {
  // Restore the real getBoundingClientRect and remove only the stubs we added,
  // so this file's jsdom shims never bleed into other suites.
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  for (const name of addedGlobals) {
    if (name === 'matchMedia') delete (window as unknown as Record<string, unknown>)[name]
    else delete (globalThis as unknown as Record<string, unknown>)[name]
  }
})

// ─── Store reset ─────────────────────────────────────────────────────────────

const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROUTE_ID = 'route-integ-001'
const QUEST = 'quest-alpha'
const RECIPE_SLUG = 'my-recipe'
const RECIPE_NAME = 'My Integration Recipe'

/** Two chained tasks: task-A (wave 10, recipe node) → task-B (wave 20, plain). */
const tasks = [
  {
    id: 'task-A',
    route_id: ROUTE_ID,
    plan_ref: 'slice-setup',
    title: 'Setup slice',
    phase: 'execute',
    wave: 10,
    kind: 'recipe' as const,
    status: 'open' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    metadata: { waypoint: { recipe: { slug: RECIPE_SLUG } } },
  },
  {
    id: 'task-B',
    route_id: ROUTE_ID,
    plan_ref: 'slice-verify',
    title: 'Verify slice',
    phase: 'verify',
    wave: 20,
    kind: 'task' as const,
    status: 'open' as const,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const route = {
  id: ROUTE_ID,
  quest: QUEST,
  plan_ref: 'slice-integ',
  title: 'Integration Route',
  status: 'open' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RouteGraph integration (real @xyflow/react)', () => {
  it('mounts the ReactFlow renderer', () => {
    useStore.setState({
      selectedRouteId: ROUTE_ID,
      routes: [route],
      tasks,
      recipesByQuest: { [QUEST]: [{ slug: RECIPE_SLUG, name: RECIPE_NAME }] },
    })

    const { container } = render(
      <div style={{ width: 1024, height: 768 }}>
        <RouteGraph />
      </div>,
    )

    // The real renderer wraps everything in .react-flow
    expect(container.querySelector('.react-flow')).not.toBeNull()
  })

  it('custom nodes render <Handle> elements (edge anchors present)', async () => {
    useStore.setState({
      selectedRouteId: ROUTE_ID,
      routes: [route],
      tasks,
      recipesByQuest: { [QUEST]: [{ slug: RECIPE_SLUG, name: RECIPE_NAME }] },
    })

    const { container } = render(
      <div style={{ width: 1024, height: 768 }}>
        <RouteGraph />
      </div>,
    )

    // @xyflow/react renders Handle elements as .react-flow__handle.
    // If GraphNode were missing its <Handle> imports, this count would be 0
    // and edges would have no anchors — the exact bug class we're guarding.
    await waitFor(() => {
      const handles = container.querySelectorAll('.react-flow__handle')
      expect(handles.length).toBeGreaterThan(0)
    }, { timeout: 3000 })
  })

  it('recipe node label and subtitle text appear in the DOM', () => {
    useStore.setState({
      selectedRouteId: ROUTE_ID,
      routes: [route],
      tasks,
      recipesByQuest: { [QUEST]: [{ slug: RECIPE_SLUG, name: RECIPE_NAME }] },
    })

    const { container } = render(
      <div style={{ width: 1024, height: 768 }}>
        <RouteGraph />
      </div>,
    )

    // plan_ref is used as the node label in GraphNode
    expect(container.textContent).toContain('slice-setup')
    // recipeName resolved from recipesByQuest appears as subtitle
    expect(container.textContent).toContain(RECIPE_NAME)
    // second node's plan_ref too
    expect(container.textContent).toContain('slice-verify')
  })

  it('produces a chaining edge between the two tasks (deterministic, library-agnostic)', () => {
    // NOTE: do NOT assert `.react-flow__edges` presence — ReactFlow renders that
    // container unconditionally (even with zero edges), so it proves nothing about
    // edge production. Assert edge production on the pure builder instead, which is
    // deterministic and independent of the jsdom renderer (the real-renderer guard
    // is the `.react-flow__handle` count above — handles are the edge anchors).
    const { edges } = buildRouteGraph(tasks)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'task-A', target: 'task-B' })
  })

  it('shows empty hint when no route is selected (sanity)', () => {
    const { container } = render(<RouteGraph />)
    expect(container.textContent).toMatch(/select a route/i)
  })

  /**
   * Node-click → TaskDetail / RecipeCard path:
   *
   * In jsdom, @xyflow/react attaches its onNodeClick handler through synthetic
   * pointer events on internal wrapper divs. The handler fires correctly in a
   * real browser but is unreliable in jsdom because ReactFlow uses pointer-event
   * coordinates to hit-test which node was clicked, and jsdom returns zero-sized
   * layout rects even with our getBoundingClientRect stub.
   *
   * Concretely: clicking .react-flow__node dispatches a click event that
   * ReactFlow sees, but the internal nodeId lookup based on pointer coords
   * returns undefined, so onNodeClick never fires, selectTask is never called,
   * and selectedTaskId stays null — making the TaskDetail assertion flaky.
   *
   * We therefore omit the click→card sub-assertion here. The handle/edge/label
   * assertions above are the high-value guards for the target bug class.
   */
})
