# CTX-X009: Third-party skill or rule pack imported without a pinned version or hash

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | warning | deterministic | none | beta | local |

## Why it matters

Upstream changes reach every agent without review.

## How to fix

Pin the import to a version or content hash.

## Source

CWE-1357

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X009: reason -->
```
