import type { FsView } from "@threadctx/core";
import { stripJsonc } from "@threadctx/discovery";
import { dirChain, expandImports, join, LayerBuilder, targetDir, type ArtifactSpec, type ParsedArtifact, type Target } from "../common.js";
import type { Catalog, ToolAdapter } from "../types.js";

export const GEMINI_MAX_IMPORT_HOPS = 5;

/** Context file names from .gemini/settings.json `context.fileName`, default GEMINI.md. */
export function geminiFileNames(fs: FsView): string[] {
  const raw = fs.readFile(".gemini/settings.json");
  if (raw) {
    try {
      const json = JSON.parse(stripJsonc(raw)) as { context?: { fileName?: unknown } };
      const v = json.context?.fileName;
      const names = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x.length > 0);
      if (names.length) return names;
    } catch {
      /* invalid settings: Gemini CLI would report it; fall back to the default */
    }
  }
  return ["GEMINI.md"];
}

export const gemini: ToolAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  status: "beta",
  verifiedAgainst: { docsUrl: "https://geminicli.com/docs/cli/gemini-md/", date: "2026-10-03" },
  summary: "GEMINI.md (or names from context.fileName) at the root and ancestors at start, subdirectory files just in time, all concatenated; @imports supported.",
  caveats: [
    "Global ~/.gemini/GEMINI.md is outside the repository and not shown unless --machine is used.",
    "The docs do not state an import depth limit; this view stops after 5 hops.",
  ],
  discover(fs: FsView): ArtifactSpec[] {
    const names = geminiFileNames(fs).filter((n) => n !== "AGENTS.md");
    return fs.files
      .filter((f) => names.includes(f.split("/").pop()!))
      .map((path) => ({ tool: "gemini", path, kind: "instructions", frontmatter: false }));
  },
  resolve(target: Target, catalog: Catalog) {
    const b = new LayerBuilder();
    const names = geminiFileNames(catalog.fs);
    for (const dir of dirChain(targetDir(target))) {
      for (const name of names) {
        const a = catalog.get(join(dir, name));
        if (!a) continue;
        const loading = dir ? "on-demand" : "always";
        b.add(a, loading, dir ? `just-in-time context for ${dir}/` : "workspace context file");
        for (const imp of expandImports(catalog.fs, a, (p) => catalog.get(p), GEMINI_MAX_IMPORT_HOPS)) {
          b.add(imp.artifact as ParsedArtifact, loading, `imported by ${imp.via}`);
        }
      }
    }
    if (names.join() !== "GEMINI.md") b.notes.push(`context.fileName: ${names.join(", ")}`);
    return b.build("gemini", target, new Map(catalog.artifacts.map((a) => [a.artifact.path, a])));
  },
};
