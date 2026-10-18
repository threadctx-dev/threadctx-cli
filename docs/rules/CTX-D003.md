# CTX-D003: Stated package manager contradicts the lockfile

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | warning | deterministic | safe | beta | local |

## Why it matters

Agents install with the wrong package manager and corrupt the lockfile.

## How to fix

State the package manager that matches the committed lockfile.

## Source

arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-D003: reason -->
```
