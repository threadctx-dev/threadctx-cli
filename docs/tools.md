# Tool adapters

What each agent loads, as modelled by threadctx. Each adapter is a dated fact: it records the documentation it was checked against.

## AGENTS.md (Codex and other AGENTS.md readers) (`agents-md`)

AGENTS.md at the repo root and in subdirectories; the closest file to the edited file takes precedence.

- Status: **beta**
- Verified against: https://agents.md/ on 2026-10-03

Caveats:

- Each AGENTS.md reader decides how nested files combine; this view loads every AGENTS.md from the root down, nearest last (highest precedence).
- Codex-specific AGENTS.override.md replaces AGENTS.md in the same directory.

## Claude Code (`claude-code`)

CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md from the working directory up, subdirectory files on demand, @imports (4 hops), .claude/rules with `paths`, and AGENTS.md when no CLAUDE.md exists.

- Status: **ga** (verified against the real tool: fixtures/oracle)
- Verified against: https://code.claude.com/docs/en/memory on 2026-10-03, tool version 2.1.144

Caveats:

- Assumes Claude Code is started at the repository root with the default `claude-md-or-agents-md` project-instructions setting.
- Reading AGENTS.md directly requires Claude Code v2.1.277 or later; earlier versions read CLAUDE.md only. The AGENTS.md fallback is modelled from the docs and not yet oracle-verified.
- User (~/.claude) and managed-policy files are outside the repository and are not shown unless --machine is used.

## Cursor (`cursor`)

Project rules in .cursor/rules (.mdc with description, globs, alwaysApply), plus AGENTS.md at the root and in subdirectories.

- Status: **beta**
- Verified against: https://cursor.com/docs/context/rules on 2026-10-03

Caveats:

- Team rules and user rules live in Cursor's settings, not the repository, and are not shown.
- Legacy .cursorrules is no longer described in Cursor's docs; it is shown as legacy and may not load.
- Glob patterns without a slash are matched against the file name anywhere in the tree.

## GitHub Copilot (`copilot`)

.github/copilot-instructions.md, path-specific .github/instructions/*.instructions.md (applyTo, excludeAgent), and AGENTS.md / CLAUDE.md / GEMINI.md for the cloud agent.

- Status: **beta**
- Verified against: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions on 2026-10-03

Caveats:

- Copilot surfaces differ: path-specific files load for the cloud agent and code review; AGENTS.md, CLAUDE.md and GEMINI.md only for the cloud agent. Personal and organization instructions are not in the repository.
- IDE behaviour (VS Code) is documented separately and may load more.

## Gemini CLI (`gemini`)

GEMINI.md (or names from context.fileName) at the root and ancestors at start, subdirectory files just in time, all concatenated; @imports supported.

- Status: **beta**
- Verified against: https://geminicli.com/docs/cli/gemini-md/ on 2026-10-03

Caveats:

- Global ~/.gemini/GEMINI.md is outside the repository and not shown unless --machine is used.
- The docs do not state an import depth limit; this view stops after 5 hops.
