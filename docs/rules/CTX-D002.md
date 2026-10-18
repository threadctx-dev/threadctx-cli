# CTX-D002: Referenced command or script is not defined

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | warning | deterministic | suggested | ga | local |

## Why it matters

Agents run commands that fail, then improvise.

## How to fix

Point to a script defined in package.json, Makefile, justfile or pyproject.toml.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

14 findings in 5 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-D002: reason -->
```
