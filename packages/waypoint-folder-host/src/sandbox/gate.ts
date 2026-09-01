import {
  allowRetiredMicrosandbox,
  RETIRED_MICROSANDBOX_MESSAGE,
  type SandboxParseOptions,
  type WaypointProjectSandboxConfig,
} from '../project/config.ts'

// STATUS: the D12 shelf (Aaron 2026-08-24) is superseded by S1 (2026-08-27,
// docs/designs/sprite-worker-isolation.md): the VM tier is live again as the
// fly-sprites cloud backend via ProjectSandboxProvider, and the shelved
// microsandbox path is RETIRED — parse/admission refuse it unless
// WAYPOINT_ALLOW_RETIRED_MICROSANDBOX re-admits it for legacy argv-builder tests.

/**
 * Kill switch for the worker sandbox (egress allowlist + credential brokering).
 *
 * The production backend is cloud-qualified (`fly-sprites`) via
 * `ProjectSandboxProvider`; local `microsandbox` is retired — see
 * `sandboxConfigProblem` / `parseSandboxConfig`.
 *
 * Deliberately NOT the seatbelt's `WAYPOINT_SEATBELT` shape. The seatbelt's env
 * var can turn the jail ON, because the jail needs nothing but paths it already
 * knows. A sandbox needs an image and an egress policy — things only the project
 * config can supply — so env cannot conjure one. That leaves env exactly one
 * honest job: turning a configured sandbox OFF (bring-up, debugging, an
 * outage). Enabling is the config's job alone.
 */
export const SANDBOX_ENV = 'WAYPOINT_SANDBOX'

/** `WAYPOINT_SANDBOX=off|0|false` disables the sandbox even when configured. */
export function sandboxDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[SANDBOX_ENV] ?? '').trim().toLowerCase()
  return value === '0' || value === 'false' || value === 'off'
}

/**
 * Is the worker sandbox active for this project? Opt-in: absent config means
 * off, and off is byte-for-byte today's behavior.
 */
export function sandboxEnabledForProject(
  sandbox: WaypointProjectSandboxConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (sandbox === undefined) return false
  return !sandboxDisabledByEnv(env)
}

/**
 * A domain, a domain suffix (`*.example.com`), or something else.
 *
 * microsandbox's `--net-rule` grammar accepts IPs, CIDRs, domains, domain
 * suffixes and GROUPS (`public`, `private`, `multicast`). We accept only the
 * domain forms — see `nonDomainEgressTarget` for why.
 */
function isDomainTarget(target: string): boolean {
  const bare = target.startsWith('*.') ? target.slice(2) : target.startsWith('suffix=') ? target.slice(7) : target
  if (bare === '') return false
  // An IPv4 literal, an IPv6 literal, or a CIDR is not a domain.
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(bare)) return false
  if (bare.includes(':')) return false
  if (bare.includes('/')) return false
  // A group name (`public`, `private`, …) has no dot; so does a single label.
  if (!bare.includes('.')) return false
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bare)
}

/** A 64-hex content digest, anchored: the whole reference must end in one. */
const DIGEST_SUFFIX = /@sha256:[0-9a-f]{64}$/

/**
 * The registry host an OCI reference names, or undefined when it names none.
 *
 * This is the standard reference grammar: the first path component is the
 * registry only if it looks like a host — it contains a `.` or a `:`, or it is
 * exactly `localhost`. Anything else is a namespace, and a reference with no
 * host resolves to Docker Hub. `alpine` and `waypoint/worker` BOTH have no
 * host; they mean `docker.io/library/alpine` and `docker.io/waypoint/worker`.
 */
function imageRegistryHost(image: string): string | undefined {
  if (!image.includes('/')) return undefined
  const first = image.slice(0, image.indexOf('/'))
  if (first === 'localhost' || first.startsWith('localhost:')) return first
  if (first.includes('.') || first.includes(':')) return first
  return undefined
}

/**
 * Is this image reference one msb can resolve to only the thing we meant?
 *
 * THIS RULE IS A SECURITY FIX, not hygiene (rsc-zai). `msb run` AUTO-PULLS on a
 * local cache miss and defaults to Docker Hub. Our own image was configured as
 * `waypoint/worker:slim` — an unqualified name, so really
 * `docker.io/waypoint/worker:slim` — and that namespace is UNCLAIMED
 * (measured: 404 for user, org and repo, against a `library/alpine` control that
 * returns 200). On any machine without the image cached, which is precisely the
 * fresh-machine case, a squatter claiming the namespace would have their image
 * pulled and RUN, with the case tree mounted rw and the credential brokered to
 * it. It failed safe only because nobody had claimed the name yet — luck, not a
 * boundary. So the config may not express such a reference at all.
 *
 * Two rules, from what the reference can silently resolve to:
 *
 *  - No registry host  -> REFUSED. It means Docker Hub, and a namespace we do
 *    not own. Host-qualifying is the whole fix: measured, `localhost/...` runs
 *    from cache offline, and on a miss fails loud instead of reaching the hub.
 *  - A REMOTE host, no digest -> REFUSED. A tag is a mutable pointer; whoever can
 *    write the namespace can repoint it and swap the agent under us, and nothing
 *    in a passing test would notice. A digest is the content itself.
 *
 * `localhost/...` may carry a tag: there is no registry behind it to lie, so the
 * tag names a local cache artifact that only `image load` can write.
 */
function imageProblem(image: string): string | undefined {
  const host = imageRegistryHost(image)

  if (host === undefined) {
    return [
      `runtime.sandbox.image '${image}' names no registry host, which means Docker Hub —`,
      `msb auto-pulls on a cache miss, so this silently resolves to 'docker.io/${image}' and would RUN whatever is published there,`,
      'with the case tree mounted rw and the credential brokered to it (rsc-zai).',
      "Qualify it: 'localhost/waypoint/worker:slim' for a locally built image (deploy/sandbox/worker-image/build.sh),",
      "or a digest-pinned remote such as 'ghcr.io/<ns>/waypoint-worker@sha256:<64-hex>'.",
    ].join(' ')
  }

  const isLocal = host === 'localhost' || host.startsWith('localhost:')
  if (!isLocal && !DIGEST_SUFFIX.test(image)) {
    return [
      `runtime.sandbox.image '${image}' names the remote registry '${host}' but pins no digest —`,
      'a tag is a mutable pointer, so the agent our worker runs could be swapped without a config change and no test would fail.',
      "Pin the content: '<name>@sha256:<64-hex>' (deploy/sandbox/worker-image/publish.sh prints the digest to paste).",
    ].join(' ')
  }

  return undefined
}

/**
 * Admission for a configured sandbox — the `recipeRuntimeProblem` of the
 * sandbox layer, and it carries the same charter: a policy that cannot honestly
 * carry a dispatch must refuse NOW, at start, not strand a worker at the first
 * network call. Every rule below is a config that either cannot work or
 * silently is not the boundary it appears to be.
 *
 * Returns a problem string, or undefined when the policy is coherent.
 */
export function sandboxConfigProblem(
  sandbox: WaypointProjectSandboxConfig,
  options?: SandboxParseOptions,
): string | undefined {
  if (sandbox.backend === 'microsandbox' && !allowRetiredMicrosandbox(options)) {
    return RETIRED_MICROSANDBOX_MESSAGE
  }

  const { egress, credential } = sandbox
  const allowed = egress.allow ?? []

  // First: the image is the code that runs. An egress policy is irrelevant if
  // the thing enforcing nothing is a stranger's agent.
  const image = imageProblem(sandbox.image)
  if (image !== undefined) return image

  // A sandbox that lets the worker reach anything is not a boundary — it is a
  // VM with a comforting name in a config file. We adopted this layer for
  // exactly one property ("there is nowhere to exfiltrate to"), and an operator
  // who wants no egress control omits the block rather than writing one that
  // reads as protection and grants none.
  //
  // Note microsandbox's OWN default is `allow`. This rule is why our config
  // cannot inherit that default silently: the boundary has to be asked for.
  if (egress.default === 'allow') {
    return [
      "runtime.sandbox.egress.default is 'allow' — that is a sandbox in name only:",
      'the worker could still send case content anywhere, which is the one thing this layer exists to stop.',
      'Use `default: deny` with an explicit `allow:` list, or remove the runtime.sandbox block entirely if you intend no egress control.',
    ].join(' ')
  }

  // The spike's load-bearing caveat, made unwritable.
  //
  // microsandbox matches domain rules by intercepting DNS and validating TLS
  // SNI. A connection to a hard-coded IP resolves through nothing, matches no
  // domain rule, and under `default: deny` fails closed — proven: zero bytes
  // moved to a raw IP. But an IP/CIDR entry here, or a group like `public`,
  // matches by address instead, which hands back exactly the raw-IP exfil path
  // default-deny had closed. The failure would be silent: every test still
  // passes, because the allowed provider still works.
  const offenders = allowed.filter((target) => !isDomainTarget(target))
  if (offenders.length > 0) {
    return [
      `runtime.sandbox.egress.allow contains non-domain target(s) ${offenders.map((o) => `'${o}'`).join(', ')} —`,
      'only domains (`api.openai.com`) and domain suffixes (`*.example.com`) are allowed here.',
      'IPs, CIDRs and groups (`public`, `private`) match by address rather than by intercepted DNS + TLS SNI,',
      'which reopens the raw-IP exfil path that `default: deny` otherwise closes (docs/spikes/microsandbox.md).',
    ].join(' ')
  }

  if (allowed.length === 0) {
    return [
      'runtime.sandbox.egress denies everything and allows nothing —',
      'a worker that cannot reach its model provider cannot take a dispatch to an outcome.',
      'Name the model host in `allow:`.',
    ].join(' ')
  }

  // Brokering a secret into a host the firewall drops is dead config: the
  // substitution never fires and every model call fails authentication, with an
  // error that looks like anything but its actual cause.
  for (const entry of credential?.broker ?? []) {
    const unreachable = entry.hosts.filter((host) => !allowed.some((target) => targetCovers(target, host)))
    if (unreachable.length > 0) {
      return [
        `runtime.sandbox.credential.broker[env_var=${entry.env_var}].hosts names ${unreachable.map((h) => `'${h}'`).join(', ')},`,
        `which runtime.sandbox.egress.allow (${allowed.join(', ')}) does not permit —`,
        'the host would substitute the secret onto a connection the firewall blocks; no model call could succeed.',
      ].join(' ')
    }
  }

  // Passthrough puts a real credential INSIDE the sandbox. That is a supported
  // choice (subscription/OAuth agents cannot take a placeholder), but it leans
  // entirely on the egress allowlist as the wall: the worker holds a token it
  // can only send to the hosts we named. Combined with `default: allow` — which
  // is refused above — it would be a credential loose on the open internet.
  if (credential?.passthrough && allowed.length === 0) {
    return [
      'runtime.sandbox.credential.passthrough puts a real credential inside the sandbox, but runtime.sandbox.egress.allow is empty —',
      'the egress allowlist is the only thing keeping that credential from going anywhere.',
      'Name the provider host(s) the worker is allowed to reach.',
    ].join(' ')
  }

  return undefined
}

/** Does an egress target cover this host? Exact match, or a suffix rule. */
function targetCovers(target: string, host: string): boolean {
  if (target === host) return true
  const suffix = target.startsWith('*.') ? target.slice(2) : target.startsWith('suffix=') ? target.slice(7) : undefined
  return suffix !== undefined && (host === suffix || host.endsWith(`.${suffix}`))
}
