import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, parseGithubRef, type Io } from "./cli.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tctx-cli-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

async function cli(args: string[], cwd: string) {
  let out = "";
  let err = "";
  const io: Io = { cwd, env: { CI: "1" }, stdout: (s) => (out += s), stderr: (s) => (err += s), isTTY: false, now: () => new Date("2026-10-03T12:00:00Z") };
  const code = await main(args, io);
  return { code, out, err };
}

const MESSY = {
  "package.json": JSON.stringify({ scripts: { test: "vitest run", build: "tsc" }, devDependencies: { vitest: "3" } }),
  "pnpm-lock.yaml": "",
  "AGENTS.md": "# Dev\n- Install: `pnpm install`\n- Test: `pnpm test`\n",
  "CLAUDE.md": "# Dev\r\n- Install: `npm install`\r\n- Build: `npm run build`\r\n- Hidden\u202E here\r\n",
  ".cursor/rules/ts.mdc": "---\nglobs: *.ts\n---\n- Strict TS\n",
  "src/index.ts": "",
};

describe("cli", () => {
  it("scan exits 1 on blockers and 0 with --fail-on none; text output has the grade", async () => {
    const dir = repo(MESSY);
    const r = await cli(["scan"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Grade F/);
    expect((await cli(["scan", "--fail-on", "none"], dir)).code).toBe(0);
  });

  it("scan writes json and sarif to a file", async () => {
    const dir = repo(MESSY);
    const r = await cli(["scan", "--format", "sarif", "--output", "out/r.sarif"], dir);
    expect(r.err).toMatch(/Wrote sarif report/);
    expect(JSON.parse(readFileSync(join(dir, "out/r.sarif"), "utf8")).version).toBe("2.1.0");
    const j = await cli(["scan", "--format", "json"], dir);
    expect(JSON.parse(j.out).schema).toBe("threadctx.scan/v1");
  });

  it("usage and config errors exit 2", async () => {
    const dir = repo({ ".threadctx/config.yaml": "failOn: maybe\n" });
    expect((await cli(["scan"], dir)).code).toBe(2);
    expect((await cli(["scan", "--format", "xml"], dir)).code).toBe(2);
    expect((await cli(["bogus"], dir)).code).toBe(2);
    expect((await cli(["scan", "--nope"], dir)).code).toBe(2);
  });

  it("fix prints a patch and --apply rewrites files preserving CRLF, then the findings are gone", async () => {
    const dir = repo(MESSY);
    const patch = await cli(["fix"], dir);
    expect(patch.out).toContain("+- Install: `pnpm install`");
    await cli(["fix", "--apply"], dir);
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    expect(claude).toBe("# Dev\r\n- Install: `pnpm install`\r\n- Build: `pnpm build`\r\n- Hidden here\r\n");
    const after = JSON.parse((await cli(["scan", "--format", "json"], dir)).out);
    expect(after.findings.filter((f: { ruleId: string }) => ["CTX-D003", "CTX-X001", "CTX-C001"].includes(f.ruleId))).toEqual([]);
  });

  it("explain lists layers per tool for a file", async () => {
    // `globs: *.ts` is invalid YAML but Cursor reads it leniently, and so do we.
    const dir = repo(MESSY);
    const r = await cli(["explain", "src/index.ts", "--tool", "cursor", "--no-color"], dir);
    expect(r.out).toContain(".cursor/rules/ts.mdc");
    expect(r.out).toContain("AGENTS.md");
    const json = JSON.parse((await cli(["explain", "src/index.ts", "--json"], dir)).out);
    expect(json.map((c: { tool: string }) => c.tool)).toEqual(["agents-md", "claude-code", "cursor", "copilot", "gemini"]);
  });

  it("diff shows where agents disagree", async () => {
    const dir = repo(MESSY);
    const r = await cli(["diff", "--no-color"], dir);
    expect(r.out).toMatch(/pkg\.manager.*← differs/);
  });

  it("rules, tools, version and pack validate", async () => {
    const dir = repo({ "p.yaml": "pack: house\nrules:\n  - id: NO-X\n    title: t\n    rationale: r\n    citation: c\n    remediation: m\n    match:\n      any: ['x']\n" });
    expect((await cli(["rules", "CTX-X001"], dir)).out).toContain("Invisible");
    expect((await cli(["tools"], dir)).out).toContain("claude-code");
    expect((await cli(["--version"], dir)).out).toMatch(/^threadctx \d/);
    expect((await cli(["pack", "validate", "p.yaml"], dir)).out).toContain("house/NO-X");
  });

  it("badge prints a shields.io markdown line for the current grade", async () => {
    const dir = repo(MESSY);
    const r = await cli(["badge"], dir);
    expect(r.out).toMatch(/^\[!\[Agent context grade [A-F]\]\(https:\/\/img\.shields\.io\/badge\/agent%20context-[A-F]%20%C2%B7%20\d+-[a-z]+\)\]\(https:\/\/.+\)\n$/);
    expect(JSON.parse((await cli(["badge", "--json"], dir)).out).grade).toMatch(/^[A-F]$/);
  });

  it("parses GitHub references and rejects nonsense", () => {
    expect(parseGithubRef("vercel/next.js")).toEqual({ fullName: "vercel/next.js", ref: undefined });
    expect(parseGithubRef("openai/codex@main")).toEqual({ fullName: "openai/codex", ref: "main" });
    expect(parseGithubRef("https://github.com/openai/codex.git")).toEqual({ fullName: "openai/codex", ref: undefined });
    expect(parseGithubRef("https://github.com/openai/codex/tree/dev")).toEqual({ fullName: "openai/codex", ref: "dev" });
    expect(() => parseGithubRef("just-a-name")).toThrow(/owner\/repo/);
  });

  it("scan rejects a path together with --github", async () => {
    const r = await cli(["scan", ".", "--github", "a/b"], repo({}));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/either a path or --github/);
  });

  it("compare applies the net-new ratchet through files", async () => {
    const dir = repo(MESSY);
    await cli(["scan", "--format", "json", "--output", "base.json"], dir);
    // Same repo: nothing new, so the ratchet passes even though the grade is poor.
    await cli(["scan", "--format", "json", "--output", "head.json"], dir);
    const same = await cli(["compare", "base.json", "head.json", "--fail-on", "info"], dir);
    expect(same.code).toBe(0);
    expect(same.out).toMatch(/0 new · 0 fixed/);
    writeFileSync(join(dir, "AGENTS.md"), readFileSync(join(dir, "AGENTS.md"), "utf8") + "- evil\u202Etext\n");
    await cli(["scan", "--format", "json", "--output", "head.json"], dir);
    const worse = await cli(["compare", "base.json", "head.json"], dir);
    expect(worse.code).toBe(1);
    expect(worse.out).toContain("CTX-X001");
    expect((await cli(["compare", "base.json", "head.json", "--format", "md"], dir)).out).toContain("**1 new**");
    expect((await cli(["compare", "nope.json", "head.json"], dir)).code).toBe(2);
  });

  it("badge links to the repository's own grade page when origin is on GitHub", async () => {
    const dir = repo(MESSY);
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/widgets.git"], { cwd: dir });
    expect((await cli(["badge"], dir)).out).toContain("](https://threadctx.dev/r/acme/widgets)");
    const plain = repo(MESSY);
    expect((await cli(["badge"], plain)).out).toContain("](https://threadctx.dev)");
  });

  it("the daily hint suggests the free org audit for the repo's own org, only in a TTY and never in CI", async () => {
    const dir = repo(MESSY);
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/widgets"], { cwd: dir });
    const home = mkdtempSync(join(tmpdir(), "tctx-home-"));
    let err = "";
    const run = (env: NodeJS.ProcessEnv, isTTY: boolean) => main(["scan", "--fail-on", "none"], { cwd: dir, env: { THREADCTX_HOME: home, ...env }, stdout: () => {}, stderr: (s) => (err += s), isTTY, now: () => new Date("2026-10-06T12:00:00Z") });
    await run({ CI: "1" }, true);
    await run({}, false);
    expect(err).not.toContain("audit --org");
    await run({}, true);
    expect(err).toContain("npx threadctx audit --org acme");
    err = "";
    await run({}, true); // same day: silent
    expect(err).not.toContain("audit --org");
  });
});
