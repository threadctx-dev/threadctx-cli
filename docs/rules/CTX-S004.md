# CTX-S004: Rule glob or path scope matches no files

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | warning | deterministic | suggested | ga | local |

## Why it matters

A scoped rule that matches nothing never applies.

## How to fix

Update the glob to match existing paths, or delete the rule.

## Source

https://cursor.com/docs/context/rules

## Measured precision

11 findings in 3 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S004: reason -->
```
