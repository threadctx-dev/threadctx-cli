# threadctx

**Your coding agents' instructions are stale, and copied across tools. See exactly what each agent is told, and fix it.**

Claude Code, Cursor, Copilot, Gemini CLI and Codex each read different files. In a benchmark of 210
public repositories, 48% of those with agent context keep instructions in the formats of two or more
tools (28% in two or more tool-specific formats). Those copies drift: they point at files that no
longer exist, repeat each other, and grow past what is worth loading on every session.

`threadctx` finds every agent context file in a repository (AGENTS.md, CLAUDE.md, Cursor rules,
Copilot instructions, GEMINI.md, skills, MCP configs), shows what each agent actually loads, and grades it A–F:

- **Drift:** dead paths, undefined scripts, the wrong package manager, outdated versions.
- **Duplication and waste:** the same instructions in several files, bloated always-loaded context.
- **Isolated copies:** tool-specific files that never see your shared AGENTS.md.
- **Conflicts:** AGENTS.md says `pnpm`, CLAUDE.md says `npm`.
- **Injection risks:** hidden Unicode, curl-pipe-to-shell, secrets in context, unpinned MCP servers.

It runs locally and offline. No account, and your code never leaves your machine.

```bash
npx threadctx scan
```

```text
CLAUDE.md
   2: blocker Conflicting package manager: CLAUDE.md says npm, AGENTS.md:2 says pnpm. Agents reading different files will do different things. CTX-C001
   2: warning `npm install` uses npm, but pnpm-lock.yaml says this repository uses pnpm. CTX-D003 [fixable]
   3: warning `npm run build` uses npm, but pnpm-lock.yaml says this repository uses pnpm. CTX-D003 [fixable]
   4: blocker Contains 1 invisible or bidirectional character (U+200B). Reviewers cannot see what the agent reads. CTX-X001 [fixable]

Grade F (40/100)  2 blockers, 2 warnings, 0 info
3 findings can be fixed automatically: threadctx fix
```

## What each agent loads

```bash
npx threadctx explain src/payments/refund.ts          # every tool, in precedence order
npx threadctx diff --path src/payments                 # where the agents disagree
```

## Fix

```bash
npx threadctx fix            # print safe fixes as a patch
npx threadctx fix --apply    # write them (never commits)
npx threadctx fix --pr       # open a pull request with them (uses your git and gh)
```

## Keep it fixed

```bash
npx threadctx init --pr      # pull request adding the GitHub Action check and a live README badge
```

## Audit a whole organisation, with compliance evidence

```bash
npx threadctx audit --org your-org
```

Free: the fleet grade, headline findings and how many AI-governance controls are met. With a
[licence](https://threadctx.dev/pricing): a full report, CSV and JSON, and an evidence pack for security
and auditors, with 8 controls cross-referenced to SOC 2, ISO/IEC 27001, ISO/IEC 42001 and NIST AI RMF, and an
inventory of every agent instruction file and MCP server. Everything is generated on your machine.
[See the controls](https://threadctx.dev/security).

## In CI

```bash
npx threadctx scan --format sarif --output threadctx.sarif   # upload to GitHub code scanning
npx threadctx scan --fail-on warning                         # exit 1 on warnings or worse
```

Exit codes: `0` passed · `1` findings at or above the threshold · `2` usage or config error.

## Configure

`.threadctx/config.yaml`:

```yaml
failOn: blocker
budgets: { default: 5000, claude-code: 8000 }   # estimated always-loaded tokens per tool
rules:
  CTX-B003: off
suppress:
  - rule: CTX-D001
    path: "docs/**"
    reason: docs describe a sibling repository
    expires: 2026-12-31
```

Inline: `<!-- ctx-ignore CTX-D001: generated at build time -->` (a reason is required).

Add your own rules with YAML [rule packs](docs/extending.md).

## Principles

- **Precision over recall.** A false positive is a bug. Each rule's false-positive rate is
  measured on a public benchmark corpus.
- **Remove, don't add.** threadctx never writes context with an LLM; it shrinks and corrects it.
- **Declared, not observed.** `explain` shows what a correctly behaving tool loads, according
  to its docs as of the verification date in `threadctx tools`. The Claude Code adapter is also
  checked against the real tool (`fixtures/oracle`).
- **Offline by default.** No network access, no telemetry.

Rules: `npx threadctx rules` · Adapters: `npx threadctx tools` · Licence: Apache-2.0
