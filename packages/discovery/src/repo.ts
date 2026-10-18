// Read-only view of a repository. The engine never touches the filesystem directly, so the
// same inputs always give the same outputs and tests can use an in-memory view.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import type { FsView } from "@threadctx/core";

/** Files above this size are never read as context (they are not instructions). */
export const MAX_READ_BYTES = 1_000_000;
/** Hard cap on files listed, to keep scans bounded on huge monorepos. */
export const MAX_FILES = 200_000;

const ALWAYS_SKIP = new Set([".git", "node_modules", ".hg", ".svn", ".venv", "venv", "__pycache__", ".next", ".turbo", "dist", "build", "target", ".gradle", "vendor", "Pods", ".terraform"]);

export interface RepoView extends FsView {
  /** Where the file list came from. */
  listing: "git" | "walk" | "memory";
  /** True when the listing was truncated at MAX_FILES. */
  truncated: boolean;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function gitList(root: string): string[] | undefined {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = out.toString("utf8").split("\0").filter(Boolean);
    // git lists deleted-but-tracked files too; drop the ones not on disk.
    return files.filter((f) => {
      try {
        lstatSync(join(root, f));
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

function walk(root: string): string[] {
  const ig = ignore();
  try {
    ig.add(readFileSync(join(root, ".gitignore"), "utf8"));
  } catch {
    /* no .gitignore */
  }
  const out: string[] = [];
  const stack = [""];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (ALWAYS_SKIP.has(e.name) || ig.ignores(`${rel}/`)) continue;
        stack.push(rel);
      } else if ((e.isFile() || e.isSymbolicLink()) && !ig.ignores(rel)) {
        out.push(rel);
      }
    }
  }
  return out;
}

function isInsideGitWorkTree(root: string): boolean {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return Boolean(top);
  } catch {
    return false;
  }
}

/** Build a view over a directory on disk. Uses `git ls-files` when available. */
export function openRepo(rootPath: string): RepoView {
  const root = resolve(rootPath);
  const st = statSync(root);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${rootPath}`);
  let listing: RepoView["listing"] = "walk";
  let files: string[] | undefined;
  if (isInsideGitWorkTree(root)) {
    files = gitList(root);
    if (files) listing = "git";
  }
  if (!files) files = walk(root);
  files = files
    .map(toPosix)
    .filter((f) => !f.split("/").some((seg) => seg === "node_modules" || seg === ".git"));
  const truncated = files.length > MAX_FILES;
  files = [...new Set(files)].sort().slice(0, MAX_FILES);
  return makeView(root, files, listing, truncated, (rel) => {
    const abs = join(root, rel);
    try {
      const s = statSync(abs);
      if (!s.isFile() || s.size > MAX_READ_BYTES) return undefined;
      return readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  }, (rel) => {
    try {
      lstatSync(join(root, rel));
      return true;
    } catch {
      return false;
    }
  }, (rel) => {
    try {
      const abs = join(root, rel);
      if (!lstatSync(abs).isSymbolicLink()) return undefined;
      const target = resolve(join(root, posix.dirname(rel)), readlinkSync(abs));
      const r = toPosix(relative(root, target));
      return r.startsWith("..") ? target : r;
    } catch {
      return undefined;
    }
  });
}

/** In-memory view for tests and for scanning fetched files (e.g. `--org` audits). */
export function memoryRepo(fileMap: Record<string, string>, symlinks: Record<string, string> = {}): RepoView {
  const files = Object.keys(fileMap).sort();
  return makeView("/memory", files, "memory", false, (p) => fileMap[p], (p) => p in fileMap || [...files].some((f) => f.startsWith(`${p.replace(/\/$/, "")}/`)), (p) => symlinks[p]);
}

function makeView(
  root: string,
  files: string[],
  listing: RepoView["listing"],
  truncated: boolean,
  read: (rel: string) => string | undefined,
  exists: (rel: string) => boolean,
  link: (rel: string) => string | undefined,
): RepoView {
  const dirs = new Set<string>([""]);
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const fileSet = new Set(files);
  const cache = new Map<string, string | undefined>();
  const readCached = (p: string) => {
    const rel = normalizeRel(p);
    if (!cache.has(rel)) cache.set(rel, read(rel));
    return cache.get(rel);
  };
  const existsRel = (p: string) => {
    const rel = normalizeRel(p);
    return fileSet.has(rel) || dirs.has(rel.replace(/\/$/, "")) || exists(rel);
  };
  return {
    root,
    files,
    dirs,
    listing,
    truncated,
    readFile: readCached,
    exists: existsRel,
    symlinkTarget: (p) => link(normalizeRel(p)),
  };
}

export function normalizeRel(p: string): string {
  return posix.normalize(toPosix(p)).replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/$/, "") || "";
}
