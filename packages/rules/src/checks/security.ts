import type { ParsedArtifact } from "@threadctx/adapters";
import { packageRef, type McpServerEntry } from "@threadctx/discovery";
import type { Check, FindingInput, RuleContext } from "../types.js";
import { negatedAt, quote, redact } from "../util.js";

/** Every text an agent or MCP client reads: context artifacts plus MCP config files. */
function* texts(ctx: RuleContext): Generator<{ path: string; text: string; artifact?: ParsedArtifact }> {
  for (const a of ctx.artifacts) yield { path: a.artifact.path, text: a.text, artifact: a };
  const seen = new Set<string>();
  for (const s of ctx.mcp) {
    if (s.scope !== "repo" || seen.has(s.sourcePath)) continue;
    seen.add(s.sourcePath);
    const text = ctx.fs.readFile(s.sourcePath);
    if (text !== undefined) yield { path: s.sourcePath, text };
  }
}

// --- X001: invisible and bidirectional Unicode -------------------------------------------

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]|[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]{2,}/gu;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function describe(ch: string): string {
  return [...ch].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

/** Remove invisible characters, keeping ZWJ / VS16 that join emoji. Returns what was removed. */
export function stripInvisible(line: string): { cleaned: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = line.replace(INVISIBLE, (m: string, offset: number) => {
    const prev = [...line.slice(0, offset)].pop() ?? "";
    const next = [...line.slice(offset + m.length)][0] ?? "";
    if ((m === "\u200D" || m === "\uFE0F") && (EMOJI.test(prev) || EMOJI.test(next))) return m;
    removed.push(m);
    return "";
  });
  return { cleaned, removed };
}

export const X001: Check = {
  ruleId: "CTX-X001",
  run(ctx, report) {
    for (const { path, text } of texts(ctx)) {
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const bom = i === 0 && line.startsWith("\uFEFF");
        const body = bom ? line.slice(1) : line;
        const { cleaned, removed: found } = stripInvisible(body);
        if (found.length === 0) return;
        // A stray zero-width space from copy-paste cannot carry an instruction; bidirectional
        // controls, tag characters and runs of three or more zero-width characters can.
        const dangerous = found.some((f) => /[\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/u.test(f) || f.length > 1);
        if (!dangerous && found.length < 3) return;
        const tag = found.some((f) => /[\u{E0000}-\u{E007F}]/u.test(f));
        report({
          path,
          line: i + 1,
          message: `Contains ${found.length} invisible or bidirectional character${found.length === 1 ? "" : "s"} (${[...new Set(found.map(describe))].slice(0, 4).join(", ")})${tag ? ", including Unicode tag characters that can smuggle hidden instructions" : ""}. Reviewers cannot see what the agent reads.`,
          evidence: quote(cleaned),
          fingerprintKey: `${describe(found.join(""))}:${cleaned.trim()}`,
          fix: { kind: "safe", description: "Remove invisible characters", edits: [{ path, startLine: i + 1, endLine: i + 1, replacement: bom ? `\uFEFF${cleaned}` : cleaned }] },
        });
      });
    }
  },
};

// --- X002: long encoded payloads ---------------------------------------------------------

const BASE64 = /[A-Za-z0-9+/_-]{200,}={0,2}/g;
const HEX = /\b[0-9a-fA-F]{128,}\b/g;

export const X002: Check = {
  ruleId: "CTX-X002",
  run(ctx, report) {
    for (const { path, text, artifact } of texts(ctx)) {
      if (!artifact) continue;
      text.split("\n").forEach((line, i) => {
        for (const m of [...line.matchAll(BASE64), ...line.matchAll(HEX)]) {
          const s = m[0];
          const mixed = /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
          if (!mixed && !/^[0-9a-fA-F]+$/.test(s)) continue;
          report({
            path,
            line: i + 1,
            message: `Contains a ${s.length}-character encoded blob. Encoded text can carry instructions no reviewer reads.`,
            evidence: `${s.slice(0, 24)}… (${s.length} chars)`,
            fingerprintKey: s.slice(0, 64),
          });
          break;
        }
      });
    }
  },
};

// --- X003: download and execute ----------------------------------------------------------

const PIPE_TO_SHELL = /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|fetch)\b[^\n|;&]*\|\s*(?:sudo\s+(?:-\w+\s+)*)?(sh|bash|zsh|ksh|dash|fish|python3?|node|perl|ruby|php|iex|Invoke-Expression|pwsh|powershell)\b/i;
const PROCESS_SUB = /\b(?:bash|sh|zsh|source|\.)\s+<\(\s*(?:curl|wget)\b/i;
const EVAL_FETCH = /\b(?:eval|sh\s+-c|bash\s+-c)\s+["']?\$\(\s*(?:curl|wget)\b/i;
const PS_DOWNLOAD = /\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:DownloadString|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient)\b/i;

/** Official installers that are widely documented; still reported if served over plain HTTP. */
export const KNOWN_INSTALLERS = [
  "bun.sh/install", "deno.land/install.sh", "deno.land/x/install", "sh.rustup.rs", "astral.sh/uv", "get.pnpm.io/install",
  "install.python-poetry.org", "raw.githubusercontent.com/nvm-sh/nvm/", "get.volta.sh", "mise.run", "fnm.vercel.app/install",
  "raw.githubusercontent.com/Homebrew/install/", "aka.ms/install-azd", "claude.ai/install.sh", "starship.rs/install.sh", "get.docker.com", "sdk.cloud.google.com",
];

export const X003: Check = {
  ruleId: "CTX-X003",
  run(ctx, report) {
    const allowed = [...KNOWN_INSTALLERS, ...ctx.config.security.allowedInstallers];
    for (const { path, text, artifact } of texts(ctx)) {
      if (!artifact) continue;
      text.split("\n").forEach((line, i) => {
        const m = line.match(PIPE_TO_SHELL) ?? line.match(PROCESS_SUB) ?? line.match(EVAL_FETCH) ?? line.match(PS_DOWNLOAD);
        if (!m || m.index === undefined) return;
        if (negatedAt(line, m.index)) return;
        const url = line.slice(m.index).match(/https?:\/\/[^\s'"`|)]+/)?.[0];
        if (url && url.startsWith("https://") && allowed.some((a) => url.replace(/^https:\/\//, "").startsWith(a))) return;
        report({
          path,
          line: i + 1,
          message: `Tells the agent to download and run remote code${url ? ` from ${url}` : ""}. Anyone who controls that URL controls the agent's machine.`,
          evidence: quote(line),
          fingerprintKey: quote(m[0], 120),
        });
      });
    }
  },
};

// --- X005: secrets -----------------------------------------------------------------------

const SECRET_PATTERNS: [string, RegExp][] = [
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ["Stripe live key", /\b[rs]k_live_[A-Za-z0-9]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}\b|\bsk-proj-[A-Za-z0-9_-]{40,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{34,}\b/],
  ["threadctx key", /\btctx_[a-f0-9]{32,}\b/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ["Credential in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{8,})@[^\s/]+/i],
];

const CREDENTIAL_NAME = /(secret|token|password|passwd|pwd|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth|credential|bearer)/i;
const REFERENCE = /^(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\{(env|input|secrets?|config):[^}]+\}|\{\{[^}]+\}\}|%[A-Za-z_][A-Za-z0-9_]*%|env:[A-Za-z_]+)$/;
const PLACEHOLDER = /^(<[^>]*>|\[[^\]]*\]|your[-_ ].*|.*(xxx|\.\.\.|…|changeme|change[-_]me|replace|placeholder|example|dummy|redacted|todo|fixme).*|\*+|0+|true|false|null|none)$/i;

function secretIn(text: string): { kind: string; value: string; index: number } | undefined {
  for (const [kind, re] of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      const value = kind === "Credential in URL" ? m[1]! : m[0];
      if (PLACEHOLDER.test(value) || REFERENCE.test(value)) continue;
      return { kind, value, index: m.index };
    }
  }
  return undefined;
}

function literalCredential(name: string, value: string): boolean {
  const v = value.trim().replace(/^Bearer\s+/i, "");
  if (!CREDENTIAL_NAME.test(name) || v.length < 8) return false;
  if (REFERENCE.test(v) || PLACEHOLDER.test(v) || /\$\{|\$[A-Z_]/.test(v)) return false;
  return /[A-Za-z]/.test(v) && /\d/.test(v);
}

export const X005: Check = {
  ruleId: "CTX-X005",
  run(ctx, report) {
    for (const { path, text, artifact } of texts(ctx)) {
      if (!artifact) continue;
      text.split("\n").forEach((line, i) => {
        const s = secretIn(line);
        if (!s) return;
        report({
          path,
          line: i + 1,
          message: `${s.kind} in a context file. Context is sent to model providers and committed to version control: rotate it and load it from the environment.`,
          evidence: quote(line.replace(s.value, redact(s.value))),
          fingerprintKey: `${s.kind}:${redact(s.value)}`,
        });
      });
    }
    for (const server of ctx.mcp.filter((x) => x.scope === "repo")) {
      const emit = (where: string, name: string, value: string, kind: string) =>
        report({
          path: server.sourcePath,
          line: server.line,
          message: `MCP server "${server.name}" has a literal ${kind} in ${where} \`${name}\`. Use an environment variable reference instead and rotate the value.`,
          evidence: `${where}.${name} = ${redact(value)}`,
          fingerprintKey: `${server.name}:${where}.${name}:${redact(value)}`,
        });
      for (const [name, value] of Object.entries(server.env)) {
        const pattern = secretIn(value);
        if (pattern) emit("env", name, pattern.value, pattern.kind);
        else if (literalCredential(name, value)) emit("env", name, value, "credential");
      }
      for (const [name, value] of Object.entries(server.headers)) {
        const pattern = secretIn(value);
        if (pattern) emit("headers", name, pattern.value, pattern.kind);
        else if (literalCredential(name, value) || (/^authorization$/i.test(name) && literalCredential("token", value))) emit("headers", name, value, "credential");
      }
      server.args.forEach((arg, idx) => {
        const pattern = secretIn(arg);
        const flag = arg.match(/^--?([\w-]*(?:token|key|secret|password)[\w-]*)=(.+)$/i);
        const nextOf = /^--?[\w-]*(token|key|secret|password)[\w-]*$/i.test(arg) ? server.args[idx + 1] : undefined;
        if (pattern) emit("args", String(idx), pattern.value, pattern.kind);
        else if (flag && literalCredential(flag[1]!, flag[2]!)) emit("args", flag[1]!, flag[2]!, "credential");
        else if (nextOf && literalCredential(arg, nextOf)) emit("args", arg, nextOf, "credential");
      });
    }
  },
};

// --- X006 / X007: MCP server configuration -----------------------------------------------

function mcpFinding(server: McpServerEntry, message: string, evidence: string): FindingInput {
  return { path: server.sourcePath, line: server.line, message, evidence, fingerprintKey: `${server.name}:${evidence}` };
}

export const X006: Check = {
  ruleId: "CTX-X006",
  run(ctx, report) {
    for (const server of ctx.mcp.filter((x) => x.scope === "repo" && x.transport === "stdio")) {
      const ref = packageRef(server.command, server.args);
      if (!ref || ref.pinned) continue;
      const cmd = quote([server.command, ...server.args].join(" "), 120);
      const range = ref.version && /^[~^><=*]|\.x\b|\*/.test(ref.version);
      const what = ref.version ? `\`${ref.name}@${ref.version}\`` : `\`${ref.name ?? "the package"}\` with no version`;
      const why = range ? "a version range, so new releases run without review" : "whatever was published most recently";
      report(mcpFinding(server, `MCP server "${server.name}" runs ${what}: ${why}. Pin an exact version.`, cmd));
    }
  },
};

function isLocalHost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "host.docker.internal"].includes(url.hostname) || url.hostname.endsWith(".localhost");
}

export const X007: Check = {
  ruleId: "CTX-X007",
  run(ctx, report) {
    for (const server of ctx.mcp.filter((x) => x.scope === "repo" && x.url)) {
      let url: URL;
      try {
        url = new URL(server.url!);
      } catch {
        continue;
      }
      if (url.protocol !== "http:" || isLocalHost(url)) continue;
      report(mcpFinding(server, `MCP server "${server.name}" connects over plain HTTP to ${url.host}. Tool calls and credentials can be read or altered in transit; use HTTPS.`, `${url.protocol}//${url.host}`));
    }
  },
};

export const X008: Check = {
  ruleId: "CTX-X008",
  run(ctx, report) {
    const allow = ctx.config.security.allowedDomains;
    if (!allow) return; // only meaningful with an explicit allowlist
    for (const a of ctx.artifacts) {
      for (const d of a.directives) {
        for (const c of d.claims) {
          if (c.type !== "url") continue;
          let host: string;
          try {
            host = new URL(c.value).hostname.toLowerCase();
          } catch {
            continue;
          }
          if (allow.some((dom) => host === dom.toLowerCase() || host.endsWith(`.${dom.toLowerCase()}`))) continue;
          report({ path: a.artifact.path, line: c.line, message: `Links to ${host}, which is not in security.allowedDomains.`, evidence: c.value, fingerprintKey: host });
        }
      }
    }
  },
};

export const X009: Check = {
  ruleId: "CTX-X009",
  run(ctx, report) {
    for (const p of ctx.config.packs) {
      if (p.package && !p.integrity) {
        report({ path: ctx.config.source ?? ".threadctx/config.yaml", line: p.line, message: `Rule pack ${p.package} is loaded without an integrity hash, so upstream changes reach every agent unreviewed.`, evidence: p.package });
      }
    }
  },
};
