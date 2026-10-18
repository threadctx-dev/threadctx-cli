---
description: Apply threadctx's safe, mechanical fixes to agent instructions and show the diff. Never commits.
allowed-tools: Bash(npx -y threadctx@0.4.0 fix:*), Bash(git diff:*), mcp__threadctx__check_context
---

# Fix agent context

1. Call `check_context` and note the grade.
2. Run `npx -y threadctx@0.4.0 fix` to preview the safe fixes as a patch.
3. If the patch looks right to the user, run `npx -y threadctx@0.4.0 fix --apply`, then `git diff` to show what changed.
4. Call `check_context` again and report the grade change.

Never commit. Findings without a safe fix (dead paths, duplicated text, conflicts) need a human decision: list them and propose specific edits, preferring deletion.
