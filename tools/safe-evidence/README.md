# Safe-evidence guard

A deterministic pre-commit guard that refuses to commit either

1. **unmasked PII in sensitive content** (rsc-w0z, D1), or
2. **a credential, in any file at all** (rsc-889).

Part of the runner's safety floor.

## The two scopes differ — that is the design

**PII** is scanned only in sensitive paths, because that is where
personal identifiers live and the policy scopes masking there.

**Credentials** are scanned in **every** staged text file, with no path scope and
no manifest. A leaked key does not respect the folder layout: the worker prints
its environment into a run dossier, a report, a scratch note, a shell script — and
a dossier is not a sensitive record. Scoping credentials to `sensitive/` would have
made the guard blind exactly where the leak lands. There is also nothing
project-specific to allowlist: a credential is a credential in any repo.

Why the worker has a credential to leak at all: `rsc-m8x` narrowed the worker's
environment to an allowlist, which *reduced* the secrets it holds (to the model
key plus the substrate URL) but did not remove them. This guard is the last gate
before one reaches a PR.

**What this guard does NOT cover.** It sees *commits*. The worker's stdout also
lands in Postgres evidence rows and is re-injected into a later attempt's prompt
(`rsc-xam`), and no pre-commit hook can see either. A clean run here does not mean
"no credential escaped."

## The policy (authoritative, fixed)

Exactly **five categories** are protected, and nothing more (Aaron, 2026-07-14):

1. **client names** — from the project's protected manifest, plus derived variants
2. **SSNs** — structured shape (`123-45-6789`), plus undashed after an `SSN:` label
3. **email addresses** — structured shape
4. **phone numbers** — structured shape
5. **client mailing address** — from the manifest (house-number + street fragment)

**Provider / doctor / staff / facility / third-party NAMES are never masked**, by
design — never "fix" this. Note the carve-out is about *names*: phone numbers,
emails, and SSNs are masked by shape wherever they appear (a provider's fax in a
sensitive record still masks to `PHONE_1`). DOB and MRN/account/policy numbers are
**out of scope** here even though the original implementation masks them — five
categories only.

The model: sensitive content is **masked before commit** (PII → `PERSON_1`,
`SSN_1`, `PHONE_1`, … tokens); this guard is the *verifier* that no raw value
survived. It never rewrites content and never prints a matched value — only
`file:line: unmasked <category>`.

## How it works

Strict **allowlist**, no NER: nothing is flagged unless it matches a
near-zero-false-positive structured shape or a value in the per-project manifest.
That is why provider names can never fire — they are simply not in the manifest.
Detection is a narrowed port of the originating host's targeted masker.

- `masking.py` — the PII detector (structured shapes, manifest loading,
  name/address/SSN variant derivation, `scan_text`). Pure stdlib.
- `credentials.py` — the CREDENTIAL detector (`scan_credentials`). Deliberately a
  separate module: the five-category masking policy is authoritative, credentials
  are not a sixth category, and keeping them apart means nothing here can widen
  that policy. Same discipline — vendor-defined structured shapes only, no entropy
  heuristics, no model.
- `guard.py` — the pre-commit gate: staged files → scan → `file:line: category`.
  Exit **0** clean / **1** leak(s) / **2** hard error.
- `pre-commit-hook.sh`, `install-hook.sh` — deployment into a project vault.
- `test_masking.py`, `test_guard.py`, `test_credentials.py` — synthetic-fixture
  tests (no real PII, no real credentials).

### Credential categories

Anthropic (`sk-ant-`), OpenAI (`sk-`/`sk-proj-`), GitHub (`ghp_`/`gho_`/… and
`github_pat_`), AWS (`AKIA`/`ASIA`), PEM private keys, JWTs, `Bearer` tokens, and
the agent OAuth blob shape (`~/.claude/.credentials.json`'s
`accessToken`/`refreshToken`).

Every pattern is a **vendor-defined format** — fixed prefix plus known length — so
it fires on the real thing and not on prose. Placeholders never fire
(`Bearer <your-token>`, `${TOKEN}`, `{{ .Values.token }}`, `xxxxxxxx`, `REDACTED`),
because a guard that flags the README gets switched off, and a switched-off guard
catches nothing. Over-matching is not a lesser failure than under-matching — it is
a slower path to the same silence.

**A JWT inside a URL is content, not a leak.** The first sweep of this repo (8,876
tracked text files) returned 155 findings, *all* of them JWTs in FreshBooks invoice
links quoted inside archived client email. Real JWTs, but a vendor's capability URL
that IS the evidence — not our credential escaping. A vault is full of these
(invoice links, password resets, e-sign links), so a URL-embedded JWT is skipped
and a bare one still fires. The threat here looks like `ANTHROPIC_API_KEY=…` in an
env dump, not like a link.

**Test fixtures must be assembled, not written literally.** The tests build tokens
as `"sk-ant-api03-" + "A1b2…"`, so the source carries no contiguous credential
literal and stays committable under its own guard — without an ignore file, a
baseline, or inline suppressions, each of which is a place a real leak could later
hide. Paste a real key as a literal and the self-scan test fails, which is the
warning you would want.

### The per-project manifest

Personal name and mailing address are project-specific, so the guard reads a
**`protected.json` manifest**, found by walking up from each staged
file to the repo root, under `.safe-evidence/`:

```json
{
  "schema_version": 1,
  "entries": [
    {"type": "PERSON",  "value": "Jane Q. Client", "variants": ["Janie"], "label": "client"},
    {"type": "SSN",     "value": "123-45-6789", "label": "client"},
    {"type": "PHONE",   "value": "502-555-0182", "label": "client"},
    {"type": "EMAIL",   "value": "jane@example.com", "label": "client"},
    {"type": "ADDRESS", "value": "3421 Heatherfield Dr, Louisville KY 40202", "label": "client"}
  ]
}
```

Only `PERSON / SSN / EMAIL / PHONE / ADDRESS` entries are used; others are
ignored.

**No manifest for a staged sensitive file?** Structured shapes (SSN/email/phone)
still block; personal name/address can't be checked, so the guard prints a loud
warning. `--require-manifest` turns that into a hard failure (fail-closed).

### Scope

Only staged files whose path looks sensitive are scanned — default substrings
`sensitive`, `confidential`, `pii`. Extend with `--hint`, or
scan every staged text file with `--all`. Binary files (raw PDFs) are skipped.

## Install (in a project vault)

```sh
sh tools/safe-evidence/install-hook.sh "/path/to/your/vault"
```

The vault is a separate repo, so the hook is written with an absolute path to
`guard.py`. It refuses to overwrite an existing pre-commit hook (prints the line
to chain instead). Uninstall: delete `<vault>/.git/hooks/pre-commit`.

## Run manually / in tests

```sh
python3 tools/safe-evidence/guard.py                 # scan the staged index
python3 tools/safe-evidence/guard.py --paths a.md    # scan specific files
python3 tools/safe-evidence/guard.py --all           # ignore the sensitive-path scope for PII too
python3 tools/safe-evidence/test_masking.py          # PII detector unit tests
python3 tools/safe-evidence/test_credentials.py      # credential detector unit tests
python3 tools/safe-evidence/test_guard.py            # end-to-end git tests
```

## If a credential fires

It is not a masking problem, and you cannot fix it by editing the file: **rotate
the secret**. By the time the guard sees it, it is staged, and if it was ever
committed it is in the reflog and in history. Rotate first, clean up second —
deleting first hides the evidence without closing the hole.

The guard's first sweep of this repo found live credentials in `archive/`,
including Supabase `service_role` JWTs valid until 2035 (`rsc-254`). It works.
