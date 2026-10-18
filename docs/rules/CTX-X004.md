# CTX-X004: Instruction to skip tests, disable checks or hide changes

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | warning | heuristic | none | beta | local |

## Why it matters

Classic injected-instruction pattern that weakens review.

## How to fix

Remove the instruction.

## Source

CWE-693

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-X004: reason -->
```
