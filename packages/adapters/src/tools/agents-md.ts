import type { FsView } from "@threadctx/core";
import { dirChain, join, LayerBuilder, targetDir, type ArtifactSpec, type Target } from "../common.js";
import type { Catalog, ToolAdapter } from "../types.js";

/** Neutral AGENTS.md (agents.md, stewarded by the Agentic AI Foundation). Read by Codex, Jules, Aider and others. */
export const agentsMd: ToolAdapter = {
  id: "agents-md",
  label: "AGENTS.md (Codex and other AGENTS.md readers)",
  status: "beta",
  verifiedAgainst: { docsUrl: "https://agents.md/", date: "2026-10-03" },
  summary: "AGENTS.md at the repo root and in subdirectories; the closest file to the edited file takes precedence.",
  caveats: [
    "Each AGENTS.md reader decides how nested files combine; this view loads every AGENTS.md from the root down, nearest last (highest precedence).",
    "Codex-specific AGENTS.override.md replaces AGENTS.md in the same directory.",
  ],
  discover(fs: FsView): ArtifactSpec[] {
    return fs.files
      .filter((f) => /(^|\/)AGENTS(\.override)?\.md$/.test(f) && !f.includes("/.claude/") && !f.startsWith(".claude/"))
      .map((path) => ({ tool: "neutral", path, kind: "instructions", frontmatter: false }));
  },
  resolve(target: Target, catalog: Catalog) {
    const b = new LayerBuilder();
    for (const dir of dirChain(targetDir(target))) {
      const override = catalog.get(join(dir, "AGENTS.override.md"));
      const file = override ?? catalog.get(join(dir, "AGENTS.md"));
      if (!file) continue;
      const reason = dir ? `nested AGENTS.md for ${dir}/` : "repository root AGENTS.md";
      b.add(file, dir ? "conditional" : "always", override ? `${reason} (override)` : reason);
    }
    b.notes.push(...agentsMd.caveats);
    return b.build("agents-md", target, new Map(catalog.artifacts.map((a) => [a.artifact.path, a])));
  },
};
