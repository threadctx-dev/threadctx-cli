# CTX-D006: Context unchanged while the paths it cites changed heavily

| Family | Severity | Type | Autofix | Status | Runs |
|---|---|---|---|---|---|
| drift | info | heuristic | none | beta | local |

## Why it matters

Instructions likely describe code that no longer exists in that form.

## How to fix

Review the context file against recent changes to the cited paths.

## Source

https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/

## Measured precision

The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.

## Suppress

```markdown
<!-- ctx-ignore CTX-D006: reason -->
```
