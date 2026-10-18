import { globMatcher, resolveImport, type ParsedArtifact } from "@threadctx/adapters";
import type { Check, RuleContext } from "../types.js";
import { displayTool, isInstructional, quote } from "../util.js";

const TOOL_FILES: Record<string, (a: ParsedArtifact) => boolean> = {
  "claude-code": (a) => a.artifact.tool === "claude-code" && (a.artifact.kind === "instructions" || a.artifact.kind === "rule") && !a.untracked,
  cursor: (a) => a.artifact.tool === "cursor" && (a.artifact.kind === "rule" || a.artifact.kind === "instructions"),
  copilot: (a) => a.artifact.tool === "copilot",
  gemini: (a) => a.artifact.tool === "gemini",
};

/** Does this tool receive the root AGENTS.md (natively, via import, symlink or fallback)? */
function receivesAgentsMd(ctx: RuleContext, tool: string): boolean {
  const ctxFor = ctx.rootContexts.find((c) => c.tool === tool);
  return Boolean(ctxFor?.layers.some((l) => l.path === "AGENTS.md"));
}

export const S001: Check = {
  ruleId: "CTX-S001",
  run(ctx, report) {
    if (ctx.artifacts.some((a) => isInstructional(a))) return;
    report({ path: "", message: "No agent context file found. Agents will guess build, test and lint commands." });
  },
};

export const S002: Check = {
  ruleId: "CTX-S002",
  run(ctx, report) {
    const tools = Object.entries(TOOL_FILES)
      .map(([tool, owns]) => ({ tool, files: ctx.artifacts.filter((a) => owns(a) && !a.symlinkTarget && !a.artifact.generatedFrom) }))
      .filter((t) => t.files.length > 0);
    if (tools.length < 2) return;
    const hasAgents = Boolean(ctx.catalog.get("AGENTS.md"));
    const isolated = tools.filter((t) => !hasAgents || !receivesAgentsMd(ctx, t.tool));
    if (isolated.length === 0) return;
    const first = isolated[0]!.files[0]!;
    const names = tools.map((t) => displayTool(t.tool)).join(", ");
    const isolatedNames = isolated.map((t) => displayTool(t.tool));
    report({
      path: first.artifact.path,
      line: 1,
      message: hasAgents
        ? `${tools.length} tools have their own context files (${names}), and ${isolatedNames.join(" and ")} ${isolatedNames.length === 1 ? "does" : "do"} not read AGENTS.md. Their copies can drift apart.`
        : `${tools.length} tools have their own context files (${names}) with no shared source. Their copies can drift apart.`,
      evidence: isolated.map((t) => t.files.map((f) => f.artifact.path).join(", ")).join("; "),
      fingerprintKey: names,
      fix: hasAgents && isolated.some((t) => t.tool === "claude-code") && ctx.catalog.get("CLAUDE.md")
        ? { kind: "suggested", description: "Import AGENTS.md from CLAUDE.md so Claude Code reads the shared instructions.", edits: [{ path: "CLAUDE.md", startLine: 1, endLine: 0, replacement: "@AGENTS.md\n" }] }
        : undefined,
    });
  },
};

/** Tools whose files expand `@path` imports or references. */
function parsesImports(a: ParsedArtifact): boolean {
  if (a.artifact.tool === "copilot") return false;
  return isInstructional(a);
}

export const S003: Check = {
  ruleId: "CTX-S003",
  run(ctx, report) {
    for (const a of ctx.artifacts) {
      if (!parsesImports(a)) continue;
      for (const imp of a.imports) {
        if (!imp.certain) continue;
        const resolved = resolveImport(a.artifact.path, imp.path);
        if (!resolved) continue; // ~/ or absolute: outside the repository, cannot be checked here
        if (/(^|\/)(deps|node_modules|_build|vendor|\.venv|venv|target|dist|build)\//.test(resolved)) continue; // populated at install or build time
        if (ctx.fs.exists(resolved)) continue;
        // Cursor `@file` references may be repo-relative rather than file-relative.
        if (a.artifact.tool === "cursor" && ctx.fs.exists(imp.path)) continue;
        report({
          path: a.artifact.path,
          line: imp.line,
          message: `Import @${imp.path} points to ${resolved}, which does not exist. The agent silently loads less context.`,
          evidence: `@${imp.path}`,
        });
      }
    }
  },
};

export const S004: Check = {
  ruleId: "CTX-S004",
  run(ctx, report) {
    for (const a of ctx.artifacts) {
      const globs = a.artifact.scope.globs;
      if (!globs?.length) continue;
      const match = globMatcher(globs);
      if (ctx.fs.files.some((f) => match(f))) continue;
      const key = a.artifact.tool === "copilot" ? "applyTo" : a.artifact.tool === "cursor" ? "globs" : "paths";
      const line = (a.frontmatter?.raw ?? "").split("\n").findIndex((l) => l.trimStart().startsWith(`${key}:`));
      report({
        path: a.artifact.path,
        line: line === -1 ? 1 : line + 2,
        message: `\`${key}\` (${globs.join(", ")}) matches no files in the repository, so this rule never applies.`,
        evidence: globs.join(", "),
      });
    }
  },
};

export const S005: Check = {
  ruleId: "CTX-S005",
  run(ctx, report) {
    for (const a of ctx.artifacts) {
      const fm = a.frontmatter;
      if (!fm) continue;
      // Tools read frontmatter leniently (unquoted `globs: *.ts`, colons in descriptions), so strict
      // YAML errors alone are not reported; only files that not even a lenient reading understands.
      if (fm.error && !fm.data) {
        report({
          path: a.artifact.path,
          line: fm.error.line,
          message: `Frontmatter cannot be read: ${fm.error.message}. The tool will likely ignore its settings and apply this file with the wrong scope.`,
          evidence: quote(a.text.split("\n")[fm.error.line - 1] ?? ""),
        });
        continue;
      }
      if (a.artifact.tool === "copilot" && a.artifact.kind === "rule" && !a.artifact.scope.globs) {
        report({ path: a.artifact.path, line: 1, message: "Path-specific Copilot instructions need an `applyTo` glob in frontmatter; without it the file never applies.", evidence: a.frontmatter?.present ? "frontmatter without applyTo" : "no frontmatter" });
      }
      if (a.artifact.tool === "claude-code" && a.artifact.kind === "skill" && fm.data && typeof fm.data.description !== "string") {
        report({ path: a.artifact.path, line: 1, message: "Skill has no `description`, so Claude Code cannot decide when to use it.", evidence: "frontmatter without description" });
      }
    }
  },
};

export const S006: Check = {
  ruleId: "CTX-S006",
  run(ctx, report) {
    const legacy = ctx.catalog.get(".cursorrules");
    if (!legacy) return;
    report({ path: ".cursorrules", line: 1, message: "Legacy .cursorrules is no longer described in Cursor's docs. Move its content to .cursor/rules/*.mdc or AGENTS.md.", evidence: ".cursorrules" });
  },
};
