// Facts about the code that context files make claims about: scripts, lockfiles, runtime
// versions, dependencies. Drift rules compare directive claims against these.
import { posix } from "node:path";
import type { PackageManager } from "@threadctx/core";
import ignore from "ignore";
import type { FsView } from "@threadctx/core";

export interface PackageManifest {
  path: string;
  name?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  packageManager?: string;
  engines: Record<string, string>;
}

export interface ProjectFacts {
  manifests: PackageManifest[];
  /** Package managers implied by committed lockfiles, with the lockfile path. */
  lockfiles: { manager: PackageManager; path: string }[];
  /** `packageManager` field of the root package.json, e.g. "pnpm". */
  declaredPackageManager?: PackageManager;
  makeTargets: Set<string>;
  justRecipes: Set<string>;
  /** Runtime version constraints, e.g. node: ">=20" from engines or .nvmrc. */
  runtimes: { tool: string; constraint: string; source: string }[];
  /** All dependency names across manifests (npm, plus Python where cheaply parseable). */
  dependencyNames: Set<string>;
  /** CODEOWNERS entries in file order; `owned` is false for lines that clear ownership. */
  codeowners?: { path: string; entries: { pattern: string; owned: boolean; line: number }[] };
  readme?: { path: string; text: string };
  hasPythonProject: boolean;
  /** True when the root .gitignore ignores the path: it is intentionally absent from checkouts. */
  isIgnored: (path: string) => boolean;
}

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function strRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string>;
}

export function collectFacts(repo: FsView): ProjectFacts {
  const manifests: PackageManifest[] = [];
  const dependencyNames = new Set<string>();
  for (const f of repo.files) {
    if (posix.basename(f) !== "package.json") continue;
    const json = parseJson(repo.readFile(f));
    if (!json) continue;
    const deps = {
      ...strRecord(json.dependencies),
      ...strRecord(json.devDependencies),
      ...strRecord(json.peerDependencies),
      ...strRecord(json.optionalDependencies),
    };
    for (const d of Object.keys(deps)) dependencyNames.add(d);
    if (typeof json.name === "string") dependencyNames.add(json.name); // workspace packages
    manifests.push({
      path: f,
      name: typeof json.name === "string" ? json.name : undefined,
      scripts: strRecord(json.scripts),
      dependencies: deps,
      packageManager: typeof json.packageManager === "string" ? json.packageManager : undefined,
      engines: strRecord(json.engines),
    });
  }

  const lockfiles: ProjectFacts["lockfiles"] = [];
  for (const f of repo.files) {
    const base = posix.basename(f);
    const hit = LOCKFILES.find(([name]) => name === base);
    if (hit && !f.includes("/fixtures/") && !f.startsWith("fixtures/")) lockfiles.push({ manager: hit[1], path: f });
  }

  const root = manifests.find((m) => m.path === "package.json");
  const pmField = root?.packageManager?.split("@")[0];
  const declaredPackageManager = pmField && ["npm", "pnpm", "yarn", "bun"].includes(pmField) ? (pmField as PackageManager) : undefined;

  const makeTargets = new Set<string>();
  const justRecipes = new Set<string>();
  for (const f of repo.files) {
    const base = posix.basename(f);
    if (/^(GNUmakefile|[Mm]akefile(\.[\w.-]+)?)$/.test(base) || /\.(mk|make)$/.test(base)) {
      for (const m of (repo.readFile(f) ?? "").matchAll(/^([A-Za-z0-9_.\-/%]+(?:\s+[A-Za-z0-9_.\-/%]+)*)\s*::?(?!=)/gm)) {
        for (const t of m[1]!.split(/\s+/)) if (!t.startsWith(".")) makeTargets.add(t);
      }
      for (const m of (repo.readFile(f) ?? "").matchAll(/^\.PHONY\s*:\s*(.+)$/gm)) {
        for (const t of m[1]!.trim().split(/\s+/)) makeTargets.add(t);
      }
    }
    if (/^(\.)?justfile$/i.test(base) || base.endsWith(".just")) {
      for (const m of (repo.readFile(f) ?? "").matchAll(/^@?([A-Za-z0-9_-]+)(?:\s+[^:=\n]*)?:(?!=)/gm)) justRecipes.add(m[1]!);
    }
  }

  const runtimes: ProjectFacts["runtimes"] = [];
  for (const m of manifests) {
    if (m.path !== "package.json") continue;
    for (const [tool, constraint] of Object.entries(m.engines)) runtimes.push({ tool, constraint, source: `${m.path} engines.${tool}` });
  }
  for (const [file, tool] of [[".nvmrc", "node"], [".node-version", "node"], [".python-version", "python"], [".ruby-version", "ruby"]] as const) {
    const text = repo.readFile(file)?.trim();
    if (text) runtimes.push({ tool, constraint: text.split("\n")[0]!.replace(/^v/, ""), source: file });
  }
  const toolVersions = repo.readFile(".tool-versions");
  if (toolVersions) {
    for (const line of toolVersions.split("\n")) {
      const [tool, version] = line.trim().split(/\s+/);
      if (!tool || !version) continue;
      const name = tool === "nodejs" ? "node" : tool;
      runtimes.push({ tool: name, constraint: version, source: ".tool-versions" });
    }
  }
  const pyproject = repo.readFile("pyproject.toml");
  if (pyproject) {
    const rp = pyproject.match(/^\s*requires-python\s*=\s*["']([^"']+)["']/m);
    if (rp) runtimes.push({ tool: "python", constraint: rp[1]!, source: "pyproject.toml requires-python" });
    for (const m of pyproject.matchAll(/^\s*["']([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(?:[<>=!~;].*)?["'],?\s*$/gm)) dependencyNames.add(m[1]!.toLowerCase());
  }
  for (const f of repo.files) {
    if (!/(^|\/)requirements[^/]*\.txt$/.test(f)) continue;
    for (const line of (repo.readFile(f) ?? "").split("\n")) {
      const m = line.trim().match(/^([A-Za-z0-9_.\-]+)/);
      if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) dependencyNames.add(m[1]!.toLowerCase());
    }
  }

  let codeowners: ProjectFacts["codeowners"];
  for (const p of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"]) {
    const text = repo.readFile(p);
    if (text !== undefined) {
      const entries = text.split("\n").flatMap((raw, i) => {
        const parts = raw.replace(/(^|\s)#.*$/, "").trim().split(/\s+/).filter(Boolean);
        return parts.length ? [{ pattern: parts[0]!, owned: parts.length > 1, line: i + 1 }] : [];
      });
      codeowners = { path: p, entries };
      break;
    }
  }

  const readmePath = repo.files.find((f) => /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(f));
  const readmeText = readmePath ? repo.readFile(readmePath) : undefined;

  return {
    manifests,
    lockfiles,
    declaredPackageManager,
    makeTargets,
    justRecipes,
    runtimes,
    dependencyNames,
    codeowners,
    readme: readmePath && readmeText !== undefined ? { path: readmePath, text: readmeText } : undefined,
    hasPythonProject: Boolean(pyproject) || repo.files.some((f) => /(^|\/)(setup\.py|requirements[^/]*\.txt)$/.test(f)),
    isIgnored: gitignoreMatcher(repo),
  };
}

function gitignoreMatcher(repo: FsView): (path: string) => boolean {
  const text = repo.readFile(".gitignore");
  if (!text) return () => false;
  const ig = ignore().add(text);
  return (path: string) => {
    const p = path.replace(/^\.\//, "").replace(/\/$/, "");
    if (!p || p.startsWith("..")) return false;
    try {
      return ig.ignores(p) || ig.ignores(`${p}/`);
    } catch {
      return false;
    }
  };
}
