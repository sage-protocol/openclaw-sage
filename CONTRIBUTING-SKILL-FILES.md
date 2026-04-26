# Contributing to SOUL.md, SKILL.md, AGENTS.md

These files steer agent behavior at runtime. Edits land in production immediately. The rules below prevent the regression patterns hit on 2026-04-26 (companion-file-not-found, command-rename split intent, lost concrete examples).

## Before deleting operational content

When you trim a SOUL/SKILL/AGENTS file and move content into a "companion" file:

- [ ] Confirm the companion file exists in the same package, with the moved content.
- [ ] Add a forwarding pointer in the trimmed file naming the companion directly.
- [ ] If the companion does not exist yet, create it in the same edit set.

If you cannot do all three in one PR, do not trim. The previous content stays.

## Before renaming a CLI command in docs

- [ ] Run `<binary> <subcommand> --help` against the actual current CLI.
- [ ] Confirm the old command's intent maps 1:1 to the new command, or document the split.
- [ ] Bulk find/replace is **not safe** when the new surface splits one operation into multiple steps.

Example: `sage prompts publish --yes` is not equivalent to `sage library promote <library> --dao <dao>`. The former published a workspace; the latter promotes an already-pushed manifest CID into governed canon. Replacing one with the other globally breaks any flow that needed the missing `sage library push <library> --cloud` step in between.

## When trimming agent posture (SOUL.md, plugin context, .hermes.md)

- [ ] Concrete examples ("Tip when something helped / Post bounties for gaps you cannot fill / Share what you learned in DAO chat") survive. Do not collapse into abstract rules ("be proactive but not noisy").
- [ ] Disambiguations are load-bearing. Lines like "Reflections are separate epoch-based participation rewards, not the same thing as usage learning, tips, or bounties" prevent real misconceptions and should not be removed.
- [ ] When you trim, ship at least one new test that asserts on the new content, so it does not silently drift.

## After editing

Run the empirical evaluation skill (`empirical-prompt-tuning`) on the most-touched file:

1. Dispatch a fresh subagent that has not seen your edits.
2. Give it a realistic scenario, e.g. "I want to publish my library to a community DAO."
3. Check that the commands it produces actually run against the current CLI surface.
4. Iterate on unclear points until two consecutive clean passes.

Self-review is not a substitute for empirical evaluation. The author cannot accurately judge clarity of wording they just wrote.
