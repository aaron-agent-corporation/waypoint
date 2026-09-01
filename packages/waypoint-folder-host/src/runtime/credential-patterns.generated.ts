// GENERATED FILE — DO NOT EDIT.
//
// Source:    tools/safe-evidence/credential-patterns.json
// Generator: tools/safe-evidence/gen-ts-patterns.py
//
// The Python pre-commit guard (tools/safe-evidence/credentials.py) reads the
// same JSON. Hand-editing this file makes the two engines disagree, which is a
// SILENT failure — the guard keeps passing while this mask stops covering a
// category. credential-mask.test.ts regenerates and byte-compares to stop
// that, the way the prose gate does for quest YAML.
//
// Edit the JSON and re-run the generator.

export interface CredentialPattern {
  readonly category: string
  /** Source text for a RegExp. Kept dialect-clean: no named groups, no inline flags. */
  readonly regex: string
  readonly flags: string
}

/** Shapes where the whole match is the secret. */
export const SIMPLE_PATTERNS: readonly CredentialPattern[] = [
  { category: "Anthropic API key", regex: "\\bsk-ant-[A-Za-z0-9_-]{24,}", flags: "" },
  { category: "OpenAI API key", regex: "\\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}", flags: "" },
  { category: "GitHub token", regex: "\\bgh[pousr]_[A-Za-z0-9]{36}\\b", flags: "" },
  { category: "GitHub token", regex: "\\bgithub_pat_[A-Za-z0-9_]{22,}", flags: "" },
  { category: "AWS access key id", regex: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b", flags: "" },
  { category: "private key", regex: "-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----", flags: "" },
]

/** Three base64url segments. Skipped inside a URL — see credential-mask.ts. */
export const JWT_PATTERN: CredentialPattern = { category: "JWT", regex: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}", flags: "" }

/** Shapes where GROUP 1 is the secret and the match spans its anchor too. */
export const VALUED_PATTERNS: readonly CredentialPattern[] = [
  { category: "agent OAuth credential", regex: "\"(?:access|refresh)Token\"\\s*:\\s*\"([^\"]{20,})\"", flags: "i" },
  { category: "bearer token", regex: "\\bBearer\\s+([A-Za-z0-9._~+/-]{20,}={0,2})", flags: "" },
]

/** A captured value that is obviously a stand-in. Tested against the value ALONE. */
export const PLACEHOLDER_PATTERN: CredentialPattern = { category: 'placeholder', regex: "^(?:[Xx]+|\\.+|(?:your|my|the)[-_.]?\\w*|\\w*(?:token|secret|key|credential)s?[-_.]?(?:here|goes[-_.]?here|value)?|(?:example|placeholder|redacted|dummy|fake|sample|test|changeme|todo)[-_.\\w]*|\\$\\{?\\w+\\}?|<[^>]*>|\\{\\{?[^}]*\\}?\\})$", flags: "i" }

export const PLACEHOLDER_CHARS = "<>{}$"
export const URL_SCHEME = "://"
