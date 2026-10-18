# CTX-G001: Context files not covered by CODEOWNERS

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| governance | warning | deterministic | suggested | ga | local |

## Why it matters

Anyone can change what every agent is told without review.

## How to fix

Add the context files to CODEOWNERS.

## Source

https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

## Measured precision

5 findings in 5 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-G001: reason -->
```
