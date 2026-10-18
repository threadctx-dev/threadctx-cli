# CTX-X002: Long encoded payload in a context file

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | warning | deterministic | none | beta | local |

## Why it matters

Base64 or hex blobs can hide instructions from reviewers.

## How to fix

Remove the payload or replace it with a reviewed, plain-text reference.

## Source

CWE-506

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X002: reason -->
```
