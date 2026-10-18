import { describe, expect, it } from "vitest";
import { memoryRepo } from "@threadctx/discovery";
import { evidencePack, scan, summarizeFleet, type AuditRepo } from "@threadctx/rules";
import { renderControlsCsv, renderEvidenceHtml, renderInventoryCsv } from "./evidence.js";
import { renderAuditCsv, renderAuditHtml, renderAuditJson, renderAuditText } from "./audit.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const mk = (name: string, files: Record<string, string>): AuditRepo => ({ fullName: name, url: `https://github.com/${name}`, result: scan(memoryRepo(files), { now: NOW }) });
const repos: AuditRepo[] = [
  mk("acme/a", { "package.json": "{}", "pnpm-lock.yaml": "", "AGENTS.md": "- Install: `pnpm install`\n" }),
  mk("acme/b", { "package.json": "{}", "pnpm-lock.yaml": "", "AGENTS.md": "- Install: `pnpm install`\n" }),
  mk("acme/c", { "package.json": "{}", "package-lock.json": "", "AGENTS.md": "- Install: `npm install`\n", "CLAUDE.md": "- x‮y\n" }),
  mk("=cmd|' /C calc'!A0", { "src/x.ts": "" }),
  mk("acme/<img src=x onerror=alert(1)>", { "AGENTS.md": "- hello <script>alert(1)</script>\n" }),
];
const fleet = summarizeFleet(repos, { org: "<b>acme</b>", generatedAt: "2026-10-05T12:00:00Z", engine: { version: "0.2.0", registry: "2026.10.1" } });

describe("audit renderers", () => {
  it("free text shows the headline and the upgrade path, not the findings", () => {
    const t = renderAuditText(fleet, { color: false, licensed: false });
    expect(t).toContain("Fleet grade");
    expect(t).toContain("The full report is a paid feature.");
    expect(t).toContain("threadctx.dev/audit?org=%3Cb%3Eacme%3C%2Fb%3E");
    expect(t).not.toContain("Findings by repository");
  });

  it("licensed text lists the files written instead of the upsell", () => {
    const t = renderAuditText(fleet, { color: false, licensed: true, files: ["a.html"] });
    expect(t).toContain("Full report written:");
    expect(t).not.toContain("paid feature");
  });

  it("HTML escapes every untrusted string and loads nothing external", () => {
    const html = renderAuditHtml(fleet, repos);
    expect(html).not.toMatch(/<script>alert|<img src=x|<b>acme/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toMatch(/<script\s+src|<link\s|@import|url\(\s*["']?https?:|<img\s|<iframe/i);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('id="c-out"');
    expect(html).toContain("Findings by repository");
  });

  it("CSV neutralises spreadsheet formulas", () => {
    const csv = renderAuditCsv(fleet);
    expect(csv.split("\n")[0]).toContain("repository,grade");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|\n)=cmd/);
  });

  it("JSON carries per-repository findings", () => {
    const j = JSON.parse(renderAuditJson(fleet, repos));
    expect(j.schema).toBe("threadctx.audit/v1");
    expect(j.repositories.find((r: { repo: string }) => r.repo === "acme/c").findings.length).toBeGreaterThan(0);
  });
});

describe("evidence pack rendering", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const repos = [{ fullName: "acme/<script>", url: "https://github.com/acme/x", result: scan(memoryRepo({ "AGENTS.md": "- a‮b\n" }), { now }) }];
  const pack = evidencePack(summarizeFleet(repos, { org: "acme", generatedAt: now.toISOString(), engine: { version: "t", registry: "t" } }), repos);

  it("escapes repository names and states it is not an attestation", () => {
    const html = renderEvidenceHtml(pack, { auditSha256: "abc" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("not an attestation");
    expect(html).toContain("abc");
  });

  it("writes one CSV row per control reference and keeps formulas inert", () => {
    const rows = renderControlsCsv(pack).trim().split("\n");
    expect(rows.length - 1).toBe(pack.controls.reduce((n, c) => n + c.refs.length, 0));
    const evil = { ...pack, inventory: [{ ...pack.inventory[0]!, repo: "=HYPERLINK(1)" }] };
    expect(renderInventoryCsv(evil)).toContain("'=HYPERLINK(1)");
  });
});
