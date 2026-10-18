import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { scan } from "./engine.js";
import { fleetTrend, summarizeFleet, type AuditRepo } from "./audit.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const repo = (name: string, files: Record<string, string>): AuditRepo => ({ fullName: `acme/${name}`, url: `https://github.com/acme/${name}`, result: scan(memoryRepo(files), { now: NOW }) });
const pm = (name: string, manager: "pnpm" | "npm" | "yarn", extra: Record<string, string> = {}) =>
  repo(name, { "package.json": JSON.stringify({ scripts: { test: "vitest" } }), [manager === "pnpm" ? "pnpm-lock.yaml" : manager === "npm" ? "package-lock.json" : "yarn.lock"]: "", "AGENTS.md": `- Install: \`${manager} install\`\n- Test: \`${manager} test\`\n`, ...extra });

const META = { org: "acme", generatedAt: "2026-10-05T12:00:00Z", engine: { version: "0.2.0", registry: "2026.10.1" } };

describe("summarizeFleet", () => {
  const fleet = summarizeFleet([
    pm("a", "pnpm"), pm("b", "pnpm"), pm("c", "pnpm"), pm("d", "npm"),
    repo("noctx", { "src/x.ts": "" }),
    repo("messy", { "package.json": "{}", "pnpm-lock.yaml": "", "AGENTS.md": "- `npm install`\n- Hidden‮text\n", "CLAUDE.md": "- yarn add things\n" }),
    { fullName: "acme/empty", url: "u", error: "repository is empty" },
  ], META);

  it("counts repositories by outcome", () => {
    expect(fleet.repos).toEqual({ listed: 7, scanned: 6, withContext: 5, withoutContext: 1, failed: 1 });
    expect(fleet.failures).toEqual([{ repo: "acme/empty", error: "repository is empty" }]);
    expect(fleet.noContext.map((r) => r.repo)).toEqual(["acme/noctx"]);
  });

  it("orders the table worst first and grades the fleet by mean score", () => {
    expect(fleet.repoTable[0]!.repo).toBe("acme/messy");
    expect(fleet.fleet.score).toBe(Math.round(fleet.repoTable.reduce((n, r) => n + r.score, 0) / fleet.repoTable.length));
    expect(fleet.fleet.toolsUsed["agents-md"]).toBe(5);
  });

  it("finds inconsistent conventions across repositories with the majority and outliers", () => {
    const pkg = fleet.inconsistencies.find((i) => i.key === "actual.pkg.manager")!;
    expect(pkg.majority).toMatchObject({ value: "pnpm" });
    expect(pkg.outliers.map((o) => o.repo)).toContain("acme/d");
  });

  it("compares runners only within one language ecosystem", () => {
    const js = (name: string, runner: string) => repo(name, { "package.json": JSON.stringify({ scripts: { test: runner } }), "AGENTS.md": "- Test: `pnpm test`\n" });
    const py = (name: string) => repo(name, { "pyproject.toml": "", "AGENTS.md": "- Test: `uv run pytest`\n" });
    const mixed = summarizeFleet([js("a", "vitest run"), js("b", "vitest run"), js("c", "vitest run"), py("d"), py("e"), py("f")], META);
    expect(mixed.inconsistencies.filter((i) => i.key.startsWith("cmd.test.runner"))).toEqual([]);
    const jsOnly = summarizeFleet([js("a", "vitest run"), js("b", "vitest run"), js("c", "jest")], META);
    const t = jsOnly.inconsistencies.find((i) => i.key === "cmd.test.runner@js")!;
    expect(t.label).toBe("Test runner (js)");
    expect(t.outliers.map((o) => o.repo)).toEqual(["acme/c"]);
  });

  it("surfaces security findings and ranks the plan by gain per effort", () => {
    expect(fleet.security.map((s) => s.ruleId)).toContain("CTX-X001");
    expect(fleet.plan[0]!.priority).toBeGreaterThanOrEqual(fleet.plan[fleet.plan.length - 1]!.priority);
    const x001 = fleet.plan.find((p) => p.ruleId === "CTX-X001")!;
    expect(x001.effort).toBe("automatic");
    expect(x001.action).toContain("threadctx fix");
  });

  it("is deterministic", () => {
    const again = summarizeFleet([pm("a", "pnpm"), pm("b", "pnpm"), pm("c", "pnpm"), pm("d", "npm")], META);
    expect(JSON.stringify(again)).toBe(JSON.stringify(summarizeFleet([pm("a", "pnpm"), pm("b", "pnpm"), pm("c", "pnpm"), pm("d", "npm")], META)));
  });

  it("estimates waste only from duplicated or boilerplate text, capped by always-loaded size", () => {
    const dup = "- Always run the full test suite before opening a pull request please.\n";
    const w = summarizeFleet([repo("dup", { "AGENTS.md": dup.repeat(1), "CLAUDE.md": dup, "package.json": "{}" })], META);
    expect(w.waste.totalTokens).toBeGreaterThan(0);
    expect(w.waste.totalTokens).toBeLessThanOrEqual(w.repoTable[0]!.alwaysTokens);
  });

  it("computes the trend between two audits", () => {
    const before = summarizeFleet([pm("a", "pnpm"), pm("b", "npm"), pm("gone", "pnpm")], { ...META, generatedAt: "2026-09-01T00:00:00Z" });
    const after = summarizeFleet([pm("a", "pnpm"), pm("b", "pnpm"), repo("new", { "AGENTS.md": "- x\u202Ey\n" })], META);
    const t = fleetTrend(before, after);
    expect(t.since).toBe("2026-09-01T00:00:00Z");
    expect(t.added).toEqual(["acme/new"]);
    expect(t.removed).toEqual(["acme/gone"]);
    expect(t.after.blockers).toBeGreaterThan(t.before.blockers);
  });

  it("handles an empty organisation", () => {
    const e = summarizeFleet([], META);
    expect(e.repos.listed).toBe(0);
    expect(e.fleet.grade).toBe("F");
  });
});
