# Methodology

## Grade

Start at 100. Subtract 25 per open blocker, 5 per warning and 1 per info finding; the floor is 0.
A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F. Any open blocker caps the grade at D, and any open
security blocker caps it at F. Suppressed findings do not count.

## Precision

Every rule is measured on a benchmark corpus of 210 public repositories that contain agent
context files, selected with GitHub code search on 2026-10-03 across AGENTS.md, CLAUDE.md,
.cursorrules, .cursor/rules, Copilot instructions, GEMINI.md and .mcp.json, each pinned to a commit.
Every finding was reviewed by hand and labelled true or false positive.

- A deterministic rule becomes **GA** when it has at least 5 corpus findings and under 5.0% false positives.
- A rule at or over 5.0% is **demoted** automatically: it reports at info and stays beta.
- A rule with too few findings to measure stays beta.

The corpus reports aggregates only. Findings for individual public repositories are never published.

## Token estimates

Token counts are estimates (about four characters per token), always labelled as such.
