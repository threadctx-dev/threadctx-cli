// Compliance evidence pack (paid): a print-ready HTML document for auditors, plus CSV exports.
import { FRAMEWORKS, type ControlStatus, type EvidencePack } from "@threadctx/rules";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const TOOL_LABEL: Record<string, string> = { "agents-md": "AGENTS.md", "claude-code": "Claude Code", cursor: "Cursor", copilot: "GitHub Copilot", gemini: "Gemini CLI" };
const STATUS_LABEL: Record<ControlStatus, string> = { met: "Met", evidenced: "Evidenced", attention: "Needs attention", gap: "Gap", "not-evidenced": "Not evidenced" };

const csvCell = (v: unknown) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: string[][]) => `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;

/** One row per agent instruction or configuration file, then one per MCP server. */
export function renderInventoryCsv(p: EvidencePack): string {
  const rows = [["repository", "visibility", "item_type", "path_or_name", "agent_or_client", "kind_or_transport", "source", "repository_grade"]];
  for (const r of p.inventory) {
    const vis = r.private ? "private" : "public";
    for (const f of r.files) rows.push([r.repo, vis, "instruction_file", f.path, TOOL_LABEL[f.tool] ?? f.tool, f.kind, "", r.grade]);
    for (const m of r.mcpServers) rows.push([r.repo, vis, "mcp_server", m.name, m.client, m.transport, m.source, r.grade]);
  }
  return csv(rows);
}

/** One row per control and framework reference, so it filters cleanly in a spreadsheet or GRC tool. */
export function renderControlsCsv(p: EvidencePack): string {
  const rows = [["control_id", "control", "status", "framework", "reference", "reference_name", "open_findings", "blocking_findings", "repositories_affected", "repositories_tested", "statement", "generated_at"]];
  for (const c of p.controls) {
    for (const r of c.refs) rows.push([c.id, c.title, STATUS_LABEL[c.status], r.framework, r.ref, r.name, String(c.findings), String(c.blockers), String(c.repos.length), String(c.tested), c.statement, p.generatedAt]);
  }
  return csv(rows);
}

const CSS = `
:root{--fg:#111418;--muted:#5b6370;--line:#e2e5ea;--card:#f6f7f9;--accent:#1f4fd1;--met:#1a7f37;--att:#9a6700;--gap:#c62828;--na:#5b6370}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--fg);font:14px/1.55 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:40px 28px 64px}
h1{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:19px;margin:36px 0 10px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:15px;margin:18px 0 4px}
.muted{color:var(--muted)}.small{font-size:12.5px}code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);padding:1px 5px;border-radius:4px;word-break:break-all}
.cover{border:1px solid var(--line);border-radius:14px;padding:28px;margin:8px 0 24px;background:linear-gradient(180deg,#f8faff,#fff)}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:700}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 24px;margin-top:18px}.meta div b{display:block;font-size:12px;color:var(--muted);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}.kpi{border:1px solid var(--line);border-radius:10px;padding:12px}.kpi b{display:block;font-size:24px;letter-spacing:-.01em}
table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:13px}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.st{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:700;white-space:nowrap}
.st-met,.st-evidenced{background:#e6f4ea;color:var(--met)}.st-attention,.st-not-evidenced{background:#fff4d6;color:var(--att)}.st-gap{background:#fde8e8;color:var(--gap)}
.control{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0;break-inside:avoid}.control h3{margin:0 0 4px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.refs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.ref{font-size:11.5px;border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--muted)}
.note{border-left:3px solid var(--accent);background:var(--card);padding:10px 14px;border-radius:0 8px 8px 0;margin:14px 0;font-size:13px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:20px}.sign div{border-top:1px solid var(--fg);padding-top:6px;font-size:12px;color:var(--muted)}
.toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid var(--line);padding:10px 28px;display:flex;gap:10px;justify-content:flex-end}.toolbar button{font:600 13px system-ui;border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}
footer{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
@media print{.toolbar{display:none}main{padding:0;max-width:none}h2{break-after:avoid}tr,.control{break-inside:avoid}.pb{break-before:page}@page{margin:16mm 14mm}}
`;

export interface EvidenceHtmlOptions {
  /** SHA-256 of the audit.json written alongside, so the pack can be tied to its raw data. */
  auditSha256?: string;
}

export function renderEvidenceHtml(p: EvidencePack, opts: EvidenceHtmlOptions = {}): string {
  const date = p.generatedAt.slice(0, 10);
  const st = (s: ControlStatus) => `<span class="st st-${s}">${STATUS_LABEL[s]}</span>`;
  const count = (s: ControlStatus[]) => p.controls.filter((c) => s.includes(c.status)).length;
  const agents = Object.entries(p.totals.agents).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${esc(TOOL_LABEL[id] ?? id)} (${n})`).join(", ") || "none";
  const out: string[] = [];

  out.push(`<div class="cover"><div class="eyebrow">AI coding agent governance · evidence pack</div>
  <h1>${esc(p.org)}</h1><div class="muted">Configuration of AI coding agents across the organisation's GitHub repositories</div>
  <div class="meta"><div><b>Generated</b>${esc(p.generatedAt.replace("T", " ").slice(0, 16))} UTC</div><div><b>Tool</b>threadctx ${esc(p.engine.version)} · rules ${esc(p.engine.registry)}</div>
  <div><b>Scope</b>${p.scope.repositoriesScanned} of ${p.scope.repositoriesListed} repositories</div><div><b>Frameworks referenced</b>${FRAMEWORKS.map(esc).join(", ")}</div></div></div>`);

  out.push(`<h2>Summary</h2><div class="kpis">
  <div class="kpi"><b>${count(["met", "evidenced"])}/${p.controls.length}</b><span class="muted small">controls met or evidenced</span></div>
  <div class="kpi"><b>${count(["attention", "not-evidenced"])}</b><span class="muted small">need attention</span></div>
  <div class="kpi"><b>${count(["gap"])}</b><span class="muted small">gaps (blocking findings)</span></div>
  <div class="kpi"><b>${p.totals.agentFiles}</b><span class="muted small">agent files inventoried</span></div>
  <div class="kpi"><b>${p.totals.mcpServers}</b><span class="muted small">MCP servers inventoried</span></div></div>
  <p>${p.scope.withAgentContext} repositories give instructions to AI coding agents (${agents}); ${p.scope.withoutAgentContext} have none${p.scope.unreadable ? `; ${p.scope.unreadable} could not be read and are outside the tested population` : ""}.</p>
  <table><tr><th>Control</th><th>Status</th><th>Result</th></tr>${p.controls.map((c) => `<tr><td><b>${esc(c.id)}</b> ${esc(c.title)}</td><td>${st(c.status)}</td><td class="small">${esc(c.statement)}</td></tr>`).join("")}</table>`);

  out.push(`<h2>Method</h2><p class="small">The repositories of <b>${esc(p.org)}</b> were listed through the GitHub API with the operator's own token. For each repository, the files that AI coding agents read (AGENTS.md, CLAUDE.md, Cursor rules, GitHub Copilot instructions, Gemini files, MCP configuration) and the manifests they refer to were fetched and analysed on the operator's machine. No repository content was sent to threadctx or any third party. Each control is tested against the deterministic rules listed under it; a rule's false-positive rate is published at threadctx.dev/rules. Findings that the repository owners suppressed in configuration are excluded and remain visible in audit.json.</p>
  <p class="small"><b>Status meanings.</b> <i>Met</i>: tested, no open findings. <i>Evidenced</i>: the audit itself provides the evidence. <i>Needs attention</i>: non-blocking findings, or not yet evidenced. <i>Gap</i>: at least one blocking finding.</p>`);

  out.push(`<h2 class="pb">Controls</h2>${p.controls.map((c) => `<div class="control"><h3>${esc(c.id)} ${esc(c.title)} ${st(c.status)}</h3>
  <div class="small muted">${esc(c.objective)}</div><p class="small" style="margin:8px 0 0">${esc(c.statement)}</p>
  ${c.repos.length ? `<p class="small" style="margin:6px 0 0"><b>Repositories with findings:</b> ${c.repos.slice(0, 25).map(esc).join(", ")}${c.repos.length > 25 ? ` and ${c.repos.length - 25} more (see controls.csv)` : ""}</p>` : ""}
  <div class="refs">${c.refs.map((r) => `<span class="ref" title="${esc(r.name)}">${esc(r.framework)} ${esc(r.ref)}</span>`).join("")}</div></div>`).join("")}`);

  out.push(`<h2 class="pb">Framework cross-reference</h2><table><tr><th>Framework</th><th>Reference</th><th>Name</th><th>Control</th><th>Status</th></tr>${FRAMEWORKS.flatMap((fw) => p.controls.flatMap((c) => c.refs.filter((r) => r.framework === fw).map((r) => `<tr><td>${esc(fw)}</td><td><b>${esc(r.ref)}</b></td><td class="small">${esc(r.name)}</td><td>${esc(c.id)}</td><td>${st(c.status)}</td></tr>`))).join("")}</table>`);

  out.push(`<h2 class="pb">Inventory</h2><p class="small muted">Every agent instruction or configuration file and MCP server found. The same data is in inventory.csv.</p>
  <table><tr><th>Repository</th><th>Agents</th><th>Files</th><th>MCP servers</th></tr>${p.inventory.map((r) => `<tr><td>${esc(r.repo)}${r.private ? ' <span class="muted small">private</span>' : ""}</td><td class="small">${esc(r.agents.map((a) => TOOL_LABEL[a] ?? a).join(", "))}</td><td class="small">${r.files.map((f) => `<code>${esc(f.path)}</code>`).join(" ")}</td><td class="small">${r.mcpServers.length ? r.mcpServers.map((m) => `${esc(m.name)} <span class="muted">(${esc(m.transport)})</span>`).join(", ") : "—"}</td></tr>`).join("")}</table>`);

  out.push(`<h2>Review and sign-off</h2><p class="small muted">For the control owner's records.</p><div class="sign"><div>Reviewed by (name, role)</div><div>Date</div><div>Follow-up ticket(s)</div><div>Next review due</div></div>`);

  out.push(`<div class="note"><b>Important.</b> ${esc(p.disclaimer)}</div>
  <footer>Integrity: ${opts.auditSha256 ? `SHA-256 of the accompanying audit.json is <code>${esc(opts.auditSha256)}</code>. Recompute it with <code>shasum -a 256 audit.json</code> to confirm this pack matches its raw data.` : "see audit.json for the raw data."} Generated locally by threadctx ${esc(p.engine.version)} on ${esc(date)}. Methodology: https://threadctx.dev/methodology · Controls: https://threadctx.dev/security</footer>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>AI agent governance evidence: ${esc(p.org)} (${esc(date)})</title><style>${CSS}</style></head><body><div class="toolbar"><button onclick="window.print()">Save as PDF</button></div><main>${out.join("\n")}</main></body></html>\n`;
}
