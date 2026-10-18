// `.threadctx/config.yaml`. Validated strictly: an invalid config is a usage error (exit 2),
// never silently ignored, because a typo could otherwise disable a security rule.
import { parseDocument } from "yaml";
import type { Severity } from "./registry.js";

export interface PackRef {
  path?: string;
  package?: string;
  /** sha256-<base64> or sha256:<hex> of the pack file; required for npm packs. */
  integrity?: string;
  /** Allow this pack's rules to report blockers. */
  allowBlockers?: boolean;
  line: number;
}

export interface ConfigSuppression {
  rule: string;
  /** Glob over repo-relative paths; omitted means every path. */
  path?: string;
  reason: string;
  expires?: string;
  line: number;
}

export interface ScanConfig {
  failOn: Severity | "none";
  budgets: Record<string, number>;
  rules: Record<string, Severity | "off">;
  suppress: ConfigSuppression[];
  security: { allowedDomains?: string[]; allowedInstallers: string[] };
  packs: PackRef[];
  /** Path the config was loaded from, if any. */
  source?: string;
}

export const DEFAULT_BUDGET_TOKENS = 5000;

export function defaultConfig(): ScanConfig {
  return { failOn: "blocker", budgets: { default: DEFAULT_BUDGET_TOKENS }, rules: {}, suppress: [], security: { allowedInstallers: [] }, packs: [] };
}

export class ConfigError extends Error {
  constructor(message: string, readonly path: string, readonly line?: number) {
    super(line ? `${path}:${line}: ${message}` : `${path}: ${message}`);
  }
}

const SEVERITIES = ["blocker", "warning", "info"];
const TOP_KEYS = new Set(["version", "failOn", "budgets", "rules", "suppress", "security", "packs"]);

export const CONFIG_PATHS = [".threadctx/config.yaml", ".threadctx/config.yml"];

export function parseConfig(text: string, path: string): ScanConfig {
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    throw new ConfigError(e.message.split("\n")[0]!, path, (e.linePos?.[0]?.line ?? 0) || undefined);
  }
  const lineOf = (node: unknown): number | undefined => {
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    return range ? text.slice(0, range[0]).split("\n").length : undefined;
  };
  const raw = doc.toJS({ maxAliasCount: 0 }) as unknown;
  const cfg = defaultConfig();
  cfg.source = path;
  if (raw === null || raw === undefined) return cfg;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("config must be a mapping", path);
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!TOP_KEYS.has(key)) throw new ConfigError(`unknown key '${key}' (expected one of ${[...TOP_KEYS].join(", ")})`, path, lineOf(doc.get(key, true)));
  }
  if (obj.version !== undefined && obj.version !== 1) throw new ConfigError("only config version 1 is supported", path);
  if (obj.failOn !== undefined) {
    if (typeof obj.failOn !== "string" || ![...SEVERITIES, "none"].includes(obj.failOn)) throw new ConfigError("failOn must be blocker, warning, info or none", path);
    cfg.failOn = obj.failOn as ScanConfig["failOn"];
  }
  if (obj.budgets !== undefined) {
    if (!isMap(obj.budgets)) throw new ConfigError("budgets must be a mapping of tool id to token budget", path);
    for (const [k, v] of Object.entries(obj.budgets)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new ConfigError(`budgets.${k} must be a positive number`, path);
      cfg.budgets[k] = v;
    }
  }
  if (obj.rules !== undefined) {
    if (!isMap(obj.rules)) throw new ConfigError("rules must be a mapping of rule id to severity or off", path);
    for (const [k, v] of Object.entries(obj.rules)) {
      if (typeof v !== "string" || ![...SEVERITIES, "off"].includes(v)) throw new ConfigError(`rules.${k} must be blocker, warning, info or off`, path);
      cfg.rules[k] = v as Severity | "off";
    }
  }
  if (obj.suppress !== undefined) {
    if (!Array.isArray(obj.suppress)) throw new ConfigError("suppress must be a list", path);
    const seq = doc.get("suppress", true) as { items?: unknown[] } | undefined;
    obj.suppress.forEach((s, i) => {
      const line = lineOf(seq?.items?.[i]) ?? 1;
      if (!isMap(s)) throw new ConfigError("each suppression must be a mapping", path, line);
      if (typeof s.rule !== "string") throw new ConfigError("suppression needs a 'rule'", path, line);
      if (typeof s.reason !== "string" || !s.reason.trim()) throw new ConfigError(`suppression of ${s.rule} needs a non-empty 'reason'`, path, line);
      if (s.path !== undefined && typeof s.path !== "string") throw new ConfigError("suppression 'path' must be a glob string", path, line);
      const expires = s.expires instanceof Date ? s.expires.toISOString().slice(0, 10) : s.expires;
      if (expires !== undefined && (typeof expires !== "string" || Number.isNaN(Date.parse(expires)))) throw new ConfigError("suppression 'expires' must be a date (YYYY-MM-DD)", path, line);
      cfg.suppress.push({ rule: s.rule, path: s.path as string | undefined, reason: s.reason.trim(), expires: expires as string | undefined, line });
    });
  }
  if (obj.security !== undefined) {
    if (!isMap(obj.security)) throw new ConfigError("security must be a mapping", path);
    const sec = obj.security;
    for (const k of Object.keys(sec)) if (!["allowedDomains", "allowedInstallers"].includes(k)) throw new ConfigError(`unknown key security.${k}`, path);
    if (sec.allowedDomains !== undefined) cfg.security.allowedDomains = stringList(sec.allowedDomains, "security.allowedDomains", path);
    if (sec.allowedInstallers !== undefined) cfg.security.allowedInstallers = stringList(sec.allowedInstallers, "security.allowedInstallers", path);
  }
  if (obj.packs !== undefined) {
    if (!Array.isArray(obj.packs)) throw new ConfigError("packs must be a list", path);
    const seq = doc.get("packs", true) as { items?: unknown[] } | undefined;
    obj.packs.forEach((p, i) => {
      const line = lineOf(seq?.items?.[i]) ?? 1;
      if (!isMap(p)) throw new ConfigError("each pack must be a mapping with 'path' or 'package'", path, line);
      if ((p.path === undefined) === (p.package === undefined)) throw new ConfigError("a pack needs exactly one of 'path' or 'package'", path, line);
      if (p.package !== undefined && (typeof p.package !== "string" || !/^(@[a-z0-9-]+\/)?threadctx-pack-[a-z0-9-]+$/.test(p.package))) {
        throw new ConfigError("npm packs must be named threadctx-pack-* (optionally scoped)", path, line);
      }
      cfg.packs.push({
        path: typeof p.path === "string" ? p.path : undefined,
        package: typeof p.package === "string" ? p.package : undefined,
        integrity: typeof p.integrity === "string" ? p.integrity : undefined,
        allowBlockers: p.allowBlockers === true,
        line,
      });
    });
  }
  return cfg;
}

function isMap(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function stringList(v: unknown, key: string, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ConfigError(`${key} must be a list of strings`, path);
  return v as string[];
}
