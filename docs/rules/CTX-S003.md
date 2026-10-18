# CTX-S003: Broken import or reference to a missing context file

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | blocker | deterministic | none | ga | local |

## Why it matters

The agent silently loads less context than the author intended.

## How to fix

Fix the import path or remove the reference.

## Source

https://code.claude.com/docs/en/memory

## Measured precision

11 findings in 5 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S003: reason -->
```
