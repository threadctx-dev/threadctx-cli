import type { FsView } from "@threadctx/core";
import { normalizeRel } from "@threadctx/discovery";
import { expandImports, parseArtifact, type ArtifactSpec, type ParsedArtifact } from "./common.js";
import { ADAPTERS } from "./registry.js";
import type { Catalog } from "./types.js";

const VENDORED = /(^|\/)(vendor|third_party|thirdparty|third-party|node_modules|bower_components|external|deps|\.venv|venv|site-packages|Pods|Carthage)\//;

/** Every context artifact in a repository, each file owned by exactly one adapter. */
export function buildCatalog(fs: FsView): Catalog {
  const specs = new Map<string, ArtifactSpec>();
  for (const adapter of ADAPTERS) {
    for (const spec of adapter.discover(fs)) {
      if (VENDORED.test(spec.path)) continue; // third-party trees are not this repository's context
      if (!specs.has(spec.path)) specs.set(spec.path, spec);
    }
  }
  const byPath = new Map<string, ParsedArtifact>();
  for (const spec of [...specs.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const parsed = parseArtifact(fs, spec);
    if (parsed) byPath.set(spec.path, parsed);
  }
  const get = (path: string): ParsedArtifact | undefined => {
    const rel = normalizeRel(path);
    const hit = byPath.get(rel);
    if (hit) return hit;
    if (!fs.exists(rel) || !/\.(md|mdc|txt|markdown)$/i.test(rel)) return undefined;
    // An imported file becomes part of the context supply chain: parse and keep it.
    const parsed = parseArtifact(fs, { tool: "neutral", path: rel, kind: "instructions", frontmatter: false, origin: "repo" });
    if (parsed) byPath.set(rel, parsed);
    return parsed;
  };
  // Pull every imported file into the catalog so security and drift rules see it too.
  for (const a of [...byPath.values()]) {
    if (a.artifact.kind === "instructions" || a.artifact.kind === "rule") expandImports(fs, a, get, 5);
  }
  return {
    fs,
    get artifacts() {
      return [...byPath.values()].sort((a, b) => (a.artifact.path < b.artifact.path ? -1 : 1));
    },
    get,
  };
}
