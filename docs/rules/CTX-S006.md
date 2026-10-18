# CTX-S006: Deprecated context format in use

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | info | deterministic | suggested | ga | local |

## Why it matters

Legacy formats such as .cursorrules may lose support.

## How to fix

Migrate to the tool's current format.

## Source

https://cursor.com/docs/context/rules

## Measured precision

28 findings in 28 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S006: reason -->
```
