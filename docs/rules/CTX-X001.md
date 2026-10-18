# CTX-X001: Invisible or bidirectional Unicode in a context file

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | blocker | deterministic | safe | beta | local |

## Why it matters

Hidden characters can carry instructions a human reviewer cannot see.

## How to fix

Remove the invisible characters.

## Source

CVE-2021-42574 (Trojan Source); CWE-1007

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X001: reason -->
```
