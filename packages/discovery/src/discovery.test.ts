import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectFacts, machineMcpSources, memoryRepo, openRepo, packageRef, parseCodexToml, parseMcpConfig, stripJsonc } from "./index.js";

describe("openRepo", () => {
  it("walks a non-git directory honouring .gitignore and skipping node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "tctx-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules/x"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "secret.txt\n");
    writeFileSync(join(dir, "AGENTS.md"), "# hi");
    writeFileSync(join(dir, "secret.txt"), "x");
    writeFileSync(join(dir, "src/a.ts"), "x");
    writeFileSync(join(dir, "node_modules/x/index.js"), "x");
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
    const repo = openRepo(dir);
    expect(repo.files).toEqual([".gitignore", "AGENTS.md", "CLAUDE.md", "src/a.ts"]);
    expect(repo.symlinkTarget("CLAUDE.md")).toBe("AGENTS.md");
    expect(repo.readFile("./AGENTS.md")).toBe("# hi");
    expect(repo.exists("src")).toBe(true);
  });
});

describe("collectFacts", () => {
  const repo = memoryRepo({
    "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest" }, engines: { node: ">=20" }, devDependencies: { vitest: "^3" } }),
    "pnpm-lock.yaml": "",
    "apps/web/package.json": JSON.stringify({ name: "web", scripts: { dev: "next dev" }, dependencies: { next: "15.0.0" } }),
    "Makefile": "VERSION := 1\n.PHONY: ci\nbuild test: deps\n\tgo build\n",
    "justfile": "default:\n  echo hi\nrelease version:\n  echo {{version}}\n",
    ".nvmrc": "v20.11.0\n",
    "pyproject.toml": '[project]\nrequires-python = ">=3.11"\ndependencies = [\n  "httpx>=0.27",\n]\n',
    ".github/CODEOWNERS": "# owners\n*.md @docs\n/AGENTS.md @lead\n",
    "README.md": "# Readme",
  });
  const facts = collectFacts(repo);
  it("reads scripts, lockfiles and the packageManager field", () => {
    expect(facts.manifests.map((m) => m.path)).toEqual(["apps/web/package.json", "package.json"]);
    expect(facts.lockfiles).toEqual([{ manager: "pnpm", path: "pnpm-lock.yaml" }]);
    expect(facts.declaredPackageManager).toBe("pnpm");
  });
  it("reads make targets and just recipes but not variables", () => {
    expect([...facts.makeTargets].sort()).toEqual(["build", "ci", "test"]);
    expect([...facts.justRecipes].sort()).toEqual(["default", "release"]);
  });
  it("collects runtimes, deps and codeowners", () => {
    expect(facts.runtimes.map((r) => [r.tool, r.constraint])).toEqual([["node", ">=20"], ["node", "20.11.0"], ["python", ">=3.11"]]);
    expect(facts.dependencyNames.has("next")).toBe(true);
    expect(facts.dependencyNames.has("httpx")).toBe(true);
    expect(facts.codeowners?.entries).toEqual([{ pattern: "*.md", owned: true, line: 2 }, { pattern: "/AGENTS.md", owned: true, line: 3 }]);
  });
});

describe("MCP configs", () => {
  it("parses mcpServers and VS Code JSONC servers", () => {
    const vs = parseMcpConfig({ client: "vscode", path: ".vscode/mcp.json", format: "vscode" },
      '{\n // comment\n "servers": {\n  "gh": { "type": "http", "url": "https://api.example.com/mcp", },\n },\n}', "repo", ".vscode/mcp.json");
    expect(vs.error).toBeUndefined();
    expect(vs.servers[0]).toMatchObject({ name: "gh", transport: "http", line: 4 });
  });
  it("reports invalid JSON instead of throwing", () => {
    expect(parseMcpConfig({ client: "claude-code", path: ".mcp.json", format: "mcpServers" }, "{oops", "repo", ".mcp.json").error).toMatch(/Invalid JSON/);
  });
  it("keeps // inside strings when stripping comments", () => {
    expect(JSON.parse(stripJsonc('{"u": "https://x.dev"}'))).toEqual({ u: "https://x.dev" });
  });
  it("reads Codex TOML", () => {
    const servers = parseCodexToml('[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp@1.2.3"]\nenv = { API_KEY = "abc" }\n[other]\nx = 1\n');
    expect(servers).toEqual([["docs", { command: "npx", args: ["-y", "docs-mcp@1.2.3"], env: { API_KEY: "abc" } }]]);
  });
  it.each([
    [["npx", ["-y", "@modelcontextprotocol/server-github"]], { name: "@modelcontextprotocol/server-github", pinned: false }],
    [["npx", ["-y", "pkg@latest"]], { version: "latest", pinned: false }],
    [["npx", ["-y", "pkg@1.2.3"]], { pinned: true }],
    [["npx", ["pkg@^1.2.0"]], { pinned: false }],
    [["pnpm", ["dlx", "pkg@2.0.0"]], { pinned: true }],
    [["uvx", ["mcp-server-git==0.6.2"]], { name: "mcp-server-git", pinned: true }],
    [["uvx", ["--from", "mcp-x==1.0", "mcp-x"]], { pinned: true }],
    [["docker", ["run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/x/y"]], { name: "ghcr.io/x/y", pinned: false }],
    [["docker", ["run", "ghcr.io/x/y:1.4"]], { pinned: true }],
    [["docker", ["run", "ghcr.io/x/y@sha256:abc"]], { pinned: true }],
  ] as const)("%j", ([cmd, args], expected) => {
    expect(packageRef(cmd, [...args])).toMatchObject(expected);
  });
  it("uses the corrected per-OS paths", () => {
    const win = machineMcpSources("C:\\Users\\a", "win32", "C:\\Users\\a\\AppData\\Roaming").map((d) => d.path);
    expect(win).toContain("C:/Users/a/.cursor/mcp.json");
    expect(win).toContain("C:/Users/a/.codeium/windsurf/mcp_config.json");
    expect(machineMcpSources("/home/a", "linux").map((d) => d.path)).toContain("/home/a/.config/Code/User/mcp.json");
  });
});
