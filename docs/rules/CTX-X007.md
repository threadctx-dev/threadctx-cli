# CTX-X007: Remote MCP server over plain HTTP or without auth

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | warning | deterministic | none | beta | local |

## Why it matters

Tool traffic can be read or tampered with in transit.

## How to fix

Use HTTPS and configure authentication.

## Source

CWE-319

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X007: reason -->
```
