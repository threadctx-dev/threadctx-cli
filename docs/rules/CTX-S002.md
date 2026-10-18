# CTX-S002: Two or more tool-specific context files with no shared source

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | warning | deterministic | suggested | ga | local |

## Why it matters

Parallel copies for different agents drift apart over time.

## How to fix

Move shared content to AGENTS.md and import or reference it from tool-specific files.

## Source

https://agents.md

## Measured precision

43 findings in 43 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S002: reason -->
```
