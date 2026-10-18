# CTX-D005: Stated major version contradicts installed version

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | warning | deterministic | suggested | ga | local |

## Why it matters

Agents use APIs from the wrong major version.

## How to fix

Update the stated version to match the manifest.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

6 findings in 5 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-D005: reason -->
```
