# CTX-B004: Same directive repeated across files

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| budget | info | deterministic | suggested | ga | local |

## Why it matters

Repeated directives are loaded and paid for more than once.

## How to fix

Keep the directive in one shared file.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

70 findings in 30 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-B004: reason -->
```
