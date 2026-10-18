import type { FsView } from "@threadctx/core";
import { estimateTokens } from "@threadctx/core";
import {
  dirChain, expandImports, globList, join, LayerBuilder, ownerDir, targetDir, targetMatches,
  type ArtifactSpec, type ParsedArtifact, type Target,
} from "../common.js";
import type { Catalog, ToolAdapter } from "../types.js";

/** Claude Code: CLAUDE.md hierarchy, imports, .claude/rules, skills, subagents (docs checked 2026-10-03). */
export const MAX_IMPORT_HOPS = 4;
const CLAUDE_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

export const claudeCode: ToolAdapter = {
  id: "claude-code",
  label: "Claude Code",
  // GA: startup loading verified by fixtures/oracle/claude-code (Claude Code 2.1.144, 2026-10-03).
  status: "ga",
  verifiedAgainst: { docsUrl: "https://code.claude.com/docs/en/memory", date: "2026-10-03", toolVersion: "2.1.144" },
  summary: "CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md from the working directory up, subdirectory files on demand, @imports (4 hops), .claude/rules with `paths`, and AGENTS.md when no CLAUDE.md exists.",
  caveats: [
    "Assumes Claude Code is started at the repository root with the default `claude-md-or-agents-md` project-instructions setting.",
    "Reading AGENTS.md directly requires Claude Code v2.1.277 or later; earlier versions read CLAUDE.md only. The AGENTS.md fallback is modelled from the docs and not yet oracle-verified.",
    "User (~/.claude) and managed-policy files are outside the repository and are not shown unless --machine is used.",
  ],
  discover(fs: FsView): ArtifactSpec[] {
    const specs: ArtifactSpec[] = [];
    for (const f of fs.files) {
      if (/(^|\/)(\.claude\/)?CLAUDE(\.local)?\.md$/.test(f)) {
        specs.push({ tool: "claude-code", path: f, kind: "instructions", frontmatter: false, stripComments: true });
      } else if (/(^|\/)\.claude\/AGENTS\.md$/.test(f)) {
        specs.push({ tool: "claude-code", path: f, kind: "instructions", frontmatter: false, stripComments: true });
      } else if (/(^|\/)\.claude\/rules\/.+\.md$/.test(f)) {
        specs.push({
          tool: "claude-code", path: f, kind: "rule", frontmatter: true, stripComments: true,
          scope: (fm) => {
            const globs = globList(fm?.data?.paths);
            return { directory: ownerDir(f), globs: globs.length ? globs : undefined, alwaysApply: globs.length === 0 };
          },
        });
      } else if (/(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f)) {
        specs.push({ tool: "claude-code", path: f, kind: "skill", frontmatter: true, ext: (fm) => ({ "claude-code": { name: fm?.data?.name, description: fm?.data?.description } }) });
      } else if (/(^|\/)\.claude\/agents\/.+\.md$/.test(f)) {
        specs.push({ tool: "claude-code", path: f, kind: "subagent", frontmatter: true });
      } else if (/(^|\/)\.claude\/commands\/.+\.md$/.test(f)) {
        specs.push({ tool: "claude-code", path: f, kind: "command", frontmatter: true });
      }
    }
    // CLAUDE.local.md is usually gitignored, so it is not in the listing; read it directly.
    if (!fs.files.includes("CLAUDE.local.md") && fs.readFile("CLAUDE.local.md") !== undefined) {
      specs.push({ tool: "claude-code", path: "CLAUDE.local.md", kind: "instructions", frontmatter: false, stripComments: true, origin: "user", untracked: true });
    }
    return specs;
  },
  resolve(target: Target, catalog: Catalog) {
    const b = new LayerBuilder();
    const fs = catalog.fs;
    const addWithImports = (a: ParsedArtifact, loading: "always" | "on-demand", reason: string) => {
      b.add(a, loading, reason);
      for (const imp of expandImports(fs, a, (p) => catalog.get(p), MAX_IMPORT_HOPS)) {
        b.add(imp.artifact, loading, `imported by ${imp.via} (${imp.hops} hop${imp.hops > 1 ? "s" : ""})`);
      }
    };
    const rootClaude = CLAUDE_FILES.map((f) => catalog.get(f)).filter((a): a is ParsedArtifact => Boolean(a));
    const agentsFallback = rootClaude.length === 0;

    for (const a of rootClaude) addWithImports(a, "always", "project instructions at launch");
    if (agentsFallback) {
      for (const p of ["AGENTS.md", ".claude/AGENTS.md"]) {
        const a = catalog.get(p);
        if (a) addWithImports(a, "always", "AGENTS.md read because no CLAUDE.md exists (v2.1.277+)");
      }
    }

    // .claude/rules at the root: unconditional rules at launch, path-scoped rules on matching files.
    const rules = catalog.artifacts.filter((a) => a.artifact.kind === "rule" && a.artifact.tool === "claude-code");
    for (const r of rules) {
      const owner = r.artifact.scope.directory ?? "";
      if (owner !== "") continue;
      const globs = r.artifact.scope.globs;
      if (!globs) b.add(r, "always", "rule without `paths`");
      else if (targetMatches(fs, target, globs)) b.add(r, "conditional", `rule paths match (${globs.join(", ")})`);
    }

    // Subdirectories between the root and the target load on demand.
    for (const dir of dirChain(targetDir(target)).slice(1)) {
      const local = CLAUDE_FILES.map((f) => catalog.get(join(dir, f))).filter((a): a is ParsedArtifact => Boolean(a));
      for (const a of local) addWithImports(a, "on-demand", `subdirectory instructions for ${dir}/`);
      if (local.length === 0 && agentsFallback) {
        const a = catalog.get(join(dir, "AGENTS.md"));
        if (a) addWithImports(a, "on-demand", `subdirectory AGENTS.md for ${dir}/ (no CLAUDE.md there)`);
      }
      for (const r of rules.filter((x) => (x.artifact.scope.directory ?? "") === dir)) {
        const globs = r.artifact.scope.globs;
        if (!globs) b.add(r, "on-demand", `nested rule in ${dir}/.claude/rules`);
        else if (targetMatches(fs, target, globs)) b.add(r, "conditional", `nested rule paths match (${globs.join(", ")})`);
      }
    }

    // Skills: only name and description are in context until invoked.
    for (const s of catalog.artifacts.filter((a) => a.artifact.kind === "skill" && a.artifact.tool === "claude-code")) {
      const meta = (s.artifact.ext["claude-code"] ?? {}) as { name?: unknown; description?: unknown };
      const desc = `${typeof meta.name === "string" ? meta.name : ""} ${typeof meta.description === "string" ? meta.description : ""}`;
      b.add(s, "agent-decides", "skill metadata (body loads when invoked)", estimateTokens(desc.trim()));
    }

    b.notes.push(claudeCode.caveats[0]!, claudeCode.caveats[1]!);
    if (agentsFallback && catalog.get("AGENTS.md")) b.notes.push("No CLAUDE.md: Claude Code falls back to AGENTS.md.");
    return b.build("claude-code", target, new Map(catalog.artifacts.map((a) => [a.artifact.path, a])));
  },
};
