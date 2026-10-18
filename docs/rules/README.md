# Rules

Registry 2026.10.1. False-positive rates are measured on 210 public repositories (see [methodology](../methodology.md)).

| ID | Title | Severity | Status | Runs | Benchmark |
|---|---|---|---|---|---|
| [CTX-S001](CTX-S001.md) | No agent context file in repository | info | ga | local | 26 findings · 0.0% FP |
| [CTX-S002](CTX-S002.md) | Two or more tool-specific context files with no shared source | warning | ga | local | 43 findings · 0.0% FP |
| [CTX-S003](CTX-S003.md) | Broken import or reference to a missing context file | blocker | ga | local | 11 findings · 0.0% FP |
| [CTX-S004](CTX-S004.md) | Rule glob or path scope matches no files | warning | ga | local | 11 findings · 0.0% FP |
| [CTX-S005](CTX-S005.md) | Invalid frontmatter in a rule or instruction file | warning | beta | local | 1 findings · 0.0% FP |
| [CTX-S006](CTX-S006.md) | Deprecated context format in use | info | ga | local | 28 findings · 0.0% FP |
| [CTX-D001](CTX-D001.md) | Referenced path does not exist | info | beta | local | 60 findings · 11.7% FP |
| [CTX-D002](CTX-D002.md) | Referenced command or script is not defined | warning | ga | local | 14 findings · 0.0% FP |
| [CTX-D003](CTX-D003.md) | Stated package manager contradicts the lockfile | warning | beta | local | no corpus findings yet |
| [CTX-D004](CTX-D004.md) | Referenced dependency absent from manifests | info | beta | local | 17 findings · 35.3% FP |
| [CTX-D005](CTX-D005.md) | Stated major version contradicts installed version | warning | ga | local | 6 findings · 0.0% FP |
| [CTX-D006](CTX-D006.md) | Context unchanged while the paths it cites changed heavily | info | beta | local | no corpus findings yet |
| [CTX-D007](CTX-D007.md) | Architecture claim contradicted by the code model | warning | beta | deferred | no corpus findings yet |
| [CTX-C001](CTX-C001.md) | Same fact stated with different values across files or tools | blocker | beta | local | no corpus findings yet |
| [CTX-C002](CTX-C002.md) | AGENTS.md and CLAUDE.md shared sections have diverged | warning | beta | local | 3 findings · 0.0% FP |
| [CTX-C003](CTX-C003.md) | Nested file overrides a parent with a different value | warning | beta | local | no corpus findings yet |
| [CTX-C004](CTX-C004.md) | Natural-language contradiction between directives | warning | beta | deferred | no corpus findings yet |
| [CTX-C005](CTX-C005.md) | Team memory entry contradicts an instruction file | warning | beta | cloud | no corpus findings yet |
| [CTX-B001](CTX-B001.md) | Always-loaded context exceeds the token budget for a tool | warning | ga | local | 29 findings · 0.0% FP |
| [CTX-B002](CTX-B002.md) | Section duplicates README or docs content | info | beta | local | 2 findings · 0.0% FP |
| [CTX-B003](CTX-B003.md) | Generic boilerplate with no repository-specific content | info | beta | local | 5 findings · 0.0% FP |
| [CTX-B004](CTX-B004.md) | Same directive repeated across files | info | ga | local | 70 findings · 0.0% FP |
| [CTX-X001](CTX-X001.md) | Invisible or bidirectional Unicode in a context file | blocker | beta | local | no corpus findings yet |
| [CTX-X002](CTX-X002.md) | Long encoded payload in a context file | warning | beta | local | no corpus findings yet |
| [CTX-X003](CTX-X003.md) | Instruction to download and execute remote code | blocker | beta | local | no corpus findings yet |
| [CTX-X004](CTX-X004.md) | Instruction to skip tests, disable checks or hide changes | warning | beta | local | no corpus findings yet |
| [CTX-X005](CTX-X005.md) | Secret or credential in context or MCP config | blocker | beta | local | no corpus findings yet |
| [CTX-X006](CTX-X006.md) | MCP server not pinned to a version | warning | ga | local | 22 findings · 0.0% FP |
| [CTX-X007](CTX-X007.md) | Remote MCP server over plain HTTP or without auth | warning | beta | local | no corpus findings yet |
| [CTX-X008](CTX-X008.md) | Instruction links to a domain outside the allowlist | info | beta | local | no corpus findings yet |
| [CTX-X009](CTX-X009.md) | Third-party skill or rule pack imported without a pinned version or hash | warning | beta | local | no corpus findings yet |
| [CTX-G001](CTX-G001.md) | Context files not covered by CODEOWNERS | warning | ga | local | 5 findings · 0.0% FP |
| [CTX-G002](CTX-G002.md) | Generated context file edited by hand | blocker | beta | deferred | no corpus findings yet |
| [CTX-G003](CTX-G003.md) | Org-required policy missing from repository | blocker | beta | cloud | no corpus findings yet |
| [CTX-G004](CTX-G004.md) | Team memory entry expired or never reviewed | warning | beta | cloud | no corpus findings yet |
