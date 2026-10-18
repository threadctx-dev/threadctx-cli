# CTX-D001: Referenced path does not exist

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | info (demoted from warning) | deterministic | suggested | beta | local |

## Why it matters

Agents follow stale pointers and waste turns or invent files.

## How to fix

Update or remove the path reference.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

60 findings in 25 of 210 benchmark repositories; 7 judged false positives (11.7%). That is over the 5.0% budget, so the rule reports at info and stays beta until it improves.

## Suppress

```markdown
<!-- ctx-ignore CTX-D001: reason -->
```
