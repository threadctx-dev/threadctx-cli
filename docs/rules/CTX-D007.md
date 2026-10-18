# CTX-D007: Architecture claim contradicted by the code model

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | warning | heuristic | none | beta | deferred |

## Why it matters

Agents follow layering rules the code no longer obeys, or vice versa.

## How to fix

Update the architecture claim or fix the violating code.

## Source

https://github.com/einvoice-dev1/archsteer

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-D007: reason -->
```
