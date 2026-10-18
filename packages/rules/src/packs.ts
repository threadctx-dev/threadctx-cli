// Declarative rule packs: YAML only, no code execution, so they are safe to load in CI.
// Built-in heuristic rules use the same format, which keeps the format honest.
import { parseDocument } from "yaml";
import { createHash } from "node:crypto";
import type { ParsedArtifact } from "@threadctx/adapters";
import { estimateTokens, type ArtifactKind } from "@threadctx/core";
import type { Family, RuleMeta, Severity } from "./registry.js";
import type { Check, RuleContext } from "./types.js";
import { isExampleContext, negatedAt, quote } from "./util.js";

export interface PackRule {
  id: string;
  title: string;
  rationale: string;
  citation: string;
  remediation: string;
  family: Family;
  severity: Severity;
  determinism: "deterministic" | "heuristic";
  match: {
    /** Regular expressions tested against each directive's text. */
    any: string[];
    /** Case-sensitive matching; default is case-insensitive. */
    caseSensitive?: boolean;
    /** Skip matches preceded by a negation ("never …"). Default true. */
    skipNegated?: boolean;
    /** Skip directives that describe examples. Default true. */
    skipExamples?: boolean;
    /** Only these artifact kinds. Default instructions and rule. */
    kinds?: ArtifactKind[];
    /** Only artifacts read by these tools (artifact tool id, or "neutral"). */
    tools?: string[];
    /** Report once per artifact when at least this many directives match. Default 1 (report each). */
    minPerArtifact?: number;
  };
}

export interface Pack {
  pack: string;
  description?: string;
  rules: PackRule[];
  source: string;
  builtin: boolean;
}

export class PackError extends Error {}

const FAMILIES: Family[] = ["structure", "drift", "conflict", "budget", "security", "governance"];
const MAX_PATTERN_LENGTH = 500;

/** Reject patterns with nested quantifiers, the classic catastrophic-backtracking shape. */
export function unsafePattern(p: string): boolean {
  return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(p) || p.length > MAX_PATTERN_LENGTH;
}

export function parsePack(text: string, source: string, builtin = false): Pack {
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) throw new PackError(`${source}: ${doc.errors[0]!.message.split("\n")[0]}`);
  return validatePack(doc.toJS({ maxAliasCount: 0 }), source, builtin);
}

export function validatePack(raw: unknown, source: string, builtin = false): Pack {
  const fail = (m: string): never => {
    throw new PackError(`${source}: ${m}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("pack must be a mapping");
  const o = raw as Record<string, unknown>;
  if (typeof o.pack !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.pack)) fail("'pack' must be a lowercase id (a-z, 0-9, -)");
  if (!builtin && o.pack === "ctx") fail("'ctx' is reserved for built-in rules");
  if (!Array.isArray(o.rules) || o.rules.length === 0) fail("'rules' must be a non-empty list");
  const ids = new Set<string>();
  const rules = (o.rules as unknown[]).map((r, i): PackRule => {
    const where = `rules[${i}]`;
    if (!r || typeof r !== "object") fail(`${where} must be a mapping`);
    const x = r as Record<string, unknown>;
    for (const k of ["id", "title", "rationale", "citation", "remediation"]) {
      if (typeof x[k] !== "string" || !(x[k] as string).trim()) fail(`${where}.${k} is required`);
    }
    const id = x.id as string;
    if (!(builtin ? /^CTX-[A-Z]\d{3}$/ : /^[A-Z][A-Z0-9-]{1,30}$/).test(id)) fail(`${where}.id '${id}' must be uppercase letters, digits and dashes`);
    if (ids.has(id)) fail(`duplicate rule id ${id}`);
    ids.add(id);
    const family = (x.family ?? "governance") as Family;
    if (!FAMILIES.includes(family)) fail(`${where}.family must be one of ${FAMILIES.join(", ")}`);
    const severity = (x.severity ?? "warning") as Severity;
    if (!["blocker", "warning", "info"].includes(severity)) fail(`${where}.severity must be blocker, warning or info`);
    const determinism = (x.determinism ?? "deterministic") as PackRule["determinism"];
    if (!["deterministic", "heuristic"].includes(determinism)) fail(`${where}.determinism must be deterministic or heuristic`);
    const m = x.match as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") fail(`${where}.match is required`);
    const any = m!.any;
    if (!Array.isArray(any) || any.length === 0 || any.some((p) => typeof p !== "string")) fail(`${where}.match.any must be a list of regular expressions`);
    for (const p of any as string[]) {
      if (unsafePattern(p)) fail(`${where}.match.any pattern is too long or has nested quantifiers: ${p.slice(0, 60)}`);
      try {
        new RegExp(p);
      } catch (e) {
        fail(`${where}.match.any invalid regular expression: ${(e as Error).message}`);
      }
    }
    return {
      id,
      title: x.title as string,
      rationale: x.rationale as string,
      citation: x.citation as string,
      remediation: x.remediation as string,
      family,
      severity,
      determinism,
      match: {
        any: any as string[],
        caseSensitive: m!.caseSensitive === true,
        skipNegated: m!.skipNegated !== false,
        skipExamples: m!.skipExamples !== false,
        kinds: Array.isArray(m!.kinds) ? (m!.kinds as ArtifactKind[]) : undefined,
        tools: Array.isArray(m!.tools) ? (m!.tools as string[]) : undefined,
        minPerArtifact: typeof m!.minPerArtifact === "number" ? m!.minPerArtifact : 1,
      },
    };
  });
  return { pack: o.pack as string, description: typeof o.description === "string" ? o.description : undefined, rules, source, builtin };
}

export function packRuleId(pack: Pack, rule: PackRule): string {
  return pack.builtin ? rule.id : `${pack.pack}/${rule.id}`;
}

export function packRuleMeta(pack: Pack, rule: PackRule, allowBlockers: boolean): RuleMeta {
  return {
    id: packRuleId(pack, rule),
    family: rule.family,
    severity: !pack.builtin && !allowBlockers && rule.severity === "blocker" ? "warning" : rule.severity,
    determinism: rule.determinism,
    title: rule.title,
    rationale: rule.rationale,
    citation: rule.citation,
    remediation: rule.remediation,
    autofix: "none",
    status: pack.builtin ? "beta" : "beta",
    since: "0.1.0",
    availability: "local",
  };
}

function applies(rule: PackRule, a: ParsedArtifact): boolean {
  const kinds = rule.match.kinds ?? ["instructions", "rule"];
  if (!kinds.includes(a.artifact.kind)) return false;
  if (rule.match.tools && !rule.match.tools.includes(a.artifact.tool)) return false;
  return true;
}

export function packCheck(pack: Pack, rule: PackRule): Check {
  const flags = rule.match.caseSensitive ? "" : "i";
  const patterns = rule.match.any.map((p) => new RegExp(p, flags));
  return {
    ruleId: packRuleId(pack, rule),
    run(ctx: RuleContext, report) {
      for (const a of ctx.artifacts) {
        if (!applies(rule, a)) continue;
        const hits: { line: number; text: string }[] = [];
        for (const d of a.directives) {
          if (rule.match.skipExamples && isExampleContext(d)) continue;
          // A heading such as "Never do" or "Forbidden" negates every line beneath it.
          if (rule.match.skipNegated && d.section && /\b(never|don'?t|do not|forbidden|prohibited|not allowed|avoid|anti-?patterns?|must not)\b/i.test(d.section)) continue;
          // Directives are short; cap the text a user pattern runs on as a ReDoS backstop.
          const text = d.text.slice(0, 2000);
          for (const re of patterns) {
            const m = re.exec(text);
            if (!m) continue;
            if (rule.match.skipNegated && negatedAt(text, m.index)) continue;
            const lineOffset = text.slice(0, m.index).split("\n").length - 1;
            hits.push({ line: d.span.startLine + lineOffset, text: text.split("\n")[lineOffset] ?? text });
            break;
          }
        }
        const min = rule.match.minPerArtifact ?? 1;
        if (min > 1) {
          if (hits.length >= min) {
            report({
              path: a.artifact.path,
              line: hits[0]!.line,
              message: `${rule.title}: ${hits.length} lines (${hits.slice(0, 3).map((h) => `line ${h.line}`).join(", ")}${hits.length > 3 ? ", …" : ""}).`,
              evidence: quote(hits[0]!.text),
              fingerprintKey: `${a.artifact.path}:${rule.id}`,
              ...(rule.family === "budget" ? { wasteTokens: hits.reduce((n, h) => n + estimateTokens(h.text), 0) } : {}),
            });
          }
        } else {
          for (const h of hits) report({ path: a.artifact.path, line: h.line, message: rule.title, evidence: quote(h.text), ...(rule.family === "budget" ? { wasteTokens: estimateTokens(h.text) } : {}) });
        }
      }
    },
  };
}

/** sha256 of the pack file, in either `sha256-<base64>` (npm SRI) or `sha256:<hex>` form. */
export function verifyIntegrity(text: string, integrity: string): boolean {
  const digest = createHash("sha256").update(text).digest();
  if (integrity.startsWith("sha256-")) return digest.toString("base64") === integrity.slice(7);
  if (integrity.startsWith("sha256:")) return digest.toString("hex") === integrity.slice(7).toLowerCase();
  return false;
}
