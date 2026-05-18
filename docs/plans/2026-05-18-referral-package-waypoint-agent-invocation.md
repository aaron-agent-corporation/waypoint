# Referral Package Waypoint Agent Invocation Plan

## Goal

Make the short operator request `Create a referral package for <folder>` route through the Waypoint Quest system instead of an ad hoc/direct package builder, and give Paralegal/Perry durable instructions for invoking and verifying the Waypoint CLI.

## Source failure

The Alma Cristobal referral package output had medical-facing files but no `.waypoint` route artifacts and no chronology artifacts. That means the package was not governed by the current `referral-package` Quest, even though the Quest now includes medical chronology and adversarial QC.

## Implementation slices

1. **Regression coverage for agent invocation instructions**
   - Add tests requiring the referral-package docs to tell agents to use Waypoint CLI commands and verify `.waypoint` route evidence.
   - Require the docs to state that absence of `.waypoint` route evidence means the package is not Quest-governed.

2. **Repository docs/runbook hardening**
   - Update `docs/quests/referral-package.md` with the exact CLI invocation/check sequence for agents.
   - Include the required verification artifacts: `.waypoint/`, `routes`, `tasks`, `route-events`, chronology output, START_HERE, and package QC.

3. **Paralegal profile instruction hardening**
   - Add a profile-local skill for `Create a referral package for <folder>` under the Paralegal profile.
   - Patch both Paralegal SOUL surfaces (`~/.hermes/profiles/paralegal/SOUL.md` and `~/.hermes/agents/paralegal/SOUL.md`) to load/use the skill.
   - Keep source files read-only and prohibit direct legal-state YAML edits.

4. **Verification**
   - Run targeted referral-package Quest tests.
   - Run typecheck.
   - Validate edited Paralegal YAML/config surfaces if touched.
   - Commit/push repo changes; report profile-file changes separately because they are outside the repo.
