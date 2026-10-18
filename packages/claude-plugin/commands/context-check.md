---
description: Grade this repository's agent instructions (AGENTS.md, CLAUDE.md, Cursor, Copilot, Gemini) and list what is wrong.
allowed-tools: mcp__threadctx__check_context
---

# Check agent context

Call the `check_context` tool for the project root and report the result.

- Lead with the grade and the number of blockers and warnings.
- List each blocker and warning with its file and line, and what to change. Quote nothing you did not read.
- If a finding is marked fixable, say that `/context-fix` can apply it.
- Do not edit any file unless the user asks. Removing stale or duplicated instructions is almost always better than adding more.
