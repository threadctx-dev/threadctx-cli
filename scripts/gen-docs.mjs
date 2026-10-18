// Render docs/rules/*.md, docs/tools.md and docs/methodology.md from the registries.
// These are the sources for threadctx.dev /rules, /tools and /methodology. Usage: node scripts/gen-docs.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ADAPTERS } from "../packages/adapters/dist/index.js";
import { BENCHMARK_CORPUS, FP_BUDGET, RULES, REGISTRY_VERSION } from "../packages/rules/dist/index.js";

rmSync("docs/rules", { recursive: true, force: true });
mkdirSync("docs/rules", { recursive: true });
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const index = ["# Rules", "", `Registry ${REGISTRY_VERSION}. False-positive rates are measured on ${BENCHMARK_CORPUS.repos} public repositories (see [methodology](../methodology.md)).`, "",
  "| ID | Title | Severity | Status | Runs | Benchmark |", "|---|---|---|---|---|---|"];
for (const r of RULES) {
  const bench = r.benchmark ? `${r.benchmark.findings} findings · ${pct(r.benchmark.rate)} FP` : "no corpus findings yet";
  index.push(`| [${r.id}](${r.id}.md) | ${r.title} | ${r.severity} | ${r.status} | ${r.availability} | ${bench} |`);
  writeFileSync(`docs/rules/${r.id}.md`, [
    `# ${r.id}: ${r.title}`, "",
    `| Family | Severity | Type | Autofix | Status | Runs |`, `|---|---|---|---|---|---|`,
    `| ${r.family} | ${r.severity}${r.demotedFrom ? ` (demoted from ${r.demotedFrom})` : ""} | ${r.determinism} | ${r.autofix} | ${r.status} | ${r.availability} |`, "",
    "## Why it matters", "", r.rationale, "",
    "## How to fix", "", r.remediation, "",
    "## Source", "", r.citation, "",
    "## Measured precision", "",
    r.benchmark
      ? `${r.benchmark.findings} findings in ${r.benchmark.repos} of ${BENCHMARK_CORPUS.repos} benchmark repositories; ${r.benchmark.falsePositives} judged false positives (${pct(r.benchmark.rate)}).${r.demotedFrom ? ` That is over the ${pct(FP_BUDGET)} budget, so the rule reports at info and stays beta until it improves.` : ""}`
      : "The benchmark corpus produced no findings for this rule yet, so its precision is not established and it stays beta.",
    "",
    "## Suppress", "", "```markdown", `<!-- ctx-ignore ${r.id}: reason -->`, "```", "",
  ].join("\n"));
}
writeFileSync("docs/rules/README.md", index.join("\n") + "\n");

const tools = ["# Tool adapters", "", "What each agent loads, as modelled by threadctx. Each adapter is a dated fact: it records the documentation it was checked against.", ""];
for (const a of ADAPTERS) {
  tools.push(`## ${a.label} (\`${a.id}\`)`, "", a.summary, "", `- Status: **${a.status}**${a.status === "ga" ? " (verified against the real tool: fixtures/oracle)" : ""}`,
    `- Verified against: ${a.verifiedAgainst.docsUrl} on ${a.verifiedAgainst.date}${a.verifiedAgainst.toolVersion ? `, tool version ${a.verifiedAgainst.toolVersion}` : ""}`, "", "Caveats:", "", ...a.caveats.map((c) => `- ${c}`), "");
}
writeFileSync("docs/tools.md", tools.join("\n"));

writeFileSync("docs/methodology.md", `# Methodology

## Grade

Start at 100. Subtract 25 per open blocker, 5 per warning and 1 per info finding; the floor is 0.
A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, otherwise F. Any open blocker caps the grade at D, and any open
security blocker caps it at F. Suppressed findings do not count.

## Precision

Every rule is measured on a benchmark corpus of ${BENCHMARK_CORPUS.repos} public repositories that contain agent
context files, selected with GitHub code search on ${BENCHMARK_CORPUS.selectedAt} across AGENTS.md, CLAUDE.md,
.cursorrules, .cursor/rules, Copilot instructions, GEMINI.md and .mcp.json, each pinned to a commit.
Every finding was reviewed by hand and labelled true or false positive.

- A deterministic rule becomes **GA** when it has at least 5 corpus findings and under ${pct(FP_BUDGET)} false positives.
- A rule at or over ${pct(FP_BUDGET)} is **demoted** automatically: it reports at info and stays beta.
- A rule with too few findings to measure stays beta.

The corpus reports aggregates only. Findings for individual public repositories are never published.

## Token estimates

Token counts are estimates (about four characters per token), always labelled as such.
`);
console.log(`wrote ${RULES.length} rule pages, tools.md, methodology.md`);
