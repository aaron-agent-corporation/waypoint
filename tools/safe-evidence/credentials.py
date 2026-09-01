#!/usr/bin/env python3
"""Deterministic CREDENTIAL leak detector for the safe-evidence guard (rsc-889).

A SEPARATE module from masking.py, deliberately. The five-category masking policy
(client names, SSNs, emails, phones, client addresses — and NEVER provider/doctor/
staff names) is authoritative and fixed. Credentials are not a sixth masking
category: they are a different question ("did a secret escape?") with a different
scope and different remedies. Keeping them in their own module makes that boundary
structural — nothing here can widen the masking policy, and nobody reading the
policy has to wonder whether `Bearer` is now a client identifier.

WHY THIS EXISTS: the worker runs with a real credential (rsc-m8x narrowed that to
the model key + substrate URL, it did not remove it). An agent that prints its
environment — or a tool that logs a request header — puts that secret in content
that gets committed: a run dossier, a report, a scratch file. This is the last
gate before it reaches a PR.

WHAT THIS IS NOT: this guard sees COMMITS. The worker's stdout also reaches
Postgres evidence rows and is re-injected into a later attempt's prompt, and no
pre-commit hook can see either (rsc-xam). Do not mistake a clean run here for
"no credential escaped".

DISCIPLINE, inherited from masking.py: strict structured shapes with near-zero
false positives, no entropy heuristics, no model. Every pattern below matches a
VENDOR-DEFINED format — a fixed prefix plus a known length — so it fires on the
real thing and not on prose that happens to look secret-ish. Thresholds come from
the published formats, not from guesswork about what looks long enough.

Reports category + line, NEVER the matched value: this output goes to a terminal,
CI logs, and (via the guard) anywhere an operator pastes it. A leak detector that
prints the leak is a leak.

Pure stdlib `re` — no dependencies, so the guard runs in any repo's pre-commit.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

CAT_ANTHROPIC = "Anthropic API key"
CAT_OPENAI = "OpenAI API key"
CAT_GITHUB = "GitHub token"
CAT_AWS = "AWS access key id"
CAT_PRIVATE_KEY = "private key"
CAT_JWT = "JWT"
CAT_BEARER = "bearer token"
CAT_OAUTH = "agent OAuth credential"

# ── The shapes come from data, not from this file ────────────────────────────
# credential-patterns.json is the single source of truth, shared with the
# TypeScript evidence mask (rsc-xam) that redacts worker output before it reaches
# Postgres and the next agent's prompt. Two hand-maintained copies in two
# languages would drift, and drift here is silent: the guard keeps passing while
# the mask quietly stops covering a category. The TS side is GENERATED from this
# file and drift-tested, the way the prose gate byte-diffs recompiled YAML.
PATTERNS_PATH = Path(__file__).parent / "credential-patterns.json"


def _load() -> dict:
    return json.loads(PATTERNS_PATH.read_text(encoding="utf-8"))


def _compile(spec: dict) -> re.Pattern[str]:
    flags = re.IGNORECASE if "i" in spec.get("flags", "") else 0
    return re.compile(spec["regex"], flags)


_SPEC = _load()

# ── Vendor-defined shapes, loaded from credential-patterns.json ──────────────
# Each is prefix + charset + minimum length taken from the vendor's own format;
# the rationale for each lives beside it in the JSON.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (spec["category"], _compile(spec)) for spec in _SPEC["simple"]
)

# Three base64url segments; `eyJ` is base64 of `{"`, i.e. a JSON header. Handled
# apart from _PATTERNS because of the URL rule below.
_JWT_RE = _compile(_SPEC["jwt"])

# Shapes whose SECRET is a capture group rather than the whole match: the OAuth
# blob (~/.claude/.credentials.json) anchors on the key name, and `Bearer` anchors
# on an ordinary English word. Both therefore need the placeholder guard.
_VALUED: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (spec["category"], _compile(spec)) for spec in _SPEC["valued"]
)

# A value that is obviously a stand-in, not a secret. Checked against the TOKEN
# only (never the surrounding text), so a real token containing the letters
# "example" is not excused by them.
_PLACEHOLDER_RE = _compile(_SPEC["placeholder"])
_PLACEHOLDER_CHARS = _SPEC["placeholder_chars"]
_URL_SCHEME = _SPEC["url_scheme"]


def _is_placeholder(value: str) -> bool:
    if _PLACEHOLDER_RE.match(value):
        return True
    # A template interpolation anywhere in the value: `Bearer ${TOKEN}`,
    # `Bearer {{ .Token }}`, `Bearer <TOKEN>`. Not a secret — a shape.
    return any(ch in value for ch in _PLACEHOLDER_CHARS)


def _in_url(text: str, start: int) -> bool:
    """Is the token at `start` embedded in a URL?

    MEASURED, not guessed. Sweeping this detector across all 8,876 tracked text
    files in the repo returned 155 findings — every single one a JWT, and every
    single one a FreshBooks invoice link inside archived client email:

        https://my.freshbooks.com/#/link/<jwt>?companyName=...&invoiceNumber=...

    Those are real JWTs (the header decodes to {"typ":"JWT","alg":"HS256"}), but
    they are not OUR credential leaking — they are a vendor's capability URL,
    quoted inside correspondence that IS the content. A document vault is full
    of this: invoice links, password resets, calendar invites, e-sign links. A
    guard that refuses every commit of archived email would be switched off
    within a day, and a switched-off guard would then miss the `sk-ant-` key it
    was built for. Crying wolf is not a lesser failure than silence; it is a
    slower path to the same silence.

    The threat this module exists for does not look like a URL. It looks like
    `ANTHROPIC_API_KEY=...` in an env dump, or an `Authorization:` header in a
    log. So a JWT inside a URL is content; a bare one is a leak.

    A JWT that a real leak happens to embed in a URL is the accepted cost, and it
    is the right side to err on given what the sweep actually found.
    """
    # The maximal run of URL-ish characters containing the token. If that run
    # carries a scheme, the token is part of a link rather than a bare secret.
    left = start
    while left > 0 and not text[left - 1].isspace() and text[left - 1] not in "\"'`<>(),":
        left -= 1
    return _URL_SCHEME in text[left:start]


@dataclass(frozen=True)
class CredentialFinding:
    category: str
    line: int  # 1-indexed
    # NB: the matched VALUE is never stored or reported — only category + line.


def scan_credentials(text: str) -> list[CredentialFinding]:
    """Return credential findings (category + line), never the offending value.

    Unlike the PII scan, this takes no manifest and no configuration: a
    credential is a credential in any file, in any repo, belonging to anyone.
    There is nothing case-specific to allowlist.
    """
    findings: list[CredentialFinding] = []
    seen: set[tuple[str, int]] = set()

    def line_of(pos: int) -> int:
        return text.count("\n", 0, pos) + 1

    def record(category: str, start: int) -> None:
        key = (category, line_of(start))
        if key not in seen:
            seen.add(key)
            findings.append(CredentialFinding(category, line_of(start)))

    for category, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            record(category, m.start())

    for m in _JWT_RE.finditer(text):
        if not _in_url(text, m.start()):
            record(CAT_JWT, m.start())

    # Group 1 is the secret; the match also spans its anchor (the key name, or
    # the word "Bearer"). Plain group 1, not a named group: the same regex has to
    # mean the same thing to JavaScript, which spells named groups differently.
    for category, pattern in _VALUED:
        for m in pattern.finditer(text):
            if not _is_placeholder(m.group(1)):
                record(category, m.start())

    findings.sort(key=lambda f: (f.line, f.category))
    return findings
