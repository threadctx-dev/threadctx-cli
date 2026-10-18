# threadctx

TypeScript ESM monorepo (pnpm workspaces, Node >= 20). A CLI that grades the instruction files AI coding agents read.

- Commands: `pnpm install`, `pnpm typecheck`, `pnpm test`. Build the CLI with `cd packages/cli && node build.mjs`.
- The engine must stay deterministic and offline: no network access unless `--github`, `audit` or `--online` is passed.
- Rule metadata lives only in `packages/rules/src/registry.ts`. When you add or remove a rule, update the counts in
  `packages/rules/src/registry.test.ts`.
- Tests run against sources through the aliases in `vitest.config.ts`, never against `dist/`.
- Code copied from other projects needs a header naming its origin repository and commit, and an entry in `NOTICE`.
