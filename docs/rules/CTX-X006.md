# CTX-X006: MCP server not pinned to a version

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| security | warning | deterministic | suggested | ga | local |

## Why it matters

@latest or unpinned npx -y runs whatever was published most recently.

## How to fix

Pin the package to an exact version.

## Source

CWE-1357

## Measured precision

22 findings in 11 of 210 benchmark repositories; 0 judged false positives (0.0%).

## Suppress

```markdown
<!-- ctx-ignore CTX-X006: reason -->
```
