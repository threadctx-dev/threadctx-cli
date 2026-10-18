import { dirOf, ownerDir, resolveImport, type ParsedArtifact } from "@threadctx/adapters";
import { extractSections, parseCommand, type Fact } from "@threadctx/core";
import type { Check, RuleContext } from "../types.js";
import { isAncestorDir, isExampleContext, isOwnInstruction, lineText, quote } from "../util.js";

/** Test/lint/format runners whose disagreement is a real contradiction (jest vs vitest). */
const RUNNERS = new Set([
  "jest", "vitest", "mocha", "ava", "tap", "jasmine", "playwright", "cypress", "pytest", "unittest", "nose2", "rspec", "minitest", "phpunit",
  "eslint", "biome", "oxlint", "standard", "xo", "ruff", "flake8", "pylint", "rubocop", "golangci-lint",
  "prettier", "dprint", "black", "yapf", "autopep8", "gofmt", "rustfmt",
  "tsc", "mypy", "pyright",
]);

interface Stated {
  a: ParsedArtifact;
  fact: Fact;
  /** Comparable value: package manager, major version, or resolved runner. */
  value: string;
}

/** Resolve a command fact to the runner it ultimately invokes, via package.json scripts. */
function runnerOf(ctx: RuleContext, a: ParsedArtifact, command: string): string | undefined {
  const parsed = parseCommand(command);
  let exec = command;
  if (parsed.script && parsed.scriptSource === "package.json") {
    const dir = ownerDir(a.artifact.path) ?? "";
    const manifest =
      ctx.facts.manifests.find((m) => dirOf(m.path) === dir && parsed.script! in m.scripts) ??
      ctx.facts.manifests.find((m) => m.path === "package.json" && parsed.script! in m.scripts);
    if (!manifest) return undefined;
    exec = manifest.scripts[parsed.script]!;
  }
  const tokens = exec.replace(/^(?:cross-env\s+(?:\S+=\S+\s+)*|(?:[A-Z_]+=\S+\s+)+)/, "").split(/\s+/);
  let i = 0;
  while (["npx", "pnpm", "yarn", "bunx", "bun", "uv", "poetry", "pdm", "hatch", "exec", "run", "dlx", "x", "python", "python3", "-m"].includes(tokens[i] ?? "")) i++;
  const tool = tokens[i]?.replace(/^.*\//, "");
  return tool && RUNNERS.has(tool) ? tool : undefined;
}

/** Facts per artifact that can be compared across files without false positives. */
function comparable(ctx: RuleContext): Map<string, Stated[]> {
  const byKey = new Map<string, Stated[]>();
  const push = (key: string, s: Stated) => {
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  };
  for (const a of ctx.artifacts) {
    if (!isOwnInstruction(a) || a.symlinkTarget) continue;
    const explicitPm = a.directives.some((d) => d.kind !== "prohibition" && d.facts.some((f) => f.topicKey === "pkg.manager" && !f.derived));
    for (const d of a.directives) {
      if (d.kind === "prohibition" || isExampleContext(d)) continue;
      const pmsHere = new Set(d.facts.filter((f) => f.topicKey === "pkg.manager").map((f) => f.value));
      for (const f of d.facts) {
        if (f.topicKey === "pkg.manager") {
          if (pmsHere.size > 1) continue; // alternatives listed together
          if (explicitPm && f.derived) continue; // an explicit statement outranks inferred usage
          const text = lineText(a, f.line);
          if (/\s(-g|--global)\b/.test(text)) continue;
          if (f.derived && /\b(npm|pnpm|yarn|bun)\s+(install|i|add)\s+[^-\s`]/.test(text)) continue; // installing a named package
          push("pkg.manager", { a, fact: f, value: f.value });
        } else if (/^(lang|dep)\.\w+\.version$/.test(f.topicKey)) {
          if (f.value.endsWith("+")) continue;
          const major = f.topicKey === "lang.python.version" ? f.value : f.value.split(".")[0]!;
          push(f.topicKey, { a, fact: f, value: major });
        } else if (f.topicKey.startsWith("cmd.") && f.topicKey !== "cmd.install" && f.topicKey !== "cmd.dev" && f.topicKey !== "cmd.build") {
          const runner = runnerOf(ctx, a, f.value);
          if (runner) push(`${f.topicKey}.runner`, { a, fact: f, value: runner });
        }
      }
    }
  }
  return byKey;
}

/** Distinct normalised values per fact key this repository's own instructions state, plus the lockfile truth. */
export function statedFacts(ctx: RuleContext): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, stated] of comparable(ctx)) out[key] = [...new Set(stated.map((s) => s.value))].sort();
  const roots = [...new Set(ctx.facts.lockfiles.filter((l) => !l.path.includes("/")).map((l) => l.manager))];
  if (roots.length === 1) out["actual.pkg.manager"] = roots;
  return out;
}

const TOPIC_LABEL: Record<string, string> = {
  "pkg.manager": "package manager",
  "cmd.test.runner": "test runner",
  "cmd.lint.runner": "linter",
  "cmd.format.runner": "formatter",
  "cmd.typecheck.runner": "type checker",
};

function label(key: string): string {
  return TOPIC_LABEL[key] ?? key.replace(/^(lang|dep)\.(\w+)\.version$/, "$2 version");
}

const MANIFEST = /^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|composer\.json|Gemfile|mix\.exs|deno\.jsonc?)$/;

/** The project root an artifact describes: nearest ancestor directory with its own manifest. */
function projectOf(ctx: RuleContext, a: ParsedArtifact): string {
  let dir = ownerDir(a.artifact.path) ?? "";
  for (;;) {
    if (ctx.fs.files.some((f) => dirOf(f) === dir && MANIFEST.test(f.split("/").pop()!))) return dir;
    if (!dir) return "";
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
}

function nested(a: ParsedArtifact, b: ParsedArtifact): boolean {
  const da = ownerDir(a.artifact.path) ?? "";
  const db = ownerDir(b.artifact.path) ?? "";
  return isAncestorDir(da, db) || isAncestorDir(db, da);
}

interface Pair {
  key: string;
  first: Stated;
  second: Stated;
}

/** Pairs of artifacts whose value sets for a topic are disjoint. */
function disjointPairs(ctx: RuleContext): Pair[] {
  const pairs: Pair[] = [];
  for (const [key, stated] of comparable(ctx)) {
    const byArtifact = new Map<string, Stated[]>();
    for (const s of stated) byArtifact.set(s.a.artifact.path, [...(byArtifact.get(s.a.artifact.path) ?? []), s]);
    const paths = [...byArtifact.keys()].sort();
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const A = byArtifact.get(paths[i]!)!;
        const B = byArtifact.get(paths[j]!)!;
        const va = new Set(A.map((s) => s.value));
        if (B.some((s) => va.has(s.value))) continue;
        pairs.push({ key, first: A[0]!, second: B[0]! });
      }
    }
  }
  return pairs;
}

export const C001: Check = {
  ruleId: "CTX-C001",
  run(ctx, report) {
    for (const p of disjointPairs(ctx)) {
      if (nested(p.first.a, p.second.a)) continue; // reported by C003
      // Sibling packages in a monorepo, each with its own manifest, legitimately differ.
      const pa = projectOf(ctx, p.first.a);
      const pb = projectOf(ctx, p.second.a);
      if (pa !== pb && pa !== "" && pb !== "") continue;
      const { first, second } = p;
      report({
        path: second.a.artifact.path,
        line: second.fact.line,
        message: p.key.endsWith(".runner")
          ? `Conflicting ${label(p.key)}: ${second.a.artifact.path} runs ${second.value} (\`${quote(second.fact.value, 60)}\`), ${first.a.artifact.path}:${first.fact.line} runs ${first.value} (\`${quote(first.fact.value, 60)}\`). Agents reading different files will do different things.`
          : `Conflicting ${label(p.key)}: ${second.a.artifact.path} says ${second.value}, ${first.a.artifact.path}:${first.fact.line} says ${first.value}. Agents reading different files will do different things.`,
        evidence: quote(lineText(second.a, second.fact.line)),
        related: [{ path: first.a.artifact.path, line: first.fact.line, message: `states ${first.value}` }],
        fingerprintKey: `${p.key}:${[first.a.artifact.path, second.a.artifact.path].sort().join("|")}:${[first.value, second.value].sort().join("|")}`,
      });
    }
  },
};

export const C003: Check = {
  ruleId: "CTX-C003",
  run(ctx, report) {
    for (const p of disjointPairs(ctx)) {
      if (!nested(p.first.a, p.second.a)) continue;
      const parentFirst = isAncestorDir(ownerDir(p.first.a.artifact.path) ?? "", ownerDir(p.second.a.artifact.path) ?? "");
      const parent = parentFirst ? p.first : p.second;
      const child = parentFirst ? p.second : p.first;
      const childDir = ownerDir(child.a.artifact.path) ?? "";
      // A nested project with its own manifest or lockfile legitimately differs.
      if (ctx.fs.files.some((f) => dirOf(f) === childDir && /^(package\.json|pyproject\.toml|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?|\.nvmrc|\.python-version)$/.test(f.split("/").pop()!))) continue;
      report({
        path: child.a.artifact.path,
        line: child.fact.line,
        message: `Overrides the ${label(p.key)} from ${parent.a.artifact.path} (${parent.value} → ${child.value}) but ${childDir}/ has no manifest of its own to justify it.`,
        evidence: quote(lineText(child.a, child.fact.line)),
        related: [{ path: parent.a.artifact.path, line: parent.fact.line }],
        fingerprintKey: `${p.key}:${parent.a.artifact.path}|${child.a.artifact.path}:${parent.value}|${child.value}`,
      });
    }
  },
};

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[`*_:#]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeLines(body: string): string[] {
  return body.split("\n").map((l) => l.replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
}

export const C002: Check = {
  ruleId: "CTX-C002",
  run(ctx, report) {
    for (const agents of ctx.artifacts.filter((a) => /(^|\/)AGENTS\.md$/.test(a.artifact.path))) {
      const dir = dirOf(agents.artifact.path);
      const claudePath = dir ? `${dir}/CLAUDE.md` : "CLAUDE.md";
      const claude = ctx.catalog.get(claudePath);
      if (!claude || claude.symlinkTarget || agents.symlinkTarget) continue;
      if (claude.imports.some((i) => resolveImport(claude.artifact.path, i.path) === agents.artifact.path)) continue;
      const aSections = extractSections(agents.text);
      const cSections = new Map(extractSections(claude.text).map((s) => [normalizeTitle(s.title), s]));
      for (const s of aSections) {
        const other = cSections.get(normalizeTitle(s.title));
        if (!other) continue;
        const la = normalizeLines(s.body);
        const lc = normalizeLines(other.body);
        if (la.length === 0 || lc.length === 0) continue;
        if (la.join("\n") === lc.join("\n")) continue; // identical: duplication (B004), not divergence
        const shared = la.filter((l) => lc.includes(l)).length;
        if (shared / Math.max(la.length, lc.length) < 0.5) continue; // different content, not a drifted copy
        report({
          path: claude.artifact.path,
          line: other.line,
          message: `Section "${s.title}" exists in both ${agents.artifact.path} and ${claude.artifact.path} and the copies have diverged (${shared} of ${Math.max(la.length, lc.length)} lines shared). Claude Code reads CLAUDE.md, other agents read AGENTS.md.`,
          evidence: quote(s.title),
          related: [{ path: agents.artifact.path, line: s.line }],
          fingerprintKey: `${agents.artifact.path}|${claude.artifact.path}|${normalizeTitle(s.title)}`,
          fix: {
            kind: "suggested",
            description: "Delete the copy in CLAUDE.md and add `@AGENTS.md` so both tools read one source.",
            edits: [{ path: claude.artifact.path, startLine: 1, endLine: 0, replacement: `@${dir ? "AGENTS.md" : "AGENTS.md"}\n` }],
          },
        });
      }
    }
  },
};
