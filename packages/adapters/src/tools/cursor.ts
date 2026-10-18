import type { FsView } from "@threadctx/core";
import { estimateTokens } from "@threadctx/core";
import {
  dirChain, globList, join, LayerBuilder, resolveImport, targetDir, targetMatches,
  type ArtifactSpec, type Target,
} from "../common.js";
import type { Catalog, ToolAdapter } from "../types.js";

export type CursorRuleType = "always" | "auto-attached" | "agent-requested" | "manual";

/** Rule type from frontmatter, per the type table in Cursor's rules docs (checked 2026-10-03). */
export function cursorRuleType(data: Record<string, unknown> | undefined): CursorRuleType {
  if (data?.alwaysApply === true) return "always";
  if (globList(data?.globs).length > 0) return "auto-attached";
  if (typeof data?.description === "string" && data.description.trim()) return "agent-requested";
  return "manual";
}

export const cursor: ToolAdapter = {
  id: "cursor",
  label: "Cursor",
  status: "beta",
  verifiedAgainst: { docsUrl: "https://cursor.com/docs/context/rules", date: "2026-10-03" },
  summary: "Project rules in .cursor/rules (.mdc with description, globs, alwaysApply), plus AGENTS.md at the root and in subdirectories.",
  caveats: [
    "Team rules and user rules live in Cursor's settings, not the repository, and are not shown.",
    "Legacy .cursorrules is no longer described in Cursor's docs; it is shown as legacy and may not load.",
    "Glob patterns without a slash are matched against the file name anywhere in the tree.",
  ],
  discover(fs: FsView): ArtifactSpec[] {
    const specs: ArtifactSpec[] = [];
    for (const f of fs.files) {
      if (/^\.cursor\/rules\/.+\.(mdc|md)$/.test(f)) {
        specs.push({
          tool: "cursor", path: f, kind: "rule", frontmatter: true,
          scope: (fm) => {
            const type = cursorRuleType(fm?.data);
            const globs = globList(fm?.data?.globs);
            return { directory: "", globs: globs.length ? globs : undefined, alwaysApply: type === "always" };
          },
          ext: (fm) => ({ cursor: { type: cursorRuleType(fm?.data), description: fm?.data?.description } }),
        });
      } else if (f === ".cursorrules") {
        specs.push({ tool: "cursor", path: f, kind: "instructions", frontmatter: false, ext: () => ({ cursor: { legacy: true } }) });
      }
    }
    return specs;
  },
  resolve(target: Target, catalog: Catalog) {
    const b = new LayerBuilder();
    const fs = catalog.fs;
    const legacy = catalog.get(".cursorrules");
    if (legacy) b.add(legacy, "always", "legacy .cursorrules (deprecated, may not load)");
    const root = catalog.get("AGENTS.md");
    if (root) b.add(root, "always", "root AGENTS.md");
    const rules = catalog.artifacts.filter((a) => a.artifact.tool === "cursor" && a.artifact.kind === "rule");
    for (const r of rules) {
      const type = cursorRuleType(r.frontmatter?.data);
      if (type === "always") b.add(r, "always", "alwaysApply: true");
      else if (type === "auto-attached" && targetMatches(fs, target, r.artifact.scope.globs ?? [])) {
        b.add(r, "conditional", `globs match (${(r.artifact.scope.globs ?? []).join(", ")})`);
      } else if (type === "agent-requested") {
        b.add(r, "agent-decides", "description only; agent decides whether to apply", estimateTokens(String(r.frontmatter?.data?.description ?? "")));
      }
      if (b.has(r.artifact.path) && (type === "always" || type === "auto-attached")) {
        // `@file` references inside an applied rule pull those files into context.
        for (const imp of r.imports) {
          const p = resolveImport(r.artifact.path, imp.path) ?? imp.path;
          const ref = fs.exists(p) ? catalog.get(p) : catalog.get(imp.path);
          if (ref) b.add(ref, "conditional", `referenced by ${r.artifact.path}`);
        }
      }
    }
    for (const dir of dirChain(targetDir(target)).slice(1)) {
      const nested = catalog.get(join(dir, "AGENTS.md"));
      if (nested) b.add(nested, "conditional", `nested AGENTS.md for ${dir}/ (more specific wins)`);
    }
    b.notes.push(cursor.caveats[0]!);
    return b.build("cursor", target, new Map(catalog.artifacts.map((a) => [a.artifact.path, a])));
  },
};
