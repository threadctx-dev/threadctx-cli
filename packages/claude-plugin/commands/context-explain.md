---
description: Show exactly which instruction files each coding agent loads for a file or directory.
argument-hint: <file-or-directory>
allowed-tools: mcp__threadctx__get_effective_context
---

# Explain what agents load

Call `get_effective_context` with `file` set to `$ARGUMENTS` (use `.` if empty) and `tool` set to `all`.

Summarise, per tool, which files load and in what order, and note where tools disagree: a file one agent reads and another never sees, or two files that both load and say different things. Point out the largest always-loaded files, since those cost tokens on every session.
