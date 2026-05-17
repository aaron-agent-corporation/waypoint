# Waypoint folder host

The Waypoint folder host runs a Quest against a normal project directory without Mission Control, a database, or a server. It stores project-local state in a human-readable `.waypoint/` folder and exposes the journey through the development CLI in `packages/waypoint-cli/src/bin.ts`.

This is a private development package and not a globally published CLI. The examples below use either `waypoint ...` as shorthand or the direct Node entrypoint when you are running from this repository.

## Current status

The folder host can currently:

- initialize a project-local `.waypoint/` directory;
- install bundled Quest and Recipe manifests into that project;
- start a live route for the bundled `waypoint` Quest;
- persist route YAML, event JSONL, task YAML, discussion JSONL, and autopilot run JSONL;
- pause/resume routes and approve/reject gates;
- run autopilot in the safe null runtime by default;
- run Recipes through an explicitly configured local command runtime;
- initialize product-owned FirmVault case state and project workflow landmarks from explicit YAML state plus evidence paths;
- add local FirmVault documents into `documents/inbox/`, index them in `.waypoint/firmvault/documents.yaml`, and append FirmVault document events without marking substantive landmarks complete.

It does not claim global installation, package publishing, cloud sync, or production packaging yet.

## Development invocation

From this repository, the safest smoke pattern is to run the CLI by absolute path from a temporary project directory:

```bash
repo=/Users/aaronwhaley/Github/waypoint
tmp=$(mktemp -d)
cd "$tmp"
node "$repo/packages/waypoint-cli/src/bin.ts" --help
```

If you have installed or aliased the development CLI yourself, the shorthand command is:

```bash
waypoint --help
```

The CLI help registry currently exposes these commands:

```text
waypoint --help
waypoint --version
waypoint init [--quest <slug>]
waypoint status
waypoint doctor firmvault [--profile paralegal] [--workspace-root <path>] [--upgrade-plan] [--json]
waypoint firmvault bootstrap --cases-root <path> --case-name <name> [--case-type personal-injury] [--case-slug <slug>] [--start] [--json]
waypoint firmvault add-document --source <path> --kind medical-records|bill|insurance|police-report|correspondence|unknown [--note <note>] [--json]
waypoint firmvault document-handoff --document-id <id> --status not-started|submitted|pr-opened|merged|deferred|failed [--pr-number <number>] [--pr-url <url>] [--branch <branch>] [--submitted-at <iso>] [--completed-at <iso>] [--json]
waypoint firmvault init-case [--case-type personal-injury] [--case-slug <slug>]
waypoint firmvault landmarks [--json]
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint quests
waypoint recipes [--quest <slug>]
waypoint start [--quest <slug>]
waypoint routes [--json]
waypoint route --route-id <id> [--json]
waypoint route-events --route-id <id> [--limit N] [--offset N] [--json]
waypoint tasks [--route-id <id>] [--json]
waypoint discuss --task-id <id> [--message <text>] [--author user|agent]
waypoint auto [--route-id <id>] [--max-iterations N] [--json]
waypoint auto status [--limit N] [--offset N] [--json]
waypoint gate --route-id <id> --node <node> (--approve|--reject) [--note <text>] [--next-node <node>]
waypoint pause --route-id <id> [--reason <text>]
waypoint resume --route-id <id>
waypoint lifecycle add workstream --key <key> --name <name>
waypoint lifecycle add milestone --workstream <key> --key <key> --title <title>
waypoint lifecycle add phase --milestone <key> --key <key> --lifecycle <name>
waypoint lifecycle add plan --phase <key> --ref <ref> --title <title>
waypoint lifecycle list
waypoint operators list [--json]
waypoint operators show <slug> [--json]
waypoint operators instructions <slug> [--json]
waypoint handoffs list [--quest <slug>] [--json]
waypoint handoffs show <slug> [--json]
waypoint tools list --operator <slug> [--json]
waypoint tools explain <tool-slug> [--json]
waypoint author brainstorm --kind quest|recipe|operator|handoff_graph [--domain <domain>] [--json]
waypoint author design --answers <path> --write-spec docs/plans/<file>.md [--json]
waypoint author plan --design docs/plans/<file>.md [--allow-unapproved-draft] [--json]
waypoint author recipe --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
waypoint author quest --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
waypoint author handoff --answers <path> [--allow-unapproved-draft] [--write-draft <path>] [--json]
```

## Operator journey

Start from an empty project folder.

### 1. Initialize the folder

```bash
waypoint init --quest waypoint
```

This creates `.waypoint/config.yaml`, installs the bundled `waypoint` Quest manifest, installs the Recipes referenced by that Quest, and creates the local state directories.

Check status:

```bash
waypoint status
```

### 2. Inspect bundled catalog content

```bash
waypoint quests
waypoint recipes --quest waypoint
```

`waypoint quests` lists available bundled Quests, with the primary starter Quests first (`firmvault` and `waypoint`). `waypoint recipes --quest waypoint` lists Recipes referenced by the `waypoint` Project Delivery (GSD) Quest.

### 3. Start a Quest route

```bash
waypoint start --quest waypoint
```

This creates a route such as `route-001`, appends a `route.started` event, scaffolds local workstream/milestone/phase/plan YAML, and materializes local tasks.

Inspect route state:

```bash
waypoint routes
waypoint route --route-id route-001
waypoint route-events --route-id route-001
waypoint tasks --route-id route-001
```

### 4. Use task discussion locally

```bash
waypoint discuss --task-id task-003 --message "Clarify the acceptance criteria before planning."
```

Task discussion is stored locally. Agent-authored messages are recorded as agent-authored and do not recursively request auto-response.

### 5. Run safe autopilot

```bash
waypoint auto --route-id route-001
waypoint auto status
```

By default, autopilot uses the null runtime. It simulates Recipe/discussion tasks, writes runtime metadata, appends events, and stops at the first human gate instead of executing external commands.

### 6. Decide a gate

When autopilot blocks on a gate, approve or reject it explicitly:

```bash
waypoint gate --route-id route-001 --node plan-approval-gate --approve --note "Plan accepted."
```

You can also pause and resume a route:

```bash
waypoint pause --route-id route-001 --reason "Waiting for owner review."
waypoint resume --route-id route-001
```

### FirmVault case-state contract

For FirmVault cases, Waypoint owns a simpler product runtime state model instead of scraping arbitrary legacy folder layouts for workflow truth.

To create and activate a new PI case folder from a trusted cases root:

```bash
waypoint firmvault bootstrap --cases-root /path/to/cases --case-name "Smith v. Acme" --case-type personal-injury --start
```

`bootstrap` creates the canonical case folder, initializes Waypoint with the bundled `firmvault` Quest, installs the Quest/Recipe manifests, initializes `.waypoint/firmvault/` state, and starts the route when `--start` is present. For agent-initiated bootstrap, use the Hermes operator adapter's trusted `cases_roots` registry and route FirmVault new-case requests through the `paralegal` profile; see `docs/firmvault-new-case-bootstrap.md`.

To add a local document after bootstrap or case-state initialization:

```bash
waypoint firmvault add-document --source /path/to/local/file.pdf --kind medical-records --note "uploaded by client" --json
```

`add-document` copies the source file into `documents/inbox/`, appends an entry to `.waypoint/firmvault/documents.yaml`, and records a `firmvault.document.added` event in `.waypoint/firmvault/events.jsonl`. It is local-only: it does not send email, fax, portal messages, API calls, or trust-account actions, and it does not mark workflow landmarks complete solely because a file exists.

To attach the external FirmVault document-pipeline review state to an indexed document:

```bash
waypoint firmvault document-handoff \
  --document-id document-001 \
  --status pr-opened \
  --pr-number 123 \
  --pr-url http://localhost:3001/aaron/FirmVault/pulls/123 \
  --branch ingest/2026-05-08-deadbeef \
  --submitted-at 2026-05-08T12:00:00.000Z \
  --json
```

`document-handoff` updates only the matching entry in `.waypoint/firmvault/documents.yaml` and appends a `firmvault.document.handoff_updated` event. It records pipeline handoff/review state for the Python/Forgejo ingestion pipeline; it still does not satisfy legal workflow landmarks by itself.

For an existing FirmVault-style folder, initialize only the case-state contract:

```bash
waypoint firmvault init-case --case-type personal-injury --case-slug smith-v-acme
waypoint firmvault landmarks
waypoint firmvault landmarks --json
```

`init-case` creates `.waypoint/firmvault/` state files. Initial landmarks are deliberately false until explicit state fields and evidence paths satisfy them.

The supported FirmVault landmark projection currently includes the core case, intake, accident, provider, BI/PIP insurance, demand, negotiation, settlement, and distribution landmarks:

```text
case_setup_complete
full_intake_complete
accident_report_obtained
providers_setup
at_fault_insurance_identified
bi_lor_prepared
bi_lor_sent
bi_acknowledgment_checked
pip_track_active
pip_carrier_identified
pip_application_prepared
pip_lor_prepared
pip_application_filed
pip_lor_sent
pip_acknowledgment_checked
pip_approved
pip_status_checked
pip_benefits_exhausted
demand_sent
initial_offer_received
settlement_reached
final_distribution_complete
```

Each landmark is derived from YAML status fields and relative evidence paths that exist inside the case folder. If a status is complete but its evidence path is missing or unsafe, the landmark remains unsatisfied and `landmarks --json` returns a warning.

The Part Three doctor remains a read-only legacy/template inspection helper when no profile is supplied:

```bash
waypoint doctor firmvault --json
```

The paralegal profile mode checks local operator readiness without network calls or external sends:

```bash
waypoint doctor firmvault --profile paralegal --json --upgrade-plan
```

It verifies the configured `waypoint_cases` root, optional source `cases` root, paralegal skill path, bundled `firmvault-paralegal` operator manifest, case export script, and local smoke scripts. Use the doctor to inspect whether a folder resembles the starter FirmVault shape or whether the paralegal operator workspace is ready. Use `.waypoint/firmvault/` as the runtime source of truth for workflow progress.

## Waypoint Wizard adoption bridge

Waypoint Wizard is the safe bridge for messy source folders that do not already look like Waypoint cases. Source files remain wherever they are and are treated as read-only inputs. The Wizard creates markdown shadows under `.waypoint/shadows`, records frontmatter source pointers and hashes, stores PII masking metadata, asks one-question-at-a-time clarifications, and writes a reviewable `.waypoint/wizard/adoption-plan.yaml`.

For FirmVault, shadows and filenames do not satisfy legal facts. Only approved proposed facts are applied, and apply uses the existing FirmVault safe state APIs rather than hand-editing `.waypoint/firmvault/*.yaml`.

Typical command flow:

```bash
waypoint wizard scan --source <path> --domain <domain> [--json]
waypoint wizard shadow --source <path> --target <case-root> --domain <domain> [--json]
waypoint wizard organize --source <path> --target <case-root> --domain <domain> [--copy-files] [--json]
waypoint wizard questions --case <case-root> [--json]
waypoint wizard answer --case <case-root> --question <id> --answer <text> [--json]
waypoint wizard plan --case <case-root> [--write-plan .waypoint/wizard/adoption-plan.yaml] [--json]
waypoint wizard apply --case <case-root> [--plan .waypoint/wizard/adoption-plan.yaml] [--json]
```

Concrete FirmVault shorthand:

```bash
waypoint wizard scan --source <source> --domain firmvault --json
waypoint wizard shadow --source <source> --target <case-root> --domain firmvault --json
waypoint wizard questions --case <case-root> --json
waypoint wizard answer --case <case-root> --question <id> --answer <text> --json
waypoint wizard plan --case <case-root> --write-plan .waypoint/wizard/adoption-plan.yaml --json
waypoint wizard apply --case <case-root> --plan .waypoint/wizard/adoption-plan.yaml --json
```

See `docs/waypoint-wizard.md` for the full operator guide.

## `.waypoint/` folder layout

A project-local folder host state tree looks like this:

```text
.waypoint/
  config.yaml                 # project opt-in, selected Quest, runtime config
  quests/                     # copied Quest manifests, e.g. waypoint.yaml
  recipes/                    # copied Recipe manifests used by the Quest
  lifecycle/
    workstreams.yaml
    milestones.yaml
    phases.yaml
    plans.yaml
  routes/
    route-001.yaml            # live route state
  events/
    route-001.jsonl           # append-only route event log
  tasks/
    tasks.yaml                # materialized task records
    task-003-discussion.jsonl # task-scoped discussion messages
  autopilot/
    runs.jsonl                # append-only autopilot run history
  firmvault/
    case.yaml                 # canonical case setup/status state
    client.yaml               # intake, contract, and HIPAA status + evidence
    accident.yaml             # accident report/liability state
    providers.yaml            # provider setup state
    insurance.yaml            # BI/PIP carrier, packet, acknowledgment, and exhaustion state
    demand.yaml               # demand package state
    negotiation.yaml          # offers and negotiation state
    settlement.yaml           # settlement and distribution state
    documents.yaml            # optional document index
    landmarks.yaml            # generated landmark projection cache
    events.jsonl              # append-only FirmVault state event log
```

Key path prefixes are `.waypoint/routes/`, `.waypoint/events/`, `.waypoint/tasks/`, `.waypoint/autopilot/runs.jsonl`, and `.waypoint/firmvault/`.

These files are intended to be readable and inspectable. A project may choose to commit or ignore `.waypoint/` depending on whether the route state is part of the repo's audit trail.

## Runtime modes

### null runtime

The null runtime is the default. It does not execute external commands. Autopilot marks eligible tasks as simulated/done and blocks at human gate tasks.

### opt-in local runtime

The local runtime executes local commands only when `.waypoint/config.yaml` explicitly sets `runtime.recipe: local` with a command and optional args:

```yaml
runtime:
  recipe: local
  command: node
  args:
    - ./capture-runtime.mjs
    - ./payload.json
```

Safety rule: `runtime.recipe: local` executes local commands. Only enable it in a project folder where you control the command, arguments, and input script. The runtime sends a stable JSON payload on stdin and captures stdout, stderr, exit code, and signal in task runtime metadata.

## Reset workflow

For temporary smoke folders, reset by deleting local state:

```bash
rm -rf .waypoint
```

Then re-run:

```bash
waypoint init --quest waypoint
waypoint start --quest waypoint
```

Do not run folder-host smokes from your home directory unless you intentionally want a home-level `.waypoint/` folder.

## Limitations

- This is a private development package, not a globally published CLI.
- The direct Node TypeScript CLI path is the verified development smoke path.
- The bundled `waypoint` Quest is the Project Delivery (GSD) starter workflow; it does not make Waypoint itself a GSD clone.
- The null runtime is safe by default but does not produce real external agent work.
- The local runtime is intentionally opt-in because it executes local commands.
- Packaging, release polish, and final readiness cleanup are tracked separately from this guide.

## Reference example

See [`examples/folder-host-quest/README.md`](../examples/folder-host-quest/README.md) for a copy/paste walkthrough that can be run from scratch.
