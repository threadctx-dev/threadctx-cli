// Read-only view of a GitHub repository without cloning: the full file tree plus the contents
// of context files, manifests and anything they import. Used by `scan --org` and the
// benchmark corpus. Network access happens only here, never in the engine.
import { posix } from "node:path";
import type { FsView } from "@threadctx/core";

const WANT = [
  /(^|\/)AGENTS(\.override)?\.md$/, /(^|\/)(\.claude\/)?CLAUDE(\.local)?\.md$/, /(^|\/)\.claude\//, /^\.cursor\//, /^\.cursorrules$/,
  /^\.github\/(copilot-instructions\.md|instructions\/.+\.instructions\.md|CODEOWNERS)$/, /(^|\/)GEMINI\.md$/, /^\.gemini\/settings\.json$/,
  /^\.mcp\.json$/, /^\.vscode\/mcp\.json$/, /^\.codex\/config\.toml$/, /^\.threadctx\//,
  /(^|\/)package\.json$/, /^pyproject\.toml$/, /^requirements[^/]*\.txt$/, /(^|\/)(GNUmakefile|[Mm]akefile(\.[\w.-]+)?|\.?justfile|[^/]+\.(mk|make|just))$/,
  /^\.(nvmrc|node-version|python-version|tool-versions|gitignore)$/, /^(docs\/)?CODEOWNERS$/, /^readme(\.md|\.markdown)?$/i,
];
const SKIP = /(^|\/)(node_modules|vendor|\.git|dist|build|third_party|fixtures?|testdata|__fixtures__|examples?)\//;
const MAX_BLOB = 1_000_000;
const MAX_PACKAGE_JSONS = 300;

export interface RemoteRepo {
  /** README text when it was fetched (used to detect the threadctx badge). */
  readme?: string;
  fullName: string;
  sha: string;
  view: FsView;
  truncated: boolean;
  fetched: number;
}

async function api<T>(path: string, token: string | undefined): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "threadctx-scanner (+https://threadctx.dev)", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }));
  return out;
}

export interface FetchOptions {
  ref?: string;
  token?: string;
  /** Refuse private repositories (used by the public web grader). */
  publicOnly?: boolean;
  /** Repo-relative paths the scan still needs, given what has been fetched so far (for @imports). */
  followImports?: (view: FsView) => string[];
}

export async function fetchRemoteRepo(fullName: string, opts: FetchOptions = {}): Promise<RemoteRepo> {
  const token = opts.token;
  const meta = opts.publicOnly || !opts.ref ? await api<{ default_branch: string; private: boolean }>(`/repos/${fullName}`, token) : undefined;
  if (opts.publicOnly && meta?.private) throw new Error("GitHub API 404: repository is not public");
  const ref = opts.ref ?? meta!.default_branch;
  const sha = /^[0-9a-f]{40}$/.test(ref) ? ref : (await api<{ sha: string }>(`/repos/${fullName}/commits/${encodeURIComponent(ref)}`, token)).sha;
  const tree = await api<{ truncated: boolean; tree: { path: string; type: string; mode: string; size?: number }[] }>(`/repos/${fullName}/git/trees/${sha}?recursive=1`, token);
  const blobs = tree.tree.filter((t) => t.type === "blob" && !t.path.split("/").includes("node_modules"));
  const submodules = tree.tree.filter((t) => t.type === "commit").map((t) => t.path);
  const files = blobs.map((b) => b.path).sort();
  const modes = new Map(blobs.map((b) => [b.path, b]));
  const content = new Map<string, string>();
  const fetchPaths = async (paths: string[]) => {
    const todo = paths.filter((p) => !content.has(p) && (modes.get(p)?.size ?? 0) <= MAX_BLOB);
    await pool(todo, 8, async (p) => {
      const res = await fetch(`https://raw.githubusercontent.com/${fullName}/${sha}/${p.split("/").map(encodeURIComponent).join("/")}`, {
        headers: token ? { Authorization: `token ${token}` } : {},
      });
      if (res.ok) content.set(p, await res.text());
    });
  };
  let packageJsons = 0;
  const first = files.filter((f) => {
    if (!WANT.some((re) => re.test(f))) return false;
    if (f.endsWith("package.json")) {
      if (SKIP.test(f) || ++packageJsons > MAX_PACKAGE_JSONS) return false;
    }
    return true;
  });
  await fetchPaths(first);
  const fileSet = new Set(files);
  const dirs = new Set<string>([""]);
  for (const f of [...files, ...submodules.map((m) => `${m}/.`)]) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const view: FsView = {
    root: `github:${fullName}@${sha.slice(0, 12)}`,
    files,
    dirs,
    readFile: (p) => {
      const rel = posix.normalize(p).replace(/^\.\//, "");
      if (modes.get(rel)?.mode !== "120000") return content.get(rel);
      // Symlinks: raw content is the link target; read the target instead.
      const target = posix.normalize(posix.join(posix.dirname(rel), content.get(rel) ?? ""));
      return content.get(target);
    },
    exists: (p) => {
      const rel = posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");
      return fileSet.has(rel) || dirs.has(rel);
    },
    symlinkTarget: (p) => (modes.get(p)?.mode === "120000" ? posix.normalize(posix.join(posix.dirname(p), content.get(p) ?? "")) : undefined),
  };
  // Imported files are context too: let the caller name the ones still missing, a few rounds deep.
  if (opts.followImports) {
    for (let round = 0; round < 3; round++) {
      const missing = opts.followImports(view).filter((p) => fileSet.has(p) && !content.has(p));
      if (!missing.length) break;
      await fetchPaths([...new Set(missing)]);
    }
  }
  const readmePath = files.find((f) => /^readme(\.md|\.markdown)?$/i.test(f));
  return { fullName, sha, view, truncated: tree.truncated, fetched: content.size, readme: readmePath ? content.get(readmePath) : undefined };
}

export interface OrgRepo {
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string;
}

export interface ListOptions {
  token?: string;
  max: number;
  includeForks: boolean;
  includeArchived: boolean;
}

/** Repositories of an organisation or user, most recently pushed first. Skips forks, archived and empty repositories by default. */
export async function listOrgRepos(org: string, opts: ListOptions): Promise<{ repos: OrgRepo[]; skipped: { forks: number; archived: number; empty: number; beyondMax: number }; owner: "org" | "user" }> {
  const collected: Record<string, unknown>[] = [];
  let owner: "org" | "user" = "org";
  for (const kind of ["orgs", "users"] as const) {
    collected.length = 0;
    try {
      for (let page = 1; page <= 20; page++) {
        const q = kind === "orgs" ? `type=all&sort=pushed&per_page=100&page=${page}` : `type=owner&sort=pushed&per_page=100&page=${page}`;
        const batch = await api<Record<string, unknown>[]>(`/${kind}/${encodeURIComponent(org)}/repos?${q}`, opts.token);
        collected.push(...batch);
        if (batch.length < 100) break;
      }
      owner = kind === "orgs" ? "org" : "user";
      break;
    } catch (e) {
      if (kind === "users" || !/\b404\b/.test((e as Error).message)) throw e;
    }
  }
  const skipped = { forks: 0, archived: 0, empty: 0, beyondMax: 0 };
  const kept: OrgRepo[] = [];
  for (const r of collected) {
    if (r.fork && !opts.includeForks) { skipped.forks++; continue; }
    if ((r.archived || r.disabled) && !opts.includeArchived) { skipped.archived++; continue; }
    if (r.size === 0) { skipped.empty++; continue; }
    kept.push({ fullName: String(r.full_name), url: String(r.html_url), private: Boolean(r.private), defaultBranch: String(r.default_branch ?? "main"), pushedAt: String(r.pushed_at ?? "") });
  }
  kept.sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : a.pushedAt > b.pushedAt ? -1 : a.fullName < b.fullName ? -1 : 1));
  skipped.beyondMax = Math.max(0, kept.length - opts.max);
  return { repos: kept.slice(0, opts.max), skipped, owner };
}
