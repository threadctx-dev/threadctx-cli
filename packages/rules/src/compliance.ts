// Compliance evidence for `threadctx audit`: the audit's findings regrouped as controls that auditors
// recognise, plus an inventory of every agent instruction file and MCP server.
// Pure and deterministic. The framework references are guidance on where the evidence is relevant;
// the auditor decides whether it is sufficient. This is evidence, not an attestation.
import type { AuditRepo, FleetSummary } from "./audit.js";

export type ControlStatus = "met" | "attention" | "gap" | "evidenced" | "not-evidenced";

export interface ControlDef {
  id: string;
  title: string;
  objective: string;
  /** Rules whose open findings count against this control. Empty for controls the audit itself evidences. */
  rules: string[];
  refs: { framework: Framework; ref: string; name: string }[];
}

export type Framework = "SOC 2" | "ISO/IEC 27001:2022" | "ISO/IEC 42001:2023" | "NIST AI RMF 1.0";

export const FRAMEWORKS: Framework[] = ["SOC 2", "ISO/IEC 27001:2022", "ISO/IEC 42001:2023", "NIST AI RMF 1.0"];

export const CONTROLS: ControlDef[] = [
  {
    id: "TC-01",
    title: "AI coding agents and their tools are inventoried",
    objective: "The organisation knows which repositories give instructions to which AI coding agents, and which MCP servers those agents can call.",
    rules: [],
    refs: [
      { framework: "SOC 2", ref: "CC6.1", name: "Logical access: inventory of information assets" },
      { framework: "ISO/IEC 27001:2022", ref: "A.5.9", name: "Inventory of information and other associated assets" },
      { framework: "ISO/IEC 42001:2023", ref: "A.4.4", name: "Tooling resources" },
      { framework: "NIST AI RMF 1.0", ref: "GOVERN 1.6", name: "Mechanisms are in place to inventory AI systems" },
    ],
  },
  {
    id: "TC-02",
    title: "Secrets are kept out of agent instructions and tool configuration",
    objective: "No credential, token or key is written into a file that AI agents read or into an MCP server configuration.",
    rules: ["CTX-X005"],
    refs: [
      { framework: "SOC 2", ref: "CC6.1", name: "Logical access: protection of credentials" },
      { framework: "ISO/IEC 27001:2022", ref: "A.5.17", name: "Authentication information" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.12", name: "Data leakage prevention" },
      { framework: "NIST AI RMF 1.0", ref: "MEASURE 2.7", name: "AI system security and resilience are evaluated" },
    ],
  },
  {
    id: "TC-03",
    title: "Agent instructions are free of hidden or injected content",
    objective: "Instruction files contain no invisible or bidirectional characters, encoded payloads, or instructions to download and run remote code.",
    rules: ["CTX-X001", "CTX-X002", "CTX-X003"],
    refs: [
      { framework: "SOC 2", ref: "CC6.8", name: "Prevent or detect unauthorised or malicious software" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.7", name: "Protection against malware" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.28", name: "Secure coding" },
      { framework: "NIST AI RMF 1.0", ref: "MEASURE 2.7", name: "AI system security and resilience are evaluated" },
    ],
  },
  {
    id: "TC-04",
    title: "Agents are not told to bypass quality and security checks",
    objective: "No instruction tells an agent to skip tests, disable linters or checks, or hide changes from review.",
    rules: ["CTX-X004"],
    refs: [
      { framework: "SOC 2", ref: "CC8.1", name: "Change management: changes are tested before implementation" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.29", name: "Security testing in development and acceptance" },
      { framework: "ISO/IEC 42001:2023", ref: "A.6.2.4", name: "AI system verification and validation" },
    ],
  },
  {
    id: "TC-05",
    title: "Third-party agent tools are pinned and authenticated",
    objective: "MCP servers, skills and rule packs are pinned to a version or hash, and remote servers use TLS and authentication.",
    rules: ["CTX-X006", "CTX-X007", "CTX-X009"],
    refs: [
      { framework: "SOC 2", ref: "CC9.2", name: "Risks from vendors and business partners are assessed and managed" },
      { framework: "ISO/IEC 27001:2022", ref: "A.5.21", name: "Managing information security in the ICT supply chain" },
      { framework: "ISO/IEC 42001:2023", ref: "A.10.3", name: "Suppliers" },
      { framework: "NIST AI RMF 1.0", ref: "GOVERN 6.1", name: "Policies address risks from third-party entities" },
    ],
  },
  {
    id: "TC-06",
    title: "Agent instructions have owners and reviewed changes",
    objective: "Every instruction file is covered by CODEOWNERS, and generated files are changed only at their source.",
    rules: ["CTX-G001", "CTX-G002", "CTX-G003"],
    refs: [
      { framework: "SOC 2", ref: "CC8.1", name: "Change management: changes are authorised and approved" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.32", name: "Change management" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.4", name: "Access to source code" },
      { framework: "NIST AI RMF 1.0", ref: "GOVERN 2.1", name: "Roles and responsibilities are documented" },
    ],
  },
  {
    id: "TC-07",
    title: "Agent instructions are accurate and consistent",
    objective: "Instructions match the repository (paths, scripts, package manager, versions) and do not contradict each other across files and tools.",
    rules: ["CTX-S003", "CTX-S004", "CTX-D001", "CTX-D002", "CTX-D003", "CTX-D005", "CTX-C001", "CTX-C002", "CTX-C003"],
    refs: [
      { framework: "SOC 2", ref: "CC2.1", name: "Relevant, quality information supports internal control" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.9", name: "Configuration management" },
      { framework: "ISO/IEC 42001:2023", ref: "A.6.2.7", name: "AI system technical documentation" },
      { framework: "NIST AI RMF 1.0", ref: "MAP 2.2", name: "Knowledge limits and how outputs are used are documented" },
    ],
  },
  {
    id: "TC-08",
    title: "Agent context is monitored over time",
    objective: "The audit is repeated and compared with the previous run, so regressions are found and followed up.",
    rules: [],
    refs: [
      { framework: "SOC 2", ref: "CC4.1", name: "Ongoing and separate evaluations" },
      { framework: "SOC 2", ref: "CC7.1", name: "Detection of configuration changes and vulnerabilities" },
      { framework: "ISO/IEC 27001:2022", ref: "A.8.16", name: "Monitoring activities" },
      { framework: "NIST AI RMF 1.0", ref: "MANAGE 4.1", name: "Post-deployment monitoring plans are implemented" },
    ],
  },
];

export interface ControlResult {
  id: string;
  title: string;
  objective: string;
  refs: ControlDef["refs"];
  status: ControlStatus;
  /** Open findings counted against the control. */
  findings: number;
  blockers: number;
  /** Repositories with at least one finding against this control. */
  repos: string[];
  /** Repositories the control was tested on. */
  tested: number;
  /** One sentence an auditor can read: what was tested and what was found. */
  statement: string;
}

export interface InventoryRow {
  repo: string;
  url: string;
  private: boolean;
  agents: string[];
  files: { path: string; tool: string; kind: string }[];
  mcpServers: { client: string; name: string; transport: string; source: string }[];
  grade: string;
  score: number;
}

export interface EvidencePack {
  schema: "threadctx.evidence/v1";
  org: string;
  generatedAt: string;
  engine: FleetSummary["engine"];
  scope: { repositoriesListed: number; repositoriesScanned: number; withAgentContext: number; withoutAgentContext: number; unreadable: number };
  totals: { agentFiles: number; mcpServers: number; agents: Record<string, number> };
  controls: ControlResult[];
  inventory: InventoryRow[];
  disclaimer: string;
}

export const EVIDENCE_DISCLAIMER =
  "threadctx produces evidence about AI coding agent configuration. It is not an attestation, certification or audit opinion. " +
  "Framework references show where the evidence is commonly relevant; your auditor decides whether it is sufficient for a control.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Regroup an audit as controls and an inventory. Needs the per-repository scans, not only the summary. */
export function evidencePack(summary: FleetSummary, repos: AuditRepo[]): EvidencePack {
  const withContext = repos.filter((r) => r.result && r.result.artifacts.length > 0).sort((a, b) => (a.fullName < b.fullName ? -1 : 1));
  const tested = withContext.length;

  const inventory: InventoryRow[] = withContext.map((r) => {
    const res = r.result!;
    return {
      repo: r.fullName,
      url: r.url,
      private: Boolean(r.private),
      agents: res.tools.filter((t) => t.layers > 0).map((t) => t.id),
      files: res.artifacts.map((a) => ({ path: a.path, tool: a.tool, kind: a.kind })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      mcpServers: res.mcpServers.map((m) => ({ client: m.client, name: m.name, transport: m.transport, source: m.source })),
      grade: res.grade,
      score: res.score,
    };
  });

  const controls: ControlResult[] = CONTROLS.map((c) => {
    if (c.id === "TC-01") {
      const files = inventory.reduce((n, r) => n + r.files.length, 0);
      const servers = inventory.reduce((n, r) => n + r.mcpServers.length, 0);
      return {
        ...base(c), status: "evidenced" as const, tested,
        statement: `${plural(summary.repos.scanned, "repository", "repositories")} scanned; ${plural(files, "agent instruction or configuration file")} and ${plural(servers, "MCP server")} inventoried across ${plural(tested, "repository", "repositories")} (see the inventory).`,
      };
    }
    if (c.id === "TC-08") {
      const t = summary.trend;
      return t
        ? { ...base(c), status: "evidenced" as const, tested, statement: `Compared with the audit of ${t.since.slice(0, 10)}: fleet score ${t.before.score} → ${t.after.score}, blockers ${t.before.blockers} → ${t.after.blockers}, ${t.regressed.length} repositories regressed.` }
        : { ...base(c), status: "not-evidenced" as const, tested, statement: "This is the first audit in this folder, so there is no earlier run to compare with. Run the audit on a schedule (Team plan) to evidence ongoing monitoring." };
    }
    const ids = new Set(c.rules);
    let findings = 0;
    let blockers = 0;
    const hit = new Set<string>();
    for (const r of withContext) {
      for (const f of r.result!.findings) {
        if (f.suppressed || !ids.has(f.ruleId)) continue;
        findings++;
        if (f.severity === "blocker") blockers++;
        hit.add(r.fullName);
      }
    }
    const status: ControlStatus = tested === 0 ? "not-evidenced" : blockers > 0 ? "gap" : findings > 0 ? "attention" : "met";
    const statement = tested === 0
      ? "No repository has agent context files, so there was nothing to test."
      : findings === 0
        ? `Tested on ${plural(tested, "repository", "repositories")} with agent context; no open findings.`
        : `Tested on ${plural(tested, "repository", "repositories")}; ${plural(findings, "open finding")}${blockers ? ` (${blockers} blocking)` : ""} in ${plural(hit.size, "repository", "repositories")}.`;
    return { ...base(c), status, findings, blockers, repos: [...hit].sort(), tested, statement };
  });

  const agents: Record<string, number> = {};
  for (const r of inventory) for (const a of r.agents) agents[a] = (agents[a] ?? 0) + 1;
  return {
    schema: "threadctx.evidence/v1",
    org: summary.org,
    generatedAt: summary.generatedAt,
    engine: summary.engine,
    scope: { repositoriesListed: summary.repos.listed, repositoriesScanned: summary.repos.scanned, withAgentContext: summary.repos.withContext, withoutAgentContext: summary.repos.withoutContext, unreadable: summary.repos.failed },
    totals: { agentFiles: inventory.reduce((n, r) => n + r.files.length, 0), mcpServers: inventory.reduce((n, r) => n + r.mcpServers.length, 0), agents },
    controls,
    inventory,
    disclaimer: EVIDENCE_DISCLAIMER,
  };

  function base(c: ControlDef) {
    return { id: c.id, title: c.title, objective: c.objective, refs: c.refs, findings: 0, blockers: 0, repos: [] as string[] };
  }
}

/** Headline for the free audit: how many controls need work, without the detail. */
export function controlHeadline(pack: EvidencePack): { total: number; met: number; attention: number; gap: number } {
  const c = pack.controls;
  return {
    total: c.length,
    met: c.filter((x) => x.status === "met" || x.status === "evidenced").length,
    attention: c.filter((x) => x.status === "attention" || x.status === "not-evidenced").length,
    gap: c.filter((x) => x.status === "gap").length,
  };
}
