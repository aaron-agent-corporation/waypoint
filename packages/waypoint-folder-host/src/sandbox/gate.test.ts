import { describe, expect, it } from 'vitest'

import type { WaypointProjectSandboxConfig } from '../project/config.ts'
import { RETIRED_MICROSANDBOX_MESSAGE } from '../project/config.ts'
import { SANDBOX_ENV, sandboxConfigProblem, sandboxDisabledByEnv, sandboxEnabledForProject } from './gate.ts'

const sandbox = (overrides: Partial<WaypointProjectSandboxConfig> = {}): WaypointProjectSandboxConfig => ({
  // Admission rules are backend-agnostic; use `fake` so these tests are not
  // gated on the retired microsandbox allowlist.
  backend: 'fake',
  // Host-qualified, and it has to be: an unqualified name means Docker Hub
  // (rsc-zai). This fixture said `alpine` until the image rule landed — the
  // fixture was expressing the very hazard the rule now refuses.
  image: 'localhost/waypoint/worker:slim',
  egress: { default: 'deny', allow: ['api.openai.com'] },
  credential: {
    broker: [{ env_var: 'OPENAI_API_KEY', hosts: ['api.openai.com'] }],
  },
  ...overrides,
})

describe('sandboxEnabledForProject (rsc-wxk)', () => {
  it('is OFF when the project configures no sandbox — opt-in', () => {
    expect(sandboxEnabledForProject(undefined, {})).toBe(false)
  })

  it('stays OFF with no sandbox config even when the env var is set — env cannot conjure an image or policy', () => {
    expect(sandboxEnabledForProject(undefined, { [SANDBOX_ENV]: '1' })).toBe(false)
    expect(sandboxEnabledForProject(undefined, { [SANDBOX_ENV]: 'on' })).toBe(false)
  })

  it('is ON when the project configures a sandbox', () => {
    expect(sandboxEnabledForProject(sandbox(), {})).toBe(true)
  })

  it('honors the env kill switch for a configured sandbox', () => {
    for (const value of ['0', 'false', 'off', 'OFF', ' Off ']) {
      expect(sandboxEnabledForProject(sandbox(), { [SANDBOX_ENV]: value })).toBe(false)
    }
  })

  it('is unaffected by unrelated env values', () => {
    for (const value of ['', '1', 'true', 'yes', 'anything']) {
      expect(sandboxEnabledForProject(sandbox(), { [SANDBOX_ENV]: value })).toBe(true)
    }
  })

  it('reads the kill switch independently of any config', () => {
    expect(sandboxDisabledByEnv({ [SANDBOX_ENV]: 'off' })).toBe(true)
    expect(sandboxDisabledByEnv({})).toBe(false)
  })
})

describe('sandboxConfigProblem (rsc-wxk)', () => {
  it('accepts the adopted policy: deny-by-default, model host allowed, secret brokered to it', () => {
    expect(sandboxConfigProblem(sandbox())).toBeUndefined()
  })

  it('refuses retired microsandbox unless allowRetired', () => {
    const retired = sandbox({ backend: 'microsandbox' })
    expect(sandboxConfigProblem(retired)).toBe(RETIRED_MICROSANDBOX_MESSAGE)
    expect(sandboxConfigProblem(retired, { allowRetired: true })).toBeUndefined()
  })

  it('accepts a policy with no credential at all (egress control alone)', () => {
    expect(sandboxConfigProblem(sandbox({ credential: undefined }))).toBeUndefined()
  })

  it("refuses egress.default 'allow' — a sandbox that permits exfiltration is not a boundary", () => {
    const problem = sandboxConfigProblem(sandbox({ egress: { default: 'allow', allow: ['api.openai.com'] } }))
    expect(problem).toMatch(/sandbox in name only/)
  })

  it('refuses a brokered secret bound to a host the egress firewall blocks', () => {
    const problem = sandboxConfigProblem(sandbox({ egress: { default: 'deny', allow: ['registry.npmjs.org'] } }))
    expect(problem).toMatch(/which runtime\.sandbox\.egress\.allow .* does not permit/)
  })

  it('refuses deny-everything-allow-nothing — the worker could never reach a model', () => {
    const problem = sandboxConfigProblem(sandbox({ egress: { default: 'deny' }, credential: undefined }))
    expect(problem).toMatch(/denies everything and allows nothing/)
  })

  it('accepts a suffix rule that covers the brokered host', () => {
    expect(
      sandboxConfigProblem(sandbox({ egress: { default: 'deny', allow: ['*.openai.com'] } })),
    ).toBeUndefined()
  })

  it('works for a non-Anthropic provider — nothing hardcodes a vendor', () => {
    const grok = sandbox({
      egress: { default: 'deny', allow: ['api.x.ai'] },
      credential: { broker: [{ env_var: 'XAI_API_KEY', hosts: ['api.x.ai'] }] },
    })
    expect(sandboxConfigProblem(grok)).toBeUndefined()
  })
})

/**
 * The spike's load-bearing caveat, made unwritable (docs/spikes/microsandbox.md).
 *
 * microsandbox matches domain rules via intercepted DNS + TLS SNI. A raw-IP
 * connection matches no domain rule and fails closed under default-deny — proven
 * live, zero bytes moved. But an IP/CIDR/group entry matches by ADDRESS, handing
 * back exactly that path. The failure would be silent: the allowed provider still
 * works, so every test still passes while the exfil door stands open.
 */
/**
 * rsc-zai. `msb run` auto-pulls on a cache miss and defaults to Docker Hub, so an
 * unqualified reference is not a name — it is a coordinate in a public namespace
 * anyone can claim. `waypoint` was measured UNCLAIMED (404 for user, org and
 * repo; `library/alpine` control returned 200), which made the fresh-machine path
 * a silent third-party-code-execution hole with the case tree mounted rw.
 *
 * These assert the config cannot EXPRESS that reference. Both halves of the fix
 * were proved live before it was written: `localhost/...` runs from cache offline,
 * and on a miss fails loud rather than reaching the hub.
 */
describe('sandboxConfigProblem — the image reference (rsc-zai namespace takeover)', () => {
  it('REFUSES an unqualified reference — it means Docker Hub, in a namespace we do not own', () => {
    const problem = sandboxConfigProblem(sandbox({ image: 'waypoint/worker:slim' }))
    expect(problem).toMatch(/names no registry host/)
    expect(problem, 'the refusal must name what it would actually have run').toMatch(/docker\.io\/waypoint\/worker:slim/)
  })

  it('REFUSES a bare single-word image — `alpine` is `docker.io/library/alpine`, not a local thing', () => {
    expect(sandboxConfigProblem(sandbox({ image: 'alpine' }))).toMatch(/names no registry host/)
  })

  it('accepts a locally built, host-qualified image — a tag is honest here, no registry can lie', () => {
    expect(sandboxConfigProblem(sandbox({ image: 'localhost/waypoint/worker:slim' }))).toBeUndefined()
    expect(sandboxConfigProblem(sandbox({ image: 'localhost:5000/waypoint/worker:slim' }))).toBeUndefined()
  })

  it('accepts a digest-pinned remote image — the content itself, not a pointer to it', () => {
    const digest = `ghcr.io/aaron-agent-corporation/waypoint-worker@sha256:${'a'.repeat(64)}`
    expect(sandboxConfigProblem(sandbox({ image: digest }))).toBeUndefined()
  })

  it('REFUSES a remote image pinned only by tag — whoever can write the namespace can swap the agent', () => {
    const problem = sandboxConfigProblem(sandbox({ image: 'ghcr.io/aaron-agent-corporation/waypoint-worker:v1' }))
    expect(problem).toMatch(/pins no digest/)
    expect(problem).toMatch(/mutable pointer/)
  })

  it('REFUSES a malformed digest rather than treating it as pinned', () => {
    for (const image of [
      `ghcr.io/ns/worker@sha256:${'a'.repeat(63)}`, // too short
      `ghcr.io/ns/worker@sha256:${'A'.repeat(64)}`, // not lowercase hex
      `ghcr.io/ns/worker@sha512:${'a'.repeat(64)}`, // wrong algorithm
      `ghcr.io/ns/worker@sha256:${'a'.repeat(64)}-extra`, // not anchored at the end
    ]) {
      expect(sandboxConfigProblem(sandbox({ image })), image).toMatch(/pins no digest/)
    }
  })

  it('checks the image BEFORE the egress policy — a stranger\'s agent makes the rest moot', () => {
    // Both are wrong. The image must be what it complains about: an egress rule
    // is irrelevant when the thing that would enforce nothing is not our code.
    const problem = sandboxConfigProblem(sandbox({ image: 'alpine', egress: { default: 'allow', allow: ['api.openai.com'] } }))
    expect(problem).toMatch(/names no registry host/)
  })
})

describe('sandboxConfigProblem — non-domain egress targets (the raw-IP reopening)', () => {
  const withAllow = (allow: string[]) => sandboxConfigProblem(sandbox({ egress: { default: 'deny', allow }, credential: undefined }))

  it('refuses a bare IPv4 target', () => {
    expect(withAllow(['142.251.155.119'])).toMatch(/non-domain target/)
  })

  it('refuses a CIDR target', () => {
    expect(withAllow(['10.0.0.0/8'])).toMatch(/non-domain target/)
  })

  it("refuses the 'public' group — it is default:allow wearing a disguise", () => {
    expect(withAllow(['public'])).toMatch(/non-domain target/)
  })

  it('refuses the private/multicast groups too', () => {
    expect(withAllow(['private'])).toMatch(/non-domain target/)
    expect(withAllow(['multicast'])).toMatch(/non-domain target/)
  })

  it('refuses an IPv6 literal', () => {
    expect(withAllow(['2001:4860:4860::8888'])).toMatch(/non-domain target/)
  })

  it('refuses a mixed list — one bad target is enough, and names the offender', () => {
    const problem = withAllow(['api.openai.com', '10.0.0.0/8'])
    expect(problem).toMatch(/non-domain target/)
    expect(problem).toContain('10.0.0.0/8')
    expect(problem).not.toContain("'api.openai.com'")
  })

  it('accepts plain domains and suffix forms', () => {
    expect(withAllow(['api.openai.com'])).toBeUndefined()
    expect(withAllow(['*.openai.com'])).toBeUndefined()
    expect(withAllow(['suffix=openai.com'])).toBeUndefined()
  })
})

// Multi-provider (2026-07-16): subscription/OAuth agents (Claude Code, Codex,
// Grok) cannot take a placeholder, so the real credential goes INSIDE the
// sandbox and the egress allowlist becomes the only wall.
describe('sandboxConfigProblem — passthrough credentials', () => {
  const passthrough = (overrides: Partial<WaypointProjectSandboxConfig> = {}): WaypointProjectSandboxConfig =>
    sandbox({
      credential: { passthrough: { files: [{ host_path: '~/.claude/.credentials.json', mount_path: '/home/node/.claude/.credentials.json' }] } },
      ...overrides,
    })

  it('accepts passthrough when the egress allowlist names the provider', () => {
    expect(sandboxConfigProblem(passthrough())).toBeUndefined()
  })

  it('refuses passthrough with an empty allowlist — nothing would confine the credential', () => {
    // Caught by the deny-nothing-allowed rule first; either way it does not spawn.
    expect(sandboxConfigProblem(passthrough({ egress: { default: 'deny' } }))).toBeDefined()
  })

  it("refuses passthrough with egress.default 'allow' — a real credential on the open internet", () => {
    const problem = sandboxConfigProblem(passthrough({ egress: { default: 'allow', allow: ['api.openai.com'] } }))
    expect(problem).toMatch(/sandbox in name only/)
  })
})
