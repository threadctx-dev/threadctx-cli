# CTX-C002: AGENTS.md and CLAUDE.md shared sections have diverged

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| conflict | warning | deterministic | suggested | beta | local |

## Why it matters

Claude Code and other agents behave differently on the same repository.

## How to fix

Import AGENTS.md from CLAUDE.md instead of copying it.

## Source

https://devops.com/claude-code-adds-agents-md-fallback-cutting-instruction-file-sprawl/

## Measured precision

3 findings in 2 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-C002: reason -->
```
