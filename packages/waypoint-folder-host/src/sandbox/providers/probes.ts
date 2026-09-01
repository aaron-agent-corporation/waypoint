/**
 * Guest shell probes for cloud ProjectSandboxProvider.verify().
 *
 * Probes report presence/denial only. They must never print secret bytes —
 * commands exit with RESULT=<token> lines and no credential material.
 */

import {
  REQUIRED_PROBES,
  type ProjectSandboxProbe,
  type ProjectSandboxProbeResult,
} from '../provider.ts'

export type GuestProbeContext = {
  readonly allowlistedHost: string
  readonly deniedHost: string
  readonly rawIp: string
}

const DEFAULT_CONTEXT: GuestProbeContext = {
  // NOT an Anthropic host: Anthropic is out of the worker lanes entirely
  // (Aaron 2026-08-27) — no worker-path default may name one. Production
  // derives this from the project's egress allowlist anyway; the default only
  // exists for probe-shell unit tests.
  allowlistedHost: 'api.openai.com',
  deniedHost: 'example.com',
  rawIp: '1.1.1.1',
}

export function defaultGuestProbeContext(
  overrides: Partial<GuestProbeContext> = {},
): GuestProbeContext {
  return { ...DEFAULT_CONTEXT, ...overrides }
}

/** Shell fragment that emits RESULT=<token> and never echoes secret files. */
export function guestProbeShell(probeId: string, ctx: GuestProbeContext = DEFAULT_CONTEXT): string {
  switch (probeId) {
    case 'portfolio-store-read':
      return pathAbsentOrDenied([
        '/portfolio',
        '/var/waypoint/portfolio',
        '$HOME/.waypoint/portfolio',
        '/Users/Shared/portfolio',
      ])
    case 'manager-brief-read':
      return pathAbsentOrDenied([
        '/manager/brief',
        '/var/waypoint/manager-brief',
        '$HOME/.waypoint/manager-brief.md',
        '/etc/waypoint/manager-brief',
      ])
    case 'other-project-read':
      return pathAbsentOrDenied([
        '/other-project',
        '/projects/other',
        '/var/waypoint/other-project',
        '$HOME/other-project',
      ])
    case 'host-home-secret-read':
      // Existence/readability checks only — never cat/print credential files.
      // Do not treat guest OS files like /etc/shadow as host-secret leakage.
      return [
        'set +e',
        'readable=0',
        'for p in \\',
        '  "$HOME/.ssh/id_rsa" "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_ecdsa" \\',
        '  "$HOME/.aws/credentials" "$HOME/.config/gcloud/application_default_credentials.json" \\',
        '  /Users/*/.ssh/id_rsa /Users/*/.aws/credentials; do',
        '  for q in $p; do',
        '    case "$q" in',
        '      /home/sprite/*) continue ;;',
        '    esac',
        '    if [ -r "$q" ]; then readable=1; break 2; fi',
        '  done',
        'done',
        'if [ "$readable" = 1 ]; then echo RESULT=allowed; else echo RESULT=denied; fi',
      ].join('\n')
    case 'denied-host-egress':
      return curlProbe(ctx.deniedHost, /*asIp*/ false)
    case 'raw-ip-egress':
      return curlProbe(ctx.rawIp, /*asIp*/ true)
    case 'allowlisted-model-egress':
      return curlProbe(ctx.allowlistedHost, /*asIp*/ false)
    case 'parallel-write-collision':
      return [
        'set +e',
        '# Guest cannot claim host-managed parallel write authority.',
        'if [ -w /host-managed-write-lock ] || [ -w /var/run/waypoint-host-fallback ]; then',
        '  echo RESULT=allowed',
        'else',
        '  echo RESULT=denied',
        'fi',
      ].join('\n')
    case 'managed-host-fallback':
      return [
        'set +e',
        'if [ -x /usr/local/bin/waypoint-host-worker ] || [ -r /run/waypoint/host-fallback ]; then',
        '  echo RESULT=allowed',
        'else',
        '  echo RESULT=denied',
        'fi',
      ].join('\n')
    case 'forged-managed-start':
      return [
        'set +e',
        'if [ -r /run/waypoint/forged-start ] || [ -r "$HOME/.waypoint/forged-managed-start" ]; then',
        '  echo RESULT=allowed',
        'else',
        '  echo RESULT=denied',
        'fi',
      ].join('\n')
    default:
      throw new Error(`unknown sandbox probe: ${probeId}`)
  }
}

export function parseProbeResultLine(stdout: string): ProjectSandboxProbeResult | null {
  // Tolerate binary mux prefixes / noise before the RESULT token.
  const match = /RESULT=(allowed|denied|not_mounted)(?:\r?\n|$)/.exec(stdout)
  if (!match) return null
  return match[1] as ProjectSandboxProbeResult
}

export function probeFromEnterOutput(
  probeId: string,
  stdout: string,
  exitCode: number,
): ProjectSandboxProbe {
  const parsed = parseProbeResultLine(stdout)
  if (parsed !== null) {
    return { id: probeId, result: parsed, secret_plaintext_available: false }
  }
  // Fail closed: unparseable output is treated as the unsafe outcome for that probe.
  const admitted = REQUIRED_PROBES[probeId]
  const unsafe: ProjectSandboxProbeResult =
    admitted?.includes('allowed') && !admitted.includes('denied') ? 'denied' : 'allowed'
  return {
    id: probeId,
    result: exitCode === 0 && admitted?.includes('not_mounted') ? 'allowed' : unsafe,
    secret_plaintext_available: false,
  }
}

export function requiredProbeIds(): readonly string[] {
  return Object.keys(REQUIRED_PROBES)
}

function pathAbsentOrDenied(paths: readonly string[]): string {
  const checks = paths
    .map((p) => {
      const expr = p.includes('$') ? `"${p}"` : shellQuote(p)
      return `if [ -e ${expr} ] || [ -r ${expr} ]; then found=1; fi`
    })
    .join('\n')
  return [
    'set +e',
    'found=0',
    checks,
    'if [ "$found" = 1 ]; then echo RESULT=allowed; else echo RESULT=not_mounted; fi',
  ].join('\n')
}

function curlProbe(hostOrIp: string, asIp = false): string {
  const url = asIp ? `http://${hostOrIp}/` : `https://${hostOrIp}/`
  // Connectivity probe: any HTTP status (incl. 401/403/404) means egress reached the
  // host. curl -f would false-deny allowlisted model endpoints that require auth.
  return [
    'set +e',
    'code=000',
    'if command -v curl >/dev/null 2>&1; then',
    `  code=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 ${shellQuote(url)} 2>/dev/null || true)`,
    'elif command -v wget >/dev/null 2>&1; then',
    `  wget -q -O /dev/null --timeout=5 ${shellQuote(url)} >/dev/null 2>&1`,
    '  if [ $? -eq 0 ]; then code=200; else code=000; fi',
    'fi',
    'if [ -n "$code" ] && [ "$code" != "000" ]; then echo RESULT=allowed; else echo RESULT=denied; fi',
  ].join('\n')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
