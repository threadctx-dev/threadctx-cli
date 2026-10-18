// topicKey extraction (spec §6.1): turn common facts into normalised keys so conflicts are
// found deterministically, without a model. Two artifacts with the same key and disjoint
// values contradict each other.
import { stripPrompt } from "./claims.js";
import type { Claim, Fact } from "./types.js";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export function isPackageManager(s: string): s is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(s);
}

/** Canonical form of a command so `npm run test` and `npm test` compare equal. */
export function normalizeCommand(raw: string): string {
  let cmd = stripPrompt(raw).replace(/\s+/g, " ").replace(/\s+#.*$/, "").trim();
  cmd = cmd.replace(/^npm run-script /, "npm run ");
  cmd = cmd.replace(/^npm run (test|start|stop|restart)(?=\s|$)/, "npm $1");
  cmd = cmd.replace(/^(pnpm|yarn) run /, "$1 ");
  cmd = cmd.replace(/^npm (?:i|install)$/, "npm install");
  cmd = cmd.replace(/^pnpm i$/, "pnpm install");
  cmd = cmd.replace(/^yarn install$/, "yarn");
  return cmd;
}

const PM_BUILTINS: Record<PackageManager, Set<string>> = {
  npm: new Set(["install", "i", "ci", "add", "uninstall", "update", "exec", "init", "publish", "pack", "link", "ls", "outdated", "audit", "version", "view", "whoami", "login", "config", "cache", "dedupe", "prune", "rebuild", "x"]),
  pnpm: new Set(["install", "i", "add", "remove", "rm", "update", "up", "exec", "dlx", "create", "init", "publish", "pack", "link", "list", "ls", "outdated", "audit", "why", "store", "import", "fetch", "rebuild", "prune", "deploy", "patch", "patch-commit", "env", "setup", "config", "approve-builds", "self-update"]),
  yarn: new Set(["install", "add", "remove", "up", "upgrade", "dlx", "exec", "init", "publish", "pack", "link", "info", "why", "workspaces", "workspace", "set", "config", "cache", "dedupe", "npm", "plugin", "constraints", "version"]),
  bun: new Set(["install", "i", "add", "remove", "rm", "update", "x", "create", "init", "publish", "pm", "link", "upgrade", "build", "test", "repl", "outdated", "audit", "patch"]),
};

export interface ParsedCommand {
  tool: string;
  /** Script name when the command runs a package.json / Makefile / justfile target. */
  script?: string;
  /** Where the script must be defined. */
  scriptSource?: "package.json" | "Makefile" | "justfile";
  packageManager?: PackageManager;
  /** Workspace/filter flags mean the script may live in any workspace package. */
  workspaceScoped: boolean;
}

/** Parse just enough of a command to know which script it runs and with which tool. */
export function parseCommand(raw: string): ParsedCommand {
  const tokens = normalizeCommand(raw).split(" ");
  const tool = tokens[0] ?? "";
  const workspaceScoped = tokens.some((t) => /^(-r|--recursive|-w|--workspace(=.*)?|--workspaces|-F|--filter(=.*)?|--cwd(=.*)?|-C|--prefix(=.*)?|--dir(=.*)?|workspace|workspaces)$/.test(t));
  if (isPackageManager(tool)) {
    const rest = tokens.slice(1).filter((t, i, arr) => {
      // Drop flags and the value that follows a flag taking an argument.
      if (t.startsWith("-")) return false;
      const prev = arr[i - 1];
      if (prev && /^(-F|--filter|-C|--cwd|--prefix|--dir|-w|--workspace)$/.test(prev)) return false;
      return true;
    });
    let script: string | undefined;
    if (rest[0] === "run" || rest[0] === "run-script") script = rest[1];
    else if (tool === "npm") script = rest[0] && ["test", "start", "stop", "restart"].includes(rest[0]) ? rest[0] : undefined;
    else if (tool === "yarn" && (rest[0] === "workspace" || rest[0] === "workspaces")) script = undefined;
    else if (rest[0] && !PM_BUILTINS[tool].has(rest[0])) script = rest[0];
    return { tool, script, scriptSource: script ? "package.json" : undefined, packageManager: tool, workspaceScoped };
  }
  if (tool === "make") {
    const target = tokens.slice(1).find((t) => !t.startsWith("-") && !t.includes("="));
    return { tool, script: target, scriptSource: target ? "Makefile" : undefined, workspaceScoped: tokens.includes("-C") };
  }
  if (tool === "just") {
    const recipe = tokens.slice(1).find((t) => !t.startsWith("-"));
    return { tool, script: recipe, scriptSource: recipe ? "justfile" : undefined, workspaceScoped: false };
  }
  if (tool === "npx" || tool === "bunx") return { tool, packageManager: tool === "bunx" ? "bun" : undefined, workspaceScoped };
  return { tool, workspaceScoped };
}

const TOPIC_PATTERNS: [string, RegExp][] = [
  ["cmd.typecheck", /^(typecheck|type-check|types|check-types|tsc|mypy|pyright)(:|$)|^tsc --noemit/i],
  ["cmd.test", /^(test|tests|unit|spec|vitest|jest|mocha|pytest|rspec|phpunit|ava|tap)(:|$)/i],
  ["cmd.lint", /^(lint|eslint|ruff|flake8|pylint|rubocop|golangci-lint|clippy|biome|stylelint)(:|$)/i],
  ["cmd.format", /^(format|fmt|prettier|black|gofmt|rustfmt|isort)(:|$)/i],
  ["cmd.build", /^(build|compile|bundle)(:|$)/i],
  ["cmd.dev", /^(dev|start|serve|develop|watch)(:|$)/i],
];

/** Which normalised command topic a command belongs to, if any. */
export function commandTopic(raw: string): string | undefined {
  const cmd = normalizeCommand(raw);
  const parsed = parseCommand(cmd);
  const tokens = cmd.split(" ");
  if (parsed.packageManager && !parsed.script) {
    const sub = tokens.slice(1).find((t) => !t.startsWith("-"));
    if (tokens.length === 1 || sub === "install" || sub === "i" || sub === "ci") return "cmd.install";
    if (parsed.tool === "bun" && sub === "test") return "cmd.test";
    return undefined;
  }
  let subject = parsed.script ?? parsed.tool;
  if (["cargo", "go", "dotnet", "mix", "swift", "flutter", "dart", "deno", "uv", "poetry", "pdm", "hatch", "rye"].includes(parsed.tool)) {
    // `cargo test`, `go test ./...`, `uv run pytest`, `poetry run pytest`
    const sub = tokens.slice(1).filter((t) => !t.startsWith("-"));
    subject = sub[0] === "run" ? sub[1] ?? "" : sub[0] ?? "";
  }
  if (parsed.tool === "python" || parsed.tool === "python3") {
    const m = cmd.match(/-m (\S+)/);
    subject = m?.[1] ?? "";
  }
  if (parsed.tool === "npx" || parsed.tool === "bunx") subject = tokens.slice(1).find((t) => !t.startsWith("-")) ?? "";
  if (parsed.tool === "ruff" && tokens[1] === "format") return "cmd.format";
  if (parsed.tool === "tsc" && !/--noemit/i.test(cmd)) return "cmd.build";
  for (const [key, re] of TOPIC_PATTERNS) if (re.test(subject)) return key;
  return undefined;
}

/** Facts derived from a directive's claims. */
export function factsFromClaims(claims: Claim[]): Fact[] {
  const facts: Fact[] = [];
  const add = (f: Fact) => {
    if (!facts.some((x) => x.topicKey === f.topicKey && x.value === f.value)) facts.push(f);
  };
  for (const c of claims) {
    if (c.type === "command") {
      const topic = commandTopic(c.value);
      const norm = normalizeCommand(c.value);
      if (topic) add({ topicKey: topic, value: norm, line: c.line, derived: false });
      const pm = parseCommand(norm).packageManager;
      if (pm) add({ topicKey: "pkg.manager", value: pm, line: c.line, derived: true });
    } else if (c.type === "package-manager") {
      add({ topicKey: "pkg.manager", value: c.value, line: c.line, derived: false });
    } else if (c.type === "version") {
      const [tech, rawVersion] = c.value.split("@") as [string, string];
      const lowerBound = rawVersion.endsWith("+");
      const version = rawVersion.replace(/\+$/, "");
      const major = version.split(".")[0]!;
      const key = ["node", "python", "ruby", "java", "php", "go", "deno", "bun"].includes(tech)
        ? `lang.${tech}.version`
        : `dep.${tech}.version`;
      // Python is always major 3; compare major.minor so 3.11 vs 3.12 is meaningful.
      const value = (tech === "python" ? version.split(".").slice(0, 2).join(".") : major) + (lowerBound ? "+" : "");
      add({ topicKey: key, value, line: c.line, derived: false });
    }
  }
  return facts;
}
