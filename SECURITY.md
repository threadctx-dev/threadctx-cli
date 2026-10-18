# Security policy

threadctx judges other people's context supply chain, so its own must be exemplary.

## Reporting a vulnerability

Email security@threadctx.dev or use GitHub private vulnerability reporting on this repository. Do not open a public issue.
We acknowledge within 3 working days and aim to ship a fix within 30 days.

## What the engine does by default

- Runs fully offline. No network calls unless `--online` is passed.
- Never sends source code or context file contents anywhere.
- Never passes context files to a model that has tools.
- Redacts detected secrets to a prefix plus hash in every output.

## Our own supply chain

- The CLI ships as a single bundled file with zero runtime dependencies, plus the licences of the code it bundles.
- The GitHub Action pins every step it uses by commit SHA, and `threadctx init` pins the Action the same way.
- npm provenance attestations are planned; until then, releases are built from this repository's tagged commits.
- Dependencies are pinned through the lockfile.
- Docs pin the GitHub Action by commit SHA.
