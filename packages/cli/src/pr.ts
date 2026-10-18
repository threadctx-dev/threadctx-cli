// Open a pull request with a set of file changes, using the developer's own git and GitHub CLI.
// Never touches uncommitted work: refuses to run on a dirty tree, and returns to the original branch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class PrError extends Error {}

export interface PrRequest {
  root: string;
  env: NodeJS.ProcessEnv;
  /** Branch name prefix; a numeric suffix is added if it already exists. */
  branch: string;
  files: Map<string, string>;
  title: string;
  body: string;
  /** Print progress. */
  log: (s: string) => void;
}

function run(cmd: string, args: string[], root: string, env: NodeJS.ProcessEnv, input?: string): string {
  try {
    return execFileSync(cmd, args, { cwd: root, env, input, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 }).toString().trim();
  } catch (e) {
    const err = e as { stderr?: Buffer; code?: string; message: string };
    if (err.code === "ENOENT") throw new PrError(cmd === "gh" ? "the GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run 'gh auth login', or use --apply and open the pull request yourself." : `${cmd} is not installed`);
    throw new PrError(`${cmd} ${args[0]} failed: ${(err.stderr?.toString() || err.message).trim().split("\n").slice(-3).join(" ")}`);
  }
}

/** Create a branch with the changes, push it and open a pull request. Returns the pull request URL. */
export function openPullRequest(r: PrRequest): string {
  const git = (...args: string[]) => run("git", args, r.root, r.env);
  run("gh", ["--version"], r.root, r.env);
  if (git("status", "--porcelain", "--untracked-files=no")) throw new PrError("you have uncommitted changes. Commit or stash them first, so the pull request contains only threadctx's changes.");
  for (const p of r.files.keys()) {
    if (git("status", "--porcelain", "--", p)) throw new PrError(`${p} has uncommitted changes or is untracked. Commit, stash or remove it first.`);
  }
  const original = git("rev-parse", "--abbrev-ref", "HEAD");
  if (original === "HEAD") throw new PrError("you are on a detached HEAD. Check out a branch first.");
  const existing = new Set(git("branch", "--list", "--format=%(refname:short)").split("\n"));
  let branch = r.branch;
  for (let i = 2; existing.has(branch); i++) branch = `${r.branch}-${i}`;

  const tracked = new Set([...r.files.keys()].filter((p) => existsSync(join(r.root, p))));
  git("switch", "-c", branch);
  let committed = false;
  try {
    for (const [p, content] of r.files) {
      mkdirSync(dirname(join(r.root, p)), { recursive: true });
      writeFileSync(join(r.root, p), content);
    }
    git("add", "--", ...r.files.keys());
    git("commit", "-q", "-m", r.title);
    committed = true;
    r.log(`Committed on ${branch}. Pushing…\n`);
    git("push", "-q", "-u", "origin", branch);
    const url = run("gh", ["pr", "create", "--head", branch, "--title", r.title, "--body-file", "-"], r.root, r.env, r.body).split("\n").pop() ?? "";
    return url;
  } catch (e) {
    if (!committed) {
      // Leave the working tree exactly as we found it.
      try { git("reset", "-q"); } catch { /* nothing staged */ }
      for (const p of r.files.keys()) {
        if (tracked.has(p)) git("checkout", "-q", "--", p);
        else rmSync(join(r.root, p), { force: true });
      }
    } else {
      r.log(`note: the commit is on local branch ${branch}; push it and open the pull request yourself.\n`);
    }
    throw e;
  } finally {
    try {
      git("switch", "-q", original);
    } catch {
      r.log(`note: could not switch back to ${original}; you are on ${branch}.\n`);
    }
  }
}
