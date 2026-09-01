#!/usr/bin/env python3
"""Deterministic PII leak detector for the safe-evidence guard (rsc-w0z, S5-D1).

The masking POLICY is authoritative and fixed (Aaron, 2026-07-14): in
sensitive content, exactly FIVE categories are protected —

    1. client names            (per-case manifest + derived variants)
    2. SSNs                    (structured shape; near-zero false positive)
    3. email addresses         (structured shape)
    4. phone numbers           (structured shape)
    5. client mailing address  (per-case manifest, house-number+street fragment)

…and NOTHING more. Provider / doctor / staff / facility / third-party names are
NEVER masked, by design. This detector therefore uses a strict allowlist — the
per-project `protected.json` manifest — plus a few near-zero-false-positive
structured shapes. There is NO named-entity model anywhere in the detection
path: nothing is flagged unless it is a manifest value/variant or matches a
structured shape, so a provider name can never fire.

Detection mechanics are a faithful, deliberately-narrowed port of the
originating host's targeted masker. Narrowed: the original additionally masks
DOBs and labeled MRN/account/policy identifiers;
those are OUT of scope here (the five-category policy). This module DETECTS
(reports category + location, never the value); it does not rewrite.

Pure stdlib `re` — no dependencies, so the guard runs in any repo's pre-commit.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

# The five policy categories, as reported to the operator (never the value).
CAT_NAME = "client name"
CAT_SSN = "SSN"
CAT_EMAIL = "email address"
CAT_PHONE = "phone number"
CAT_ADDRESS = "client mailing address"

# Manifest entry types we act on. The original manifest also carries DOB /
# ID_NUMBER / OTHER; we ignore those here — five categories, nothing more.
_TYPE_TO_CATEGORY = {
    "PERSON": CAT_NAME,
    "SSN": CAT_SSN,
    "EMAIL": CAT_EMAIL,
    "PHONE": CAT_PHONE,
    "ADDRESS": CAT_ADDRESS,
}

# ── Structured, always-on shapes ─────────────────────────────────────────────
# Masked wherever they appear, manifest or not — near-zero false positive.
# Ported verbatim from the original masking implementation.
_STRUCTURED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (CAT_SSN, re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    (CAT_EMAIL, re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    (
        # Lookbehind instead of \b: a leading "(" or "+" is not a word boundary,
        # so \b would reject "(212) 555-0182" and "+1 212-555-0182".
        CAT_PHONE,
        re.compile(r"(?<![A-Za-z0-9])(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b"),
    ),
)

# Undashed SSN after an explicit SSN label — an SSN (in scope) that escapes the
# dashed structured shape. Narrowed from the original's
# _CONTEXT_ID_RE to the SSN label ONLY; MRN/account/policy labels are out of
# scope. The separator run tolerates kreuzberg's markdown-escaped `\#` and OCR
# table pipes (`| SSN | 078051120 |`).
_SSN_LABEL_RE = re.compile(
    r"\b(?:SSN|Social\s+Security(?:\s+(?:No|Number))?)\s*(?:No\.?|Number)?"
    r"(?:\s*\\?[|:#.\-])*\s*"
    r"(?P<value>\d{3}[-\s]?\d{2}[-\s]?\d{4})\b",
    re.IGNORECASE,
)

# A placeholder already issued by a masker (PERSON_1, SSN_2, ADDR_1, …). Skipped
# so re-scanning already-masked content never re-flags the token itself.
_PLACEHOLDER_RE = re.compile(r"\b[A-Z][A-Z0-9_]*_\d+\b")

_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "esq"}


# ── Manifest ────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ProtectedEntry:
    type: str
    value: str
    variants: tuple[str, ...] = ()
    label: str = ""


class ManifestError(RuntimeError):
    """protected.json exists but is malformed."""


def load_manifest(path: Path) -> list[ProtectedEntry]:
    """Read a protected.json manifest. Returns only the five
    in-scope entry types (PERSON/SSN/EMAIL/PHONE/ADDRESS); DOB/ID_NUMBER/OTHER
    are silently dropped — the guard enforces exactly five categories."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ManifestError(f"cannot read protected manifest {path}: {e}") from e
    out: list[ProtectedEntry] = []
    for e in data.get("entries", []):
        try:
            etype, value = e["type"], e["value"]
        except (KeyError, TypeError) as err:
            raise ManifestError(f"malformed entry in {path}: {e!r}") from err
        if etype not in _TYPE_TO_CATEGORY:
            continue
        out.append(ProtectedEntry(etype, value, tuple(e.get("variants", ())), e.get("label", "")))
    return out


# ── Variant derivation (ported from the original manifest module) ──────────
def _dedupe(candidates: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for c in candidates:
        c = c.strip()
        if len(c) < 2:
            continue
        key = c.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def _strip_name_suffixes(tokens: list[str]) -> list[str]:
    out = list(tokens)
    while out and out[-1].rstrip(".").casefold() in _NAME_SUFFIXES:
        out.pop()
    return out


def derive_person_variants(full_name: str, *, include_first_name: bool = True) -> list[str]:
    """Additional renderings of a name (surname, first, "Last, First", middle
    forms, concatenated firstlast). A mononym yields nothing. Conservative — we
    protect what identifies the person, not vocabulary. Port of
    the original derive_person_variants."""
    if full_name.count(",") == 1:
        m = re.match(r"^\s*([^,]+),\s+(.+)$", full_name)
        if m:
            full_name = f"{m.group(2)} {m.group(1)}"
    raw = [t.strip(".,;'\"") for t in full_name.split()]
    tokens = _strip_name_suffixes([t for t in raw if t])
    if len(tokens) < 2:
        return []
    first, surname, middle_tokens = tokens[0], tokens[-1], tokens[1:-1]
    middle = " ".join(middle_tokens)
    candidates = [surname]
    if include_first_name:
        candidates.append(first)
    candidates.append(f"{surname}, {first}")
    if middle:
        candidates.append(f"{first} {middle} {surname}")
        if len(middle_tokens) == 1:
            initial = middle_tokens[0][0]
            candidates.append(f"{first} {initial}. {surname}")
            candidates.append(f"{first} {initial} {surname}")
        candidates.append(f"{first} {surname}")
    candidates.append(f"{first}{surname}".lower())
    return _dedupe(candidates)


def derive_email_variants(email: str) -> list[str]:
    local = email.split("@", 1)[0].strip()
    return _dedupe([local]) if local else []


def derive_ssn_variants(ssn: str) -> list[str]:
    """Dashed and undashed renderings of a 9-digit SSN; [] otherwise. The
    last-4 alone is deliberately NOT derived (would mask any 4-digit number)."""
    digits = re.sub(r"\D", "", ssn)
    if len(digits) != 9:
        return []
    return _dedupe([f"{digits[:3]}-{digits[3:5]}-{digits[5:]}", digits])


def derive_address_variants(address: str) -> list[str]:
    """House-number + street-name fragment ("3421 Heatherfield Dr" from
    "3421 Heatherfield Dr. City ST 12345"). No bare ZIP / bare street name (both
    over-match landmines). Port of the original derive_address_variants."""
    text = address.strip()
    if not re.match(r"^\d", text):
        return []
    street = text.split(",", 1)[0].strip()
    if "," not in text:
        m = re.search(r"\b[A-Za-z]{2}\s+\d{5}(?:-\d{4})?\b", street)
        if m:
            street = street[: m.start()].strip()
            street = re.sub(r"\s+\S+$", "", street).strip()
    if not re.match(r"^\d", street):
        return []
    return _dedupe([street])


def _derive(entry: ProtectedEntry) -> list[str]:
    if entry.type == "PERSON":
        return derive_person_variants(entry.value)
    if entry.type == "ADDRESS":
        return derive_address_variants(entry.value)
    if entry.type == "SSN":
        return derive_ssn_variants(entry.value)
    # EMAIL is NOT expanded to its local part: a bare username ("abby") is not
    # "an email address" under the five-category policy, and it would collide
    # with a matching nickname. The full email is caught by the structured
    # EMAIL shape (and, if oddly formatted, by the literal manifest value).
    return []


# ── Term compilation ─────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Term:
    category: str
    regex: re.Pattern[str]


def _term_regex(text: str) -> re.Pattern[str]:
    # Underscore in the boundary class so a term can never match inside a
    # placeholder (PERSON_1). Case-insensitive; the literal text is escaped.
    return re.compile(rf"(?<![A-Za-z0-9_]){re.escape(text)}(?![A-Za-z0-9_])", re.IGNORECASE)


def build_terms(manifest: list[ProtectedEntry]) -> list[Term]:
    """Compile every manifest value + stored variant + derived variant into a
    boundary-anchored regex, longest match text first so the most specific term
    is reported. Structured shapes are handled separately in scan_text."""
    seen: set[str] = set()
    pairs: list[tuple[str, str]] = []  # (category, match_text)
    for e in manifest:
        category = _TYPE_TO_CATEGORY[e.type]
        for text in (e.value, *e.variants, *_derive(e)):
            t = text.strip()
            key = (category, t.casefold())
            if t and key not in seen:
                seen.add(key)
                pairs.append((category, t))
    pairs.sort(key=lambda p: len(p[1]), reverse=True)
    return [Term(category, _term_regex(text)) for category, text in pairs]


# ── Scanning ─────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Finding:
    category: str
    line: int  # 1-indexed
    # NB: the matched VALUE is never stored or reported — only category + line.


def scan_text(text: str, terms: list[Term]) -> list[Finding]:
    """Return findings (category + line), never the offending value. Structured
    shapes always fire; manifest terms fire when a manifest was supplied.

    Structured matches win over manifest terms on overlap: a manifest name whose
    text falls INSIDE a structured span (e.g. the nickname "abby" inside
    "abby@example.com") is suppressed, so the email reports once as an email.
    Idempotent on already-masked content: placeholder spans (PERSON_1, …) are
    blanked first so the token itself never re-triggers."""
    # Blank out placeholders so a re-scan of masked output stays clean.
    scrubbed = _PLACEHOLDER_RE.sub(lambda m: " " * len(m.group(0)), text)

    findings: list[Finding] = []
    seen: set[tuple[str, int]] = set()  # de-dupe (category, line)
    structured_spans: list[tuple[int, int]] = []

    def line_of(pos: int) -> int:
        return scrubbed.count("\n", 0, pos) + 1

    def record(category: str, start: int) -> None:
        key = (category, line_of(start))
        if key not in seen:
            seen.add(key)
            findings.append(Finding(category, line_of(start)))

    for category, pattern in _STRUCTURED_PATTERNS:
        for m in pattern.finditer(scrubbed):
            structured_spans.append((m.start(), m.end()))
            record(category, m.start())
    for m in _SSN_LABEL_RE.finditer(scrubbed):
        structured_spans.append((m.start("value"), m.end("value")))
        record(CAT_SSN, m.start("value"))

    def inside_structured(pos: int) -> bool:
        return any(s <= pos < e for s, e in structured_spans)

    for term in terms:
        for m in term.regex.finditer(scrubbed):
            if inside_structured(m.start()):
                continue  # the structured shape already owns this span
            record(term.category, m.start())

    findings.sort(key=lambda f: (f.line, f.category))
    return findings
