# CTX-B002: Section duplicates README or docs content

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| budget | info | heuristic | suggested | beta | local |

## Why it matters

Duplicated prose costs tokens on every session.

## How to fix

Replace the section with a pointer to the README.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

2 findings in 1 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-B002: reason -->
```
