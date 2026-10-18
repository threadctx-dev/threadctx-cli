# Project

Codeword ORACLE-ROOT-CLAUDE.

@docs/a.md

<!-- ORACLE-COMMENT-STRIPPED -->

Do not import `@docs/x.md` (code span).

<!-- threadctx:start (managed — edit above/below, not between) -->
## Team memory (threadctx)

- **Before** starting any non-trivial task, call `memory_query` with a short
  description of what you are about to do. Check for prior decisions, fixes,
  and gotchas on this repo before writing code — not after.
- **After** resolving a non-obvious bug, making an architectural decision, or
  learning something that would save a teammate time, call `memory_write` to
  save it. Write it so a future reader has full context.
- If the `memory_query` / `memory_write` tools are **not** available in this
  session: this repo uses threadctx for shared team memory, but it is not
  connected on this machine yet. Suggest the user run `npx threadctx-mcp join`
  (one command, ~30 seconds), then restart the session.
<!-- threadctx:end -->
