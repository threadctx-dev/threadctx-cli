# CTX-S005: Invalid frontmatter in a rule or instruction file

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| structure | warning | deterministic | safe | beta | local |

## Why it matters

Tools may ignore the file or apply it with the wrong scope.

## How to fix

Fix the frontmatter so it parses as YAML with the fields the tool expects.

## Source

https://cursor.com/docs/context/rules

## Measured precision

1 findings in 1 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-S005: reason -->
```
