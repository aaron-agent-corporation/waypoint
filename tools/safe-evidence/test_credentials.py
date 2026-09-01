#!/usr/bin/env python3
"""Unit tests for the credential leak detector (rsc-889).

EVERY SECRET IN THIS FILE IS FABRICATED. The tokens are structurally valid — they
have to be, or they would not exercise the patterns — but the bodies are typed
filler. No real credential is handled, printed, or committed here, and none may
ever be added: this file is committed to a repo, which is precisely the sink the
guard exists to close.

The tests that matter most are the FALSE-POSITIVE ones. A leak detector that
fires on the README gets switched off, and a switched-off guard catches nothing —
so over-matching is not a lesser failure than under-matching, it is a slower path
to the same place.

Run: python3 tools/safe-evidence/test_credentials.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from credentials import (  # noqa: E402
    CAT_ANTHROPIC,
    CAT_AWS,
    CAT_BEARER,
    CAT_GITHUB,
    CAT_JWT,
    CAT_OAUTH,
    CAT_OPENAI,
    CAT_PRIVATE_KEY,
    scan_credentials,
)

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok   {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"  FAIL {name}  {detail}")


def cats(text: str) -> set[str]:
    return {f.category for f in scan_credentials(text)}


# ── Fabricated tokens, real shapes ───────────────────────────────────────────
ANTHROPIC = "sk-ant-api03-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
OPENAI = "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2"
GITHUB_PAT = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"  # ghp_ + exactly 36
GITHUB_FINE = "github_pat_" + "11ABCDEFG0" + "A1b2C3d4E5f6G7h8I9j0K1l2M3"
AWS = "AKIA" + "IOSFODNN7EXAMPLE"  # AKIA + exactly 16
JWT = "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" + ".dBjftJeZ4CVPmB92K27uhbUJU1p1r"


def test_real_shapes_fire() -> None:
    print("\nreal vendor shapes are caught:")
    check("Anthropic sk-ant-", cats(f"ANTHROPIC_API_KEY={ANTHROPIC}") == {CAT_ANTHROPIC})
    check("OpenAI sk-proj-", CAT_OPENAI in cats(f"export OPENAI_API_KEY={OPENAI}"))
    check("GitHub ghp_", cats(f"token: {GITHUB_PAT}") == {CAT_GITHUB})
    check("GitHub fine-grained PAT", CAT_GITHUB in cats(f"GH_TOKEN={GITHUB_FINE}"))
    check("AWS AKIA", cats(f"AWS_ACCESS_KEY_ID={AWS}") == {CAT_AWS})
    check("JWT / OAuth blob", CAT_JWT in cats(f"Authorization: {JWT}"))
    # Assembled, like every other fixture here — see test_self_scan.
    check(
        "PEM private key",
        CAT_PRIVATE_KEY in cats("-----BEGIN " + "OPENSSH PRIVATE KEY" + "-----\nb3BlbnNza\n"),
    )
    check("PEM, no algorithm word", CAT_PRIVATE_KEY in cats("-----BEGIN " + "PRIVATE KEY" + "-----"))


def test_the_actual_leak_scenario() -> None:
    """The reason the bead exists: an agent prints its env into a dossier."""
    print("\nthe scenario this guard exists for:")
    dossier = f"""# Run dossier — route-001/task-1

## Session transcript
$ env
PATH=/usr/bin:/bin
HOME=/Users/operator
ANTHROPIC_API_KEY={ANTHROPIC}
WAYPOINT_POSTGRES_URL=postgres://waypoint@localhost:5433/postgres

The agent then summarized the report.
"""
    check("an env dump in a dossier is caught", CAT_ANTHROPIC in cats(dossier))
    # And the thing that makes it interesting: a dossier is NOT a sensitive path,
    # so the PII scope would never have looked at this file. See test_guard.py.

    print("\nthe agent credential file shape (~/.claude/.credentials.json):")
    blob = '{"claudeAiOauth":{"accessToken":"' + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4" + '","refreshToken":"' + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6" + '"}}'
    check("OAuth accessToken/refreshToken blob", CAT_OAUTH in cats(blob))


def test_bearer() -> None:
    print("\nbearer tokens:")
    check("a real-looking bearer token fires", CAT_BEARER in cats(f"Authorization: Bearer {GITHUB_PAT}"))
    check(
        "a bearer JWT fires (as a JWT, at least)",
        cats(f"-H 'Authorization: Bearer {JWT}'") & {CAT_BEARER, CAT_JWT} != set(),
    )


def test_placeholders_do_not_fire() -> None:
    """The tests that keep the guard usable. Docs are full of these."""
    print("\nplaceholders and templates do NOT fire:")
    for text in [
        "Authorization: Bearer <your-token>",
        "Authorization: Bearer YOUR_API_KEY_HERE",
        "Authorization: Bearer ${ANTHROPIC_API_KEY}",
        "Authorization: Bearer {{ .Values.token }}",
        "curl -H 'Authorization: Bearer $TOKEN' https://api.example.com",
        "Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxx",
        "Authorization: Bearer REDACTED_FOR_THE_TICKET",
        "Authorization: Bearer example-token-value",
        '{"accessToken": "<REDACTED>"}',
        '{"accessToken": "${OAUTH_ACCESS_TOKEN}"}',
    ]:
        check(f"no fire: {text[:44]!r}", cats(text) == set(), f"fired: {cats(text)}")


def test_prose_does_not_fire() -> None:
    print("\nordinary prose and code do NOT fire:")
    for text in [
        # The words, without the shapes.
        "The bearer of this letter is the document's author.",
        "Pass the bearer token in the Authorization header.",
        "We rotate every secret key quarterly per the policy.",
        # A real sentence with a long hyphenated run — no vendor prefix.
        "See the report-build-2026-07-16-final-reviewed-by-abby document.",
        # Short/obviously-truncated renderings people paste into tickets.
        "key starts with sk-ant- and is 108 characters long",
        "the token begins ghp_ and we store it in 1Password",
        # A commit sha, a uuid: long, alnum, and not a credential.
        "commit 6fd5cec3448c8f2ba1e5d0b9c7a3e1f2d4b6a8c0",
        "instance 9a1ea69f-4c2b-4d1e-8f3a-7b6c5d4e3f2a",
        # Base64 that is not a JWT (no eyJ header, no three segments).
        "checksum: SGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSB0b2tlbg==",
    ]:
        check(f"no fire: {text[:44]!r}", cats(text) == set(), f"fired: {cats(text)}")


def test_jwt_in_a_url_is_content_not_a_leak() -> None:
    """The rule the empirical sweep forced (see credentials._in_url).

    Scanning all 8,876 tracked text files produced 155 findings — every one a JWT
    in a FreshBooks invoice link inside archived client email. Real JWTs, but a
    vendor's capability URL quoted as evidence, not our credential escaping. A
    vault is full of these, and a guard that blocks every client email gets
    switched off — and then misses the key it exists for.
    """
    print("\na JWT inside a URL is correspondence, not a leaked secret:")
    for text in [
        f"Visit the link below to view your invoice:\nhttps://my.freshbooks.com/#/link/{JWT}?invoiceNumber=0000088",
        f"Reset your password: https://vendor.example.com/reset?token={JWT}",
        f"<a href=\"https://portal.example.com/e-sign/{JWT}\">Sign here</a>",
    ]:
        check(f"no fire (URL): {text[:40]!r}", CAT_JWT not in cats(text), f"fired: {cats(text)}")

    print("\n…but a BARE token still fires — that is the actual leak shape:")
    check("bare JWT in a log", CAT_JWT in cats(f"DEBUG auth token={JWT}"))
    check("JWT in an auth header", CAT_JWT in cats(f"Authorization: Bearer {JWT}"))
    check("JWT in a JSON field", CAT_JWT in cats(f'{{"id_token": "{JWT}"}}'))


def test_masked_and_reporting() -> None:
    print("\nreporting contract:")
    findings = scan_credentials(f"line one\nANTHROPIC_API_KEY={ANTHROPIC}\nline three")
    check("reports the right line", [f.line for f in findings] == [2], f"got {[f.line for f in findings]}")
    check(
        "the finding carries NO value — only category + line",
        not any(ANTHROPIC[8:] in repr(f) for f in findings),
        "a finding's repr contained the secret",
    )
    check("clean text yields nothing", scan_credentials("nothing to see here\n") == [])
    dupes = scan_credentials(f"{ANTHROPIC} and again {ANTHROPIC}")
    check("de-dupes per (category, line)", len(dupes) == 1, f"got {len(dupes)}")


def test_self_scan() -> None:
    """This file is clean, BY CONSTRUCTION, and that is the point.

    Every fixture above is assembled at runtime (`"sk-ant-api03-" + "A1b2..."`),
    so the source text never contains a contiguous credential literal even though
    the values the tests scan are structurally real. The detector therefore does
    not fire on its own test file, and this file stays committable under its own
    guard — without an ignore rule, a baseline, or an inline suppression comment,
    each of which is a place a real leak could later hide.

    It is the same lesson the microsandbox spike learned the hard way, inverted: a
    probe that greps for a literal finds it in its own /proc/self/cmdline, so you
    rebuild the needle at runtime. Here we rebuild it so the haystack stays clean.

    The property this locks: paste a REAL key here as a plain literal and this
    test fails — which is exactly the warning you would want.
    """
    print("\nself-scan (fixtures are assembled, so the file itself is clean):")
    found = scan_credentials(Path(__file__).read_text(encoding="utf-8"))
    check(
        "no contiguous credential literal in this file",
        found == [],
        f"lines {[(f.line, f.category) for f in found]} — a fixture was written as a plain literal; assemble it instead",
    )


def main() -> int:
    test_real_shapes_fire()
    test_the_actual_leak_scenario()
    test_bearer()
    test_jwt_in_a_url_is_content_not_a_leak()
    test_placeholders_do_not_fire()
    test_prose_does_not_fire()
    test_masked_and_reporting()
    test_self_scan()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("all credential detector tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
