// A minimal, read-only MCP server over stdio (newline-delimited JSON-RPC 2.0). No SDK dependency,
// so the CLI stays at zero runtime dependencies. It never writes files and never touches the network.
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ADAPTERS, getAdapter } from "@threadctx/adapters";
import { openRepo } from "@threadctx/discovery";
import { renderEffective, renderText } from "@threadctx/report";
import { ENGINE_VERSION, prepare, RULES, scan, type ScanResult } from "@threadctx/rules";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_TEXT = 20_000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export type McpResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const TOOLS = [
  {
    name: "check_context",
    description:
      "Grade the repository's agent instructions (AGENTS.md, CLAUDE.md, Cursor rules, Copilot instructions, GEMINI.md, MCP configs) and list problems: dead paths, undefined scripts, wrong package manager, duplicated or conflicting instructions, hidden characters, secrets. Call this after you edit any context file, and before relying on instructions you did not write.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Directory to check, relative to the project root. Defaults to the root." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_effective_context",
    description:
      "Show exactly which instruction files each coding agent loads for a given file or directory, in precedence order, with estimated token counts. Call this when an instruction seems ignored, when two tools behave differently, or before restructuring context files.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File or directory, relative to the project root." },
        tool: { type: "string", enum: ["all", ...ADAPTERS.map((a) => a.id)], description: "One tool, or all (default)." },
      },
      required: ["file"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "explain_rule",
    description: "Explain a threadctx rule id such as CTX-D001: what it checks, why it matters, how to fix it, and how precise it is.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Rule id, for example CTX-C001." } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const INSTRUCTIONS =
  "threadctx checks what AI coding agents are told. Use check_context after changing AGENTS.md, CLAUDE.md, .cursor/rules, Copilot instructions or MCP configs. Keep context minimal: remove stale, duplicated and generic instructions rather than adding more. All tools are read-only.";

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(truncated)` : text;
}

/** Resolve a user-supplied path inside the project root; throws when it escapes (including via symlinks). */
export function confine(root: string, input: string): string {
  const realRoot = realpathSync(root);
  const abs = resolve(realRoot, input);
  const real = existsSync(abs) ? realpathSync(abs) : abs;
  const rel = relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path is outside the project");
  return real;
}

function summarize(result: ScanResult): string {
  const open = result.findings.filter((f) => !f.suppressed && f.severity !== "info");
  const lines = [`Grade ${result.grade} (${result.score}/100): ${result.counts.blocker} blockers, ${result.counts.warning} warnings, ${result.counts.info} info.`];
  for (const f of open.slice(0, 25)) lines.push(`- ${f.severity} ${f.ruleId} ${f.path || "."}${f.line ? `:${f.line}` : ""}: ${f.message}${f.fix?.kind === "safe" ? " (fixable: threadctx fix)" : ""}`);
  if (open.length > 25) lines.push(`…and ${open.length - 25} more.`);
  const loaded = result.tools.filter((t) => t.layers > 0);
  if (loaded.length) {
    lines.push("Loaded at session start (estimates):");
    for (const t of result.tools) lines.push(`- ${t.label.split(" (")[0]}: ${t.alwaysLoaded.length ? `${t.alwaysLoaded.join(" → ")} (≈${t.alwaysTokenEstimate} tokens)` : "nothing"}`);
  }
  return lines.join("\n");
}

function callTool(name: string, args: Record<string, unknown>, root: string): string {
  switch (name) {
    case "check_context": {
      const dir = confine(root, typeof args.path === "string" ? args.path : ".");
      if (!statSync(dir).isDirectory()) throw new Error("path must be a directory");
      return summarize(scan(openRepo(dir), { now: new Date() }));
    }
    case "get_effective_context": {
      if (typeof args.file !== "string" || !args.file) throw new Error("file is required");
      const abs = confine(root, args.file);
      const rel = relative(realpathSync(root), abs).split(sep).join("/");
      const isDir = existsSync(abs) && statSync(abs).isDirectory();
      const repo = openRepo(root);
      const state = prepare(repo);
      const tool = typeof args.tool === "string" && args.tool !== "all" ? args.tool : undefined;
      const adapters = tool ? [getAdapter(tool)].filter((a): a is NonNullable<typeof a> => Boolean(a)) : ADAPTERS;
      if (tool && adapters.length === 0) throw new Error(`unknown tool '${tool}'`);
      return renderEffective(adapters.map((a) => ({ label: a.label, ctx: a.resolve({ path: rel === "" ? "" : rel, isDir }, state.catalog) })), { color: false });
    }
    case "explain_rule": {
      const id = String(args.id ?? "").toUpperCase();
      const r = RULES.find((x) => x.id === id);
      if (!r) throw new Error(`unknown rule '${id}'`);
      const bench = r.benchmark ? ` Measured on public repositories: ${r.benchmark.findings} findings, ${(r.benchmark.rate * 100).toFixed(1)}% false positives.` : "";
      return `${r.id}: ${r.title}\nSeverity ${r.severity}, ${r.determinism}, ${r.status}.${bench}\nWhy: ${r.rationale}\nFix: ${r.remediation}\nSource: ${r.citation}`;
    }
    default:
      throw new Error(`unknown tool '${name}'`);
  }
}

/** Handle one JSON-RPC message. Returns undefined for notifications. */
export function handleMessage(raw: unknown, root: string): McpResponse | undefined {
  const msg = raw as Partial<JsonRpcRequest> | null;
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: (msg as { id?: string | number } | null)?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;
  const ok = (result: unknown): McpResponse | undefined => (isNotification ? undefined : { jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): McpResponse | undefined => (isNotification ? undefined : { jsonrpc: "2.0", id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "threadctx", title: "threadctx: agent context integrity", version: ENGINE_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string" || !TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${String(name)}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok({ content: [{ type: "text", text: clip(callTool(name, args, root)) }] });
      } catch (e) {
        // Tool failures are results, not protocol errors, so the model can see and react to them.
        return ok({ isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return undefined;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

/** Serve MCP over the given streams until stdin ends. */
export async function serveMcp(io: { stdin: NodeJS.ReadableStream; write: (s: string) => void; root: string }): Promise<void> {
  let buffer = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      io.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of batch) {
      const res = handleMessage(m, io.root);
      if (res) io.write(`${JSON.stringify(res)}\n`);
    }
  };
  await new Promise<void>((done) => {
    io.stdin.setEncoding?.("utf8");
    io.stdin.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    io.stdin.on("end", () => {
      handle(buffer);
      done();
    });
  });
}

export { renderText };
