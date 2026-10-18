# CTX-C004: Natural-language contradiction between directives

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| conflict | warning | semantic | none | beta | deferred |

## Why it matters

Agents receive instructions that cannot both be followed.

## How to fix

Resolve the contradiction. Opt-in check using the customer's own model key.

## Source

https://agents.md

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-C004: reason -->
```
