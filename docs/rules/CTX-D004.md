# CTX-D004: Referenced dependency absent from manifests

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | info (demoted from warning) | deterministic | none | beta | local |

## Why it matters

Agents write code against libraries the project does not use.

## How to fix

Remove the reference or add the dependency.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

17 findings in 2 of 210 benchmark repositories; 6 judged false positives (35.3%). That is over the 5.0% budget, so the rule reports at info and stays beta until it improves.

## Suppress

```markdown
<!-- ctx-ignore CTX-D004: reason -->
```
