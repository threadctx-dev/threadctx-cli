# CTX-C001: Same fact stated with different values across files or tools

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| conflict | blocker | deterministic | suggested | beta | local |

## Why it matters

Different agents receive contradictory instructions for the same task.

## How to fix

Keep one value in a shared source and remove the conflicting copy.

## Source

https://agents.md

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-C001: reason -->
```
