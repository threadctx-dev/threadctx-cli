// Fleet analysis for `threadctx audit`: many repositories scanned independently, then compared.
// Pure and deterministic: the same scans always give the same summary.
import { RULES } from "./registry.js";
import type { ScanResult } from "./engine.js";
import type { Grade } from "./grade.js";

export interface AuditRepo {
  fullName: string;
  url: string;
  private?: boolean;
  result?: ScanResult;
  /** Why the repository could not be scanned (empty, unreadable). */
  error?: string;
}

export interface RepoRow {
  repo: string;
  url: string;
  private: boolean;
  grade: Grade;
  score: number;
  blockers: number;
  warnings: number;
  infos: number;
  tools: string[];
  /** Largest always-loaded estimate across tools. */
  alwaysTokens: number;
}

export interface Inconsistency {
  key: string;
  label: string;
  /** How many repositories state each value. */
  distribution: { value: string; repos: number }[];
  /** A value used by at least 60% of the repositories that state this fact. */
  majority?: { value: string; share: number };
  /** Repositories that do not use the majority value. */
  outliers: { repo: string; values: string[] }[];
  statedBy: number;
}

export interface PlanItem {
  ruleId: string;
  title: string;
  severity: string;
  findings: number;
  repos: number;
  effort: "automatic" | "quick" | "manual";
  /** Penalty points removed from repository scores if fixed. */
  impact: number;
  action: string;
  /** impact divided by an effort cost; higher means do it sooner. */
  priority: number;
}

export interface FleetSummary {
  schema: "threadctx.audit/v1";
  org: string;
  generatedAt: string;
  engine: { version: string; registry: string };
  repos: { listed: number; scanned: number; withContext: number; withoutContext: number; failed: number };
  fleet: {
    grade: Grade;
    score: number;
    counts: { blocker: number; warning: number; info: number };
    toolsUsed: Record<string, number>;
    /** Repositories that maintain instruction files for two or more different tools. */
    multiToolRepos: number;
  };
  repoTable: RepoRow[];
  noContext: { repo: string; url: string }[];
  topRules: { ruleId: string; title: string; severity: string; count: number; repos: number }[];
  inconsistencies: Inconsistency[];
  security: { repo: string; ruleId: string; severity: string; path: string; line?: number; message: string }[];
  plan: PlanItem[];
  waste: { avgTokensPerRepo: number; totalTokens: number; repos: { repo: string; tokens: number }[] };
  failures: { repo: string; error: string }[];
  /** Change since a previous audit, when one was supplied. */
  trend?: FleetTrend;
  /** Compliance evidence, in licensed audit.json only. */
  evidence?: import("./compliance.js").EvidencePack;
}

export interface FleetTrend {
  since: string;
  before: { grade: Grade; score: number; blockers: number; warnings: number; withContext: number };
  after: { grade: Grade; score: number; blockers: number; warnings: number; withContext: number };
  improved: { repo: string; from: number; to: number }[];
  regressed: { repo: string; from: number; to: number }[];
  added: string[];
  removed: string[];
}

/** Compare two audits of the same organisation. Repositories are matched by name. */
export function fleetTrend(previous: FleetSummary, current: FleetSummary): FleetTrend {
  const prev = new Map(previous.repoTable.map((r) => [r.repo, r.score]));
  const cur = new Map(current.repoTable.map((r) => [r.repo, r.score]));
  const improved: FleetTrend["improved"] = [];
  const regressed: FleetTrend["regressed"] = [];
  for (const [repo, to] of cur) {
    const from = prev.get(repo);
    if (from === undefined || from === to) continue;
    (to > from ? improved : regressed).push({ repo, from, to });
  }
  const byDelta = (a: { from: number; to: number; repo: string }, b: { from: number; to: number; repo: string }) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || (a.repo < b.repo ? -1 : 1);
  const snap = (s: FleetSummary) => ({ grade: s.fleet.grade, score: s.fleet.score, blockers: s.fleet.counts.blocker, warnings: s.fleet.counts.warning, withContext: s.repos.withContext });
  return {
    since: previous.generatedAt,
    before: snap(previous),
    after: snap(current),
    improved: improved.sort(byDelta),
    regressed: regressed.sort(byDelta),
    added: [...cur.keys()].filter((r) => !prev.has(r)).sort(),
    removed: [...prev.keys()].filter((r) => !cur.has(r)).sort(),
  };
}

const PENALTY = { blocker: 25, warning: 5, info: 1 } as const;
const EFFORT_COST = { automatic: 1, quick: 2, manual: 4 } as const;
const LABELS: Record<string, string> = {
  "pkg.manager": "Package manager stated in instructions",
  "actual.pkg.manager": "Package manager (from lockfile)",
  "cmd.test.runner": "Test runner",
  "cmd.lint.runner": "Linter",
  "cmd.format.runner": "Formatter",
  "cmd.typecheck.runner": "Type checker",
  "lang.node.version": "Node version",
  "lang.python.version": "Python version",
  "dep.react.version": "React major version",
  "dep.next.version": "Next.js major version",
  "dep.typescript.version": "TypeScript major version",
};
/** Tool → language ecosystem, so a Python repo using pytest and a JS repo using vitest are not "inconsistent". */
const ECOSYSTEM: Record<string, string> = {
  pytest: "python", unittest: "python", nose2: "python", ruff: "python", flake8: "python", pylint: "python", black: "python", yapf: "python", autopep8: "python", mypy: "python", pyright: "python",
  jest: "js", vitest: "js", mocha: "js", ava: "js", tap: "js", jasmine: "js", playwright: "js", cypress: "js", eslint: "js", biome: "js", oxlint: "js", standard: "js", xo: "js", prettier: "js", dprint: "js", tsc: "js",
  rspec: "ruby", minitest: "ruby", rubocop: "ruby", phpunit: "php", "golangci-lint": "go", gofmt: "go", rustfmt: "rust",
};
const WASTE_RULES = new Set(["CTX-B002", "CTX-B003", "CTX-B004"]);
const MAJORITY = 0.6;

export function gradeFor(score: number): Grade {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
}

export function summarizeFleet(repos: AuditRepo[], meta: { org: string; generatedAt: string; engine: { version: string; registry: string } }): FleetSummary {
  const scanned = repos.filter((r) => r.result);
  const failed = repos.filter((r) => !r.result);
  const withContext = scanned.filter((r) => r.result!.artifacts.length > 0);
  const noContext = scanned.filter((r) => r.result!.artifacts.length === 0);

  const repoTable: RepoRow[] = withContext
    .map((r) => {
      const res = r.result!;
      return {
        repo: r.fullName,
        url: r.url,
        private: Boolean(r.private),
        grade: res.grade,
        score: res.score,
        blockers: res.counts.blocker,
        warnings: res.counts.warning,
        infos: res.counts.info,
        tools: res.tools.filter((t) => t.layers > 0).map((t) => t.id),
        alwaysTokens: Math.max(0, ...res.tools.map((t) => t.alwaysTokenEstimate)),
      };
    })
    .sort((a, b) => a.score - b.score || (a.repo < b.repo ? -1 : 1));

  const meanScore = withContext.length ? Math.round(withContext.reduce((n, r) => n + r.result!.score, 0) / withContext.length) : 0;
  const counts = { blocker: 0, warning: 0, info: 0 };
  const toolsUsed: Record<string, number> = {};
  let multiToolRepos = 0;
  for (const r of withContext) {
    counts.blocker += r.result!.counts.blocker;
    counts.warning += r.result!.counts.warning;
    counts.info += r.result!.counts.info;
    for (const t of r.result!.tools.filter((x) => x.layers > 0)) toolsUsed[t.id] = (toolsUsed[t.id] ?? 0) + 1;
    // "Maintains instructions for two or more tools": distinct owners of instruction and rule files
    // (AGENTS.md counts as its own owner). A lone CLAUDE.md that Copilot also reads does not count.
    const owners = new Set(r.result!.artifacts.filter((a) => a.kind === "instructions" || a.kind === "rule").map((a) => a.tool));
    if (owners.size >= 2) multiToolRepos++;
  }

  // Rules: counts per rule across open findings.
  const ruleStats = new Map<string, { findings: number; repos: Set<string>; severity: string }>();
  const security: FleetSummary["security"] = [];
  for (const r of withContext) {
    for (const f of r.result!.findings) {
      if (f.suppressed) continue;
      const s = ruleStats.get(f.ruleId) ?? { findings: 0, repos: new Set<string>(), severity: f.severity };
      s.findings++;
      s.repos.add(r.fullName);
      ruleStats.set(f.ruleId, s);
      if (f.family === "security") security.push({ repo: r.fullName, ruleId: f.ruleId, severity: f.severity, path: f.path, line: f.line, message: f.message });
    }
  }
  const title = (id: string) => RULES.find((x) => x.id === id)?.title ?? id;
  const sevRank: Record<string, number> = { blocker: 0, warning: 1, info: 2 };
  security.sort((a, b) => sevRank[a.severity]! - sevRank[b.severity]! || (a.repo < b.repo ? -1 : 1) || a.path.localeCompare(b.path));
  const topRules = [...ruleStats.entries()]
    .map(([ruleId, s]) => ({ ruleId, title: title(ruleId), severity: s.severity, count: s.findings, repos: s.repos.size }))
    .sort((a, b) => b.repos - a.repos || b.count - a.count || (a.ruleId < b.ruleId ? -1 : 1));

  // Inconsistencies across repositories.
  const byKey = new Map<string, Map<string, Set<string>>>();
  const repoValues = new Map<string, Map<string, string[]>>();
  for (const r of withContext) {
    // Runner facts are split per ecosystem; everything else is compared as is.
    const split: [string, string[]][] = [];
    for (const [key, values] of Object.entries(r.result!.facts ?? {})) {
      if (!key.endsWith(".runner")) { split.push([key, values]); continue; }
      const byEco = new Map<string, string[]>();
      for (const v of values) byEco.set(ECOSYSTEM[v] ?? "other", [...(byEco.get(ECOSYSTEM[v] ?? "other") ?? []), v]);
      for (const [eco, vals] of byEco) split.push([`${key}@${eco}`, vals]);
    }
    for (const [key, values] of split) {
      const m = byKey.get(key) ?? new Map<string, Set<string>>();
      for (const v of values) {
        const set = m.get(v) ?? new Set<string>();
        set.add(r.fullName);
        m.set(v, set);
      }
      byKey.set(key, m);
      const rv = repoValues.get(key) ?? new Map<string, string[]>();
      rv.set(r.fullName, values);
      repoValues.set(key, rv);
    }
  }
  const inconsistencies: Inconsistency[] = [];
  for (const [key, m] of byKey) {
    const statedBy = repoValues.get(key)!.size;
    if (m.size < 2 || statedBy < 3) continue;
    const distribution = [...m.entries()].map(([value, set]) => ({ value, repos: set.size })).sort((a, b) => b.repos - a.repos || (a.value < b.value ? -1 : 1));
    const top = distribution[0]!;
    const majority = top.repos / statedBy >= MAJORITY ? { value: top.value, share: Math.round((top.repos / statedBy) * 100) / 100 } : undefined;
    const outliers = majority
      ? [...repoValues.get(key)!.entries()].filter(([, vals]) => !vals.includes(majority.value)).map(([repo, values]) => ({ repo, values })).sort((a, b) => (a.repo < b.repo ? -1 : 1))
      : [];
    const [base, eco] = key.split("@");
    inconsistencies.push({ key, label: `${LABELS[base!] ?? base}${eco ? ` (${eco})` : ""}`, distribution, majority, outliers, statedBy });
  }
  inconsistencies.sort((a, b) => b.distribution.length * b.statedBy - a.distribution.length * a.statedBy || (a.key < b.key ? -1 : 1));

  // Remediation plan: biggest score gain per unit of effort first.
  const plan: PlanItem[] = [...ruleStats.entries()].map(([ruleId, s]) => {
    const meta = RULES.find((x) => x.id === ruleId);
    const effort: PlanItem["effort"] = meta?.autofix === "safe" ? "automatic" : meta?.autofix === "suggested" ? "quick" : "manual";
    const impact = s.findings * PENALTY[(s.severity as keyof typeof PENALTY) ?? "info"];
    return {
      ruleId,
      title: title(ruleId),
      severity: s.severity,
      findings: s.findings,
      repos: s.repos.size,
      effort,
      impact,
      action: effort === "automatic" ? "Run `threadctx fix --apply` in each repository and review the diff." : (meta?.remediation ?? "Review the finding."),
      priority: Math.round((impact / EFFORT_COST[effort]) * 10) / 10,
    };
  }).sort((a, b) => b.priority - a.priority || (a.ruleId < b.ruleId ? -1 : 1));

  // Waste: duplicated and boilerplate text that is loaded every session, capped by what is actually always loaded.
  const wasteRepos = withContext.map((r) => {
    const raw = r.result!.findings.filter((f) => !f.suppressed && WASTE_RULES.has(f.ruleId)).reduce((n, f) => n + (f.wasteTokens ?? 0), 0);
    const cap = Math.max(0, ...r.result!.tools.map((t) => t.alwaysTokenEstimate));
    return { repo: r.fullName, tokens: Math.min(raw, cap) };
  }).filter((r) => r.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const totalWaste = wasteRepos.reduce((n, r) => n + r.tokens, 0);

  return {
    schema: "threadctx.audit/v1",
    org: meta.org,
    generatedAt: meta.generatedAt,
    engine: meta.engine,
    repos: { listed: repos.length, scanned: scanned.length, withContext: withContext.length, withoutContext: noContext.length, failed: failed.length },
    fleet: { grade: withContext.length ? gradeFor(meanScore) : "F", score: meanScore, counts, toolsUsed, multiToolRepos },
    repoTable,
    noContext: noContext.map((r) => ({ repo: r.fullName, url: r.url })).sort((a, b) => (a.repo < b.repo ? -1 : 1)),
    topRules,
    inconsistencies,
    security,
    plan,
    waste: { avgTokensPerRepo: withContext.length ? Math.round(totalWaste / withContext.length) : 0, totalTokens: totalWaste, repos: wasteRepos },
    failures: failed.map((r) => ({ repo: r.fullName, error: r.error ?? "unknown error" })),
  };
}
