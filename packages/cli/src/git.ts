import { execFileSync } from "node:child_process";
import type { HistoryProvider } from "@threadctx/rules";

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString().trim();
  } catch {
    return undefined;
  }
}

export function gitRoot(dir: string): string | undefined {
  return git(dir, ["rev-parse", "--show-toplevel"]);
}

/** Git history for CTX-D006, or undefined in shallow clones and non-git directories. */
export function gitHistory(root: string): HistoryProvider | undefined {
  if (git(root, ["rev-parse", "--is-shallow-repository"]) !== "false") return undefined;
  return {
    lastCommitTime(path) {
      const out = git(root, ["log", "-1", "--format=%ct", "--", path]);
      return out ? Number(out) : undefined;
    },
    commitsSince(paths, since) {
      const out = git(root, ["rev-list", "--count", `--since=@${since + 1}`, "HEAD", "--", ...paths]);
      return out ? Number(out) : undefined;
    },
  };
}

/** owner/repo of the origin remote when it is on github.com. */
export function githubRemote(dir: string): string | undefined {
  const url = git(dir, ["remote", "get-url", "origin"]);
  const m = url?.match(/github\.com[:/]([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}
