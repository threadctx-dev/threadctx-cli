# Contributing

Bug reports and false positives are the most useful contributions. If a rule flags something that is correct
in your repository, open an issue with the smallest file that reproduces it.

## Adding or changing a rule

1. Rule metadata lives only in `packages/rules/src/registry.ts`. When you add or remove a rule, update the counts in
   `registry.test.ts`.
2. Put the check in `packages/rules/src/checks/`, with a test that includes a case that must not fire.
3. Rules that only match text can be written as a YAML pack instead: see `docs/extending.md`.

## Adding or updating a tool adapter

An adapter records what a tool's documentation says it loads, the documentation URL and the date it was checked.
Change the date only when you re-read the documentation. If you can run the real tool, add a fixture under
`fixtures/oracle` (see the existing one for Claude Code).

## Ground rules

- The engine stays deterministic and offline: no network access unless a flag such as `--github` or the `audit`
  command asks for it.
- Code copied from another project needs a header naming its origin and commit, and an entry in `NOTICE`.
- `pnpm typecheck` and `pnpm test` must pass.
