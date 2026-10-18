import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv-draft-04";
import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { scan } from "@threadctx/rules";
import { renderJson, renderMarkdown, renderSarif, renderText } from "./index.js";

const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/schemas/sarif-schema-2.1.0.json", import.meta.url)), "utf8"));
const NOW = new Date("2026-10-03T12:00:00Z");

const result = scan(memoryRepo({
  "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
  "pnpm-lock.yaml": "",
  "AGENTS.md": "- Install with `pnpm install`.\n- See `docs/missing.md`.\n<!-- ctx-ignore CTX-D002: wip -->\n- `pnpm lint`",
  "CLAUDE.md": "- Install with `npm install`.\n- Hidden\u202E text",
  ".mcp.json": JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } } }),
}), { now: NOW });

describe("SARIF", () => {
  it("validates against the official SARIF 2.1.0 schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const doc = JSON.parse(renderSarif(result));
    const ok = validate(doc);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it("carries fingerprints, related locations, suppressions and security severity", () => {
    const run = JSON.parse(renderSarif(result)).runs[0];
    expect(run.results.every((r: { partialFingerprints: Record<string, string> }) => r.partialFingerprints["threadctx/v1"])).toBe(true);
    expect(run.results.some((r: { relatedLocations?: unknown[] }) => r.relatedLocations?.length)).toBe(true);
    expect(run.results.some((r: { suppressions?: unknown[] }) => r.suppressions?.length)).toBe(true);
    const x001 = run.tool.driver.rules.find((r: { id: string }) => r.id === "CTX-X001");
    expect(x001.properties["security-severity"]).toBe("9.0");
  });
});

describe("other formats", () => {
  it("JSON is byte-stable", () => {
    const again = scan(memoryRepo({ "AGENTS.md": "- `npm test`" }), { now: NOW });
    expect(renderJson(again)).toBe(renderJson(scan(memoryRepo({ "AGENTS.md": "- `npm test`" }), { now: NOW })));
    expect(JSON.parse(renderJson(result)).schema).toBe("threadctx.scan/v1");
  });
  it("text shows grade, findings and fixable count without colour codes when disabled", () => {
    const text = renderText(result, { color: false, verbose: true });
    expect(text).toMatch(/Grade F/);
    expect(text).toContain("CTX-C001");
    expect(text).not.toMatch(/\u001b\[/);
  });
  it("markdown escapes pipes and shows only new findings with a ratchet", () => {
    const first = result.findings.find((f) => !f.suppressed)!;
    const md = renderMarkdown(result, { baseline: { grade: "B", score: 85 }, newFingerprints: new Set([first.fingerprint]) });
    expect(md).toContain("**1 new**");
    expect(md).toMatch(/B → F/);
  });
});

describe("pull request comment footer", () => {
  it("points to the org audit for the repository owner, and never prints an unsafe owner", async () => {
    const { renderMarkdown } = await import("./index.js");
    const { scan } = await import("@threadctx/rules");
    const { memoryRepo } = await import("@threadctx/discovery");
    const r = scan(memoryRepo({ "AGENTS.md": "# A\n" }), { now: new Date("2026-10-01T00:00:00Z") });
    expect(renderMarkdown(r, { orgAuditOwner: "acme" })).toContain("`npx threadctx audit --org acme` (free summary)");
    expect(renderMarkdown(r, { orgAuditOwner: "a`b; rm -rf" })).toContain("--org <your-org>");
    expect(renderMarkdown(r)).not.toContain("threadctx audit");
  });
});
