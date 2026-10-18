---
name: agent-context-hygiene
description: Keep agent instruction files accurate and minimal. Use when creating or editing AGENTS.md, CLAUDE.md, .cursor/rules, .github/copilot-instructions.md, GEMINI.md or .claude/rules, when instructions seem to be ignored or tools behave differently, or when asked how Claude Code, Cursor, Copilot or Gemini load context.
---

# Agent context hygiene

Instruction files are trusted input to every agent that reads them, so they should be short, true and consistent.

## When you edit a context file

1. Prefer deleting stale or generic lines over adding new ones. Research on repository context files found that bloated, generic context raises cost without improving task success.
2. State only facts an agent cannot discover itself: exact build, test and lint commands, non-obvious conventions, and gotchas.
3. Keep one source of truth. Put shared instructions in `AGENTS.md` and have `CLAUDE.md` import it with `@AGENTS.md`, instead of maintaining parallel copies.
4. Never include secrets, invisible characters, or instructions to download and run remote code.
5. After editing, call the `check_context` tool and fix any blocker or warning you introduced.

## When instructions seem ignored

Call `get_effective_context` for the file in question. It shows which files each tool really loads, in order, so you can see whether the instruction is loaded at all, whether a nested file overrides it, or whether another file contradicts it.
