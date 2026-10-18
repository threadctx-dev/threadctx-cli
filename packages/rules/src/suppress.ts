import picomatch from "picomatch";
import type { ParsedArtifact } from "@threadctx/adapters";
import type { ScanConfig } from "./config.js";
import type { Diagnostic, Finding } from "./types.js";

interface InlineSuppression {
  rules: string[];
  path: string;
  /** undefined = whole file */
  line?: number;
  reason: string;
  expires?: string;
}

const INLINE = /<!--\s*(?:ctx|threadctx)-ignore(-file)?\s+([A-Za-z0-9/_-]+(?:\s*,\s*[A-Za-z0-9/_-]+)*)(?:\s+until[=\s](\d{4}-\d{2}-\d{2}))?\s*(?::\s*([\s\S]*?))?\s*-->/g;

/** Parse `<!-- ctx-ignore CTX-D001: reason -->` and `<!-- ctx-ignore-file CTX-B003 until=2026-12-31: reason -->`. */
export function inlineSuppressions(artifacts: ParsedArtifact[], now: Date, diagnostics: Diagnostic[]): InlineSuppression[] {
  const out: InlineSuppression[] = [];
  for (const a of artifacts) {
    const lines = a.text.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(INLINE)) {
        const where = { path: a.artifact.path, line: i + 1 };
        const reason = (m[4] ?? "").trim();
        if (!reason) {
          diagnostics.push({ level: "warning", ...where, message: "Suppression ignored: a reason is required (<!-- ctx-ignore RULE: reason -->)." });
          continue;
        }
        if (m[3] && Date.parse(m[3]) < now.getTime()) {
          diagnostics.push({ level: "warning", ...where, message: `Suppression expired on ${m[3]} and no longer applies.` });
          continue;
        }
        let target: number | undefined;
        if (!m[1]) {
          const rest = line.replace(m[0], "").trim();
          if (rest) target = i + 1;
          else {
            let j = i + 1;
            while (j < lines.length && !lines[j]!.trim()) j++;
            target = j + 1;
          }
        }
        out.push({ rules: m[2]!.split(",").map((r) => r.trim()), path: a.artifact.path, line: target, reason, expires: m[3] });
      }
    });
  }
  return out;
}

export function applySuppressions(findings: Finding[], inline: InlineSuppression[], config: ScanConfig, now: Date, diagnostics: Diagnostic[]): void {
  const active = config.suppress.filter((s) => {
    if (s.expires && Date.parse(s.expires) < now.getTime()) {
      diagnostics.push({ level: "warning", path: config.source, line: s.line, message: `Suppression of ${s.rule} expired on ${s.expires} and no longer applies.` });
      return false;
    }
    return true;
  });
  const matchers = active.map((s) => ({ s, match: s.path ? picomatch(s.path, { dot: true }) : () => true }));
  for (const f of findings) {
    const hit = inline.find((x) => x.path === f.path && x.rules.includes(f.ruleId) && (x.line === undefined || (f.line !== undefined && f.line >= x.line && f.line <= Math.max(x.line, f.endLine ?? x.line))));
    if (hit) {
      f.suppressed = { reason: hit.reason, source: "inline", expires: hit.expires };
      continue;
    }
    const cfg = matchers.find(({ s, match }) => s.rule === f.ruleId && match(f.path));
    if (cfg) f.suppressed = { reason: cfg.s.reason, source: "config", expires: cfg.s.expires };
  }
}
