# CTX-X005: Secret or credential in context or MCP config

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | blocker | deterministic | none | beta | local |

## Why it matters

Context files are shared with model providers and committed to version control.

## How to fix

Rotate the secret and load it from the environment.

## Source

CWE-798

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X005: reason -->
```
