import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { ADAPTERS, getAdapter, resolveCopilot, type CopilotSurface, type Target } from "@threadctx/adapters";
import { LICENSE_PROBLEM, normalizeCommand, verifyLicense, type EffectiveContext } from "@threadctx/core";
import type { FsView } from "@threadctx/core";
import { openRepo, type RepoView } from "@threadctx/discovery";
import { badgeLinkFor, renderBadge, renderLiveBadge, renderEffective, renderFactTable, renderJson, renderMarkdown, renderSarif, renderText, type FactRow } from "@threadctx/report";
import {
  ConfigError, ENGINE_VERSION, exitCodeFor, loadConfig, PackError, parsePack, prepare, REGISTRY_VERSION, RULES, scan,
  type ScanConfig, type ScanResult,
} from "@threadctx/rules";
import { execFileSync } from "node:child_process";
import { planFixes } from "./fix.js";
import { WORKFLOW_PATH, withBadge, workflowYaml } from "./init.js";
import { openPullRequest, PrError } from "./pr.js";
import { gitHistory, githubRemote, gitRoot } from "./git.js";
import { serveMcp } from "./mcp.js";
import { AuditUsageError, describeLicense, findLicense, runAudit } from "./audit.js";
import { CompareError, compareExitCode, compareScans, parseScanJson } from "./compare.js";
import { fetchRemoteRepo, githubToken } from "./remote.js";

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
  now: () => Date;
  /** Standard input, for `threadctx mcp`. */
  stdin?: NodeJS.ReadableStream;
}

export class UsageError extends Error {}

const HELP = `threadctx ${ENGINE_VERSION} — scan, fix and explain what every AI coding agent is told

Usage:
  threadctx scan [path]            Find and grade agent context (AGENTS.md, CLAUDE.md, Cursor,
                                   Copilot and Gemini files, MCP configs)
      --format text|json|sarif|md  Output format (default text)
      --output <file>              Write the report to a file instead of stdout
      --fail-on blocker|warning|info|none
                                   Exit 1 when a finding is at or above this level
                                   (default: config failOn, else blocker)
      --github <owner/repo[@ref]>  Scan a public GitHub repository without cloning it
                                   (network access happens only with this flag)
      --rule <id>                  Only run these rules (repeatable)
      --verbose                    Show info-level findings in text output
  threadctx badge [path]           Print a README badge with the current grade
  threadctx compare <base.json> <head.json> [--format text|md|json] [--fail-on blocker|warning|info|none]
                                   What a change introduced, from two 'scan --format json' files.
                                   Existing findings never fail; only new ones do (net-new ratchet)
  threadctx mcp                    Run as a read-only MCP server (stdio) so agents can check their own
                                   instructions: check_context, get_effective_context, explain_rule
  threadctx audit --org <name>     Grade every repository of a GitHub organisation or user, and find where
                                   they disagree. Free: fleet grade and headline findings. With a licence:
                                   full HTML report, CSV and JSON. Code never leaves your machine.
      --max <n>                    Most recently pushed repositories to include (default 200)
      --include-forks --include-archived
      --license <key|file>         Licence key (or THREADCTX_LICENSE, or ~/.threadctx/license)
      --output-dir <dir>           Where licensed reports are written
      --baseline <audit.json>      Show what changed since a previous audit (automatic when
                                   re-running into the same folder)
  threadctx license [key|file]     Check a licence offline
  threadctx explain <file> [--tool <id>|all] [--surface cloud-agent|code-review|chat]
                                   What each agent loads for this file, in precedence order
  threadctx diff [--path <dir>]    What each agent believes about the same directory
  threadctx fix [path] [--apply] [--output <patch>] [--pr]
                                   Safe fixes as a patch (never commits; --apply writes files;
                                   --pr opens a pull request with them, using git and gh)
  threadctx init [path] [--pr] [--no-badge] [--force]
                                   Add the GitHub Action workflow and a README grade badge
                                   (--pr opens a pull request instead of writing files)
  threadctx rules [id]             List rules, or show one
  threadctx tools                  List tool adapters and when each was verified
  threadctx pack validate <file>   Check a rule pack before using it

Common options: --json (explain, diff, rules, tools), --no-color, --version, --help

Exit codes: 0 passed · 1 findings at or above the threshold · 2 usage or config error
Docs: https://threadctx.dev/docs · Rules: https://threadctx.dev/rules
`;

const OPTIONS = {
  format: { type: "string" },
  output: { type: "string" },
  "fail-on": { type: "string" },
  github: { type: "string" },
  org: { type: "string" },
  max: { type: "string" },
  license: { type: "string" },
  "include-forks": { type: "boolean" },
  "include-archived": { type: "boolean" },
  "output-dir": { type: "string" },
  baseline: { type: "string" },
  rule: { type: "string", multiple: true },
  verbose: { type: "boolean" },
  tool: { type: "string" },
  surface: { type: "string" },
  path: { type: "string" },
  apply: { type: "boolean" },
  pr: { type: "boolean" },
  "no-badge": { type: "boolean" },
  force: { type: "boolean" },
  json: { type: "boolean" },
  color: { type: "boolean" },
  "no-color": { type: "boolean" },
  "no-telemetry": { type: "boolean" },
  "no-history": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    return await run(argv, io);
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError || e instanceof PackError) {
      io.stderr(`threadctx: ${e.message}\n`);
      return 2;
    }
    io.stderr(`threadctx: unexpected error: ${(e as Error).stack ?? e}\nPlease report it at https://github.com/threadctx-dev/threadctx-cli/issues\n`);
    return 2;
  }
}

async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError(`${(e as Error).message}\nRun 'threadctx --help' for usage.`);
  }
  const { values: v, positionals } = parsed;
  if (v.version) {
    io.stdout(`threadctx ${ENGINE_VERSION} (rules ${REGISTRY_VERSION})\n`);
    return 0;
  }
  const [command = "help", ...args] = positionals;
  if (v.help || command === "help") {
    io.stdout(HELP);
    return 0;
  }
  const color = v["no-color"] ? false : v.color ? true : io.isTTY && !io.env.NO_COLOR && io.env.TERM !== "dumb";

  switch (command) {
    case "scan":
      return cmdScan(args[0], v, io, color);
    case "badge":
      return cmdBadge(args[0], v, io);
    case "mcp":
      if (!io.stdin) throw new UsageError("mcp needs standard input");
      await serveMcp({ stdin: io.stdin, write: io.stdout, root: io.cwd });
      return 0;
    case "audit":
      return cmdAudit(v, io, color);
    case "license":
      return cmdLicense(args[0], v, io);
    case "compare":
      return cmdCompare(args[0], args[1], v, io);
    case "explain":
      return cmdExplain(args[0], v, io, color);
    case "diff":
      return cmdDiff(v, io, color);
    case "fix":
      return cmdFix(args[0], v, io);
    case "init":
      return cmdInit(args[0], v, io);
    case "rules":
      return cmdRules(args[0], v, io);
    case "tools":
      return cmdTools(v, io);
    case "pack":
      if (args[0] !== "validate" || !args[1]) throw new UsageError("usage: threadctx pack validate <file>");
      return cmdPackValidate(args[1], io);
    default:
      throw new UsageError(`unknown command '${command}'. Run 'threadctx --help' for usage.`);
  }
}

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function openRoot(pathArg: string | undefined, io: Io): RepoView {
  const target = resolve(io.cwd, pathArg ?? ".");
  if (!existsSync(target)) throw new UsageError(`path not found: ${pathArg}`);
  if (!statSync(target).isDirectory()) throw new UsageError(`not a directory: ${pathArg} (scan takes a repository or directory)`);
  return openRepo(target);
}

function doScan(repo: RepoView, v: Values, io: Io): ScanResult {
  const history = v["no-history"] ? undefined : gitHistory(repo.root);
  return scan(repo, { history, now: io.now(), only: v.rule });
}

/** `owner/repo`, `owner/repo@ref` or a github.com URL. */
export function parseGithubRef(input: string): { fullName: string; ref?: string } {
  const m = input.trim().match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^\s]+?))?(?:@([^\s]+))?\/?$/);
  if (!m) throw new UsageError(`--github expects owner/repo, owner/repo@ref or a github.com URL (got '${input}')`);
  return { fullName: `${m[1]}/${m[2]}`, ref: m[4] ?? m[3] };
}

async function openGithub(spec: string, io: Io): Promise<{ view: FsView; label: string }> {
  const { fullName, ref } = parseGithubRef(spec);
  try {
    const remote = await fetchRemoteRepo(fullName, { ref, token: githubToken(io.env) });
    if (remote.truncated) io.stderr(`note: ${fullName} is too large for GitHub's tree API; some files may be missing.\n`);
    return { view: remote.view, label: `github.com/${fullName}@${remote.sha.slice(0, 7)}` };
  } catch (e) {
    const msg = (e as Error).message;
    if (/\b404\b/.test(msg)) throw new UsageError(`${fullName} was not found. It may be private; set GH_TOKEN (or run 'gh auth login') to scan repositories you can access.`);
    if (/\b(403|429)\b/.test(msg)) throw new UsageError(`GitHub rate limit reached while reading ${fullName}. Set GH_TOKEN (or run 'gh auth login') for a higher limit.`);
    throw new UsageError(`could not read ${fullName} from GitHub: ${msg.slice(0, 200)}`);
  }
}

async function cmdScan(pathArg: string | undefined, v: Values, io: Io, color: boolean): Promise<number> {
  const format = v.format ?? "text";
  if (!["text", "json", "sarif", "md"].includes(format)) throw new UsageError(`--format must be text, json, sarif or md (got '${format}')`);
  const failOn = v["fail-on"];
  if (failOn && !["blocker", "warning", "info", "none"].includes(failOn)) throw new UsageError("--fail-on must be blocker, warning, info or none");
  if (v.github && pathArg) throw new UsageError("use either a path or --github, not both");
  let view: FsView;
  let result: ScanResult;
  let remoteLabel: string | undefined;
  if (v.github) {
    const g = await openGithub(v.github, io);
    view = g.view;
    remoteLabel = g.label;
    result = scan(view, { now: io.now(), only: v.rule });
  } else {
    const repo = openRoot(pathArg, io);
    view = repo;
    result = doScan(repo, v, io);
  }
  const out =
    format === "json" ? renderJson(result)
    : format === "sarif" ? renderSarif(result)
    : format === "md" ? renderMarkdown(result)
    : renderText(result, { color: v.output ? false : color, verbose: Boolean(v.verbose), next: !v.output && !remoteLabel ? nextSteps(result, v, io) : undefined });
  if (v.output) {
    const dest = resolve(io.cwd, v.output);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
    io.stderr(`Wrote ${format} report to ${relative(io.cwd, dest) || dest} — grade ${result.grade}, ${result.counts.blocker} blocker, ${result.counts.warning} warning\n`);
  } else {
    if (remoteLabel && format === "text") io.stdout(`Scanned ${remoteLabel}\n\n`);
    io.stdout(out);
  }
  if (remoteLabel && format === "text" && !v.output) io.stdout(`\nREADME badge:\n${renderBadge(result, badgeLinkFor(parseGithubRef(v.github!).fullName)).markdown}\n`);
  if (format === "text" && !v.output && !remoteLabel) maybeUpgradeLine(result, io, githubRemote(view.root));
  const threshold = (failOn as ScanConfig["failOn"] | undefined) ?? loadConfig(view).failOn;
  return exitCodeFor(result, threshold);
}

function cmdCompare(baseFile: string | undefined, headFile: string | undefined, v: Values, io: Io): number {
  if (!baseFile || !headFile) throw new UsageError("usage: threadctx compare <base.json> <head.json>");
  const failOn = (v["fail-on"] ?? "blocker") as ScanConfig["failOn"];
  if (!["blocker", "warning", "info", "none"].includes(failOn)) throw new UsageError("--fail-on must be blocker, warning, info or none");
  const format = v.format ?? "text";
  if (!["text", "md", "json"].includes(format)) throw new UsageError("--format must be text, md or json");
  const readScan = (file: string) => {
    const abs = resolve(io.cwd, file);
    if (!existsSync(abs)) throw new UsageError(`file not found: ${file}`);
    try {
      return parseScanJson(readFileSync(abs, "utf8"), file);
    } catch (e) {
      if (e instanceof CompareError) throw new UsageError(e.message);
      throw e;
    }
  };
  const base = readScan(baseFile);
  const head = readScan(headFile);
  const c = compareScans(base, head);
  const delta = head.score - base.score;
  let out: string;
  if (format === "json") out = `${JSON.stringify({ base: c.base, head: c.head, added: c.added, fixed: c.fixed, existing: c.existing }, null, 2)}\n`;
  else if (format === "md") {
    const owner = io.env.GITHUB_REPOSITORY_OWNER ?? io.env.GITHUB_REPOSITORY?.split("/")[0] ?? "";
    const md = renderMarkdown(head, { baseline: { grade: base.grade, score: base.score }, newFingerprints: new Set(c.added.map((f) => f.fingerprint)), orgAuditOwner: owner });
    out = c.fixed.length ? md.replace("\n<sub>", `\n✅ **${c.fixed.length} fixed** by this change.\n\n<sub>`) : md;
  } else {
    const lines = [`Grade ${base.grade} → ${head.grade} (${delta > 0 ? "+" : ""}${delta})`, `${c.added.length} new · ${c.fixed.length} fixed · ${c.existing} existing`];
    for (const f of c.added) lines.push(`  new ${f.severity.padEnd(7)} ${f.path}${f.line ? `:${f.line}` : ""} ${f.message} ${f.ruleId}`);
    out = `${lines.join("\n")}\n`;
  }
  if (v.output) {
    const dest = resolve(io.cwd, v.output);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
  } else io.stdout(out);
  return compareExitCode(c, failOn);
}

/** Re-running into the same folder compares with the last run automatically. */
function defaultBaseline(org: string, outDir: string | undefined, license: string | undefined, io: Io): string | undefined {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(org)) return undefined;
  const file = join(resolve(io.cwd, outDir ?? `threadctx-audit-${org}`), "audit.json");
  return existsSync(file) && findLicense(license, io) ? file : undefined;
}

async function cmdAudit(v: Values, io: Io, color: boolean): Promise<number> {
  if (!v.org) throw new UsageError("usage: threadctx audit --org <github-org-or-user>");
  try {
    return await runAudit({ org: v.org, max: v.max ? Number(v.max) : 200, includeForks: Boolean(v["include-forks"]), includeArchived: Boolean(v["include-archived"]), license: v.license, outDir: v["output-dir"], baseline: v.baseline ?? defaultBaseline(v.org, v["output-dir"], v.license, io), json: Boolean(v.json), color }, io);
  } catch (e) {
    if (e instanceof AuditUsageError) throw new UsageError(e.message);
    throw e;
  }
}

function cmdLicense(arg: string | undefined, v: Values, io: Io): number {
  const found = findLicense(arg ?? v.license, io);
  if (!found) {
    io.stderr("No licence found. Pass a key or file, set THREADCTX_LICENSE, or save it to ~/.threadctx/license.\n");
    return 1;
  }
  const check = verifyLicense(found.key, { now: io.now() });
  if (!check.ok) {
    io.stderr(`The licence from ${found.source} ${LICENSE_PROBLEM[check.reason]}.\n`);
    return 1;
  }
  io.stdout(`${describeLicense(check.claims)}\nsource: ${found.source}\n`);
  return 0;
}

function cmdBadge(pathArg: string | undefined, v: Values, io: Io): number {
  const repo = openRoot(pathArg, io);
  const result = doScan(repo, v, io);
  const badge = renderBadge(result, badgeLinkFor(githubRemote(repo.root)));
  if (v.json) io.stdout(`${JSON.stringify({ grade: result.grade, score: result.score, ...badge }, null, 2)}\n`);
  else io.stdout(`${badge.markdown}\n`);
  io.stderr(`Grade ${result.grade} (${result.score}/100). Paste the line above into your README.\n`);
  return 0;
}

/** Repository root plus the target path relative to it. */
function locate(fileArg: string, io: Io): { repo: RepoView; target: Target } {
  // Resolve symlinks (macOS /var -> /private/var) so paths compare with git's real root.
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const given = resolve(io.cwd, fileArg);
  const abs = existsSync(given) ? real(given) : join(real(dirname(given)), basename(given));
  const root = real(gitRoot(existsSync(abs) && statSync(abs).isDirectory() ? abs : dirname(abs)) ?? io.cwd);
  const rel = relative(root, abs).split(sep).join("/");
  if (rel.startsWith("..")) throw new UsageError(`${fileArg} is outside the repository at ${root}`);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  return { repo: openRepo(root), target: { path: rel === "" ? "" : rel, isDir } };
}

function contextsFor(repo: RepoView, target: Target, toolArg: string | undefined, surface: string | undefined): { label: string; ctx: EffectiveContext }[] {
  const state = prepare(repo);
  const tools = !toolArg || toolArg === "all" ? ADAPTERS : [getAdapter(toolArg) ?? fail(`unknown tool '${toolArg}'. Known: ${ADAPTERS.map((a) => a.id).join(", ")}`)];
  if (surface && !["cloud-agent", "code-review", "chat"].includes(surface)) throw new UsageError("--surface must be cloud-agent, code-review or chat");
  return tools.map((a) => ({
    label: a.id === "copilot" && surface ? `${a.label} (${surface})` : a.label,
    ctx: a.id === "copilot" && surface ? resolveCopilot(target, state.catalog, surface as CopilotSurface) : a.resolve(target, state.catalog),
  }));
}

function fail(message: string): never {
  throw new UsageError(message);
}

function cmdExplain(fileArg: string | undefined, v: Values, io: Io, color: boolean): number {
  if (!fileArg) throw new UsageError("usage: threadctx explain <file> [--tool <id>|all]");
  const { repo, target } = locate(fileArg, io);
  const contexts = contextsFor(repo, target, v.tool, v.surface);
  if (v.json) io.stdout(`${JSON.stringify(contexts.map((c) => c.ctx), null, 2)}\n`);
  else io.stdout(renderEffective(contexts, { color }));
  return 0;
}

function cmdDiff(v: Values, io: Io, color: boolean): number {
  const { repo, target } = locate(v.path ?? ".", io);
  const dirTarget: Target = { path: target.path, isDir: true };
  const contexts = contextsFor(repo, dirTarget, "all", undefined).filter((c) => c.ctx.layers.length > 0);
  const state = prepare(repo);
  const rows = new Map<string, Record<string, string[]>>();
  for (const { ctx } of contexts) {
    for (const layer of ctx.layers) {
      if (layer.loading === "agent-decides") continue;
      const a = state.catalog.get(layer.path);
      for (const d of a?.directives ?? []) {
        if (d.kind === "prohibition") continue;
        for (const f of d.facts) {
          if (f.topicKey === "cmd.install") continue;
          const row = rows.get(f.topicKey) ?? {};
          const val = f.topicKey.startsWith("cmd.") ? normalizeCommand(f.value) : f.value;
          const list = row[ctx.tool] ?? [];
          if (!list.includes(val)) list.push(val);
          row[ctx.tool] = list;
          rows.set(f.topicKey, row);
        }
      }
    }
  }
  const factRows: FactRow[] = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([topic, values]) => ({ topic, values }));
  if (v.json) {
    io.stdout(`${JSON.stringify({ path: dirTarget.path || ".", tools: contexts.map((c) => c.ctx), facts: factRows }, null, 2)}\n`);
    return 0;
  }
  io.stdout(`What each agent is told for ${dirTarget.path || "the repository root"}/\n\n`);
  io.stdout(renderFactTable(factRows, contexts.map((c) => c.ctx.tool), { color }));
  io.stdout("\n");
  io.stdout(renderEffective(contexts, { color }));
  return 0;
}

function cmdFix(pathArg: string | undefined, v: Values, io: Io): number {
  const repo = openRoot(pathArg, io);
  const result = doScan(repo, v, io);
  const plan = planFixes(repo, result.findings);
  for (const s of plan.skipped) io.stderr(`skipped ${s.finding.ruleId} at ${s.finding.path}:${s.finding.line ?? ""}: ${s.reason}\n`);
  if (plan.files.size === 0) {
    io.stderr("No safe fixes to apply.\n");
    return 0;
  }
  if (v.pr) {
    const after = new Map([...plan.files].map(([p, f]) => [p, f.after] as const));
    const byRule = new Map<string, number>();
    for (const f of plan.applied) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    const n = plan.applied.length;
    const body = [
      `This pull request applies ${n} safe, mechanical fix${n === 1 ? "" : "es"} to the instructions AI coding agents read in this repository.`,
      "",
      "| Rule | Fixes | What it fixes |",
      "|---|---|---|",
      ...[...byRule].sort().map(([id, c]) => `| [${id}](https://threadctx.dev/rules/${id}) | ${c} | ${RULES.find((r) => r.id === id)?.title ?? ""} |`),
      "",
      `Grade before: **${result.grade}** (${result.score}/100). Every change is a deterministic edit; review the diff as usual.`,
      "",
      "<sub>Generated with [threadctx](https://threadctx.dev), which grades what every coding agent is told. Run `npx threadctx scan` to check locally.</sub>",
    ].join("\n");
    return withPr(() => openPullRequest({ root: repo.root, env: io.env, branch: "threadctx/fix-agent-context", files: after, title: `Fix agent context: ${n} safe fix${n === 1 ? "" : "es"}`, body, log: io.stderr }), io);
  }
  if (v.apply) {
    for (const [p, { after }] of plan.files) writeFileSync(join(repo.root, p), after);
    io.stderr(`Applied ${plan.applied.length} fix${plan.applied.length === 1 ? "" : "es"} to ${plan.files.size} file${plan.files.size === 1 ? "" : "s"}. Review with git diff; nothing was committed.\n`);
    return 0;
  }
  if (v.output) {
    writeFileSync(resolve(io.cwd, v.output), plan.patch);
    io.stderr(`Wrote ${plan.applied.length} fix${plan.applied.length === 1 ? "" : "es"} to ${v.output}. Apply with: git apply ${v.output}\n`);
  } else {
    io.stdout(plan.patch);
    io.stderr(`${plan.applied.length} safe fix${plan.applied.length === 1 ? "" : "es"}. Apply with --apply, or pipe to 'git apply'.\n`);
  }
  return 0;
}

function withPr(open: () => string, io: Io): number {
  try {
    const url = open();
    io.stdout(`${url}\n`);
    io.stderr("Pull request opened. Nothing else in your working tree was changed.\n");
    return 0;
  } catch (e) {
    if (e instanceof PrError) throw new UsageError(e.message);
    throw e;
  }
}

/** True only when gh confirms the repository is public, so a live badge can read it. */
function isPublicOnGitHub(root: string, env: NodeJS.ProcessEnv): boolean {
  try {
    return execFileSync("gh", ["repo", "view", "--json", "visibility", "--jq", ".visibility"], { cwd: root, env, stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).toString().trim() === "PUBLIC";
  } catch {
    return false;
  }
}

function cmdInit(pathArg: string | undefined, v: Values, io: Io): number {
  const repo = openRoot(pathArg, io);
  const files = new Map<string, string>();
  const notes: string[] = [];
  if (existsSync(join(repo.root, WORKFLOW_PATH)) && !v.force) notes.push(`${WORKFLOW_PATH} already exists (use --force to replace it)`);
  else files.set(WORKFLOW_PATH, workflowYaml());

  if (!v["no-badge"]) {
    const result = doScan(repo, v, io);
    const fullName = githubRemote(repo.root);
    const badge = fullName && isPublicOnGitHub(repo.root, io.env) ? renderLiveBadge(fullName) : renderBadge(result, badgeLinkFor(fullName));
    const readmeName = ["README.md", "readme.md", "Readme.md"].find((n) => existsSync(join(repo.root, n)));
    if (!readmeName) notes.push(`no README.md; add this badge where you like:\n  ${badge.markdown}`);
    else {
      const before = readFileSync(join(repo.root, readmeName), "utf8");
      const after = withBadge(before, badge.markdown);
      if (after === before) notes.push(`${readmeName} already has an agent context badge`);
      else files.set(readmeName, after);
    }
  }
  for (const n of notes) io.stderr(`note: ${n}\n`);
  if (files.size === 0) {
    io.stderr("Nothing to add.\n");
    return 0;
  }
  if (v.pr) {
    const body = [
      "Adds an agent context check to this repository:",
      "",
      ...(files.has(WORKFLOW_PATH) ? [`- \`${WORKFLOW_PATH}\`: on every pull request, grades what AI coding agents are told (AGENTS.md, CLAUDE.md, Cursor, Copilot, Gemini, MCP config) and comments with the change. Only problems a pull request introduces can fail it. Pinned by commit.`] : []),
      ...([...files.keys()].some((p) => p !== WORKFLOW_PATH) ? ["- A README badge showing the current grade."] : []),
      "",
      "No code or secrets leave the runner. <sub>[threadctx](https://threadctx.dev)</sub>",
    ].join("\n");
    return withPr(() => openPullRequest({ root: repo.root, env: io.env, branch: "threadctx/agent-context-check", files, title: "Add agent context check", body, log: io.stderr }), io);
  }
  for (const [p, content] of files) {
    mkdirSync(dirname(join(repo.root, p)), { recursive: true });
    writeFileSync(join(repo.root, p), content);
    io.stderr(`wrote ${p}\n`);
  }
  io.stderr("Commit these files to turn on the check. Nothing was committed.\n");
  return 0;
}

function cmdRules(id: string | undefined, v: Values, io: Io): number {
  if (id) {
    const r = RULES.find((x) => x.id.toLowerCase() === id.toLowerCase());
    if (!r) throw new UsageError(`unknown rule '${id}'`);
    if (v.json) io.stdout(`${JSON.stringify(r, null, 2)}\n`);
    else {
      const bench = r.benchmark
        ? `Benchmark: ${r.benchmark.findings} findings in ${r.benchmark.repos} public repos, ${(r.benchmark.rate * 100).toFixed(1)}% false positives${r.demotedFrom ? ` (over the 5% budget: demoted from ${r.demotedFrom})` : ""}`
        : "Benchmark: no findings in the corpus yet";
      io.stdout(`${r.id}  ${r.title}\n\nFamily: ${r.family} · Severity: ${r.severity} · ${r.determinism} · autofix: ${r.autofix} · ${r.status} · runs: ${r.availability}\n${bench}\n\nWhy: ${r.rationale}\nFix: ${r.remediation}\nSource: ${r.citation}\nDocs: https://threadctx.dev/rules/${r.id}\n`);
    }
    return 0;
  }
  if (v.json) io.stdout(`${JSON.stringify(RULES, null, 2)}\n`);
  else for (const r of RULES) io.stdout(`${r.id}  ${r.severity.padEnd(7)}  ${r.status.padEnd(4)}  ${r.availability === "local" ? "" : `[${r.availability}] `}${r.title}\n`);
  return 0;
}

function cmdTools(v: Values, io: Io): number {
  const now = io.now();
  const rows = ADAPTERS.map((a) => ({ id: a.id, label: a.label, status: a.status, verified: a.verifiedAgainst.date, docs: a.verifiedAgainst.docsUrl, ageDays: Math.floor((now.getTime() - Date.parse(a.verifiedAgainst.date)) / 86_400_000), summary: a.summary, caveats: a.caveats }));
  if (v.json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
  else for (const r of rows) io.stdout(`${r.id.padEnd(12)} ${r.status.padEnd(5)} verified ${r.verified}${r.ageDays > 60 ? " (STALE)" : ""}  ${r.summary}\n`);
  return 0;
}

function cmdPackValidate(file: string, io: Io): number {
  const abs = resolve(io.cwd, file);
  if (!existsSync(abs)) throw new UsageError(`file not found: ${file}`);
  const pack = parsePack(readFileSync(abs, "utf8"), file);
  io.stdout(`${pack.pack}: ${pack.rules.length} rule${pack.rules.length === 1 ? "" : "s"} valid\n`);
  for (const r of pack.rules) io.stdout(`  ${pack.pack}/${r.id}  ${r.severity}  ${r.title}\n`);
  return 0;
}

// --- Upgrade line (spec §8.2): interactive only, once a day, never in CI ----------------

/** Set when the paid capability exists (Phase 2). Until then no upgrade line is printed. */
/** Commands worth running next, with this repository's real counts. Interactive terminals only, never in CI or pipes. */
export function nextSteps(result: ScanResult, v: { verbose?: boolean }, io: Pick<Io, "isTTY" | "env">): [string, string][] | undefined {
  if (!io.isTTY || io.env.CI || io.env.THREADCTX_NO_UPSELL || io.env.THREADCTX_NO_HINTS) return undefined;
  const open = result.findings.filter((f) => !f.suppressed);
  const out: [string, string][] = [];
  const hidden = v.verbose ? [] : open.filter((f) => f.severity === "info");
  if (hidden.length) {
    const byRule = new Map<string, number>();
    for (const f of hidden) byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
    const top = [...byRule].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, n]) => `${RULES.find((r) => r.id === id)?.title ?? id}${n > 1 ? ` (${n})` : ""}`);
    out.push(["threadctx scan --verbose", `${hidden.length} hidden info finding${hidden.length === 1 ? "" : "s"}: ${top.join("; ")}`]);
  }
  if (result.tools.some((t) => t.layers > 0)) out.push(["threadctx explain <file>", "which files each agent loads for that file, in order, with token estimates"]);
  const fixable = open.filter((f) => f.fix?.kind === "safe").length;
  if (fixable) out.push(["threadctx fix --pr", `${fixable} safe fix${fixable === 1 ? "" : "es"} in one pull request`]);
  return out.length ? out : undefined;
}

export const UPGRADE_URL: string | undefined = "https://threadctx.dev/pricing";

function maybeUpgradeLine(result: ScanResult, io: Io, remote?: string): void {
  if (!UPGRADE_URL || !io.isTTY || io.env.CI || io.env.THREADCTX_NO_UPSELL) return;
  const stateFile = join(io.env.THREADCTX_HOME ?? join(homedir(), ".threadctx"), "state.json");
  let state: { lastUpsell?: string } = {};
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8")) as typeof state;
  } catch {
    /* first run */
  }
  const today = io.now().toISOString().slice(0, 10);
  if (state.lastUpsell === today) return;
  const owner = remote?.split("/")[0];
  // One line, at most once a day, interactive terminals only: point at the next useful step, which is free.
  const msg = owner
    ? `See every repository in ${owner} at once (free summary): npx threadctx audit --org ${owner}   · ${UPGRADE_URL}`
    : `Add a README badge: npx threadctx badge   · Whole-organisation audits: ${UPGRADE_URL}`;
  io.stderr(`\n${msg}\n`);
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ ...state, lastUpsell: today }));
  } catch {
    /* read-only home: skip */
  }
}
