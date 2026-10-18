// MCP client configuration discovery.
// Derived from curatedmcp-launcher src/evidence/collect.ts (oneprofile-dev/mcp-launcher@80f4d67, MIT)
// and mcp-auditor src/scanner.ts (oneprofile-dev/mcp-auditor, MIT). Changes: repo-level and
// machine-level sources split; corrected Windows Cursor/Windsurf, Linux VS Code and Claude
// Desktop paths; VS Code `servers` key; Gemini CLI and Codex sources added; values are kept
// in memory only for secret checks and are never emitted.
import { posix } from "node:path";
import type { FsView } from "@threadctx/core";

export type McpClient = "claude-code" | "claude-desktop" | "cursor" | "vscode" | "windsurf" | "gemini" | "codex";

export interface McpServerEntry {
  client: McpClient;
  scope: "repo" | "user";
  /** Repo-relative path for repo scope, ~-relative for user scope. */
  sourcePath: string;
  name: string;
  /** 1-based line of the server's key in the source file (best effort). */
  line: number;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args: string[];
  url?: string;
  /** Environment variable and header names with their literal values (in memory only). */
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface McpSourceDef {
  client: McpClient;
  path: string;
  format: "mcpServers" | "vscode" | "claude-user" | "codex-toml";
}

/** Project-level MCP configuration files, relative to the repo root. */
export const REPO_MCP_SOURCES: McpSourceDef[] = [
  { client: "claude-code", path: ".mcp.json", format: "mcpServers" },
  { client: "cursor", path: ".cursor/mcp.json", format: "mcpServers" },
  { client: "vscode", path: ".vscode/mcp.json", format: "vscode" },
  { client: "gemini", path: ".gemini/settings.json", format: "mcpServers" },
  { client: "codex", path: ".codex/config.toml", format: "codex-toml" },
];

/** Machine-level sources. Only read with an explicit `--machine` flag, never in CI by default. */
export function machineMcpSources(home: string, platform: NodeJS.Platform, appData?: string): McpSourceDef[] {
  const j = (...p: string[]) => posix.join(home.split("\\").join("/"), ...p);
  const roaming = (appData ?? j("AppData", "Roaming")).split("\\").join("/");
  const defs: McpSourceDef[] = [
    { client: "claude-code", path: j(".claude.json"), format: "claude-user" },
    { client: "cursor", path: j(".cursor", "mcp.json"), format: "mcpServers" },
    { client: "windsurf", path: j(".codeium", "windsurf", "mcp_config.json"), format: "mcpServers" },
    { client: "gemini", path: j(".gemini", "settings.json"), format: "mcpServers" },
    { client: "codex", path: j(".codex", "config.toml"), format: "codex-toml" },
  ];
  if (platform === "darwin") {
    defs.push(
      { client: "claude-desktop", path: j("Library", "Application Support", "Claude", "claude_desktop_config.json"), format: "mcpServers" },
      { client: "vscode", path: j("Library", "Application Support", "Code", "User", "mcp.json"), format: "vscode" },
    );
  } else if (platform === "win32") {
    defs.push(
      { client: "claude-desktop", path: posix.join(roaming, "Claude", "claude_desktop_config.json"), format: "mcpServers" },
      { client: "vscode", path: posix.join(roaming, "Code", "User", "mcp.json"), format: "vscode" },
    );
  } else {
    defs.push(
      { client: "claude-desktop", path: j(".config", "Claude", "claude_desktop_config.json"), format: "mcpServers" },
      { client: "vscode", path: j(".config", "Code", "User", "mcp.json"), format: "vscode" },
    );
  }
  return defs;
}

export interface McpParseResult {
  servers: McpServerEntry[];
  error?: string;
}

/** Strip // and /* *\/ comments and trailing commas (VS Code JSONC) outside strings. */
export function stripJsonc(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function strMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === "string" ? x : JSON.stringify(x)]));
}

function lineOfKey(text: string, key: string): number {
  const idx = text.search(new RegExp(`["']?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*[:=\\]]`));
  return idx === -1 ? 1 : text.slice(0, idx).split("\n").length;
}

function entry(def: McpSourceDef, scope: McpServerEntry["scope"], sourcePath: string, name: string, raw: Record<string, unknown>, text: string): McpServerEntry {
  const url = typeof raw.url === "string" ? raw.url : typeof raw.serverUrl === "string" ? raw.serverUrl : typeof raw.httpUrl === "string" ? raw.httpUrl : undefined;
  const type = typeof raw.type === "string" ? raw.type.toLowerCase() : typeof raw.transport === "string" ? raw.transport.toLowerCase() : undefined;
  const transport: McpServerEntry["transport"] = type === "sse" ? "sse" : type === "http" || type === "streamable-http" || type === "streamablehttp" ? "http" : url ? "http" : typeof raw.command === "string" ? "stdio" : "unknown";
  return {
    client: def.client,
    scope,
    sourcePath,
    name,
    line: lineOfKey(text, name),
    transport,
    command: typeof raw.command === "string" ? raw.command : undefined,
    args: strArr(raw.args),
    url,
    env: strMap(raw.env),
    headers: strMap(raw.headers),
  };
}

export function parseMcpConfig(def: McpSourceDef, text: string, scope: McpServerEntry["scope"], sourcePath: string): McpParseResult {
  if (def.format === "codex-toml") return { servers: parseCodexToml(text).map(([name, raw]) => entry(def, scope, sourcePath, name, raw, text)) };
  let json: Record<string, unknown>;
  try {
    const parsed = JSON.parse(def.format === "vscode" ? stripJsonc(text) : text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { servers: [], error: "Top-level value is not a JSON object" };
    json = parsed as Record<string, unknown>;
  } catch (e) {
    return { servers: [], error: `Invalid JSON: ${(e as Error).message}` };
  }
  const maps: Record<string, unknown>[] = [];
  const add = (v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) maps.push(v as Record<string, unknown>);
  };
  add(json.mcpServers);
  if (def.format === "vscode") add(json.servers);
  if (def.format === "claude-user" && json.projects && typeof json.projects === "object") {
    for (const project of Object.values(json.projects as Record<string, unknown>)) {
      if (project && typeof project === "object") add((project as Record<string, unknown>).mcpServers);
    }
  }
  const servers: McpServerEntry[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    for (const [name, raw] of Object.entries(map)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const e = entry(def, scope, sourcePath, name, raw as Record<string, unknown>, text);
      const key = `${name}\0${e.command ?? ""}\0${e.args.join(" ")}\0${e.url ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      servers.push(e);
    }
  }
  return { servers };
}

/** Minimal TOML reader for Codex `[mcp_servers.<name>]` tables: strings, string arrays, inline tables. */
export function parseCodexToml(text: string): [string, Record<string, unknown>][] {
  const servers = new Map<string, Record<string, unknown>>();
  let current: Record<string, unknown> | undefined;
  let sub: string | undefined;
  const parseValue = (v: string): unknown => {
    v = v.trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
    if (v.startsWith("[")) return [...v.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
    if (v.startsWith("{")) {
      const o: Record<string, string> = {};
      for (const m of v.matchAll(/([A-Za-z0-9_."-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) o[m[1]!.replace(/"/g, "")] = m[2]!;
      return o;
    }
    return v;
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\s*mcp_servers\.("?)([^\].]+)\1(?:\.(\w+))?\s*\]$/);
    if (header) {
      const name = header[2]!;
      if (!servers.has(name)) servers.set(name, {});
      current = servers.get(name);
      sub = header[3];
      if (sub) current![sub] = current![sub] ?? {};
      continue;
    }
    if (line.startsWith("[")) {
      current = undefined;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv && current) {
      if (sub) (current[sub] as Record<string, unknown>)[kv[1]!] = parseValue(kv[2]!);
      else current[kv[1]!] = parseValue(kv[2]!);
    }
  }
  return [...servers.entries()];
}

/** MCP servers declared in a repository. */
export function discoverRepoMcp(repo: FsView): { servers: McpServerEntry[]; errors: { path: string; message: string }[] } {
  const servers: McpServerEntry[] = [];
  const errors: { path: string; message: string }[] = [];
  for (const def of REPO_MCP_SOURCES) {
    const text = repo.readFile(def.path);
    if (text === undefined) continue;
    const res = parseMcpConfig(def, text, "repo", def.path);
    servers.push(...res.servers);
    if (res.error) errors.push({ path: def.path, message: res.error });
  }
  return { servers, errors };
}

export interface PackageRef {
  ecosystem: "npm" | "pypi" | "docker";
  name?: string;
  version?: string;
  pinned: boolean;
}

/**
 * Which package a stdio server runs, and whether it is pinned to an exact version.
 * Derived from curatedmcp-launcher `packageInfo`, extended for pnpm dlx, bunx, yarn dlx,
 * uvx `pkg==1.0` / `--from`, pipx run and docker images.
 */
export function packageRef(command: string | undefined, args: string[]): PackageRef | undefined {
  if (!command) return undefined;
  const cmd = posix.basename(command.split("\\").join("/")).replace(/\.(cmd|exe)$/i, "");
  let rest = [...args];
  let ecosystem: PackageRef["ecosystem"];
  if (cmd === "npx" || cmd === "bunx") ecosystem = "npm";
  else if ((cmd === "pnpm" || cmd === "yarn") && rest[0] === "dlx") {
    ecosystem = "npm";
    rest = rest.slice(1);
  } else if (cmd === "bun" && rest[0] === "x") {
    ecosystem = "npm";
    rest = rest.slice(1);
  } else if (cmd === "uvx" || cmd === "pipx") {
    ecosystem = "pypi";
    if (cmd === "pipx" && rest[0] === "run") rest = rest.slice(1);
  } else if (cmd === "docker" || cmd === "podman") {
    if (rest[0] !== "run") return undefined;
    const image = imageFromDockerArgs(rest.slice(1));
    if (!image) return { ecosystem: "docker", pinned: false };
    const digest = image.includes("@sha256:");
    const tag = digest ? undefined : image.match(/:([^/:]+)$/)?.[1];
    return { ecosystem: "docker", name: image.replace(/(@sha256:.*|:[^/:]+)$/, ""), version: tag, pinned: digest || Boolean(tag && tag !== "latest") };
  } else return undefined;

  // npx --package=pkg@1 cmd / uvx --from pkg==1 cmd
  const fromIdx = rest.findIndex((a) => a === "--package" || a === "-p" || a === "--from");
  let candidate: string | undefined;
  const inline = rest.find((a) => /^--(package|from)=/.test(a));
  if (inline) candidate = inline.split("=").slice(1).join("=");
  else if (fromIdx !== -1) candidate = rest[fromIdx + 1];
  else candidate = rest.find((a) => !a.startsWith("-"));
  if (!candidate) return { ecosystem, pinned: false };

  if (ecosystem === "pypi") {
    const m = candidate.match(/^([A-Za-z0-9_.\-]+(?:\[[^\]]*\])?)\s*(?:==\s*([^\s,;]+)|@\s*([^\s]+))?/);
    const version = m?.[2] ?? m?.[3];
    return { ecosystem, name: m?.[1], version, pinned: Boolean(version && version !== "latest" && !/[*<>~^]/.test(version)) };
  }
  const m = candidate.match(/^(@[^/@]+\/[^@]+|[^@]+)(?:@(.+))?$/);
  if (!m) return { ecosystem, name: candidate, pinned: false };
  const version = m[2];
  return { ecosystem, name: m[1], version, pinned: Boolean(version && /^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(version)) };
}

function imageFromDockerArgs(args: string[]): string | undefined {
  const withValue = new Set(["-e", "--env", "-v", "--volume", "-p", "--publish", "--name", "--network", "-w", "--workdir", "--entrypoint", "-u", "--user", "--env-file", "--mount", "--platform", "-l", "--label"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("-")) {
      if (withValue.has(a)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}
