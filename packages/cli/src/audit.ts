import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LICENSE_PROBLEM, verifyLicense, type LicenseClaims } from "@threadctx/core";
import { createHash } from "node:crypto";
import { renderAuditCsv, renderAuditHtml, renderAuditJson, renderAuditText, renderControlsCsv, renderEvidenceHtml, renderInventoryCsv } from "@threadctx/report";
import { controlHeadline, ENGINE_VERSION, evidencePack, fleetTrend, REGISTRY_VERSION, scan, summarizeFleet, type AuditRepo, type FleetSummary } from "@threadctx/rules";
import { fetchRemoteRepo, githubToken, listOrgRepos, pool } from "./remote.js";

export interface AuditIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  now: () => Date;
}

export interface AuditOptions {
  org: string;
  max: number;
  includeForks: boolean;
  includeArchived: boolean;
  license?: string;
  outDir?: string;
  json: boolean;
  color: boolean;
  /** A previous audit.json, to show what changed since. */
  baseline?: string;
  /** Code-level only (tests): verify against this key instead of the embedded one. */
  publicKey?: string;
}

export class AuditUsageError extends Error {}

const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** A licence from --license (key or file), THREADCTX_LICENSE, or ~/.threadctx/license. */
export function findLicense(arg: string | undefined, io: Pick<AuditIo, "cwd" | "env">): { key: string; source: string } | undefined {
  const fromFile = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").trim() : undefined);
  if (arg) {
    const file = resolve(io.cwd, arg);
    const key = arg.startsWith("tctx1.") ? arg : fromFile(file);
    return key ? { key, source: arg.startsWith("tctx1.") ? "--license" : arg } : { key: arg, source: "--license" };
  }
  if (io.env.THREADCTX_LICENSE) return { key: io.env.THREADCTX_LICENSE.trim(), source: "THREADCTX_LICENSE" };
  const home = join(io.env.THREADCTX_HOME ?? join(homedir(), ".threadctx"), "license");
  const key = fromFile(home);
  return key ? { key, source: home } : undefined;
}

export function describeLicense(claims: LicenseClaims): string {
  const days = Math.max(0, Math.ceil((claims.exp * 1000 - Date.now()) / 86_400_000));
  const who = claims.orgs?.length ? claims.orgs.join(", ") : claims.org === "*" ? "any organisation" : claims.org;
  const limit = claims.agentRepoLimit ? `, up to ${claims.agentRepoLimit} agent repositories` : "";
  return `${claims.plan} licence for ${who}${limit}, ${days} day${days === 1 ? "" : "s"} left (id ${claims.id})`;
}

export async function runAudit(o: AuditOptions, io: AuditIo): Promise<number> {
  if (!ORG.test(o.org)) throw new AuditUsageError(`'${o.org}' is not a valid GitHub organisation or user name`);
  if (!Number.isInteger(o.max) || o.max < 1 || o.max > 1000) throw new AuditUsageError("--max must be a whole number from 1 to 1000");

  const found = findLicense(o.license, io);
  let claims: LicenseClaims | undefined;
  if (found) {
    const check = verifyLicense(found.key, { org: o.org, now: io.now(), publicKey: o.publicKey });
    if (check.ok) claims = check.claims;
    else if (o.license) throw new AuditUsageError(`the licence from ${found.source} ${LICENSE_PROBLEM[check.reason]}.`);
    else io.stderr(`note: the licence from ${found.source} ${LICENSE_PROBLEM[check.reason]}; running the free audit.\n`);
  }

  // Trends compare two full audits, so they come with a licence.
  let previous: FleetSummary | undefined;
  if (o.baseline) {
    if (!claims) throw new AuditUsageError("--baseline compares two full audits and needs a licence (the free audit has no audit.json to compare).");
    const file = resolve(io.cwd, o.baseline);
    if (!existsSync(file)) throw new AuditUsageError(`baseline not found: ${o.baseline}`);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as FleetSummary;
      if (parsed.schema !== "threadctx.audit/v1") throw new Error("schema");
      previous = parsed;
    } catch {
      throw new AuditUsageError(`${o.baseline} is not a threadctx audit.json`);
    }
  }

  const token = githubToken(io.env);
  if (!token) io.stderr("note: no GitHub token found (set GH_TOKEN or run 'gh auth login'). Only public repositories will be read, with a low rate limit.\n");
  let listing;
  try {
    listing = await listOrgRepos(o.org, { token, max: o.max, includeForks: o.includeForks, includeArchived: o.includeArchived });
  } catch (e) {
    const msg = (e as Error).message;
    if (/\b(403|429)\b/.test(msg)) throw new AuditUsageError("GitHub rate limit reached while listing repositories. Set GH_TOKEN (or run 'gh auth login') for a higher limit.");
    throw new AuditUsageError(`could not list repositories for ${o.org}: ${msg.slice(0, 200)}`);
  }
  if (listing.repos.length === 0) throw new AuditUsageError(`no scannable repositories found for '${o.org}'. Check the name${token ? "" : ", and set GH_TOKEN to include private repositories"}.`);
  const sk = listing.skipped;
  io.stderr(`Auditing ${listing.repos.length} ${listing.owner === "org" ? "organisation" : "user"} repositories of ${o.org}` +
    `${sk.forks + sk.archived + sk.empty + sk.beyondMax ? ` (skipped: ${sk.forks} forks, ${sk.archived} archived, ${sk.empty} empty${sk.beyondMax ? `, ${sk.beyondMax} beyond --max` : ""})` : ""}\n`);

  let done = 0;
  const repos: AuditRepo[] = await pool(listing.repos, 4, async (r): Promise<AuditRepo> => {
    const base = { fullName: r.fullName, url: r.url, private: r.private };
    try {
      const remote = await fetchRemoteRepo(r.fullName, { ref: r.defaultBranch, token });
      const result = scan(remote.view, { now: io.now() });
      io.stderr(`[${++done}/${listing.repos.length}] ${r.fullName} ${result.grade}\n`);
      return { ...base, result };
    } catch (e) {
      io.stderr(`[${++done}/${listing.repos.length}] ${r.fullName} skipped: ${(e as Error).message.slice(0, 100)}\n`);
      return { ...base, error: (e as Error).message.replace(/\s+/g, " ").slice(0, 160) };
    }
  });

  const summary = summarizeFleet(repos, { org: o.org, generatedAt: io.now().toISOString(), engine: { version: ENGINE_VERSION, registry: REGISTRY_VERSION } });
  if (previous) {
    if (previous.org.toLowerCase() !== o.org.toLowerCase()) io.stderr(`note: the baseline is for ${previous.org}, not ${o.org}; comparing anyway.\n`);
    summary.trend = fleetTrend(previous, summary);
  }
  const evidence = evidencePack(summary, repos);
  // Plans are priced by agent repositories (repositories with at least one agent context file).
  const agentRepos = summary.repos.withContext;
  if (claims?.agentRepoLimit && agentRepos > claims.agentRepoLimit) {
    io.stderr(`\nThis organisation has ${agentRepos} agent repositories; your ${claims.plan} licence covers up to ${claims.agentRepoLimit}.\n` +
      `Showing the free summary. Upgrade for the full report: https://threadctx.dev/pricing?org=${encodeURIComponent(o.org)}&repos=${agentRepos}\n\n`);
    claims = undefined;
  }
  const files: string[] = [];
  if (claims) {
    const dir = resolve(io.cwd, o.outDir ?? `threadctx-audit-${o.org}`);
    mkdirSync(dir, { recursive: true });
    // Keep the previous run so the next audit can show the trend without any flags.
    const last = join(dir, "audit.json");
    if (existsSync(last)) writeFileSync(join(dir, "previous-audit.json"), readFileSync(last));
    const auditJson = renderAuditJson({ ...summary, evidence }, repos);
    const auditSha256 = createHash("sha256").update(auditJson).digest("hex");
    for (const [name, body] of [
      ["report.html", renderAuditHtml(summary, repos)],
      ["repos.csv", renderAuditCsv(summary)],
      ["audit.json", auditJson],
      ["evidence.html", renderEvidenceHtml(evidence, { auditSha256 })],
      ["controls.csv", renderControlsCsv(evidence)],
      ["inventory.csv", renderInventoryCsv(evidence)],
    ] as const) {
      writeFileSync(join(dir, name), body);
      files.push(join(dir, name));
    }
    io.stderr(`Using ${describeLicense(claims)}\n`);
  }
  if (o.json) io.stdout(claims ? renderAuditJson({ ...summary, evidence }, repos) : `${JSON.stringify(summary, null, 2)}\n`);
  else io.stdout(renderAuditText(summary, { color: o.color, licensed: Boolean(claims), files, controls: controlHeadline(evidence) }));
  return 0;
}
