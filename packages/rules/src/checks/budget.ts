import { getAdapter } from "@threadctx/adapters";
import type { Check } from "../types.js";
import { ADAPTERS, dirOf, globMatcher, ownerDir } from "@threadctx/adapters";
import type { RuleContext } from "../types.js";
import { estimateTokens } from "@threadctx/core";
import { isInstructional, isOwnInstruction, quote } from "../util.js";

/** Pairs of files that at least one tool loads together, for the root or any context directory. */
export function coLoadedPairs(ctx: RuleContext): Set<string> {
  const targets = new Set<string>([""]);
  for (const a of ctx.artifacts) targets.add(ownerDir(a.artifact.path) ?? dirOf(a.artifact.path));
  const pairs = new Set<string>();
  for (const dir of targets) {
    for (const adapter of ADAPTERS) {
      const ec = adapter.resolve({ path: dir, isDir: true }, ctx.catalog);
      const paths = ec.layers.filter((l) => l.loading !== "agent-decides").map((l) => l.path).sort();
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const ga = ctx.catalog.get(paths[i]!)?.artifact.scope.globs;
          const gb = ctx.catalog.get(paths[j]!)?.artifact.scope.globs;
          // Two path-scoped rules load together only for a file both match.
          if (ga?.length && gb?.length) {
            const ma = globMatcher(ga);
            const mb = globMatcher(gb);
            if (!ctx.fs.files.some((f) => ma(f) && mb(f))) continue;
          }
          pairs.add(`${paths[i]}\u0000${paths[j]}`);
        }
      }
    }
  }
  return pairs;
}

export const B001: Check = {
  ruleId: "CTX-B001",
  run(ctx, report) {
    // One finding per largest file, naming every tool that is over budget because of it.
    const byFile = new Map<string, { tools: string[]; worst: number; budget: number; top: string }>();
    for (const ec of ctx.rootContexts) {
      const budget = ctx.config.budgets[ec.tool] ?? ctx.config.budgets.default!;
      if (ec.alwaysTokenEstimate <= budget) continue;
      const always = ec.layers.filter((l) => l.loading === "always" || l.loading === "agent-decides").sort((a, b) => b.tokenEstimate - a.tokenEstimate);
      const biggest = always[0];
      if (!biggest) continue;
      const entry = byFile.get(biggest.path) ?? { tools: [], worst: 0, budget, top: "" };
      entry.tools.push(`${getAdapter(ec.tool)?.label.split(" (")[0] ?? ec.tool} ≈${ec.alwaysTokenEstimate.toLocaleString("en-US")}`);
      if (ec.alwaysTokenEstimate > entry.worst) {
        entry.worst = ec.alwaysTokenEstimate;
        entry.budget = budget;
        entry.top = always.slice(0, 3).map((l) => `${l.path} ≈${l.tokenEstimate.toLocaleString("en-US")}`).join(", ");
      }
      byFile.set(biggest.path, entry);
    }
    for (const [path, e] of byFile) {
      report({
        path,
        line: 1,
        message: `Always-loaded context is over the ${e.budget.toLocaleString("en-US")}-token budget (estimates: ${e.tools.join(", ")}). Largest files: ${e.top}. Move rarely needed parts into path-scoped rules or delete them.`,
        evidence: `${e.worst} estimated tokens always loaded`,
        fingerprintKey: path,
      });
    }
  },
};

function words(text: string): string[] {
  return text.toLowerCase().replace(/[`*_#>|[\]()]/g, " ").split(/\W+/).filter(Boolean);
}

function shingles(ws: string[], n = 5): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

export const B002: Check = {
  ruleId: "CTX-B002",
  run(ctx, report) {
    const readme = ctx.facts.readme;
    if (!readme) return;
    const readmeShingles = shingles(words(readme.text));
    if (readmeShingles.size === 0) return;
    for (const a of ctx.artifacts) {
      if (!isInstructional(a)) continue;
      for (const d of a.directives) {
        const ws = words(d.text);
        if (ws.length < 40) continue;
        const sh = shingles(ws);
        let hit = 0;
        for (const s of sh) if (readmeShingles.has(s)) hit++;
        if (sh.size === 0 || hit / sh.size < 0.8) continue;
        report({
          path: a.artifact.path,
          line: d.span.startLine,
          endLine: d.span.endLine,
          wasteTokens: estimateTokens(d.text),
          message: `This ${ws.length}-word passage repeats ${readme.path}. Agents can read the README when they need it; a pointer costs fewer tokens on every session.`,
          evidence: quote(d.text, 120),
        });
      }
    }
  },
};

function normalizeDirective(text: string): string {
  return text.replace(/^\s*([-*+]|\d+[.)])\s+/gm, "").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export const B004: Check = {
  ruleId: "CTX-B004",
  run(ctx, report) {
    const seen = new Map<string, { path: string; line: number }>();
    // Two files only cost twice when some tool loads both for the same file: ask the adapters.
    const pairs = coLoadedPairs(ctx);
    const coLoad = (x: string, y: string) => pairs.has(x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);
    // One finding per (file, earlier file) pair, listing every repeated directive.
    const groups = new Map<string, { path: string; first: string; lines: number[]; firstLines: number[]; sample: string; endLine: number; tokens: number }>();
    for (const a of ctx.artifacts) {
      if (!isOwnInstruction(a) || a.symlinkTarget) continue;
      const local = new Set<string>();
      for (const d of a.directives) {
        if (d.fenceLang !== undefined) continue;
        const norm = normalizeDirective(d.text);
        if (norm.split(" ").length < 8 || local.has(norm)) continue;
        local.add(norm);
        const first = seen.get(norm);
        if (!first) {
          seen.set(norm, { path: a.artifact.path, line: d.span.startLine });
          continue;
        }
        if (first.path === a.artifact.path || !coLoad(first.path, a.artifact.path)) continue;
        const key = `${a.artifact.path}\u0000${first.path}`;
        const g = groups.get(key) ?? { path: a.artifact.path, first: first.path, lines: [], firstLines: [], sample: d.text, endLine: d.span.endLine, tokens: 0 };
        g.tokens += estimateTokens(d.text);
        g.lines.push(d.span.startLine);
        g.firstLines.push(first.line);
        g.endLine = d.span.endLine;
        groups.set(key, g);
      }
    }
    for (const g of groups.values()) {
      const n = g.lines.length;
      report({
        path: g.path,
        line: g.lines[0],
        endLine: g.endLine,
        wasteTokens: g.tokens,
        message: n === 1
          ? `Repeats ${g.first}:${g.firstLines[0]} word for word. Tools that load both files pay for it twice; keep it in one shared file.`
          : `${n} directives repeat ${g.first} word for word (lines ${g.lines.join(", ")}). Tools that load both files pay for them twice; keep them in one shared file.`,
        evidence: quote(g.sample, 120),
        related: [{ path: g.first, line: g.firstLines[0] }],
        fingerprintKey: `${g.first}:${n}`,
      });
    }
  },
};
