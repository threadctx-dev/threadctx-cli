# CTX-X003: Instruction to download and execute remote code

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | blocker | deterministic | none | beta | local |

## Why it matters

Context files are trusted input; this turns them into a remote-code path.

## How to fix

Remove the instruction. Pin and vendor any required tooling.

## Source

CWE-494

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X003: reason -->
```
