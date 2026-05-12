# FirmVault Case Folder Blueprint

This is the target shape for a personal-injury case folder that looks like it originated inside standalone Waypoint/FirmVault.

The important distinction:

- The visible case folder is for humans, documents, notes, and evidence.
- `.waypoint/` is Waypoint's machine state. Do not hand-edit it.
- Legal progress is not inferred from random file names. Legal progress is recorded through `waypoint firmvault state set`, with evidence paths attached.

## Fastest correct path for an existing case

Do not try to mutate your old folder directly into correctness first. Use this copy-forward workflow:

1. Bootstrap a clean Waypoint/FirmVault case folder.
2. Copy or move selected existing case materials into the canonical folders.
3. Record legal facts with `waypoint firmvault state set` against relative evidence paths.
4. Check landmarks with `waypoint firmvault landmarks --json`.
5. Keep the original case folder read-only until the replay is verified.

Example:

```bash
waypoint firmvault bootstrap \
  --cases-root /trusted/FirmVault/Cases \
  --case-name "Jane Smith v. Acme Trucking" \
  --case-type personal-injury \
  --start \
  --json

cd /trusted/FirmVault/Cases/jane-smith-v-acme-trucking

waypoint firmvault evidence check --path evidence/client-intake.md --json
waypoint firmvault state set \
  --fact client.intake \
  --status complete \
  --evidence evidence/client-intake.md \
  --note "Mapped from completed case intake packet." \
  --json

waypoint firmvault landmarks --json
```

## Root folder shape

A bootstrapped personal-injury case has this top-level shape:

```text
case-slug/
├── AGENTS.md
├── Dashboard.md
├── case-slug.md
├── client/
├── accident/
├── contacts/
├── insurance/
├── medical-providers/
├── liens/
├── demand/
├── negotiation/
├── settlement/
├── litigation/
├── documents/
├── activity/
├── workflow-log/
└── .waypoint/
```

The required starter paths are:

```text
AGENTS.md
Dashboard.md
client/
client/intake.md
client/contracts.md
client/authorizations.md
client/contactability.md
client/check-ins.md
accident/
accident/accident.md
accident/police-report.md
accident/liability.md
contacts/
insurance/
medical-providers/
liens/
demand/
negotiation/
settlement/
litigation/
documents/
activity/
activity/index.md
workflow-log/
workflow-log/index.md
<case-slug>.md
```

The root case index file is named after the slug, for example:

```text
jane-smith-v-acme-trucking.md
```

It should contain frontmatter like:

```yaml
---
case_slug: jane-smith-v-acme-trucking
case_type: personal_injury
created_at: 2026-05-12T00:00:00.000Z
---
```

## What each human folder is for

### `client/`

Canonical human-facing client material:

```text
client/
├── intake.md
├── contracts.md
├── authorizations.md
├── contactability.md
└── check-ins.md
```

Put or summarize:

- intake packet information;
- fee agreement status;
- HIPAA/medical authorizations;
- client contact preferences;
- check-in notes.

Typical evidence mappings:

```text
client.intake                         -> client/intake.md or evidence/client-intake.md
client.contracts.fee_agreement         -> client/contracts.md or documents/signed/fee-agreement.pdf
client.authorizations.hipaa            -> client/authorizations.md or documents/signed/hipaa.pdf
```

### `accident/`

```text
accident/
├── accident.md
├── police-report.md
└── liability.md
```

Put or summarize:

- incident facts;
- police report details;
- liability assessment.

Typical evidence mapping:

```text
accident.police_report -> accident/police-report.md or documents/reports/police-report.pdf
```

### `contacts/`

Use for people/entities:

```text
contacts/
├── client.md
├── adjusters.md
├── providers.md
├── lienholders.md
└── witnesses.md
```

Waypoint does not currently require these exact files, but this is the clean structure I recommend for migrated real cases.

### `insurance/`

Recommended structure:

```text
insurance/
├── bi/
│   ├── carrier.md
│   ├── letter-of-representation.md
│   └── acknowledgment.md
└── pip/
    ├── carrier.md
    ├── application.md
    ├── letter-of-representation.md
    ├── acknowledgment.md
    ├── approval.md
    ├── status-checks.md
    └── benefits.md
```

Typical fact mappings:

```text
insurance.bi.carrier_identified       -> insurance/bi/carrier.md
insurance.bi.lor.prepared             -> insurance/bi/letter-of-representation.md
insurance.bi.lor.sent                 -> insurance/bi/letter-of-representation.md
insurance.bi.acknowledgment           -> insurance/bi/acknowledgment.md
insurance.pip.track                   -> insurance/pip/status-checks.md
insurance.pip.carrier_identified      -> insurance/pip/carrier.md
insurance.pip.application.prepared    -> insurance/pip/application.md
insurance.pip.application.filed       -> insurance/pip/application.md
insurance.pip.lor.prepared            -> insurance/pip/letter-of-representation.md
insurance.pip.lor.sent                -> insurance/pip/letter-of-representation.md
insurance.pip.acknowledgment          -> insurance/pip/acknowledgment.md
insurance.pip.approval                -> insurance/pip/approval.md
insurance.pip.status_check            -> insurance/pip/status-checks.md
insurance.pip.benefits                -> insurance/pip/benefits.md
```

### `medical-providers/`

Recommended structure:

```text
medical-providers/
├── index.md
├── provider-001-name/
│   ├── profile.md
│   ├── records/
│   ├── bills/
│   └── correspondence/
└── treatment-status.md
```

Typical fact mappings:

```text
providers.setup                                      -> medical-providers/index.md
providers.treatment_status.provider_list_reviewed    -> medical-providers/index.md
providers.treatment_status.provider_status_updated    -> medical-providers/treatment-status.md
providers.treatment_status.provider_followups_flagged -> medical-providers/treatment-status.md
providers.treatment_status.human_review              -> medical-providers/treatment-status.md
providers.treatment_status.treatment_complete         -> medical-providers/treatment-status.md
```

### `liens/`

Recommended structure:

```text
liens/
├── early-identification.md
├── inventory.md
├── final-resolution/
│   ├── inventory.md
│   ├── final-amount-requests.md
│   ├── final-amounts-received.md
│   ├── payment-authorization.md
│   └── payments.md
└── correspondence/
```

Typical fact mappings:

```text
liens.early_identification.health_coverage                         -> liens/early-identification.md
liens.early_identification.clues_reviewed                          -> liens/early-identification.md
liens.early_identification.liens                                   -> liens/inventory.md
liens.early_identification.inventory_review                        -> liens/inventory.md
liens.final_resolution.inventory                                   -> liens/final-resolution/inventory.md
liens.final_resolution.final_amount_request.prepared               -> liens/final-resolution/final-amount-requests.md
liens.final_resolution.final_amount_request.sent                   -> liens/final-resolution/final-amount-requests.md
liens.final_resolution.final_amount_receipt                        -> liens/final-resolution/final-amounts-received.md
liens.final_resolution.payment_authorization                       -> liens/final-resolution/payment-authorization.md
liens.final_resolution.payment                                     -> liens/final-resolution/payments.md
```

### `documents/`

This is the local document intake area.

Recommended structure:

```text
documents/
├── inbox/
├── processed/
├── signed/
├── reports/
├── medical-records/
├── bills/
├── insurance/
├── correspondence/
└── sent/
```

`waypoint firmvault add-document` copies source files into `documents/inbox/` and records metadata in `.waypoint/firmvault/documents.yaml`.

Supported intake kinds:

```text
medical-records
bill
insurance
police-report
correspondence
unknown
```

Important: document intake and pipeline handoff do not satisfy legal landmarks by themselves. They only create/index evidence. Legal facts still need `state set`.

### `demand/`

Recommended structure:

```text
demand/
├── readiness.md
├── damages.md
├── lien-check.md
├── draft.md
├── attorney-review.md
├── recipients.md
└── sent.md
```

Typical fact mappings:

```text
demand.readiness.materials          -> demand/readiness.md
demand.readiness.damages            -> demand/damages.md
demand.readiness.review             -> demand/readiness.md
demand.liens.final_process_check    -> demand/lien-check.md
demand.draft                        -> demand/draft.md
demand.attorney_review              -> demand/attorney-review.md
demand.recipients                   -> demand/recipients.md
demand.send                         -> demand/sent.md or documents/sent/demand-package.pdf
```

### `negotiation/`

Recommended structure:

```text
negotiation/
├── initial-offer.md
├── offer-log.md
├── evaluation.md
├── net-to-client.md
├── client-advice.md
├── client-decision.md
├── response.md
└── result.md
```

Typical fact mappings:

```text
negotiation.initial_offer          -> negotiation/initial-offer.md
negotiation.offer_documented       -> negotiation/offer-log.md
negotiation.evaluation             -> negotiation/evaluation.md
negotiation.net_to_client          -> negotiation/net-to-client.md
negotiation.client_advice          -> negotiation/client-advice.md
negotiation.client_decision        -> negotiation/client-decision.md
negotiation.response.prepared      -> negotiation/response.md
negotiation.response.human_sent    -> negotiation/response.md
negotiation.response.result        -> negotiation/result.md
```

### `settlement/`

Recommended structure:

```text
settlement/
├── settlement.md
├── statement.md
├── authorization-to-settle.md
├── client-authorization.md
├── release.md
├── funds.md
├── liens/
│   ├── audit.md
│   ├── prioritization.md
│   ├── available-funds.md
│   ├── strategy-review.md
│   └── result.md
├── distribution/
│   ├── statement.md
│   ├── client-issuance.md
│   ├── client-receipt.md
│   ├── trust-account.md
│   └── completion.md
└── closing/
    ├── readiness.md
    ├── final-letter-prepared.md
    ├── final-letter-sent.md
    ├── archive.md
    └── case-closed.md
```

Typical fact mappings:

```text
settlement.reached                         -> settlement/settlement.md
settlement.statement                       -> settlement/statement.md
settlement.authorization_to_settle         -> settlement/authorization-to-settle.md
settlement.client_authorization            -> settlement/client-authorization.md
settlement.release                         -> settlement/release.md
settlement.funds                           -> settlement/funds.md
settlement.liens.audit                     -> settlement/liens/audit.md
settlement.liens.prioritization            -> settlement/liens/prioritization.md
settlement.liens.available_funds           -> settlement/liens/available-funds.md
settlement.liens.strategy_review           -> settlement/liens/strategy-review.md
settlement.liens.result                    -> settlement/liens/result.md
settlement.distribution.statement          -> settlement/distribution/statement.md
settlement.distribution.client_issuance    -> settlement/distribution/client-issuance.md
settlement.distribution.client_receipt     -> settlement/distribution/client-receipt.md
settlement.distribution.trust_account      -> settlement/distribution/trust-account.md
settlement.distribution.completion         -> settlement/distribution/completion.md
settlement.closing.readiness               -> settlement/closing/readiness.md
settlement.closing.letter.prepared         -> settlement/closing/final-letter-prepared.md
settlement.closing.letter.sent             -> settlement/closing/final-letter-sent.md
settlement.closing.archive                 -> settlement/closing/archive.md
settlement.closing.case                    -> settlement/closing/case-closed.md
```

### `litigation/`

Currently present as a placeholder for future litigation workflows. The current standalone FirmVault model is personal-injury pre-litigation/settlement focused, so FVL4/FVL5 do not require litigation facts to satisfy the 82 landmarks.

### `activity/` and `workflow-log/`

Human-readable logs and notes:

```text
activity/index.md
workflow-log/index.md
```

Use these for narrative summaries and operator notes. Machine audit events live under `.waypoint/firmvault/events.jsonl`.

## `.waypoint/` machine area

A bootstrapped and started case includes `.waypoint/` data. Do not manually author this from scratch for a real case; create it with `waypoint firmvault bootstrap`.

Expected machine files include:

```text
.waypoint/
├── config.yaml
├── quests/
├── recipes/
├── routes/
│   └── route-001.yaml
├── events/
│   └── route-001.jsonl
├── tasks.yaml
└── firmvault/
    ├── case.yaml
    ├── client.yaml
    ├── accident.yaml
    ├── providers.yaml
    ├── insurance.yaml
    ├── liens.yaml
    ├── records.yaml
    ├── demand.yaml
    ├── negotiation.yaml
    ├── settlement.yaml
    ├── documents.yaml
    ├── landmarks.yaml
    └── events.jsonl
```

These files mean:

- `config.yaml`: this folder is a Waypoint project using the `firmvault` Quest.
- `quests/` and `recipes/`: installed bundled FirmVault workflow definitions.
- `routes/route-001.yaml`: active route record when bootstrapped with `--start`.
- `tasks.yaml`: materialized FirmVault task/gate plan.
- `.waypoint/firmvault/*.yaml`: explicit legal case state.
- `.waypoint/firmvault/landmarks.yaml`: computed projection from explicit state.
- `.waypoint/firmvault/events.jsonl`: audit log for FirmVault state/document changes.

## Evidence folder recommendation

The simulation uses `evidence/` because it is neutral and simple. For a real migrated case, I recommend keeping a dedicated evidence layer even if you also keep documents in their practical folders.

```text
evidence/
├── case-setup.md
├── client-intake.md
├── client-contracts-fee-agreement.md
├── client-authorizations-hipaa.md
├── accident-police-report.md
├── demand-send.md
├── settlement-release.md
└── settlement-closing-case.md
```

This gives the replay/state layer stable relative paths. Those evidence files can be:

- short markdown summaries pointing to real documents;
- copied PDFs from the old case;
- redacted PDFs;
- generated index files that list the source documents reviewed.

Example evidence summary:

```md
# Evidence: Demand Sent

Source documents reviewed:

- documents/sent/2024-02-14-demand-package.pdf
- demand/sent.md

Human/legal conclusion:

Demand package was sent after attorney approval.
```

Then record:

```bash
waypoint firmvault state set \
  --fact demand.send \
  --status sent \
  --evidence evidence/demand-send.md \
  --note "Mapped from completed case demand evidence." \
  --json
```

## Migration checklist for an existing case folder

### Phase 1: Create the destination case

```bash
waypoint firmvault bootstrap \
  --cases-root /trusted/FirmVault/Cases \
  --case-name "Real Case Name" \
  --case-type personal-injury \
  --case-slug real-case-name \
  --start \
  --json
```

### Phase 2: Copy human documents into canonical locations

Recommended approach:

- keep original case folder untouched;
- copy only selected evidence into the new case;
- use redacted placeholders if the folder will be used for tests or demos;
- do not copy secrets, passwords, portal credentials, API keys, connection strings, or trust-account credentials.

### Phase 3: Create evidence index files

For each major lifecycle fact, create a stable evidence markdown file under `evidence/`, even if the real source is a PDF elsewhere.

Minimum examples:

```text
evidence/client-intake.md
evidence/client-contracts-fee-agreement.md
evidence/client-authorizations-hipaa.md
evidence/accident-police-report.md
evidence/records-received.md
evidence/demand-send.md
evidence/settlement-release.md
evidence/settlement-closing-case.md
```

### Phase 4: Validate evidence paths before mutation

```bash
waypoint firmvault evidence check --path evidence/client-intake.md --json
```

The path must be:

- relative;
- inside the case folder;
- existing;
- not `..` traversal;
- not an absolute path.

### Phase 5: Record facts through the CLI

```bash
waypoint firmvault state set \
  --fact client.intake \
  --status complete \
  --evidence evidence/client-intake.md \
  --note "Mapped from legacy case folder." \
  --json
```

Do this for each known completed fact. The command updates the correct `.waypoint/firmvault/*.yaml`, refreshes `landmarks.yaml`, appends an audit event, and returns landmark impact.

### Phase 6: Inspect completion

```bash
waypoint firmvault state show --json
waypoint firmvault landmarks --json
waypoint routes --json
waypoint tasks --route-id route-001 --json
```

## What not to do

Do not:

- directly edit `.waypoint/firmvault/*.yaml`;
- create `landmarks.yaml` by hand;
- copy old documents into `.waypoint/`;
- use absolute evidence paths in state updates;
- expect document upload or OCR pipeline merge to satisfy legal landmarks automatically;
- use live emails/faxes/API calls/trust actions as part of migration;
- commit real client data, credentials, secrets, or private case files.

## Practical target for your real folder

If you want your existing case to look like it originated in Waypoint, the final destination should satisfy these checks:

```bash
waypoint status
waypoint routes --json
waypoint tasks --route-id route-001 --json
waypoint firmvault state show --json
waypoint firmvault landmarks --json
```

And structurally:

```text
case-slug/
├── AGENTS.md
├── Dashboard.md
├── case-slug.md
├── client/
├── accident/
├── contacts/
├── insurance/
├── medical-providers/
├── liens/
├── demand/
├── negotiation/
├── settlement/
├── litigation/
├── documents/
├── evidence/
├── activity/
├── workflow-log/
└── .waypoint/
```

The folder can contain more than this. Waypoint only needs stable local evidence paths and its own `.waypoint` state. The human folder structure is for usability and consistency, not magic landmark detection.

## Recommended next product slice

The next useful improvement is a real migration helper:

```bash
waypoint firmvault blueprint
waypoint firmvault adopt-case --source /old/case --cases-root /trusted/FirmVault/Cases --case-name "..."
waypoint firmvault replay-manifest generate --source /old/case --output /private/manifest.yaml
```

That would inspect an existing folder, propose a mapping manifest, copy evidence into a bootstrapped destination, and leave legal fact updates explicit for human/paralegal review.
