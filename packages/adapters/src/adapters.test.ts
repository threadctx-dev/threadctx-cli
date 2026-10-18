import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { ADAPTERS, buildCatalog, getAdapter, resolveCopilot, splitCommaGlobs, type Target } from "./index.js";

const file = (path: string): Target => ({ path, isDir: false });
const layers = (tool: string, target: Target, repo: ReturnType<typeof memoryRepo>) =>
  getAdapter(tool)!.resolve(target, buildCatalog(repo)).layers.map((l) => [l.path, l.loading]);

const multi = memoryRepo({
  "AGENTS.md": "# Agents\n- Test: `pnpm test`\n",
  "CLAUDE.md": "<!-- maintainer note -->\n@AGENTS.md\n\n- Claude only\n",
  "docs/testing.md": "Use `pnpm test`.\n@deep/one.md\n",
  "src/payments/AGENTS.md": "- Payments: `pnpm test:payments`\n",
  "src/payments/CLAUDE.md": "@../../docs/testing.md\n",
  "src/payments/refund.ts": "",
  "src/ui/button.tsx": "",
  ".claude/rules/api.md": "---\npaths:\n  - \"src/payments/**/*.ts\"\n---\n- Validate input\n",
  ".claude/rules/general.md": "- Be terse\n",
  ".claude/skills/release/SKILL.md": "---\nname: release\ndescription: Cut a release\n---\nSteps...\n",
  ".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\n- Use pnpm\n",
  ".cursor/rules/tsx.mdc": "---\nglobs: \"*.tsx\"\nalwaysApply: false\n---\n- React rules @docs/testing.md\n",
  ".cursor/rules/agent.mdc": "---\ndescription: Database migrations\n---\n- Migrations...\n",
  ".cursor/rules/manual.mdc": "---\nalwaysApply: false\n---\n- Manual only\n",
  ".github/copilot-instructions.md": "- Copilot\n",
  ".github/instructions/ts.instructions.md": "---\napplyTo: \"**/*.ts,**/*.tsx\"\n---\n- TS\n",
  ".github/instructions/review.instructions.md": "---\napplyTo: \"**\"\nexcludeAgent: \"cloud-agent\"\n---\n- Review only\n",
  "GEMINI.md": "- Gemini\n",
  "src/GEMINI.md": "- Gemini src\n",
});

describe("catalog", () => {
  it("assigns each file to one owner and pulls in imported files", () => {
    const cat = buildCatalog(multi);
    const paths = cat.artifacts.map((a) => [a.artifact.path, a.artifact.tool, a.artifact.kind]);
    expect(paths).toContainEqual(["AGENTS.md", "neutral", "instructions"]);
    expect(paths).toContainEqual(["docs/testing.md", "neutral", "instructions"]);
    expect(paths).toContainEqual([".claude/skills/release/SKILL.md", "claude-code", "skill"]);
    expect(paths).toContainEqual([".github/instructions/ts.instructions.md", "copilot", "rule"]);
    expect(paths.filter(([p]) => p === "AGENTS.md")).toHaveLength(1);
  });
  it("strips HTML comments from Claude Code token estimates", () => {
    const claude = buildCatalog(multi).get("CLAUDE.md")!;
    expect(claude.loadedText).not.toContain("maintainer");
  });
});

describe("claude-code", () => {
  it("loads root CLAUDE.md with imports, rules, subdirectory files on demand and skill metadata", () => {
    expect(layers("claude-code", file("src/payments/refund.ts"), multi)).toEqual([
      ["CLAUDE.md", "always"],
      ["AGENTS.md", "always"],
      [".claude/rules/api.md", "conditional"],
      [".claude/rules/general.md", "always"],
      ["src/payments/CLAUDE.md", "on-demand"],
      ["docs/testing.md", "on-demand"],
      [".claude/skills/release/SKILL.md", "agent-decides"],
    ]);
  });
  it("does not apply path-scoped rules to other files", () => {
    expect(layers("claude-code", file("src/ui/button.tsx"), multi).map(([p]) => p)).not.toContain(".claude/rules/api.md");
  });
  it("falls back to AGENTS.md only when no CLAUDE.md exists", () => {
    const repo = memoryRepo({ "AGENTS.md": "x", "pkg/AGENTS.md": "y", "pkg/a.ts": "" });
    expect(layers("claude-code", file("pkg/a.ts"), repo)).toEqual([["AGENTS.md", "always"], ["pkg/AGENTS.md", "on-demand"]]);
  });
  it("stops imports after four hops and survives cycles", () => {
    const repo = memoryRepo({
      "CLAUDE.md": "@a.md", "a.md": "@b.md", "b.md": "@c.md", "c.md": "@d.md", "d.md": "@e.md", "e.md": "@CLAUDE.md",
    });
    expect(layers("claude-code", file("x.ts"), repo).map(([p]) => p)).toEqual(["CLAUDE.md", "a.md", "b.md", "c.md", "d.md"]);
  });
});

describe("cursor", () => {
  it("applies always and glob rules, lists agent-requested by description and skips manual rules", () => {
    expect(layers("cursor", file("src/ui/button.tsx"), multi)).toEqual([
      ["AGENTS.md", "always"],
      [".cursor/rules/agent.mdc", "agent-decides"],
      [".cursor/rules/always.mdc", "always"],
      [".cursor/rules/tsx.mdc", "conditional"],
      ["docs/testing.md", "conditional"],
    ]);
  });
  it("splits comma globs but keeps brace groups", () => {
    expect(splitCommaGlobs("src/*.{ts,tsx}, docs/**")).toEqual(["src/*.{ts,tsx}", " docs/**"]);
  });
});

describe("copilot", () => {
  it("cloud agent: repo-wide, path-specific minus excluded, AGENTS.md nearest last, root CLAUDE.md and GEMINI.md", () => {
    expect(layers("copilot", file("src/payments/refund.ts"), multi)).toEqual([
      [".github/copilot-instructions.md", "always"],
      [".github/instructions/ts.instructions.md", "conditional"],
      ["AGENTS.md", "always"],
      ["src/payments/AGENTS.md", "conditional"],
      ["CLAUDE.md", "always"],
      ["GEMINI.md", "always"],
    ]);
  });
  it("code review includes review-only instructions and no agent files", () => {
    const ctx = resolveCopilot(file("src/payments/refund.ts"), buildCatalog(multi), "code-review");
    expect(ctx.layers.map((l) => l.path)).toEqual([
      ".github/copilot-instructions.md", ".github/instructions/review.instructions.md", ".github/instructions/ts.instructions.md",
    ]);
  });
});

describe("gemini", () => {
  it("loads root and just-in-time subdirectory files", () => {
    expect(layers("gemini", file("src/payments/refund.ts"), multi)).toEqual([["GEMINI.md", "always"], ["src/GEMINI.md", "on-demand"]]);
  });
  it("honours context.fileName", () => {
    const repo = memoryRepo({ ".gemini/settings.json": '{"context":{"fileName":["AGENTS.md"]}}', "AGENTS.md": "x", "GEMINI.md": "ignored" });
    expect(layers("gemini", file("a.ts"), repo)).toEqual([["AGENTS.md", "always"]]);
  });
});

describe("registry", () => {
  it("every adapter has a dated verification and a docs URL", () => {
    for (const a of ADAPTERS) {
      expect(a.verifiedAgainst.docsUrl).toMatch(/^https:\/\//);
      expect(Number.isNaN(Date.parse(a.verifiedAgainst.date))).toBe(false);
    }
  });
  it("effective context is deterministic", () => {
    const a = getAdapter("claude-code")!.resolve(file("src/payments/refund.ts"), buildCatalog(multi));
    const b = getAdapter("claude-code")!.resolve(file("src/payments/refund.ts"), buildCatalog(multi));
    expect(a.hash).toBe(b.hash);
    expect(a.tokenEstimate).toBeGreaterThan(0);
  });
});
