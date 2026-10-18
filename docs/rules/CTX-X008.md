# CTX-X008: Instruction links to a domain outside the allowlist

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | info | deterministic | none | beta | local |

## Why it matters

Agents may fetch and follow untrusted content.

## How to fix

Remove the link or add the domain to the allowlist.

## Source

CWE-829

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X008: reason -->
```
