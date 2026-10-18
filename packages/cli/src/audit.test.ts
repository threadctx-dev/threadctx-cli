import { createHash } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signLicense } from "@threadctx/core";
import { main, type Io } from "./cli.js";
import { runAudit, type AuditIo, type AuditOptions } from "./audit.js";
import { parseGithubRef } from "./cli.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const keys = generateKeyPairSync("ed25519");
const priv = keys.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pub = keys.publicKey.export({ type: "spki", format: "pem" }) as string;

const REPOS: Record<string, { files: Record<string, string>; opts?: Record<string, unknown> }> = {
  "acme/api": { files: { "package.json": '{"scripts":{"test":"vitest"}}', "pnpm-lock.yaml": "", "AGENTS.md": "- Install: `pnpm install`\n- Test: `pnpm test`\n" } },
  "acme/web": { files: { "package.json": '{"scripts":{"test":"vitest"}}', "pnpm-lock.yaml": "", "AGENTS.md": "- Install: `pnpm install`\n", "CLAUDE.md": "- Be careful‮evil\n" } },
  "acme/legacy": { files: { "package.json": "{}", "package-lock.json": "", "AGENTS.md": "- Install: `npm install`\n" } },
  "acme/docs": { files: { "README.md": "# docs\n" } },
  "acme/forked": { files: { "AGENTS.md": "x" }, opts: { fork: true } },
  "acme/old": { files: { "AGENTS.md": "x" }, opts: { archived: true } },
};

function mockGithub() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    let m = url.match(/^https:\/\/api\.github\.com\/orgs\/([^/]+)\/repos/);
    if (m) {
      if (m[1] !== "acme") return json({ message: "Not Found" }, 404);
      return json(Object.entries(REPOS).map(([full, r], i) => ({ full_name: full, html_url: `https://github.com/${full}`, private: false, default_branch: "main", pushed_at: `2026-10-0${6 - i}T00:00:00Z`, size: 10, fork: false, archived: false, ...r.opts })));
    }
    if (/^https:\/\/api\.github\.com\/users\//.test(url)) return json({ message: "Not Found" }, 404);
    m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\/main$/);
    if (m) return json({ sha: "a".repeat(40) });
    m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\//);
    if (m) return json({ truncated: false, tree: Object.keys(REPOS[m[1]!]!.files).map((p) => ({ path: p, type: "blob", mode: "100644", size: 100 })) });
    m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/[0-9a-f]{40}\/(.+)$/);
    if (m) {
      const body = REPOS[m[1]!]?.files[decodeURIComponent(m[2]!)];
      return body === undefined ? new Response("", { status: 404 }) : new Response(body);
    }
    return json({ message: "unexpected " + url }, 500);
  }));
  return calls;
}

function io(extra: Partial<AuditIo> = {}) {
  let out = "";
  let err = "";
  const cwd = mkdtempSync(join(tmpdir(), "tctx-audit-"));
  const base: AuditIo = { cwd, env: { GH_TOKEN: "test-token", THREADCTX_HOME: join(cwd, "home") }, stdout: (s) => (out += s), stderr: (s) => (err += s), now: () => NOW, ...extra };
  return { io: base, get out() { return out; }, get err() { return err; }, cwd };
}

const opts = (o: Partial<AuditOptions> = {}): AuditOptions => ({ org: "acme", max: 200, includeForks: false, includeArchived: false, json: false, color: false, publicKey: pub, ...o });

afterEach(() => vi.unstubAllGlobals());

describe("audit", () => {
  it("free: prints the fleet summary and the upsell, writes nothing, skips forks and archived repos", async () => {
    const calls = mockGithub();
    const t = io();
    expect(await runAudit(opts(), t.io)).toBe(0);
    expect(t.out).toContain("Agent context audit: acme");
    expect(t.out).toContain("4 repositories scanned · 3 with agent context · 1 without");
    expect(t.out).toContain("paid feature");
    expect(t.err).toContain("skipped: 1 forks, 1 archived");
    expect(calls.some((c) => c.includes("acme/forked") || c.includes("acme/old"))).toBe(false);
    expect(existsSync(join(t.cwd, "threadctx-audit-acme"))).toBe(false);
    expect(calls.every((c) => c.startsWith("https://api.github.com/") || c.startsWith("https://raw.githubusercontent.com/"))).toBe(true);
  });

  it("licensed: writes the HTML, CSV and JSON reports", async () => {
    mockGithub();
    const t = io();
    const key = signLicense({ plan: "audit", org: "acme", days: 30, now: NOW }, priv);
    expect(await runAudit(opts({ license: key }), t.io)).toBe(0);
    expect(t.out).toContain("Full report written:");
    const dir = join(t.cwd, "threadctx-audit-acme");
    const html = readFileSync(join(dir, "report.html"), "utf8");
    expect(html).toContain("Agent context audit: acme");
    expect(html).toContain("acme/web");
    expect(readFileSync(join(dir, "repos.csv"), "utf8")).toContain("acme/legacy");
    const raw = readFileSync(join(dir, "audit.json"), "utf8");
    expect(JSON.parse(raw).repos.withContext).toBe(3);
    expect(JSON.parse(raw).evidence.schema).toBe("threadctx.evidence/v1");
    const evidence = readFileSync(join(dir, "evidence.html"), "utf8");
    expect(evidence).toContain("SOC 2");
    expect(evidence).toContain(createHash("sha256").update(raw).digest("hex"));
    expect(readFileSync(join(dir, "controls.csv"), "utf8")).toMatch(/^control_id,/);
    expect(readFileSync(join(dir, "inventory.csv"), "utf8")).toContain("acme/legacy");
  });

  it("above the licence's agent-repository limit: free summary only, with the upgrade path", async () => {
    mockGithub();
    const t = io();
    const key = signLicense({ plan: "team", org: "acme", days: 30, now: NOW, agentRepoLimit: 2 }, priv);
    expect(await runAudit(opts({ license: key }), t.io)).toBe(0);
    expect(t.err).toContain("has 3 agent repositories; your team licence covers up to 2");
    expect(t.err).toContain("https://threadctx.dev/pricing?org=acme&repos=3");
    expect(t.out).toContain("paid feature");
    expect(existsSync(join(t.cwd, "threadctx-audit-acme"))).toBe(false);
    const within = io();
    mockGithub();
    expect(await runAudit(opts({ license: signLicense({ plan: "team", org: "acme", days: 30, now: NOW, agentRepoLimit: 3 }, priv) }), within.io)).toBe(0);
    expect(within.out).toContain("Full report written:");
  });

  it("re-running into the same folder shows the trend automatically; --baseline needs a licence", async () => {
    mockGithub();
    const t = io();
    const key = signLicense({ plan: "team", org: "acme", days: 30, now: NOW }, priv);
    await runAudit(opts({ license: key }), t.io);
    REPOS["acme/web"]!.files["CLAUDE.md"] = "- Be careful\n"; // fix the hidden character
    const t2 = { ...t.io, stdout: (s: string) => (out2 += s) };
    let out2 = "";
    const { existsSync: ex } = await import("node:fs");
    const base = join(t.cwd, "threadctx-audit-acme", "audit.json");
    expect(ex(base)).toBe(true);
    await runAudit(opts({ license: key, baseline: base }), t2);
    expect(out2).toMatch(/Since 2026-10-05: [A-F] → [A-F] \(\+\d+\) · 1 improved/);
    expect(ex(join(t.cwd, "threadctx-audit-acme", "previous-audit.json"))).toBe(true);
    expect(readFileSync(join(t.cwd, "threadctx-audit-acme", "report.html"), "utf8")).toContain("Since the last audit");
    REPOS["acme/web"]!.files["CLAUDE.md"] = "- Be careful\u202Eevil\n";
    await expect(runAudit(opts({ baseline: base }), io().io)).rejects.toThrow(/needs a licence/);
  });

  it("an explicit licence that is invalid fails clearly, and a licence for another org does not unlock", async () => {
    mockGithub();
    const t = io();
    await expect(runAudit(opts({ license: "tctx1.garbage.garbage" }), t.io)).rejects.toThrow(/not a valid threadctx licence|signature/);
    const other = signLicense({ plan: "audit", org: "someone-else", days: 30, now: NOW }, priv);
    await expect(runAudit(opts({ license: other }), io().io)).rejects.toThrow(/different GitHub organisation/);
  });

  it("an ambient licence that does not apply degrades to the free audit with a note", async () => {
    mockGithub();
    const t = io({ env: { GH_TOKEN: "t", THREADCTX_LICENSE: signLicense({ plan: "audit", org: "other", days: 30, now: NOW }, priv) } });
    expect(await runAudit(opts(), t.io)).toBe(0);
    expect(t.err).toContain("different GitHub organisation; running the free audit");
    expect(t.out).toContain("paid feature");
  });

  it("reports an unknown organisation and rejects hostile names before any request", async () => {
    const calls = mockGithub();
    await expect(runAudit(opts({ org: "ghost" }), io().io)).rejects.toThrow(/could not list|no scannable/);
    for (const bad of ["../etc", "a/b", "-x", "a b", "x".repeat(60)]) await expect(runAudit(opts({ org: bad }), io().io)).rejects.toThrow(/valid GitHub/);
    expect(calls.some((c) => c.includes("etc"))).toBe(false);
  });

  it("the audit command surfaces usage errors with exit code 2 and the license command works offline", async () => {
    let err = "";
    let out = "";
    const cio: Io = { cwd: tmpdir(), env: {}, stdout: (s) => (out += s), stderr: (s) => (err += s), isTTY: false, now: () => NOW };
    expect(await main(["audit"], cio)).toBe(2);
    expect(await main(["audit", "--org", "../x"], cio)).toBe(2);
    expect(await main(["license", "garbage"], cio)).toBe(1);
    expect(err).toContain("not a valid threadctx licence");
    expect(parseGithubRef("a/b").fullName).toBe("a/b");
    expect(out).toBe("");
  });
});
