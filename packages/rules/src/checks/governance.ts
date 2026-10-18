import ignore from "ignore";
import type { Check } from "../types.js";

/** CODEOWNERS semantics: gitignore-style patterns, last matching line wins. */
export function codeownersCovers(entries: { pattern: string; owned: boolean }[], path: string): boolean {
  let owned = false;
  for (const e of entries) {
    const ig = ignore().add(e.pattern);
    if (ig.ignores(path)) owned = e.owned;
  }
  return owned;
}

export const G001: Check = {
  ruleId: "CTX-G001",
  run(ctx, report) {
    const co = ctx.facts.codeowners;
    if (!co) return; // repositories without CODEOWNERS are not using ownership review at all
    const uncovered = ctx.artifacts.filter((a) => !a.untracked && a.artifact.origin === "repo" && !codeownersCovers(co.entries, a.artifact.path));
    if (uncovered.length === 0) return;
    const paths = uncovered.map((a) => a.artifact.path);
    report({
      path: co.path,
      line: 1,
      message: `${paths.length} agent context file${paths.length === 1 ? " is" : "s are"} not covered by ${co.path}: ${paths.slice(0, 5).join(", ")}${paths.length > 5 ? `, and ${paths.length - 5} more` : ""}. Anyone with write access can change what agents are told without an owner's review.`,
      evidence: paths.slice(0, 5).join(", "),
      fingerprintKey: paths.join("|"),
      fix: { kind: "suggested", description: `Add owners for agent context files in ${co.path}`, edits: [{ path: co.path, startLine: (ctx.fs.readFile(co.path) ?? "").split("\n").length + 1, endLine: (ctx.fs.readFile(co.path) ?? "").split("\n").length, replacement: "\n# Agent context: what AI coding agents are told\n/AGENTS.md @your-team\n**/AGENTS.md @your-team\n**/CLAUDE.md @your-team\n/.claude/ @your-team\n/.cursor/ @your-team\n/.github/copilot-instructions.md @your-team\n/.github/instructions/ @your-team\n" }] },
    });
  },
};
