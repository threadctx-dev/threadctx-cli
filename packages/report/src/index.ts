import type { EffectiveContext } from "@threadctx/core";
import type { Finding, RuleMeta, ScanResult } from "@threadctx/rules";

export const RULE_DOCS = "https://threadctx.dev/rules";

// --- JSON --------------------------------------------------------------------------------

/** Stable, versioned JSON (schema threadctx.scan/v1). Same input, same bytes. */
export function renderJson(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

// --- SARIF 2.1.0 -------------------------------------------------------------------------

const SARIF_LEVEL = { blocker: "error", warning: "warning", info: "note" } as const;
const SECURITY_SEVERITY = { blocker: "9.0", warning: "5.0", info: "2.0" } as const;

export function renderSarif(result: ScanResult): string {
  const rules = [...result.rules].sort((a, b) => (a.id < b.id ? -1 : 1));
  const index = new Map(rules.map((r, i) => [r.id, i]));
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "threadctx",
            semanticVersion: result.engine.version,
            informationUri: "https://threadctx.dev",
            rules: rules.map((r) => sarifRule(r)),
          },
        },
        automationDetails: { id: "threadctx/agent-context/" },
        results: result.findings.map((f) => sarifResult(f, index.get(f.ruleId))),
        properties: { grade: result.grade, score: result.score, registry: result.engine.registry },
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function sarifRule(r: RuleMeta) {
  const tags = [...new Set(["agent-context", r.family, r.determinism])];
  return {
    id: r.id,
    name: r.id.replace(/[^A-Za-z0-9]/g, ""),
    shortDescription: { text: r.title },
    fullDescription: { text: r.rationale },
    helpUri: r.id.startsWith("CTX-") ? `${RULE_DOCS}/${r.id}` : undefined,
    help: { text: `${r.remediation}\n\nSource: ${r.citation}`, markdown: `${r.remediation}\n\nSource: ${r.citation}` },
    defaultConfiguration: { level: SARIF_LEVEL[r.severity] },
    properties: { tags, precision: r.determinism === "deterministic" ? "high" : "medium", ...(r.family === "security" ? { "security-severity": SECURITY_SEVERITY[r.severity] } : {}) },
  };
}

function sarifResult(f: Finding, ruleIndex: number | undefined) {
  const location = (path: string, line?: number, endLine?: number) => ({
    physicalLocation: {
      // Repository-level findings point at the root so code scanning still accepts them.
      artifactLocation: { uri: path || ".", uriBaseId: "%SRCROOT%" },
      ...(line ? { region: { startLine: line, ...(endLine && endLine > line ? { endLine } : {}) } } : {}),
    },
  });
  return {
    ruleId: f.ruleId,
    ...(ruleIndex !== undefined ? { ruleIndex } : {}),
    level: SARIF_LEVEL[f.severity],
    message: { text: f.evidence ? `${f.message}\n\nEvidence: ${f.evidence}` : f.message },
    locations: [location(f.path, f.line, f.endLine)],
    ...(f.related?.length ? { relatedLocations: f.related.map((r, i) => ({ id: i + 1, ...location(r.path, r.line), message: { text: r.message ?? "related" } })) } : {}),
    partialFingerprints: { "threadctx/v1": f.fingerprint },
    ...(f.suppressed ? { suppressions: [{ kind: f.suppressed.source === "inline" ? "inSource" : "external", justification: f.suppressed.reason }] } : {}),
  };
}

// --- Text --------------------------------------------------------------------------------

export interface TextOptions {
  color: boolean;
  /** Include info-level findings. */
  verbose: boolean;
  /** Suggested next commands as [command, why] pairs, printed under the summary. Interactive use only. */
  next?: [string, string][];
}

function painter(color: boolean) {
  const wrap = (code: string) => (s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  return { red: wrap("31"), yellow: wrap("33"), blue: wrap("34"), green: wrap("32"), dim: wrap("2"), bold: wrap("1"), cyan: wrap("36") };
}

const GRADE_COLOR = { A: "green", B: "green", C: "yellow", D: "yellow", F: "red" } as const;

export function renderText(result: ScanResult, opts: TextOptions): string {
  const p = painter(opts.color);
  const out: string[] = [];
  const open = result.findings.filter((f) => !f.suppressed);
  const shown = opts.verbose ? open : open.filter((f) => f.severity !== "info");
  const sev = { blocker: p.red("blocker"), warning: p.yellow("warning"), info: p.blue("info   ") };
  let lastPath: string | undefined;
  for (const f of shown) {
    if (f.path !== lastPath) {
      out.push("", p.bold(f.path || "(repository)"));
      lastPath = f.path;
    }
    const loc = f.line ? p.dim(`${String(f.line).padStart(4)}:`) : p.dim("     ");
    const fix = f.fix?.kind === "safe" ? p.green(" [fixable]") : "";
    out.push(`${loc} ${sev[f.severity]} ${f.message} ${p.dim(f.ruleId)}${fix}`);
    if (f.evidence) out.push(`      ${p.dim(`> ${f.evidence}`)}`);
  }
  const hiddenInfo = open.length - shown.length;
  const { blocker, warning, info, suppressed } = result.counts;
  out.push("");
  out.push(
    `${p[GRADE_COLOR[result.grade]](p.bold(`Grade ${result.grade}`))} ${p.dim(`(${result.score}/100)`)}  ` +
      `${blocker} blocker${blocker === 1 ? "" : "s"}, ${warning} warning${warning === 1 ? "" : "s"}, ${info} info` +
      (suppressed ? p.dim(`, ${suppressed} suppressed`) : "") +
      (hiddenInfo ? p.dim(` (${hiddenInfo} info hidden; --verbose shows them)`) : ""),
  );
  const fixable = open.filter((f) => f.fix?.kind === "safe").length;
  if (fixable) out.push(p.dim(`${fixable} finding${fixable === 1 ? "" : "s"} can be fixed automatically: threadctx fix`));
  const tools = result.tools.filter((t) => t.layers > 0);
  if (tools.length) {
    out.push(p.dim(`Always-loaded context (estimated tokens): ${tools.map((t) => `${t.label.split(" (")[0]} ≈${t.alwaysTokenEstimate.toLocaleString("en-US")}`).join(" · ")}`));
  }
  if (opts.next?.length) {
    const width = Math.max(...opts.next.map(([cmd]) => cmd.length));
    out.push("", p.bold("Next"), ...opts.next.map(([cmd, why]) => `  ${p.cyan(cmd.padEnd(width))}  ${p.dim(why)}`));
  }
  for (const d of result.diagnostics) {
    const tag = d.level === "error" ? p.red("error") : d.level === "warning" ? p.yellow("note") : p.dim("note");
    out.push(`${tag} ${d.path ? `${d.path}${d.line ? `:${d.line}` : ""}: ` : ""}${d.message}`);
  }
  return `${out.join("\n").replace(/^\n/, "")}\n`;
}

// --- Markdown (PR comments, job summaries) -----------------------------------------------

export interface MarkdownOptions {
  /** Previous grade for the delta line, e.g. from the base branch. */
  baseline?: { grade: string; score: number };
  /** Only these fingerprints are "new" (net-new ratchet). */
  newFingerprints?: Set<string>;
  /** Link to the repo's page, shown in the footer. */
  footerUrl?: string;
  maxFindings?: number;
  /** GitHub owner, for the org audit hint in pull request comments. */
  orgAuditOwner?: string;
}

const SEV_ICON = { blocker: "🔴", warning: "🟡", info: "🔵" } as const;

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderMarkdown(result: ScanResult, opts: MarkdownOptions = {}): string {
  const out: string[] = [];
  const open = result.findings.filter((f) => !f.suppressed);
  const delta = opts.baseline
    ? result.score === opts.baseline.score
      ? " (unchanged)"
      : ` (${opts.baseline.grade} → ${result.grade}, ${result.score - opts.baseline.score > 0 ? "+" : ""}${result.score - opts.baseline.score})`
    : "";
  out.push(`### Agent context: grade **${result.grade}** · ${result.score}/100${delta}`);
  out.push("");
  out.push(`${result.counts.blocker} blocker${result.counts.blocker === 1 ? "" : "s"} · ${result.counts.warning} warning${result.counts.warning === 1 ? "" : "s"} · ${result.counts.info} info${result.counts.suppressed ? ` · ${result.counts.suppressed} suppressed` : ""}`);
  const list = opts.newFingerprints ? open.filter((f) => opts.newFingerprints!.has(f.fingerprint)) : open;
  if (opts.newFingerprints) out.push("", `**${list.length} new** in this change${open.length > list.length ? ` (${open.length - list.length} existing not shown)` : ""}.`);
  const max = opts.maxFindings ?? 50;
  if (list.length) {
    out.push("", "| | Rule | Location | Finding |", "|---|---|---|---|");
    for (const f of list.slice(0, max)) {
      const rule = f.ruleId.startsWith("CTX-") ? `[${f.ruleId}](${RULE_DOCS}/${f.ruleId})` : f.ruleId;
      out.push(`| ${SEV_ICON[f.severity]} | ${rule} | \`${mdEscape(f.path || ".")}${f.line ? `:${f.line}` : ""}\` | ${mdEscape(f.message)} |`);
    }
    if (list.length > max) out.push("", `…and ${list.length - max} more. Run \`npx threadctx scan\` locally for the full list.`);
  }
  const tools = result.tools.filter((t) => t.layers > 0);
  if (tools.length) {
    out.push("", "<details><summary>What each agent loads at the repository root (estimated tokens)</summary>", "");
    for (const t of tools) out.push(`- ${t.label}: ≈${t.alwaysTokenEstimate.toLocaleString("en-US")} tokens across ${t.layers} file${t.layers === 1 ? "" : "s"}`);
    out.push("", "</details>");
  }
  if (opts.orgAuditOwner !== undefined) {
    const owner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(opts.orgAuditOwner) ? opts.orgAuditOwner : "<your-org>";
    out.push("", `See every repository in your organisation: \`npx threadctx audit --org ${owner}\` (free summary).`);
  }
  out.push("", `<sub>[threadctx](https://threadctx.dev) ${result.engine.version}${opts.footerUrl ? ` · [history and badge](${opts.footerUrl})` : ""} · [how grades work](https://threadctx.dev/methodology)</sub>`);
  return `${out.join("\n")}\n`;
}

// --- Effective context (explain / diff) --------------------------------------------------

const LOAD_LABEL = { always: "always", "on-demand": "on demand", conditional: "matches", "agent-decides": "agent decides" } as const;

export function renderEffective(contexts: { label: string; ctx: EffectiveContext }[], opts: { color: boolean }): string {
  const p = painter(opts.color);
  const out: string[] = [];
  for (const { label, ctx } of contexts) {
    out.push(p.bold(`${label}`) + p.dim(`  ${ctx.targetPath}  ≈${ctx.tokenEstimate.toLocaleString("en-US")} tokens (estimate)`));
    if (!ctx.layers.length) out.push(p.dim("  (loads nothing from this repository)"));
    for (const l of ctx.layers) {
      out.push(`  ${String(l.precedence).padStart(2)}. ${l.path.padEnd(44)} ${p.cyan(LOAD_LABEL[l.loading].padEnd(13))} ${p.dim(`≈${l.tokenEstimate}`.padStart(6))}  ${p.dim(l.reason)}`);
    }
    for (const n of ctx.notes) out.push(p.dim(`  note: ${n}`));
    out.push("");
  }
  return out.join("\n");
}

export interface FactRow {
  topic: string;
  values: Record<string, string[]>;
}

/** Side-by-side facts per tool: the "what does each agent think the test command is" view. */
export function renderFactTable(rows: FactRow[], tools: string[], opts: { color: boolean }): string {
  const p = painter(opts.color);
  if (!rows.length) return p.dim("No comparable facts (commands, package manager, versions) found.\n");
  const width = 26;
  const head = `${"".padEnd(18)}${tools.map((t) => t.padEnd(width)).join("")}`;
  const lines = [p.bold(head)];
  for (const r of rows) {
    const vals = tools.map((t) => (r.values[t]?.length ? r.values[t]!.join(", ") : "—"));
    const differ = new Set(vals.filter((v) => v !== "—")).size > 1;
    const cells = vals.map((v) => (v.length > width - 2 ? `${v.slice(0, width - 3)}…` : v).padEnd(width));
    lines.push(`${(differ ? p.red(r.topic.padEnd(18)) : r.topic.padEnd(18))}${cells.join("")}${differ ? p.red(" ← differs") : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

// --- Badge -------------------------------------------------------------------------------

const BADGE_COLOR = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" } as const;

/** Where a README badge links when the repository is not on GitHub. */
export const BADGE_LINK = "https://threadctx.dev";

/** The repository's own grade page: the badge doubles as the opt-in for a public, shareable card. */
export function badgeLinkFor(fullName: string | undefined): string {
  return fullName && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName) ? `https://threadctx.dev/r/${fullName}` : BADGE_LINK;
}

export interface Badge {
  url: string;
  markdown: string;
  html: string;
}

/** Static shields.io badge: no server, works the moment it is pasted into a README. */
export function renderBadge(result: Pick<ScanResult, "grade" | "score">, link = BADGE_LINK): Badge {
  const url = `https://img.shields.io/badge/agent%20context-${result.grade}%20%C2%B7%20${result.score}-${BADGE_COLOR[result.grade]}`;
  const alt = `Agent context grade ${result.grade}`;
  return { url, markdown: `[![${alt}](${url})](${link})`, html: `<a href="${link}"><img src="${url}" alt="${alt}"></a>` };
}
/** A badge that stays current: shields.io reads the grade from threadctx.dev. Public repositories only. */
export function renderLiveBadge(fullName: string): Badge {
  const link = badgeLinkFor(fullName);
  const url = `https://img.shields.io/endpoint?url=${encodeURIComponent(`https://threadctx.dev/badge/${fullName}`)}`;
  const alt = "Agent context grade";
  return { url, markdown: `[![${alt}](${url})](${link})`, html: `<a href="${link}"><img src="${url}" alt="${alt}"></a>` };
}
export * from "./audit.js";
export * from "./evidence.js";
