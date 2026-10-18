import { posix } from "node:path";
import { ADAPTERS, adapterAgeDays, buildCatalog, STALE_AFTER_DAYS, type Catalog, type ParsedArtifact } from "@threadctx/adapters";
import { sha256, type EffectiveContext, type FsView } from "@threadctx/core";
import { collectFacts, discoverRepoMcp, type McpServerEntry, type ProjectFacts } from "@threadctx/discovery";
import { BUILTIN_PACKS } from "./builtin-packs.js";
import { B001, B002, B004 } from "./checks/budget.js";
import { C001, C002, C003, statedFacts } from "./checks/conflict.js";
import { D001, D002, D003, D004, D005, D006 } from "./checks/drift.js";
import { G001 } from "./checks/governance.js";
import { X001, X002, X003, X005, X006, X007, X008, X009 } from "./checks/security.js";
import { S001, S002, S003, S004, S005, S006 } from "./checks/structure.js";
import { CONFIG_PATHS, ConfigError, defaultConfig, parseConfig, type ScanConfig } from "./config.js";
import { grade, type GradeResult } from "./grade.js";
import { packCheck, packRuleMeta, PackError, parsePack, verifyIntegrity, type Pack } from "./packs.js";
import { RULES, validateRegistry, type RuleMeta } from "./registry.js";
import { applySuppressions, inlineSuppressions } from "./suppress.js";
import type { Check, Diagnostic, Finding, FindingInput, HistoryProvider, RuleContext } from "./types.js";
import { ENGINE_VERSION, REGISTRY_VERSION } from "./version.js";

/** Code checks for every registry rule that runs locally. Pack-backed rules come from BUILTIN_PACKS. */
export const CHECKS: Check[] = [
  S001, S002, S003, S004, S005, S006,
  D001, D002, D003, D004, D005, D006,
  C001, C002, C003,
  B001, B002, B004,
  X001, X002, X003, X005, X006, X007, X008, X009,
  G001,
];

export interface ScanOptions {
  config?: ScanConfig;
  history?: HistoryProvider;
  now?: Date;
  /** Only report these rule ids (after overrides). */
  only?: string[];
}

export interface ScanResult {
  schema: "threadctx.scan/v1";
  engine: { version: string; registry: string };
  grade: GradeResult["grade"];
  score: number;
  counts: GradeResult["counts"];
  findings: Finding[];
  diagnostics: Diagnostic[];
  artifacts: { path: string; tool: string; kind: string; tokenEstimate: number; contentHash: string; origin: string }[];
  tools: { id: string; label: string; status: string; verified: string; alwaysTokenEstimate: number; layers: number }[];
  mcpServers: { client: string; name: string; source: string; transport: string }[];
  rules: RuleMeta[];
  /** Normalised facts this repository's instructions state (and what its lockfile says), for cross-repo comparison. */
  facts: Record<string, string[]>;
}

export interface ScanState {
  catalog: Catalog;
  facts: ProjectFacts;
  mcp: McpServerEntry[];
  config: ScanConfig;
  rootContexts: EffectiveContext[];
  packs: { pack: Pack; allowBlockers: boolean }[];
}

/** A file at the repository root: what every session in the repo loads. */
export const ROOT_TARGET = { path: "__threadctx_root__", isDir: false };

/** Load `.threadctx/config.yaml` from the repo. Throws ConfigError on invalid config. */
export function loadConfig(fs: FsView): ScanConfig {
  for (const p of CONFIG_PATHS) {
    const text = fs.readFile(p);
    if (text !== undefined) return parseConfig(text, p);
  }
  return defaultConfig();
}

function loadPacks(fs: FsView, config: ScanConfig, diagnostics: Diagnostic[]): { pack: Pack; allowBlockers: boolean }[] {
  const out: { pack: Pack; allowBlockers: boolean }[] = BUILTIN_PACKS.map((pack) => ({ pack, allowBlockers: true }));
  const seen = new Set<string>(["ctx"]);
  const add = (text: string, source: string, allowBlockers: boolean) => {
    const pack = parsePack(text, source);
    if (seen.has(pack.pack)) throw new PackError(`${source}: pack id '${pack.pack}' is already loaded`);
    seen.add(pack.pack);
    out.push({ pack, allowBlockers });
  };
  const listed = new Set(config.packs.filter((p) => p.path).map((p) => posix.normalize(p.path!)));
  for (const f of fs.files) {
    if (/^\.threadctx\/packs\/[^/]+\.ya?ml$/.test(f) && !listed.has(f)) add(fs.readFile(f) ?? "", f, false);
  }
  for (const ref of config.packs) {
    if (ref.path) {
      const text = fs.readFile(ref.path);
      if (text === undefined) throw new ConfigError(`pack file not found: ${ref.path}`, config.source ?? "config", ref.line);
      if (ref.integrity && !verifyIntegrity(text, ref.integrity)) throw new ConfigError(`integrity mismatch for ${ref.path}`, config.source ?? "config", ref.line);
      add(text, ref.path, ref.allowBlockers === true);
    } else if (ref.package) {
      const base = `node_modules/${ref.package}`;
      const text = fs.readFile(`${base}/pack.yaml`) ?? fs.readFile(`${base}/pack.yml`);
      if (text === undefined) {
        diagnostics.push({ level: "error", path: config.source, line: ref.line, message: `Rule pack ${ref.package} is not installed (expected ${base}/pack.yaml). Its rules did not run.` });
        continue;
      }
      if (ref.integrity && !verifyIntegrity(text, ref.integrity)) throw new ConfigError(`integrity mismatch for ${ref.package}: the installed pack differs from the pinned hash`, config.source ?? "config", ref.line);
      add(text, `${base}/pack.yaml`, ref.allowBlockers === true);
    }
  }
  return out;
}

/** Everything a scan needs except running the checks. Exposed for `explain` and `diff`. */
export function prepare(fs: FsView, opts: { config?: ScanConfig } = {}, diagnostics: Diagnostic[] = []): ScanState {
  const config = opts.config ?? loadConfig(fs);
  const catalog = buildCatalog(fs);
  const facts = collectFacts(fs);
  const mcpResult = discoverRepoMcp(fs);
  for (const e of mcpResult.errors) diagnostics.push({ level: "warning", path: e.path, message: `MCP config not parsed: ${e.message}` });
  const rootContexts = ADAPTERS.map((a) => a.resolve(ROOT_TARGET, catalog));
  const packs = loadPacks(fs, config, diagnostics);
  return { catalog, facts, mcp: mcpResult.servers, config, rootContexts, packs };
}

function fingerprint(ruleId: string, path: string, key: string): string {
  return sha256(`${ruleId}\u0000${path}\u0000${key.replace(/\s+/g, " ").trim().toLowerCase()}`).slice(0, 16);
}

export function scan(fs: FsView, opts: ScanOptions = {}): ScanResult {
  validateRegistry(RULES);
  const now = opts.now ?? new Date();
  const diagnostics: Diagnostic[] = [];
  const state = prepare(fs, { config: opts.config }, diagnostics);
  const { catalog, config } = state;
  const artifacts: ParsedArtifact[] = catalog.artifacts;

  if ((fs as { truncated?: boolean }).truncated) diagnostics.push({ level: "warning", message: "File listing truncated; some paths may be reported as missing." });
  for (const a of ADAPTERS) {
    const age = adapterAgeDays(a, now);
    if (age > STALE_AFTER_DAYS) diagnostics.push({ level: "warning", message: `${a.label} adapter was last verified against the tool's docs ${age} days ago (${a.verifiedAgainst.date}); its results may be stale.` });
  }

  const ctx: RuleContext = { fs, catalog, artifacts, facts: state.facts, mcp: state.mcp, config, rootContexts: state.rootContexts, history: opts.history, now };

  const metas = new Map<string, RuleMeta>(RULES.map((r) => [r.id, r]));
  const checks: { check: Check; meta: RuleMeta; community: boolean }[] = [];
  for (const c of CHECKS) checks.push({ check: c, meta: metas.get(c.ruleId)!, community: false });
  for (const { pack, allowBlockers } of state.packs) {
    for (const rule of pack.rules) {
      const meta = pack.builtin ? metas.get(rule.id)! : packRuleMeta(pack, rule, allowBlockers);
      if (!pack.builtin) metas.set(meta.id, meta);
      checks.push({ check: packCheck(pack, rule), meta, community: !pack.builtin });
    }
  }

  for (const id of Object.keys(config.rules)) {
    if (!metas.has(id)) diagnostics.push({ level: "warning", path: config.source, message: `rules.${id}: unknown rule id` });
  }

  const findings: Finding[] = [];
  for (const { check, meta, community } of checks) {
    const override = config.rules[meta.id];
    if (override === "off") continue;
    if (opts.only && !opts.only.includes(meta.id)) continue;
    const severity = override ?? meta.severity;
    const report = (f: FindingInput) => {
      findings.push({
        ruleId: meta.id,
        severity,
        family: meta.family,
        title: meta.title,
        message: f.message,
        path: f.path,
        line: f.line,
        endLine: f.endLine,
        evidence: f.evidence,
        fingerprint: fingerprint(meta.id, f.path, f.fingerprintKey ?? f.evidence ?? f.message),
        fix: f.fix,
        wasteTokens: f.wasteTokens,
        related: f.related,
        tool: f.tool,
        community: community || undefined,
      });
    };
    try {
      check.run(ctx, report);
    } catch (e) {
      // One broken check must never hide the others' findings.
      diagnostics.push({ level: "error", message: `Rule ${meta.id} failed and was skipped: ${(e as Error).message}` });
    }
  }

  applySuppressions(findings, inlineSuppressions(artifacts, now, diagnostics), config, now, diagnostics);
  const severityRank = { blocker: 0, warning: 1, info: 2 };
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0) || severityRank[a.severity] - severityRank[b.severity] || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)));
  // The same rule can find the same thing twice (e.g. a file reached two ways); keep one.
  const unique = findings.filter((f, i) => findings.findIndex((g) => g.fingerprint === f.fingerprint && g.line === f.line) === i);

  const g = grade(unique);
  return {
    schema: "threadctx.scan/v1",
    engine: { version: ENGINE_VERSION, registry: REGISTRY_VERSION },
    grade: g.grade,
    score: g.score,
    counts: g.counts,
    findings: unique,
    diagnostics,
    artifacts: artifacts.map((a) => ({ path: a.artifact.path, tool: a.artifact.tool, kind: a.artifact.kind, tokenEstimate: a.artifact.tokenEstimate, contentHash: a.artifact.contentHash, origin: a.artifact.origin })),
    tools: ADAPTERS.map((a, i) => ({ id: a.id, label: a.label, status: a.status, verified: a.verifiedAgainst.date, alwaysTokenEstimate: state.rootContexts[i]!.alwaysTokenEstimate, layers: state.rootContexts[i]!.layers.length })),
    mcpServers: state.mcp.map((s) => ({ client: s.client, name: s.name, source: s.sourcePath, transport: s.transport })),
    rules: [...metas.values()].filter((m) => checks.some((c) => c.meta.id === m.id)),
    facts: statedFacts(ctx),
  };
}

export const SEVERITY_RANK = { info: 1, warning: 2, blocker: 3 } as const;

/** Exit code per spec §8.1: 1 when an open finding is at or above the threshold. */
export function exitCodeFor(result: ScanResult, failOn: ScanConfig["failOn"]): 0 | 1 {
  if (failOn === "none") return 0;
  return result.findings.some((f) => !f.suppressed && SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}
