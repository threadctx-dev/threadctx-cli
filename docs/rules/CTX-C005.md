# CTX-C005: Team memory entry contradicts an instruction file

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| conflict | warning | deterministic | none | beta | cloud |

## Why it matters

Memory served over MCP overrides reviewed instructions.

## How to fix

Edit or expire the memory entry, or update the instruction.

## Source

spec §9.1

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-C005: reason -->
```
