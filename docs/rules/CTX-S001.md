# CTX-S001: No agent context file in repository

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | info | deterministic | none | ga | local |

## Why it matters

Agents fall back to guessing commands and conventions.

## How to fix

Add a minimal AGENTS.md with build, test and lint commands only.

## Source

https://agents.md

## Measured precision

26 findings in 26 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S001: reason -->
```
