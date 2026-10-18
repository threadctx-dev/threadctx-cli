// Deterministic claim extraction. Precision over recall: when a token is ambiguous we drop it
// rather than risk a false positive downstream (spec §4 principle 2).
import type { Block } from "./markdown.js";
import { codeSpans, isShellLang, maskCodeSpans } from "./markdown.js";
import type { Claim } from "./types.js";

const RUNNERS = new Set([
  "npm", "pnpm", "yarn", "bun", "bunx", "npx", "deno", "node", "tsx", "ts-node",
  "make", "just", "task", "cargo", "go", "rustc",
  "python", "python3", "pip", "pip3", "uv", "uvx", "poetry", "pdm", "hatch", "rye", "pipx",
  "pytest", "tox", "nox", "ruff", "black", "mypy", "pyright", "flake8", "isort",
  "eslint", "prettier", "biome", "tsc", "vitest", "jest", "mocha", "playwright", "cypress",
  "turbo", "nx", "lerna", "changeset",
  "gradle", "./gradlew", "gradlew", "mvn", "./mvnw", "dotnet", "bundle", "rake", "rails", "rspec",
  "mix", "composer", "php", "phpunit", "swift", "xcodebuild", "flutter", "dart",
  "docker", "docker-compose", "kubectl", "terraform", "helm",
]);

/** Tech names that look like files ("Next.js") but are not paths. */
const TECH_JS = new Set([
  "next", "node", "vue", "nuxt", "express", "three", "d3", "chart", "ember", "backbone", "angular",
  "react", "p5", "anime", "moment", "day", "lodash", "alpine", "solid", "svelte", "preact",
  "electron", "deno", "nest", "remix", "gatsby", "meteor", "knockout", "mithril", "polymer",
  "riot", "inferno", "hapi", "koa", "sails", "feathers", "adonis", "fastify", "vite", "jest",
  "mocha", "cypress", "playwright", "webpack", "rollup", "parcel", "gulp", "grunt", "babel",
  "esbuild", "swc", "pixi", "phaser", "leaflet", "mapbox", "socket", "hono", "elysia", "astro",
]);

export const FILE_EXT = /\.(md|mdx|mdc|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|env|lock|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyi|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|prisma|graphql|gql|proto|css|scss|sass|less|html|vue|svelte|astro|xml|gradle|tf|dockerfile|ipynb|csv)$/i;
const BARE_FILES = new Set(["Makefile", "Dockerfile", "Justfile", "justfile", "Procfile", "Gemfile", "Rakefile", "LICENSE", "CODEOWNERS"]);

export function stripPrompt(cmd: string): string {
  return cmd.replace(/^\s*(?:\$|>|%|PS>)\s+/, "").trim();
}

/** True when the string starts with a known build/test/run tool. */
export function looksLikeCommand(raw: string): boolean {
  const cmd = stripPrompt(raw);
  if (!cmd || cmd.length > 300 || /[\n]/.test(cmd)) return false;
  const first = cmd.split(/\s+/)[0]!;
  return RUNNERS.has(first);
}

export type PathShape = "path" | "glob" | undefined;

/** Classify a code-span or link target as a repository path, a glob, or neither. */
export function pathShape(raw: string): PathShape {
  const s = raw.trim();
  if (!s || s.length > 200 || /\s/.test(s)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return undefined; // url, mailto:, node:fs
  if (s.startsWith("@") || s.startsWith("-") || s.startsWith("~") || s.startsWith("/") || s.startsWith("$")) return undefined;
  // Placeholders (<name>, $VAR, %VAR%) and code fragments are never paths.
  if (/[<>$%|=;"'`]/.test(s)) return undefined;
  if (/[*?[\]{}]/.test(s)) {
    if (/,/.test(s.replace(/\{[^}]*\}/g, ""))) return undefined;
    return /\//.test(s) || /^\*\./.test(s) || s.includes("**") ? "glob" : undefined;
  }
  if (s.includes(",")) return undefined;
  if (!/^[\w.@+()\-/]+$/.test(s)) return undefined;
  if (/^v?\d+(\.\d+)*$/.test(s)) return undefined; // version numbers
  const base = s.replace(/\/+$/, "").split("/").pop() ?? "";
  if (!s.includes("/")) {
    if (BARE_FILES.has(s)) return "path";
    if (!FILE_EXT.test(s)) return undefined;
    const m = s.match(/^([\w-]+)\.js$/i);
    if (m && TECH_JS.has(m[1]!.toLowerCase())) return undefined;
    if (/^\.[\w]+$/.test(s) && !/^\.(env|nvmrc|node-version|python-version|tool-versions|gitignore|editorconfig|npmrc)$/i.test(s)) return undefined;
    return "path";
  }
  // Multi-segment: require every segment to be a plausible file name and at least one
  // to look like a file or the path to end with "/" (an explicit directory).
  const segments = s.replace(/\/+$/, "").split("/");
  if (segments.some((seg) => seg === "" || seg.length > 100)) return undefined;
  if (/^[a-z]+\/[a-z]+$/i.test(s) && !s.endsWith("/") && !FILE_EXT.test(base)) {
    // "and/or", "input/output", "read/write" are prose, not paths.
    if (PROSE_PAIRS.has(s.toLowerCase())) return undefined;
  }
  return "path";
}

const PROSE_PAIRS = new Set([
  "and/or", "input/output", "read/write", "client/server", "true/false", "yes/no", "on/off",
  "pass/fail", "frontend/backend", "front-end/back-end", "dev/prod", "get/set", "open/close",
  "start/stop", "before/after", "request/response", "success/failure", "show/hide", "enable/disable",
]);

const VERSION_CLAIM = /\b(Node(?:\.js)?|Python|React|Next(?:\.js)?|TypeScript|Vue|Angular|Django|Rails|Ruby|Java|PHP|Svelte|Nuxt|Express|Deno|Bun|pnpm|Yarn|Vite|Tailwind(?:\s?CSS)?|Prisma|Go)\s+v?(\d+(?:\.\d+){0,2})(\+|\s+or\s+(?:later|higher|newer|above))?(?![\w]|\.\d)/g;

const PM_STATEMENT = /\b(?:use|uses|using|prefer|prefers|run with|install with|managed with|package manager(?:\s+is|:)?)\s+`?(npm|pnpm|yarn|bun)`?\b/gi;
const NEGATION_BEFORE = /\b(never|don't|do not|not|no|avoid|instead of|rather than|nor)\b[^.!?]{0,30}$/i;

const BUILTIN_MODULES = new Set([
  "assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "http",
  "http2", "https", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream",
  "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

/** npm package name from an import specifier, or undefined for relative, aliased or builtin imports. */
export function packageFromSpecifier(spec: string): string | undefined {
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:") || spec.startsWith("#")) return undefined;
  if (spec.startsWith("~") || spec.startsWith("@/") || spec.startsWith("$")) return undefined; // path aliases
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  if (BUILTIN_MODULES.has(name)) return undefined;
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name)) return undefined;
  return name;
}

/** Split a fenced shell block into individual command lines, joining backslash continuations. */
export function shellLines(code: string, startLine: number): { cmd: string; line: number }[] {
  const out: { cmd: string; line: number }[] = [];
  const lines = code.split("\n");
  let acc = "";
  let accLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = startLine + i;
    const trimmed = raw.trim();
    if (!acc && (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))) continue;
    if (!acc) accLine = lineNo;
    if (trimmed.endsWith("\\")) {
      acc += trimmed.slice(0, -1) + " ";
      continue;
    }
    acc += trimmed;
    out.push({ cmd: acc.replace(/\s+#\s.*$/, "").trim(), line: accLine });
    acc = "";
  }
  if (acc) out.push({ cmd: acc.trim(), line: accLine });
  return out;
}

/** Split compound shell lines ("pnpm i && pnpm test") into separate commands. */
export function splitCompound(cmd: string): string[] {
  return cmd.split(/\s*(?:&&|\|\||;)\s*/).map((c) => c.trim()).filter(Boolean);
}

export function extractClaims(block: Block): Claim[] {
  const claims: Claim[] = [];
  const push = (c: Claim) => {
    if (!claims.some((x) => x.type === c.type && x.value === c.value && x.line === c.line)) claims.push(c);
  };

  if (block.isCode) {
    const codeStart = block.span.startLine + 1;
    if (isShellLang(block.fenceLang)) {
      for (const { cmd, line } of shellLines(block.text, codeStart)) {
        for (const part of splitCompound(stripPrompt(cmd))) {
          if (looksLikeCommand(part)) push({ type: "command", value: part, line, source: "fence" });
        }
      }
    } else if (/^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs)$/.test(block.fenceLang ?? "")) {
      const lines = block.text.split("\n");
      lines.forEach((l, i) => {
        for (const m of l.matchAll(/(?:\bfrom\s+|\bimport\s+|\brequire\(\s*)["']([^"']+)["']/g)) {
          const pkg = packageFromSpecifier(m[1]!);
          if (pkg) push({ type: "dependency", value: pkg, line: codeStart + i, source: "fence" });
        }
      });
    }
    return claims;
  }

  const lines = block.text.split("\n");
  lines.forEach((text, i) => {
    const line = block.span.startLine + i;
    for (const span of codeSpans(text)) {
      for (const part of splitCompound(stripPrompt(span))) {
        if (looksLikeCommand(part)) {
          push({ type: "command", value: part, line, source: "code-span" });
          continue;
        }
      }
      if (looksLikeCommand(span)) continue;
      const shape = pathShape(span);
      if (shape === "path") push({ type: "path", value: span.replace(/^\.\//, ""), line, source: "code-span" });
      else if (shape === "glob") push({ type: "glob", value: span, line, source: "code-span" });
    }
    const masked = maskCodeSpans(text);
    for (const m of masked.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = m[1]!.split("#")[0]!;
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const decoded = safeDecode(target).replace(/^\.\//, "");
      if (pathShape(decoded) === "path") push({ type: "path", value: decoded, line, source: "link" });
    }
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s)<>"'`\]]+/g)) {
      push({ type: "url", value: m[0].replace(/[.,;:!?]+$/, ""), line, source: "text" });
    }
    for (const m of masked.matchAll(VERSION_CLAIM)) {
      // "Node 18+" / "Node 18 or later" is a lower bound, recorded with a trailing "+".
      const before = masked.slice(Math.max(0, m.index - 3), m.index);
      const lowerBound = Boolean(m[3]) || />=\s*$/.test(before);
      push({ type: "version", value: `${normalizeTech(m[1]!)}@${m[2]}${lowerBound ? "+" : ""}`, line, source: "text" });
    }
    for (const m of text.matchAll(PM_STATEMENT)) {
      const before = text.slice(0, m.index);
      if (NEGATION_BEFORE.test(before)) continue;
      push({ type: "package-manager", value: m[1]!.toLowerCase(), line, source: "text" });
    }
  });
  return claims;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function normalizeTech(name: string): string {
  const n = name.toLowerCase().replace(/\s+/g, "");
  if (n === "node.js") return "node";
  if (n === "next.js") return "next";
  if (n === "tailwindcss") return "tailwind";
  return n;
}
