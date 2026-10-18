import type { FsView } from "@threadctx/core";
import { dirChain, globList, join, LayerBuilder, targetDir, targetMatches, type ArtifactSpec, type Target } from "../common.js";
import type { Catalog, ToolAdapter } from "../types.js";

export type CopilotSurface = "cloud-agent" | "code-review" | "chat";

/** GitHub Copilot. Which files load depends on the surface; the default view is the cloud agent. */
export function resolveCopilot(target: Target, catalog: Catalog, surface: CopilotSurface = "cloud-agent") {
  const b = new LayerBuilder();
  const fs = catalog.fs;
  const repoWide = catalog.get(".github/copilot-instructions.md");
  if (repoWide) b.add(repoWide, "always", "repository-wide instructions");
  if (surface !== "chat") {
    for (const r of catalog.artifacts.filter((a) => a.artifact.tool === "copilot" && a.artifact.kind === "rule")) {
      const excluded = globList(r.frontmatter?.data?.excludeAgent);
      const surfaceNames = surface === "cloud-agent" ? ["cloud-agent", "coding-agent"] : ["code-review"];
      if (excluded.some((e) => surfaceNames.includes(e))) continue;
      const globs = r.artifact.scope.globs ?? [];
      if (globs.length && targetMatches(fs, target, globs)) b.add(r, "conditional", `applyTo matches (${globs.join(", ")})`);
    }
  }
  if (surface === "cloud-agent") {
    for (const dir of dirChain(targetDir(target))) {
      const a = catalog.get(join(dir, "AGENTS.md"));
      if (a) b.add(a, dir ? "conditional" : "always", dir ? `nested AGENTS.md for ${dir}/ (nearest takes precedence)` : "root AGENTS.md");
    }
    for (const p of ["CLAUDE.md", "GEMINI.md"]) {
      const a = catalog.get(p);
      if (a) b.add(a, "always", `root ${p} (cloud agent reads agent instruction files)`);
    }
  }
  b.notes.push(`Surface: ${surface}. ${copilot.caveats[0]}`);
  return b.build("copilot", target, new Map(catalog.artifacts.map((a) => [a.artifact.path, a])));
}

export const copilot: ToolAdapter = {
  id: "copilot",
  label: "GitHub Copilot",
  status: "beta",
  verifiedAgainst: { docsUrl: "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions", date: "2026-10-03" },
  summary: ".github/copilot-instructions.md, path-specific .github/instructions/*.instructions.md (applyTo, excludeAgent), and AGENTS.md / CLAUDE.md / GEMINI.md for the cloud agent.",
  caveats: [
    "Copilot surfaces differ: path-specific files load for the cloud agent and code review; AGENTS.md, CLAUDE.md and GEMINI.md only for the cloud agent. Personal and organization instructions are not in the repository.",
    "IDE behaviour (VS Code) is documented separately and may load more.",
  ],
  discover(fs: FsView): ArtifactSpec[] {
    const specs: ArtifactSpec[] = [];
    for (const f of fs.files) {
      if (f === ".github/copilot-instructions.md") specs.push({ tool: "copilot", path: f, kind: "instructions", frontmatter: false });
      else if (/^\.github\/instructions\/.+\.instructions\.md$/.test(f)) {
        specs.push({
          tool: "copilot", path: f, kind: "rule", frontmatter: true,
          scope: (fm) => {
            const globs = globList(fm?.data?.applyTo);
            return { directory: "", globs: globs.length ? globs : undefined, alwaysApply: false };
          },
        });
      }
    }
    return specs;
  },
  resolve: (target, catalog) => resolveCopilot(target, catalog, "cloud-agent"),
};
