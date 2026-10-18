import type { AuditRepo, FleetSummary, ScanResult } from "@threadctx/rules";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const n = (x: number) => x.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const TOOL_LABEL: Record<string, string> = { "agents-md": "AGENTS.md", "claude-code": "Claude Code", cursor: "Cursor", copilot: "Copilot", gemini: "Gemini CLI" };

// --- Terminal (free) ---------------------------------------------------------------------

export interface AuditTextOptions {
  color: boolean;
  licensed: boolean;
  /** Files written when licensed. */
  files?: string[];
  /** Compliance control headline (from controlHeadline). */
  controls?: { total: number; met: number; attention: number; gap: number };
}

function paint(color: boolean) {
  const w = (c: string) => (s: string) => (color ? `\u001b[${c}m${s}\u001b[0m` : s);
  return { bold: w("1"), dim: w("2"), red: w("31"), green: w("32"), yellow: w("33") };
}

/** The free output: fleet grade, headline counts and the three most telling inconsistencies. */
export function renderAuditText(s: FleetSummary, opts: AuditTextOptions): string {
  const p = paint(opts.color);
  const gradeColor = s.fleet.grade === "A" || s.fleet.grade === "B" ? p.green : s.fleet.grade === "F" || s.fleet.grade === "D" ? p.red : p.yellow;
  const out: string[] = [];
  out.push(`${p.bold(`Agent context audit: ${s.org}`)}`, "");
  out.push(`${gradeColor(p.bold(`Fleet grade ${s.fleet.grade}`))} ${p.dim(`(${s.fleet.score}/100 average)`)}`);
  if (s.trend) {
    const t = s.trend;
    const d = t.after.score - t.before.score;
    out.push(`${p.bold(`Since ${t.since.slice(0, 10)}:`)} ${t.before.grade} → ${t.after.grade} (${d > 0 ? "+" : ""}${d}) · ${t.improved.length} improved · ${t.regressed.length} got worse · blockers ${t.before.blockers} → ${t.after.blockers}${t.added.length ? ` · ${t.added.length} new` : ""}`);
  }
  out.push(`${plural(s.repos.scanned, "repository", "repositories")} scanned · ${s.repos.withContext} with agent context · ${s.repos.withoutContext} without${s.repos.failed ? ` · ${s.repos.failed} could not be read` : ""}`);
  out.push(`${plural(s.fleet.counts.blocker, "blocker")} · ${plural(s.fleet.counts.warning, "warning")} · ${n(s.fleet.counts.info)} info`);
  if (s.repos.withContext) out.push(`${s.fleet.multiToolRepos} of ${s.repos.withContext} repositories maintain instructions for two or more agents`);
  const tools = Object.entries(s.fleet.toolsUsed).sort((a, b) => b[1] - a[1]).map(([id, c]) => `${TOOL_LABEL[id] ?? id} ${c}`);
  if (tools.length) out.push(p.dim(`Agents by repositories: ${tools.join(" · ")}`));
  const top = s.inconsistencies.slice(0, 3);
  if (top.length) {
    out.push("", p.bold("Where your repositories disagree"));
    for (const i of top) {
      const dist = i.distribution.map((d) => `${d.value} (${d.repos})`).join(", ");
      out.push(`  ${i.label}: ${dist}${i.majority ? p.dim(`  → ${i.outliers.length} outlier${i.outliers.length === 1 ? "" : "s"} from ${i.majority.value}`) : ""}`);
    }
  }
  const worst = s.repoTable.slice(0, 5).filter((r) => r.score < 100);
  if (worst.length) {
    out.push("", p.bold("Lowest grades"));
    for (const r of worst) out.push(`  ${r.grade} ${String(r.score).padStart(3)}  ${r.repo}`);
  }
  if (opts.controls) {
    const c = opts.controls;
    out.push("", `${p.bold("AI governance controls (SOC 2, ISO 27001, ISO 42001, NIST AI RMF):")} ${c.met}/${c.total} met${c.attention ? ` · ${c.attention} need attention` : ""}${c.gap ? ` · ${p.red(`${c.gap} gap${c.gap === 1 ? "" : "s"}`)}` : ""}`);
  }
  out.push("");
  if (opts.licensed) {
    out.push(p.green("Full report written:"), ...(opts.files ?? []).map((f) => `  ${f}`));
  } else {
    out.push(
      p.bold("The full report is a paid feature."),
      `It adds every finding by repository, a ranked remediation plan, security findings, the token-cost estimate,`,
      `an executive one-pager, and a compliance evidence pack (controls, framework cross-reference, agent and MCP`,
      `inventory) for SOC 2 and ISO auditors. It covers ${s.repos.withContext} repositories and the ${s.plan.length} fixes ranked above.`,
      `Get a licence for ${s.org}: https://threadctx.dev/audit?org=${encodeURIComponent(s.org)}`,
      p.dim(`Then: threadctx audit --org ${s.org} --license <key>`),
    );
  }
  return `${out.join("\n")}\n`;
}

// --- CSV (paid) --------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a repository name run as a spreadsheet formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderAuditCsv(s: FleetSummary): string {
  const rows = [["repository", "grade", "score", "blockers", "warnings", "info", "agents", "always_loaded_tokens_estimate", "url"]];
  for (const r of s.repoTable) rows.push([r.repo, r.grade, String(r.score), String(r.blockers), String(r.warnings), String(r.infos), r.tools.join(" "), String(r.alwaysTokens), r.url]);
  for (const r of s.noContext) rows.push([r.repo, "-", "", "", "", "", "", "", r.url]);
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

// --- JSON (paid) -------------------------------------------------------------------------

export function renderAuditJson(s: FleetSummary, repos: AuditRepo[]): string {
  const detail = repos.filter((r) => r.result).map((r) => ({ repo: r.fullName, grade: r.result!.grade, score: r.result!.score, findings: r.result!.findings.filter((f) => !f.suppressed).map((f) => ({ rule: f.ruleId, severity: f.severity, path: f.path, line: f.line, message: f.message })) }));
  return `${JSON.stringify({ ...s, repositories: detail }, null, 2)}\n`;
}

// --- HTML (paid) -------------------------------------------------------------------------

const CSS = `
:root{--bg:#fff;--fg:#14161a;--muted:#5b6370;--line:#e3e6eb;--card:#f6f7f9;--accent:#2457d6;--a:#1a7f37;--b:#4c9a2a;--c:#b08900;--d:#c25400;--f:#c62828;--warn:#b08900}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e8eaee;--muted:#9aa3b2;--line:#262b34;--card:#171a21;--accent:#7aa2ff;--a:#4cc26b;--b:#8ccf5a;--c:#e0b93a;--d:#f08a3a;--f:#ff6b6b;--warn:#e0b93a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:8px;border-top:1px solid var(--line)}h3{font-size:16px;margin:20px 0 6px}
.muted{color:var(--muted)}.small{font-size:13px}code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);padding:1px 5px;border-radius:4px}
.hero{display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin:20px 0}
.grade{font-size:64px;font-weight:800;line-height:1;width:96px;height:96px;border-radius:18px;display:grid;place-items:center;color:#fff}
.g-A{background:var(--a)}.g-B{background:var(--b)}.g-C{background:var(--c)}.g-D{background:var(--d)}.g-F{background:var(--f)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;flex:1;min-width:260px}.stat b{display:block;font-size:22px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.pill{display:inline-block;min-width:26px;text-align:center;border-radius:6px;padding:1px 7px;font-weight:700;color:#fff}
.sev-blocker{color:var(--f);font-weight:700}.sev-warning{color:var(--warn);font-weight:600}.sev-info{color:var(--muted)}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden;min-width:80px}.bar>i{display:block;height:100%;background:var(--accent)}
details{border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:6px 12px;background:var(--card)}summary{cursor:pointer;font-weight:600;padding:4px 0}
.calc{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.calc label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}.calc input{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
.result{font-size:22px;font-weight:700;margin:12px 0 2px}.callout{border-left:4px solid var(--accent);padding:8px 14px;background:var(--card);border-radius:0 8px 8px 0;margin:12px 0}
footer{margin-top:48px;color:var(--muted);font-size:13px}@media print{body{font-size:12px}details{border:none;padding:0}.calc input{border:none}main{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}
`;

function pill(grade: string): string {
  return `<span class="pill g-${esc(grade)}">${esc(grade)}</span>`;
}

function sev(s: string): string {
  return `<span class="sev-${esc(s)}">${esc(s)}</span>`;
}

function takeaways(s: FleetSummary): string[] {
  const out: string[] = [];
  if (s.repos.withContext === 0) return ["No repository in this organisation has agent context files yet, so agents are guessing commands and conventions everywhere."];
  const pct = Math.round((s.fleet.multiToolRepos / s.repos.withContext) * 100);
  if (s.fleet.multiToolRepos) out.push(`${pct}% of repositories with context (${s.fleet.multiToolRepos} of ${s.repos.withContext}) maintain instructions for two or more agents, so copies can drift apart.`);
  if (s.fleet.counts.blocker) out.push(`${plural(s.fleet.counts.blocker, "blocker")} need attention first${s.security.some((x) => x.severity === "blocker") ? ", including security findings" : ""}.`);
  if (s.inconsistencies[0]) out.push(`Repositories disagree on ${s.inconsistencies.slice(0, 3).map((i) => i.label.toLowerCase()).join(", ")}.`);
  if (s.repos.withoutContext) out.push(`${plural(s.repos.withoutContext, "repository", "repositories")} have no agent context file at all.`);
  if (s.waste.avgTokensPerRepo > 0) out.push(`About ${n(s.waste.avgTokensPerRepo)} estimated tokens per session per repository are duplicated or generic text.`);
  const auto = s.plan.filter((p) => p.effort === "automatic").reduce((c, p) => c + p.findings, 0);
  if (auto) out.push(`${plural(auto, "finding")} can be fixed automatically with <code>threadctx fix</code>.`);
  return out.length ? out : ["No significant problems found. Keep the check in CI so it stays that way."];
}

export function renderAuditHtml(s: FleetSummary, repos: AuditRepo[]): string {
  const sections: string[] = [];
  const when = s.generatedAt.slice(0, 10);
  const auto = s.plan.filter((p) => p.effort === "automatic").reduce((c, p) => c + p.findings, 0);

  sections.push(`<h1>Agent context audit: ${esc(s.org)}</h1><div class="muted">${esc(when)} · threadctx ${esc(s.engine.version)} · rules ${esc(s.engine.registry)}</div>`);
  sections.push(`<div class="hero"><div class="grade g-${esc(s.fleet.grade)}">${esc(s.fleet.grade)}</div><div class="stats">
    <div class="stat"><b>${s.fleet.score}/100</b><span class="muted">average score</span></div>
    <div class="stat"><b>${s.repos.withContext} / ${s.repos.scanned}</b><span class="muted">repositories with context</span></div>
    <div class="stat"><b>${s.fleet.counts.blocker}</b><span class="muted">blockers</span></div>
    <div class="stat"><b>${s.fleet.counts.warning}</b><span class="muted">warnings</span></div>
    <div class="stat"><b>${s.fleet.multiToolRepos}</b><span class="muted">maintain files for 2+ agents</span></div>
    <div class="stat"><b>${auto}</b><span class="muted">auto-fixable</span></div></div></div>`);
  if (s.trend) {
    const t = s.trend;
    const d = t.after.score - t.before.score;
    const row = (x: { repo: string; from: number; to: number }) => `<tr><td>${esc(x.repo)}</td><td>${x.from} → ${x.to}</td><td>${x.to - x.from > 0 ? "+" : ""}${x.to - x.from}</td></tr>`;
    sections.push(`<h2>Since the last audit (${esc(t.since.slice(0, 10))})</h2>
    <div class="stats"><div class="stat"><b>${esc(t.before.grade)} → ${esc(t.after.grade)}</b><span class="muted">fleet grade (${d > 0 ? "+" : ""}${d})</span></div><div class="stat"><b>${t.before.blockers} → ${t.after.blockers}</b><span class="muted">blockers</span></div><div class="stat"><b>${t.before.warnings} → ${t.after.warnings}</b><span class="muted">warnings</span></div><div class="stat"><b>${t.before.withContext} → ${t.after.withContext}</b><span class="muted">repos with context</span></div></div>
    ${t.regressed.length ? `<h3>Got worse (${t.regressed.length})</h3><table><tr><th>Repository</th><th>Score</th><th>Change</th></tr>${t.regressed.map(row).join("")}</table>` : ""}
    ${t.improved.length ? `<h3>Improved (${t.improved.length})</h3><table><tr><th>Repository</th><th>Score</th><th>Change</th></tr>${t.improved.map(row).join("")}</table>` : ""}
    ${t.added.length ? `<p class="small muted">New since then: ${t.added.map(esc).join(", ")}</p>` : ""}`);
  }
  sections.push(`<h2>Summary</h2><ul>${takeaways(s).map((t) => `<li>${t.includes("<code>") ? t : esc(t)}</li>`).join("")}</ul>
  <div class="callout">For security and compliance reviews: <a href="evidence.html">evidence.html</a> maps these findings to SOC 2, ISO/IEC 27001, ISO/IEC 42001 and NIST AI RMF controls, with a full agent and MCP server inventory (also in <code>controls.csv</code> and <code>inventory.csv</code>).</div>`);

  if (s.plan.length) {
    sections.push(`<h2>Fix these first</h2><p class="muted small">Ranked by score gained per unit of effort. “Automatic” fixes are mechanical and safe; “quick” ones need a one-line decision; “manual” ones need a person.</p>
    <table><tr><th>#</th><th>Problem</th><th>Severity</th><th>Where</th><th>Effort</th><th>What to do</th></tr>${s.plan.slice(0, 10).map((p, i) => `<tr><td>${i + 1}</td><td><code>${esc(p.ruleId)}</code> ${esc(p.title)}</td><td>${sev(p.severity)}</td><td>${plural(p.findings, "finding")} in ${plural(p.repos, "repo")}</td><td>${esc(p.effort)}</td><td>${p.effort === "automatic" ? "Run <code>threadctx fix --apply</code> and review the diff." : esc(p.action)}</td></tr>`).join("")}</table>`);
  }

  if (s.security.length) {
    sections.push(`<h2>Security findings</h2><p class="muted small">Agent context is trusted input: a malicious or careless line steers every agent that reads it.</p>
    <table><tr><th>Repository</th><th>Rule</th><th>Severity</th><th>Location</th><th>Finding</th></tr>${s.security.map((x) => `<tr><td>${esc(x.repo)}</td><td><code>${esc(x.ruleId)}</code></td><td>${sev(x.severity)}</td><td><code>${esc(x.path)}${x.line ? `:${x.line}` : ""}</code></td><td>${esc(x.message)}</td></tr>`).join("")}</table>`);
  }

  if (s.inconsistencies.length) {
    sections.push(`<h2>Where your repositories disagree</h2><p class="muted small">The same fact stated differently across repositories. Different conventions are sometimes intentional; check the outliers.</p>${s.inconsistencies.map((i) => {
      const total = i.distribution.reduce((c, d) => c + d.repos, 0) || 1;
      return `<h3>${esc(i.label)} <span class="muted small">stated in ${i.statedBy} repositories</span></h3><table>${i.distribution.map((d) => `<tr><td style="width:30%"><code>${esc(d.value)}</code></td><td style="width:15%">${d.repos} ${d.repos === 1 ? "repo" : "repos"}</td><td><div class="bar"><i style="width:${Math.round((d.repos / total) * 100)}%"></i></div></td></tr>`).join("")}</table>${i.majority && i.outliers.length ? `<div class="callout">Most use <code>${esc(i.majority.value)}</code> (${Math.round(i.majority.share * 100)}%). Different: ${i.outliers.slice(0, 12).map((o) => `${esc(o.repo)} (${esc(o.values.join(", "))})`).join("; ")}${i.outliers.length > 12 ? `; and ${i.outliers.length - 12} more` : ""}.</div>` : ""}`;
    }).join("")}`);
  }

  sections.push(`<h2>What the duplicated and generic text costs</h2>
  <p class="muted small">An <b>estimate</b>, not a measurement. It assumes every developer session loads each repository's always-on context. Prompt caching can remove most of this cost, so treat it as supporting evidence, not the reason to act. Change the assumptions to match your team.</p>
  <div class="calc" data-waste="${s.waste.avgTokensPerRepo}">
    <div><label>Developers using agents</label><input id="c-dev" type="number" min="1" value="25"></div>
    <div><label>Agent sessions per developer per day</label><input id="c-ses" type="number" min="1" value="20"></div>
    <div><label>Input price, $ per million tokens</label><input id="c-price" type="number" min="0" step="0.1" value="3"></div>
    <div><label>Share served from prompt cache, %</label><input id="c-cache" type="number" min="0" max="100" value="60"></div>
  </div>
  <div class="result" id="c-out">…</div>
  <div class="muted small">= removable tokens per session (<b>${n(s.waste.avgTokensPerRepo)}</b>, the average across your repositories) × sessions × developers × 21 working days × price × (1 − cache share).</div>`);

  sections.push(`<h2>All repositories</h2><table><tr><th>Grade</th><th>Repository</th><th>Score</th><th>Blockers</th><th>Warnings</th><th>Agents</th><th>Always-loaded tokens (est.)</th></tr>${s.repoTable.map((r) => `<tr><td>${pill(r.grade)}</td><td>${esc(r.repo)}${r.private ? ' <span class="muted small">private</span>' : ""}</td><td>${r.score}</td><td>${r.blockers}</td><td>${r.warnings}</td><td>${esc(r.tools.map((t) => TOOL_LABEL[t] ?? t).join(", "))}</td><td>${n(r.alwaysTokens)}</td></tr>`).join("")}</table>`);
  if (s.noContext.length) sections.push(`<h3>No agent context file (${s.noContext.length})</h3><p class="small">${s.noContext.map((r) => esc(r.repo)).join(", ")}</p>`);
  if (s.failures.length) sections.push(`<h3>Could not be read (${s.failures.length})</h3><ul class="small">${s.failures.map((f) => `<li>${esc(f.repo)}: ${esc(f.error)}</li>`).join("")}</ul>`);

  const detailed = repos.filter((r) => r.result && r.result.findings.some((f) => !f.suppressed)).sort((a, b) => a.result!.score - b.result!.score);
  if (detailed.length) {
    sections.push(`<h2>Findings by repository</h2>${detailed.map((r) => {
      const open = r.result!.findings.filter((f) => !f.suppressed);
      return `<details><summary>${pill(r.result!.grade)} ${esc(r.fullName)} <span class="muted small">${plural(open.length, "finding")}</span></summary><table>${open.map((f) => `<tr><td>${sev(f.severity)}</td><td><code>${esc(f.ruleId)}</code></td><td><code>${esc(f.path || ".")}${f.line ? `:${f.line}` : ""}</code></td><td>${esc(f.message)}</td></tr>`).join("")}</table></details>`;
    }).join("")}`);
  }

  sections.push(`<footer>Generated locally by threadctx ${esc(s.engine.version)}: repository contents were read through the GitHub API and analysed on the machine that ran the audit; nothing was uploaded. Grades: start at 100, −25 per blocker, −5 per warning, −1 per info; the fleet grade is the average repository score. Token figures are estimates (about four characters per token). This report shows what a correctly behaving agent would load according to each tool's documentation; it is evidence for review, not a compliance determination. <a href="https://threadctx.dev/methodology">Methodology</a></footer>`);

  const script = `(function(){var w=Number(document.querySelector('[data-waste]').getAttribute('data-waste'))||0;function v(i){return Math.max(0,Number(document.getElementById(i).value)||0)}function f(){var t=w*v('c-ses')*v('c-dev')*21;var cost=t/1e6*v('c-price')*(1-Math.min(100,v('c-cache'))/100);document.getElementById('c-out').textContent=(t/1e6).toFixed(1)+'M tokens a month, about $'+Math.round(cost).toLocaleString('en-US')+' a month at these assumptions'}['c-dev','c-ses','c-price','c-cache'].forEach(function(i){document.getElementById(i).addEventListener('input',f)});window.addEventListener('beforeprint',function(){document.querySelectorAll('details').forEach(function(d){d.open=true})});f()})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Agent context audit: ${esc(s.org)}</title><style>${CSS}</style></head><body><main>${sections.join("\n")}</main><script>${script}</script></body></html>\n`;
}

export type { ScanResult };
