import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, type Io } from "./cli.js";
import { withBadge } from "./init.js";

/** A git repository with a bare "origin" and a fake gh that records its arguments. */
function setup(files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), "tctx-pr-"));
  const work = join(base, "work");
  const bin = join(base, "bin");
  mkdirSync(work);
  mkdirSync(bin);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", CI: "1" };
  const git = (...a: string[]) => execFileSync("git", a, { cwd: work, env }).toString().trim();
  execFileSync("git", ["init", "-q", "--bare", join(base, "origin.git")]);
  git("init", "-q", "-b", "main");
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(work, p, ".."), { recursive: true });
    writeFileSync(join(work, p), c);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("remote", "add", "origin", join(base, "origin.git"));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nif [ "$1" = "pr" ]; then cat > "${base}/body.md"; echo "$@" > "${base}/args"; echo https://github.com/acme/x/pull/7; elif [ "$1" = "repo" ]; then echo PRIVATE; else echo gh 2; fi\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { base, work, env, git };
}

async function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  let out = "";
  let err = "";
  const io: Io = { cwd, env, stdout: (s) => (out += s), stderr: (s) => (err += s), isTTY: false, now: () => new Date("2026-10-03T12:00:00Z") };
  return { code: await main(args, io), out, err };
}

describe("fix --pr", () => {
  it("commits the safe fixes on a branch, opens a pull request and returns to the original branch", async () => {
    const t = setup({ "AGENTS.md": "# Agents\n\n- run x‮y\n", "package.json": "{}" });
    const r = await run(["fix", "--pr"], t.work, t.env);
    expect(r.code, r.err).toBe(0);
    expect(r.out.trim()).toBe("https://github.com/acme/x/pull/7");
    expect(t.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readFileSync(join(t.work, "AGENTS.md"), "utf8")).toContain("‮");
    expect(t.git("show", "threadctx/fix-agent-context:AGENTS.md")).not.toContain("‮");
    expect(t.git("ls-remote", "--heads", "origin")).toContain("threadctx/fix-agent-context");
    expect(readFileSync(join(t.base, "body.md"), "utf8")).toContain("CTX-X001");
  });

  it("refuses to run with uncommitted changes and leaves them alone", async () => {
    const t = setup({ "AGENTS.md": "# A\n\n- x‮y\n" });
    writeFileSync(join(t.work, "AGENTS.md"), "# A\n\n- edited ‮\n");
    const r = await run(["fix", "--pr"], t.work, t.env);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/uncommitted changes/);
    expect(readFileSync(join(t.work, "AGENTS.md"), "utf8")).toContain("edited");
    expect(t.git("branch", "--list")).not.toContain("threadctx/");
  });

  it("restores the tree when the push fails", async () => {
    const t = setup({ "AGENTS.md": "# A\n\n- x‮y\n" });
    t.git("remote", "set-url", "origin", join(t.base, "missing.git"));
    const r = await run(["fix", "--pr"], t.work, t.env);
    expect(r.code).toBe(2);
    expect(t.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(t.git("status", "--porcelain")).toBe("");
  });
});

describe("init", () => {
  it("writes a pinned workflow and a README badge", async () => {
    const t = setup({ "README.md": "# Project\nIntro.\n", "AGENTS.md": "# A\n\nUse pnpm.\n" });
    const r = await run(["init"], t.work, t.env);
    expect(r.code, r.err).toBe(0);
    const wf = readFileSync(join(t.work, ".github/workflows/agent-context.yml"), "utf8");
    expect(wf).toMatch(/threadctx-dev\/action@[0-9a-f]{40} # v/);
    expect(readFileSync(join(t.work, "README.md"), "utf8")).toMatch(/^# Project\n\n\[!\[Agent context grade [A-F]\]/);
    const again = await run(["init"], t.work, t.env);
    expect(again.err).toMatch(/already exists/);
  });

  it("opens a pull request with --pr and leaves the working tree untouched", async () => {
    const t = setup({ "README.md": "# P\n", "AGENTS.md": "# A\n" });
    const r = await run(["init", "--pr", "--no-badge"], t.work, t.env);
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(t.work, ".github/workflows/agent-context.yml"))).toBe(false);
    expect(t.git("show", "threadctx/agent-context-check:.github/workflows/agent-context.yml")).toContain("threadctx-dev/action@");
  });
});

describe("withBadge", () => {
  const b = "[![Agent context grade A](https://img.shields.io/badge/agent%20context-A-green)](https://threadctx.dev)";
  it("inserts after the first heading, once", () => {
    expect(withBadge("# T\n\nText\n", b)).toBe(`# T\n\n${b}\n\nText\n`);
    expect(withBadge("No heading\n", b)).toBe(`${b}\n\nNo heading\n`);
    expect(withBadge(withBadge("# T\n", b), b)).toBe(withBadge("# T\n", b));
  });
});
