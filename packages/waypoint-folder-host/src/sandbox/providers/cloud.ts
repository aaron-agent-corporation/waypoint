/**
 * Admission-bound cloud ProjectSandboxProvider factory — the VERIFY half of
 * the qualify → record → verify pattern (S2, item 52; the shape is the
 * Waypoint guide's, cut to Waypoint's one qualified provider).
 *
 *   qualify  deploy/sandbox/qualify-provider.ts runs the boundary-probe
 *            conformance floor against a live sprite and writes the evidence
 *            file. It is the ONE sanctioned direct construction — the record
 *            it feeds cannot exist before the evidence does.
 *   record   deploy/sandbox/record-admission.ts pins that evidence by digest
 *            into admission-record.json under a named HUMAN reviewer.
 *   verify   this loader, at EVERY production construction: the record's
 *            shape is closed, the evidence file is re-digested against the
 *            pinned digest, and the evidence itself must still satisfy the
 *            probe floor. A record whose evidence was edited, swapped or lost
 *            refuses — construction never trusts a digest it did not check.
 *
 * The record is the operator's signature on the provider choice — a config
 * typo or an unreviewed provider swap can never silently pick where case data
 * runs (docs/designs/sprite-worker-isolation.md).
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REQUIRED_PROBES, type ProjectSandboxProvider } from '../provider.ts'
import { FakeProjectSandboxProvider } from './fake.ts'
import {
  FlySpritesProjectSandboxProvider,
  type FlySpritesProjectSandboxProviderOptions,
} from './fly-sprites.ts'

export type CloudSandboxProviderKind = 'fly-sprites'
export type ProjectSandboxProviderKind = CloudSandboxProviderKind | 'fake'

export type CreateCloudProjectSandboxProviderOptions = FlySpritesProjectSandboxProviderOptions

export type SandboxAdmissionRecord = {
  readonly schema_version: 1
  readonly selected_provider: CloudSandboxProviderKind
  readonly qualification_digest: string
  /** The qualification evidence file, relative to this record's directory. */
  readonly qualification_evidence: string
  readonly selection_status: 'APPROVED'
  readonly authority: 'human'
  /** The human who reviewed the evidence — never an agent role name. */
  readonly reviewer: string
  readonly reviewed_at: string
  /** Free-text citation of the ruling this selection rests on. */
  readonly authority_basis?: string
  readonly dual_active_refused: true
  /**
   * The guest-bundle image the pinned qualification evidence names — DERIVED
   * at load from the evidence, never a record-file field. This is what the
   * human actually admitted: dispatch refuses to install any other bundle
   * (route-013, 2026-08-31 — a stale binding stamp is a wrong stamp, but an
   * un-admitted bundle under an admitted stamp is the real hole).
   */
  readonly admitted_image_digest: string
}

const ADMISSION_RECORD_FIELDS = new Set([
  'schema_version',
  'selected_provider',
  'qualification_digest',
  'qualification_evidence',
  'selection_status',
  'authority',
  'reviewer',
  'reviewed_at',
  'authority_basis',
  'dual_active_refused',
])

/** Role names that can never sign an admission — a human name is required. */
const FORBIDDEN_REVIEWERS = new Set(['agent', 'manager', 'worker', 'auto', 'automated', 'system', 'waypoint'])

const DEFAULT_ADMISSION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../deploy/sandbox/provider-admission/admission-record.json',
)

export function defaultAdmissionRecordPath(): string {
  return process.env.WAYPOINT_SANDBOX_ADMISSION_RECORD?.trim() || DEFAULT_ADMISSION_PATH
}

export function sha256HexOf(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Does this parsed qualification evidence still satisfy the conformance
 * floor? Returns the first problem, or undefined when it holds. Shared by
 * record-admission (refuses to pin failing evidence) and the load-time verify
 * (refuses to construct on evidence that no longer holds).
 */
export function qualificationEvidenceProblem(evidence: unknown): string | undefined {
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
    return 'evidence is not a JSON object'
  }
  const record = evidence as Record<string, unknown>
  if (record.enterable !== true) return 'evidence records enterable !== true'
  if (record.healthy !== true) return 'evidence records healthy !== true'
  if (!Array.isArray(record.probes)) return 'evidence carries no probes array'
  const byId = new Map<string, Record<string, unknown>>()
  for (const probe of record.probes) {
    if (typeof probe !== 'object' || probe === null) return 'evidence probe entry is not an object'
    const p = probe as Record<string, unknown>
    if (typeof p.id !== 'string') return 'evidence probe entry has no id'
    if (byId.has(p.id)) return `evidence carries duplicate probe '${p.id}'`
    byId.set(p.id, p)
  }
  for (const [probeId, admitted] of Object.entries(REQUIRED_PROBES)) {
    const probe = byId.get(probeId)
    if (probe === undefined) return `evidence is missing required probe '${probeId}'`
    if (probe.secret_plaintext_available === true) return `probe '${probeId}' exposed secret plaintext`
    if (!admitted.includes(probe.result as never)) {
      return `probe '${probeId}' result '${String(probe.result)}' is outside its admitted set [${admitted.join(', ')}]`
    }
  }
  return undefined
}

export function loadSandboxAdmissionRecord(filePath = defaultAdmissionRecordPath()): SandboxAdmissionRecord {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(
      `cloud sandbox admission refused: cannot read admission record at ${filePath} (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const parsed = JSON.parse(raw) as Partial<SandboxAdmissionRecord> & Record<string, unknown>
  for (const key of Object.keys(parsed)) {
    if (!ADMISSION_RECORD_FIELDS.has(key)) {
      throw new Error(`cloud sandbox admission refused: unknown record field '${key}'`)
    }
  }
  if (parsed.schema_version !== 1) {
    throw new Error('cloud sandbox admission refused: schema_version must be 1')
  }
  if (parsed.selection_status !== 'APPROVED') {
    throw new Error('cloud sandbox admission refused: selection_status must be APPROVED')
  }
  if (parsed.authority !== 'human') {
    throw new Error('cloud sandbox admission refused: authority must be human')
  }
  if (typeof parsed.reviewer !== 'string' || parsed.reviewer.trim() === '') {
    throw new Error('cloud sandbox admission refused: reviewer (a human name) is required')
  }
  if (FORBIDDEN_REVIEWERS.has(parsed.reviewer.trim().toLowerCase())) {
    throw new Error(`cloud sandbox admission refused: reviewer '${parsed.reviewer}' is a role name, not a human`)
  }
  if (typeof parsed.reviewed_at !== 'string' || Number.isNaN(Date.parse(parsed.reviewed_at))) {
    throw new Error('cloud sandbox admission refused: reviewed_at must be a parseable date-time')
  }
  if (parsed.dual_active_refused !== true) {
    throw new Error('cloud sandbox admission refused: dual_active_refused must be true')
  }
  if (parsed.selected_provider !== 'fly-sprites') {
    throw new Error('cloud sandbox admission refused: selected_provider is not a qualified cloud candidate')
  }
  if (!/^[a-f0-9]{64}$/.test(String(parsed.qualification_digest ?? ''))) {
    throw new Error('cloud sandbox admission refused: qualification_digest must be sha256 hex')
  }
  if (typeof parsed.qualification_evidence !== 'string' || parsed.qualification_evidence.trim() === '') {
    throw new Error('cloud sandbox admission refused: qualification_evidence (path relative to the record) is required')
  }

  // VERIFY: re-digest the evidence the record pins, then re-check the floor.
  // A digest nobody re-computes is a decoration, not a pin.
  const evidencePath = path.resolve(path.dirname(filePath), parsed.qualification_evidence)
  let evidenceRaw: string
  try {
    evidenceRaw = readFileSync(evidencePath, 'utf8')
  } catch (error) {
    throw new Error(
      `cloud sandbox admission refused: cannot read qualification evidence at ${evidencePath} (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const actualDigest = sha256HexOf(evidenceRaw)
  if (actualDigest !== parsed.qualification_digest) {
    throw new Error(
      `cloud sandbox admission refused: qualification evidence at ${evidencePath} digests ${actualDigest}, not the pinned ${parsed.qualification_digest} — the evidence changed after it was recorded`,
    )
  }
  let evidence: unknown
  try {
    evidence = JSON.parse(evidenceRaw)
  } catch (error) {
    throw new Error(
      `cloud sandbox admission refused: qualification evidence at ${evidencePath} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const floorProblem = qualificationEvidenceProblem(evidence)
  if (floorProblem !== undefined) {
    throw new Error(`cloud sandbox admission refused: pinned qualification evidence fails the floor — ${floorProblem}`)
  }
  const admittedImage = (evidence as Record<string, unknown>).image_digest
  if (typeof admittedImage !== 'string' || admittedImage.trim() === '') {
    throw new Error(
      'cloud sandbox admission refused: pinned qualification evidence names no image_digest — an admission that ' +
        'does not say WHICH bundle was qualified cannot gate installs; re-run qualify-provider.ts',
    )
  }
  return { ...(parsed as Omit<SandboxAdmissionRecord, 'admitted_image_digest'>), admitted_image_digest: admittedImage.trim() }
}

/**
 * Production constructor: only the admitted provider/digest may be built.
 * Optional `kind` must match the admission record when provided.
 *
 * There is deliberately NO default egress allowlist (the guide defaulted to
 * `api.anthropic.com` — Anthropic is out of the worker lanes entirely, Aaron
 * 2026-08-27). The allowlist comes from the project's
 * `runtime.sandbox.egress.allow`; production construction without one refuses,
 * because Sprites treats an empty rule list as UNRESTRICTED egress.
 */
export function createCloudProjectSandboxProvider(
  kind?: CloudSandboxProviderKind,
  options: CreateCloudProjectSandboxProviderOptions & {
    readonly admissionPath?: string
    readonly skipAdmission?: boolean
  } = {},
): ProjectSandboxProvider {
  // Unit tests may construct a non-admitted candidate explicitly.
  if (options.skipAdmission === true) {
    if (!kind) throw new Error('skipAdmission requires an explicit provider kind')
    return new FlySpritesProjectSandboxProvider(options)
  }

  if (options.egressAllow === undefined || options.egressAllow.length === 0) {
    throw new Error(
      'cloud sandbox admission refused: no egress allowlist — set runtime.sandbox.egress.allow; an empty Sprites rule list is unrestricted egress, never deny-by-default',
    )
  }
  const admission = loadSandboxAdmissionRecord(options.admissionPath)
  if (kind && kind !== admission.selected_provider) {
    throw new Error(
      `cloud sandbox admission refused: requested ${kind} but admission selects ${admission.selected_provider}`,
    )
  }
  return new CloudProjectSandboxProvider(admission, options)
}

export function createProjectSandboxProvider(
  kind: ProjectSandboxProviderKind,
  options: CreateCloudProjectSandboxProviderOptions & {
    readonly admissionPath?: string
    readonly skipAdmission?: boolean
  } = {},
): ProjectSandboxProvider {
  if (kind === 'fake') return new FakeProjectSandboxProvider()
  return createCloudProjectSandboxProvider(kind, options)
}

/** Admitted production provider — Fly.io Sprites only. */
export class CloudProjectSandboxProvider extends FlySpritesProjectSandboxProvider {
  readonly admission: SandboxAdmissionRecord

  constructor(admission: SandboxAdmissionRecord, options: FlySpritesProjectSandboxProviderOptions = {}) {
    if (admission.selected_provider !== 'fly-sprites') {
      throw new Error('CloudProjectSandboxProvider refused: only fly-sprites is qualified')
    }
    super(options)
    this.admission = admission
  }
}
