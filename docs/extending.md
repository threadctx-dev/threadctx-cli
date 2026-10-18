# Extending threadctx with rule packs

A rule pack is a YAML file of rules. Packs contain **no code**: the engine runs your regular
expressions over the context files it already parsed. That makes them safe to load in CI.

## Local packs

Put a file in `.threadctx/packs/`. Every `*.yaml` there loads automatically.

```yaml
# .threadctx/packs/house.yaml
pack: house                      # lowercase id; rule ids become house/<ID>
description: Our engineering conventions
rules:
  - id: NO-JQUERY
    title: Context recommends jQuery
    rationale: We removed jQuery in 2025; agents keep suggesting it.
    citation: ADR-012
    remediation: Recommend the DOM API instead.
    family: drift                # structure | drift | conflict | budget | security | governance
    severity: warning            # info | warning (blocker needs allowBlockers in config)
    determinism: deterministic   # or heuristic
    match:
      any:
        - '\bjquery\b'
      # optional:
      # caseSensitive: false     (default false)
      # skipNegated: true        (default true: "never use jQuery" does not match)
      # skipExamples: true       (default true: lines with "e.g." or "for example" are skipped)
      # kinds: [instructions, rule, skill, subagent, command]
      # tools: [claude-code, cursor, copilot, gemini, neutral]
      # minPerArtifact: 1        (above 1: report once per file when that many lines match)
```

Check a pack before committing it:

```bash
npx threadctx pack validate .threadctx/packs/house.yaml
```

## Shared packs from npm

Publish a package named `threadctx-pack-<name>` (scoped names work) that contains a `pack.yaml`
at its root. Consumers install it as a dev dependency and pin it in `.threadctx/config.yaml`:

```yaml
packs:
  - package: threadctx-pack-acme
    integrity: sha256-<base64 sha256 of pack.yaml>
```

Without `integrity`, the pack still loads but `CTX-X009` warns: upstream changes would reach every
agent unreviewed. With it, a changed `pack.yaml` stops the scan with a config error.

## What the engine enforces

- Every rule needs `id`, `title`, `rationale`, `citation` and `remediation`, as built-in rules do.
- Third-party rule ids are namespaced (`house/NO-JQUERY`) and marked `community` in every output.
- Third-party rules report at most `warning` unless the config sets `allowBlockers: true` for that pack.
- Patterns longer than 500 characters or with nested quantifiers such as `(a+)+` are rejected,
  and patterns only ever run on single directives (at most 2,000 characters).
- Suppressions, severity overrides and SARIF output work for pack rules exactly as for built-ins.

## Tool adapters

The `ToolAdapter` interface in `@threadctx/adapters` is exported but **unstable**. Third-party
code adapters are not loaded yet; open an issue for a tool you need.
