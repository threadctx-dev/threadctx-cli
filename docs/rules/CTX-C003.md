# CTX-C003: Nested file overrides a parent with a different value

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| conflict | warning | deterministic | none | beta | local |

## Why it matters

Behaviour changes silently by directory.

## How to fix

Make the override explicit or remove it.

## Source

https://agents.md

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-C003: reason -->
```
