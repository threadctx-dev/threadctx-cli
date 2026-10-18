// Rule registry (spec §7). Single source of truth for the engine, docs,
// SARIF metadata and the public /rules/<id> pages. Checks live elsewhere and
// register against these ids; this file holds metadata only.

export type Family = "structure" | "drift" | "conflict" | "budget" | "security" | "governance";
export type Severity = "blocker" | "warning" | "info";
export type Determinism = "deterministic" | "heuristic" | "semantic";
export type Autofix = "safe" | "suggested" | "none";
export type RuleStatus = "ga" | "beta";
/** Which tier or phase a rule needs; 'local' rules run in the free engine. */
export type Availability = "local" | "cloud" | "deferred";

import { BENCHMARK, type RuleBenchmark } from "./benchmark.js";

/** Spec §7.3: GA needs a measured false-positive rate under 5%; over budget demotes to beta + info. */
export const FP_BUDGET = 0.05;
/** Fewer corpus findings than this cannot establish a rate; the rule stays beta. */
export const MIN_BENCHMARK_FINDINGS = 5;

export interface RuleMeta {
  id: string;
  family: Family;
  severity: Severity;
  determinism: Determinism;
  title: string;
  rationale: string;
  citation: string;
  remediation: string;
  autofix: Autofix;
  status: RuleStatus;
  since: string;
  availability: Availability;
  /** Measured on the public benchmark corpus; absent when the corpus produced no findings. */
  benchmark?: RuleBenchmark;
  /** Severity before benchmark demotion, when demoted. */
  demotedFrom?: Severity;
}

const REQUIRED_FIELDS: (keyof RuleMeta)[] = [
  "id", "family", "severity", "determinism", "title", "rationale",
  "citation", "remediation", "autofix", "status", "since", "availability",
];

const ID_PATTERN = /^CTX-[SDCBXG]\d{3}$/;
const FAMILY_PREFIX: Record<Family, string> = {
  structure: "S", drift: "D", conflict: "C", budget: "B", security: "X", governance: "G",
};

const AGENTS_MD = "https://agents.md";
const LEAN_CONTEXT = "arXiv 2601.20404 (lean AGENTS.md: −28.64% median runtime); arXiv 2602.11988 (context files +20% cost, no success gain)";

type Row = [
  id: string, severity: Severity, determinism: Determinism, autofix: Autofix,
  availability: Availability, title: string, rationale: string, citation: string, remediation: string,
];

const ROWS: Row[] = [
  ["CTX-S001", "info", "deterministic", "none", "local",
    "No agent context file in repository",
    "Agents fall back to guessing commands and conventions.",
    AGENTS_MD,
    "Add a minimal AGENTS.md with build, test and lint commands only."],
  ["CTX-S002", "warning", "deterministic", "suggested", "local",
    "Two or more tool-specific context files with no shared source",
    "Parallel copies for different agents drift apart over time.",
    AGENTS_MD,
    "Move shared content to AGENTS.md and import or reference it from tool-specific files."],
  ["CTX-S003", "blocker", "deterministic", "none", "local",
    "Broken import or reference to a missing context file",
    "The agent silently loads less context than the author intended.",
    "https://code.claude.com/docs/en/memory",
    "Fix the import path or remove the reference."],
  ["CTX-S004", "warning", "deterministic", "suggested", "local",
    "Rule glob or path scope matches no files",
    "A scoped rule that matches nothing never applies.",
    "https://cursor.com/docs/context/rules",
    "Update the glob to match existing paths, or delete the rule."],
  ["CTX-S005", "warning", "deterministic", "safe", "local",
    "Invalid frontmatter in a rule or instruction file",
    "Tools may ignore the file or apply it with the wrong scope.",
    "https://cursor.com/docs/context/rules",
    "Fix the frontmatter so it parses as YAML with the fields the tool expects."],
  ["CTX-S006", "info", "deterministic", "suggested", "local",
    "Deprecated context format in use",
    "Legacy formats such as .cursorrules may lose support.",
    "https://cursor.com/docs/context/rules",
    "Migrate to the tool's current format."],
  ["CTX-D001", "warning", "deterministic", "suggested", "local",
    "Referenced path does not exist",
    "Agents follow stale pointers and waste turns or invent files.",
    LEAN_CONTEXT,
    "Update or remove the path reference."],
  ["CTX-D002", "warning", "deterministic", "suggested", "local",
    "Referenced command or script is not defined",
    "Agents run commands that fail, then improvise.",
    LEAN_CONTEXT,
    "Point to a script defined in package.json, Makefile, justfile or pyproject.toml."],
  ["CTX-D003", "warning", "deterministic", "safe", "local",
    "Stated package manager contradicts the lockfile",
    "Agents install with the wrong package manager and corrupt the lockfile.",
    LEAN_CONTEXT,
    "State the package manager that matches the committed lockfile."],
  ["CTX-D004", "warning", "deterministic", "none", "local",
    "Referenced dependency absent from manifests",
    "Agents write code against libraries the project does not use.",
    LEAN_CONTEXT,
    "Remove the reference or add the dependency."],
  ["CTX-D005", "warning", "deterministic", "suggested", "local",
    "Stated major version contradicts installed version",
    "Agents use APIs from the wrong major version.",
    LEAN_CONTEXT,
    "Update the stated version to match the manifest."],
  ["CTX-D006", "info", "heuristic", "none", "local",
    "Context unchanged while the paths it cites changed heavily",
    "Instructions likely describe code that no longer exists in that form.",
    "https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/",
    "Review the context file against recent changes to the cited paths."],
  ["CTX-D007", "warning", "heuristic", "none", "deferred",
    "Architecture claim contradicted by the code model",
    "Agents follow layering rules the code no longer obeys, or vice versa.",
    "https://github.com/einvoice-dev1/archsteer",
    "Update the architecture claim or fix the violating code."],
  ["CTX-C001", "blocker", "deterministic", "suggested", "local",
    "Same fact stated with different values across files or tools",
    "Different agents receive contradictory instructions for the same task.",
    AGENTS_MD,
    "Keep one value in a shared source and remove the conflicting copy."],
  ["CTX-C002", "warning", "deterministic", "suggested", "local",
    "AGENTS.md and CLAUDE.md shared sections have diverged",
    "Claude Code and other agents behave differently on the same repository.",
    "https://devops.com/claude-code-adds-agents-md-fallback-cutting-instruction-file-sprawl/",
    "Import AGENTS.md from CLAUDE.md instead of copying it."],
  ["CTX-C003", "warning", "deterministic", "none", "local",
    "Nested file overrides a parent with a different value",
    "Behaviour changes silently by directory.",
    AGENTS_MD,
    "Make the override explicit or remove it."],
  ["CTX-C004", "warning", "semantic", "none", "deferred",
    "Natural-language contradiction between directives",
    "Agents receive instructions that cannot both be followed.",
    AGENTS_MD,
    "Resolve the contradiction. Opt-in check using the customer's own model key."],
  ["CTX-C005", "warning", "deterministic", "none", "cloud",
    "Team memory entry contradicts an instruction file",
    "Memory served over MCP overrides reviewed instructions.",
    "spec §9.1",
    "Edit or expire the memory entry, or update the instruction."],
  ["CTX-B001", "warning", "deterministic", "none", "local",
    "Always-loaded context exceeds the token budget for a tool",
    "Bloated always-on context raises cost without raising success.",
    LEAN_CONTEXT,
    "Move rarely needed sections into path-scoped rules or delete them."],
  ["CTX-B002", "info", "heuristic", "suggested", "local",
    "Section duplicates README or docs content",
    "Duplicated prose costs tokens on every session.",
    LEAN_CONTEXT,
    "Replace the section with a pointer to the README."],
  ["CTX-B003", "info", "heuristic", "suggested", "local",
    "Generic boilerplate with no repository-specific content",
    "Generic advice adds cost and no information.",
    LEAN_CONTEXT,
    "Delete the boilerplate."],
  ["CTX-B004", "info", "deterministic", "suggested", "local",
    "Same directive repeated across files",
    "Repeated directives are loaded and paid for more than once.",
    LEAN_CONTEXT,
    "Keep the directive in one shared file."],
  ["CTX-X001", "blocker", "deterministic", "safe", "local",
    "Invisible or bidirectional Unicode in a context file",
    "Hidden characters can carry instructions a human reviewer cannot see.",
    "CVE-2021-42574 (Trojan Source); CWE-1007",
    "Remove the invisible characters."],
  ["CTX-X002", "warning", "deterministic", "none", "local",
    "Long encoded payload in a context file",
    "Base64 or hex blobs can hide instructions from reviewers.",
    "CWE-506",
    "Remove the payload or replace it with a reviewed, plain-text reference."],
  ["CTX-X003", "blocker", "deterministic", "none", "local",
    "Instruction to download and execute remote code",
    "Context files are trusted input; this turns them into a remote-code path.",
    "CWE-494",
    "Remove the instruction. Pin and vendor any required tooling."],
  ["CTX-X004", "warning", "heuristic", "none", "local",
    "Instruction to skip tests, disable checks or hide changes",
    "Classic injected-instruction pattern that weakens review.",
    "CWE-693",
    "Remove the instruction."],
  ["CTX-X005", "blocker", "deterministic", "none", "local",
    "Secret or credential in context or MCP config",
    "Context files are shared with model providers and committed to version control.",
    "CWE-798",
    "Rotate the secret and load it from the environment."],
  ["CTX-X006", "warning", "deterministic", "suggested", "local",
    "MCP server not pinned to a version",
    "@latest or unpinned npx -y runs whatever was published most recently.",
    "CWE-1357",
    "Pin the package to an exact version."],
  ["CTX-X007", "warning", "deterministic", "none", "local",
    "Remote MCP server over plain HTTP or without auth",
    "Tool traffic can be read or tampered with in transit.",
    "CWE-319",
    "Use HTTPS and configure authentication."],
  ["CTX-X008", "info", "deterministic", "none", "local",
    "Instruction links to a domain outside the allowlist",
    "Agents may fetch and follow untrusted content.",
    "CWE-829",
    "Remove the link or add the domain to the allowlist."],
  ["CTX-X009", "warning", "deterministic", "none", "local",
    "Third-party skill or rule pack imported without a pinned version or hash",
    "Upstream changes reach every agent without review.",
    "CWE-1357",
    "Pin the import to a version or content hash."],
  ["CTX-G001", "warning", "deterministic", "suggested", "local",
    "Context files not covered by CODEOWNERS",
    "Anyone can change what every agent is told without review.",
    "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners",
    "Add the context files to CODEOWNERS."],
  ["CTX-G002", "blocker", "deterministic", "safe", "deferred",
    "Generated context file edited by hand",
    "Hand edits are overwritten by the next sync and drift from the canonical source.",
    "spec §9.2",
    "Edit the canonical source and run sync."],
  ["CTX-G003", "blocker", "deterministic", "safe", "cloud",
    "Org-required policy missing from repository",
    "Organisation policy is not reaching this repository's agents.",
    "spec §9.2",
    "Merge the policy pull request or run sync."],
  ["CTX-G004", "warning", "deterministic", "none", "cloud",
    "Team memory entry expired or never reviewed",
    "Unreviewed or stale knowledge reaches agents.",
    "spec §9.1",
    "Review, renew or remove the entry."],
];

const FAMILY_BY_PREFIX: Record<string, Family> = Object.fromEntries(
  Object.entries(FAMILY_PREFIX).map(([family, prefix]) => [prefix, family as Family]),
);

export const RULES: readonly RuleMeta[] = ROWS.map(
  ([id, severity, determinism, autofix, availability, title, rationale, citation, remediation]) => {
    const benchmark = BENCHMARK[id];
    const overBudget = benchmark !== undefined && benchmark.rate >= FP_BUDGET;
    const ga = determinism === "deterministic" && benchmark !== undefined && benchmark.findings >= MIN_BENCHMARK_FINDINGS && !overBudget;
    return {
      id,
      family: FAMILY_BY_PREFIX[id.charAt(4)] as Family,
      severity: overBudget ? "info" : severity,
      determinism,
      title,
      rationale,
      citation,
      remediation,
      autofix,
      status: ga ? "ga" : "beta",
      since: "0.1.0",
      availability,
      ...(benchmark ? { benchmark } : {}),
      ...(overBudget && severity !== "info" ? { demotedFrom: severity } : {}),
    };
  },
);

/** Throws if any entry breaks the registry contract (spec §7.1). */
export function validateRegistry(rules: readonly RuleMeta[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    for (const field of REQUIRED_FIELDS) {
      if (rule[field] === undefined || rule[field] === "") {
        throw new Error(`Rule ${rule.id ?? "<no id>"} is missing required field '${field}'`);
      }
    }
    if (!ID_PATTERN.test(rule.id)) throw new Error(`Rule id '${rule.id}' does not match ${ID_PATTERN}`);
    if (rule.id.charAt(4) !== FAMILY_PREFIX[rule.family]) {
      throw new Error(`Rule ${rule.id} prefix does not match family '${rule.family}'`);
    }
    if (seen.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
    seen.add(rule.id);
  }
}
