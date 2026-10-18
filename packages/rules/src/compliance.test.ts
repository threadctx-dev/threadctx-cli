import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { scan } from "./engine.js";
import { fleetTrend, summarizeFleet, type AuditRepo } from "./audit.js";
import { CONTROLS, controlHeadline, evidencePack, FRAMEWORKS } from "./compliance.js";
import { RULES } from "./registry.js";

const NOW = new Date("2026-10-01T00:00:00Z");
const META = { org: "acme", generatedAt: NOW.toISOString(), engine: { version: "test", registry: "test" } };
const repo = (name: string, files: Record<string, string>, priv = false): AuditRepo => ({ fullName: `acme/${name}`, url: `https://github.com/acme/${name}`, private: priv, result: scan(memoryRepo(files), { now: NOW }) });

describe("controls", () => {
  it("reference only rules that exist, and every framework is used", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const c of CONTROLS) for (const r of c.rules) expect(ids.has(r), `${c.id} → ${r}`).toBe(true);
    for (const fw of FRAMEWORKS) expect(CONTROLS.some((c) => c.refs.some((r) => r.framework === fw))).toBe(true);
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
  });
});

describe("evidencePack", () => {
  const repos = [
    repo("clean", { "AGENTS.md": "# Agents\n\nUse the repository conventions.\n", CODEOWNERS: "* @acme/core\n" }),
    repo("bidi", { "AGENTS.md": "- run x‮y\n" }, true),
    repo("mcp", { "AGENTS.md": "# A\n", ".mcp.json": JSON.stringify({ mcpServers: { files: { command: "npx", args: ["-y", "some-mcp-server"] } } }) }),
    repo("empty", { "README.md": "# nothing for agents\n" }),
  ];
  const summary = summarizeFleet(repos, META);
  const pack = evidencePack(summary, repos);

  it("inventories files and MCP servers for repositories with context only", () => {
    expect(pack.inventory.map((r) => r.repo)).toEqual(["acme/bidi", "acme/clean", "acme/mcp"]);
    expect(pack.inventory.find((r) => r.repo === "acme/bidi")!.private).toBe(true);
    expect(pack.totals.mcpServers).toBeGreaterThanOrEqual(1);
    expect(pack.controls.find((c) => c.id === "TC-01")!.status).toBe("evidenced");
  });

  it("marks a blocking hidden-character finding as a gap, naming the repository", () => {
    const tc3 = pack.controls.find((c) => c.id === "TC-03")!;
    expect(tc3.status).toBe("gap");
    expect(tc3.repos).toEqual(["acme/bidi"]);
  });

  it("flags unpinned MCP servers under supply chain, and monitoring as not evidenced without a baseline", () => {
    expect(pack.controls.find((c) => c.id === "TC-05")!.status).toBe("attention");
    expect(pack.controls.find((c) => c.id === "TC-08")!.status).toBe("not-evidenced");
    const withTrend = { ...summary, trend: fleetTrend(summary, summary) };
    expect(evidencePack(withTrend, repos).controls.find((c) => c.id === "TC-08")!.status).toBe("evidenced");
  });

  it("is deterministic and carries the disclaimer", () => {
    expect(JSON.stringify(evidencePack(summary, repos))).toBe(JSON.stringify(pack));
    expect(pack.disclaimer).toMatch(/not an attestation/);
    const h = controlHeadline(pack);
    expect(h.met + h.attention + h.gap).toBe(h.total);
  });

  it("tests nothing when no repository has context", () => {
    const none = [repo("empty", { "README.md": "x\n" })];
    const p = evidencePack(summarizeFleet(none, META), none);
    const tested = new Set(CONTROLS.filter((c) => c.rules.length).map((c) => c.id));
    expect(p.controls.filter((c) => tested.has(c.id)).every((c) => c.status === "not-evidenced")).toBe(true);
  });
});
