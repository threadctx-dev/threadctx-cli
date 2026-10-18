import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { scan } from "@threadctx/rules";
import { CompareError, compareExitCode, compareScans, parseScanJson } from "./compare.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const s = (files: Record<string, string>) => scan(memoryRepo(files), { now: NOW });
const BASE = { "package.json": JSON.stringify({ scripts: { test: "x" } }), "pnpm-lock.yaml": "", "AGENTS.md": "- Install: `npm install`\n- Run `pnpm test`" };

describe("compare", () => {
  it("reports only what a change introduced and what it fixed", () => {
    const base = s(BASE);
    const head = s({ ...BASE, "AGENTS.md": "- Run `pnpm test`\n- Build: `npm run build`", "CLAUDE.md": "- hi‮evil" });
    const c = compareScans(base, head);
    expect(c.added.map((f) => f.ruleId).sort()).toEqual(["CTX-D002", "CTX-D003", "CTX-X001"]); // build script is undefined, wrong package manager, hidden character
    expect(c.fixed.map((f) => f.ruleId)).toEqual(["CTX-D003"]);
  });

  it("treats moved lines as existing debt, not new findings", () => {
    const base = s(BASE);
    const head = s({ ...BASE, "AGENTS.md": "# Notes\n\n\n- Install: `npm install`\n- Run `pnpm test`" });
    const c = compareScans(base, head);
    expect(c.added).toEqual([]);
    expect(c.existing).toBeGreaterThan(0);
  });

  it("only new findings at or above the threshold fail", () => {
    const base = s(BASE);
    const worse = compareScans(base, s({ ...BASE, "CLAUDE.md": "- x‮y" }));
    expect(compareExitCode(worse, "blocker")).toBe(1);
    expect(compareExitCode(worse, "none")).toBe(0);
    const same = compareScans(base, base);
    expect(compareExitCode(same, "info")).toBe(0);
  });

  it("rejects input that is not a threadctx scan", () => {
    expect(() => parseScanJson("{oops", "base.json")).toThrow(CompareError);
    expect(() => parseScanJson('{"schema":"other"}', "head.json")).toThrow(/threadctx scan result/);
  });
});
