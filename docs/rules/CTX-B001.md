# CTX-B001: Always-loaded context exceeds the token budget for a tool

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| budget | warning | deterministic | none | ga | local |

## Why it matters

Bloated always-on context raises cost without raising success.

## How to fix

Move rarely needed sections into path-scoped rules or delete them.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

29 findings in 28 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-B001: reason -->
```
