# threadctx

**See what every AI coding agent is told about your repository, and check that it is still true.**

Claude Code, Cursor, GitHub Copilot, Gemini CLI and Codex read different instruction files (`CLAUDE.md`,
`AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`, `GEMINI.md`) and MCP configuration. threadctx
finds them, shows which ones each agent loads for a given path, and flags problems: paths that no longer exist,
scripts that are not defined, the wrong package manager, the same text repeated in files an agent loads together,
MCP servers with no pinned version, secrets in context, invisible Unicode.

```bash
npx threadctx scan                    # grade this repository, A to F
npx threadctx explain src/app.ts      # which files each agent loads for this file, in order
npx threadctx diff                    # where the agents disagree about the same directory
npx threadctx fix --pr                # open a pull request with the safe fixes
npx threadctx init --pr               # add the GitHub Action check and a grade badge
```

Website, rules, guides and pricing: **https://threadctx.dev**

## How it works

- Deterministic code, no model calls. The scan makes no network calls.
- Each tool is an *adapter* that models what that tool's documentation says it loads, with the date and source
  it was verified against (`packages/adapters/src/tools`). The Claude Code adapter is also checked against the real
  tool (`fixtures/oracle`).
- Rules live in one registry (`packages/rules/src/registry.ts`). False-positive rates come from a hand-labelled
  benchmark of public repositories and are shown with their sample size; rules with too few real findings say
  "not yet established". Method: [docs/methodology.md](docs/methodology.md).
- You can add rules without writing code: [docs/extending.md](docs/extending.md).

## Repository layout

| Package | What it is |
|---|---|
| `packages/core` | Canonical context model, parsing, claims, licence verification |
| `packages/discovery` | Finding files, manifests, MCP configuration |
| `packages/adapters` | One adapter per tool (Claude Code, Cursor, Copilot, Gemini, AGENTS.md) |
| `packages/rules` | The rules, grading, rule packs, org audit and compliance evidence |
| `packages/report` | Text, JSON, SARIF, Markdown, HTML and CSV output |
| `packages/cli` | The `threadctx` command (bundled into one file, zero runtime dependencies) |
| `packages/action` | The GitHub Action (also published at `threadctx-dev/action`) |
| `packages/claude-plugin` | The Claude Code plugin (also at `threadctx-dev/claude-plugin`) |

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
cd packages/cli && node build.mjs     # builds dist/threadctx.mjs
```

Node 20 or later. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Free and paid

Everything that runs on one repository is free. `threadctx audit --org <name>` grades every repository in a GitHub
organisation; the summary is free, and the full report and compliance evidence pack need a licence key, which is
verified offline against a public key in `packages/core/src/license.ts`. The licence funds keeping the adapters
current as the tools change. See [pricing](https://threadctx.dev/pricing).

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0. Code derived from MIT-licensed projects keeps its notice in [NOTICE](NOTICE).
