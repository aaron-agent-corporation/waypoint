#!/usr/bin/env python3
"""Tests for the safe-evidence detector. Run: python3 tools/safe-evidence/test_masking.py

Every fixture is fictional. The load-bearing invariants:
  - the five categories are detected (client name + variants, SSN, email, phone,
    client mailing address);
  - provider / staff / third-party names are NEVER flagged;
  - a Finding never carries the offending value — only category + line;
  - already-masked content (PERSON_1 tokens) re-scans clean (idempotence);
  - out-of-scope categories (DOB, MRN/account) are NOT flagged.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from masking import (  # noqa: E402
    CAT_ADDRESS,
    CAT_EMAIL,
    CAT_NAME,
    CAT_PHONE,
    CAT_SSN,
    ProtectedEntry,
    build_terms,
    derive_person_variants,
    scan_text,
)

# A synthetic client manifest (what protected.json would yield after loading).
CLIENT = [
    ProtectedEntry("PERSON", "Abigail Example", ("Abby",), "client"),
    ProtectedEntry("ADDRESS", "3421 Heatherfield Dr, Louisville KY 40202", (), "client"),
    ProtectedEntry("SSN", "078-05-1120", (), "client"),
    ProtectedEntry("PHONE", "502-555-0182", (), "client"),
    ProtectedEntry("EMAIL", "abby@example.com", (), "client"),
]


@dataclass
class Case:
    name: str
    text: str
    expect: set[str]  # expected categories (order/line agnostic)


def cats(text: str, manifest=CLIENT) -> set[str]:
    return {f.category for f in scan_text(text, build_terms(manifest))}


def main() -> int:
    failures = 0

    def check(name: str, got, want) -> None:
        nonlocal failures
        if got != want:
            failures += 1
            print(f"FAIL {name}: got {sorted(got)}, want {sorted(want)}")

    # ── Structured shapes fire with no manifest at all ───────────────────────
    check(
        "structured-no-manifest",
        {f.category for f in scan_text(
            "Contact 078-05-1120, jane@example.com, (212) 555-0182", terms=[])},
        {CAT_SSN, CAT_EMAIL, CAT_PHONE},
    )

    # ── The five categories, with a manifest ─────────────────────────────────
    check("client-name", cats("Abigail Example joined the project in March."), {CAT_NAME})
    check("client-nickname", cats("Abby reports improvement."), {CAT_NAME})
    check("client-surname-variant", cats("Ms. Example was seen in follow-up."), {CAT_NAME})
    check("client-ssn", cats("SSN on file: 078-05-1120"), {CAT_SSN})
    check("client-phone", cats("Callback 502-555-0182 left with the office."), {CAT_PHONE})
    check("client-email", cats("Portal login abby@example.com created."), {CAT_EMAIL})
    check("client-address", cats("Home address 3421 Heatherfield Dr per intake."), {CAT_ADDRESS})

    # ── Provider / staff / third-party names are NEVER flagged ───────────────
    check(
        "provider-name-not-flagged",
        cats("Seen by Dr. Sandra Kessler at Baptist Health; nurse Thompson charted vitals."),
        set(),
    )
    check(
        "firm-and-vocabulary-clean",
        cats("Whaley Law Firm requested the records; HIPAA authorization enclosed."),
        set(),
    )

    # ── Out-of-scope identifiers are NOT flagged (exactly five categories) ────
    check("dob-not-flagged", cats("DOB 04/12/1985; treatment 03/03/2024."), set())
    check("mrn-not-flagged", cats("MRN #4829103, Account 58394027, Policy 12345."), set())

    # ── Undashed SSN only via an explicit SSN label (not any 9-digit run) ─────
    check("undashed-ssn-labeled", cats("Social Security Number: 078051120"), {CAT_SSN})
    # A random 9-digit run (NOT the client's SSN) is not flagged — bare undashed
    # SSNs fire only after an explicit SSN label.
    check("bare-9-digits-not-ssn", cats("Order number 314159265 shipped."), set())
    # The client's OWN SSN, appearing undashed, IS a leak (manifest variant).
    check("client-undashed-ssn", cats("id 078051120 on file"), {CAT_SSN})

    # ── A clean note produces nothing ───────────────────────────────────────
    check(
        "clean-note",
        cats("The committee reviewed the budget. Approved phase two. Follow up in 2 weeks."),
        set(),
    )

    # ── Findings never carry the value; line numbers are right ───────────────
    findings = scan_text("line one\nAbigail Example here\n078-05-1120\n", build_terms(CLIENT))
    for f in findings:
        # The dataclass has exactly category + line — assert no value leaked in.
        assert set(vars(f).keys()) == {"category", "line"}, f"Finding leaks a value field: {vars(f)}"
    by_line = {f.line: f.category for f in findings}
    check("line-numbering", by_line, {2: CAT_NAME, 3: CAT_SSN})

    # ── Idempotence: already-masked content re-scans clean ───────────────────
    check(
        "masked-content-clean",
        cats("Patient PERSON_1 (SSN_1) reached at PHONE_1; email EMAIL_1."),
        set(),
    )

    # ── Name-variant derivation (unit) ───────────────────────────────────────
    variants = set(derive_person_variants("Abigail Rose Example"))
    for want in ("Example", "Abigail", "Example, Abigail", "Abigail R. Example", "abigailexample"):
        if want not in variants:
            failures += 1
            print(f"FAIL person-variants: {want!r} missing from {sorted(variants)}")
    if derive_person_variants("Cher"):  # mononym → nothing
        failures += 1
        print("FAIL person-variants: mononym should yield no variants")

    if failures == 0:
        print("all safe-evidence detector tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
