import type { Finding, ScanConfig, ScanResult } from "@threadctx/rules";
import { SEVERITY_RANK } from "@threadctx/rules";

export interface Comparison {
  base: Pick<ScanResult, "grade" | "score" | "counts">;
  head: Pick<ScanResult, "grade" | "score" | "counts">;
  /** Open findings in head that are not in base: what this change introduced. */
  added: Finding[];
  /** Open findings in base that are gone in head. */
  fixed: Finding[];
  /** Open findings present in both: existing debt, never blocks a change. */
  existing: number;
}

export class CompareError extends Error {}

export function parseScanJson(text: string, label: string): ScanResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CompareError(`${label} is not valid JSON; create it with 'threadctx scan --format json'`);
  }
  const r = json as Partial<ScanResult> | null;
  if (!r || r.schema !== "threadctx.scan/v1" || !Array.isArray(r.findings)) {
    throw new CompareError(`${label} is not a threadctx scan result (expected schema threadctx.scan/v1)`);
  }
  return r as ScanResult;
}

/** Findings are matched by fingerprint (rule + path + normalised evidence), so moving a line never makes it "new". */
export function compareScans(base: ScanResult, head: ScanResult): Comparison {
  const open = (r: ScanResult) => r.findings.filter((f) => !f.suppressed);
  const key = (f: Finding) => `${f.ruleId}\u0000${f.fingerprint}`;
  const baseKeys = new Set(open(base).map(key));
  const headKeys = new Set(open(head).map(key));
  const added = open(head).filter((f) => !baseKeys.has(key(f)));
  const fixed = open(base).filter((f) => !headKeys.has(key(f)));
  return {
    base: { grade: base.grade, score: base.score, counts: base.counts },
    head: { grade: head.grade, score: head.score, counts: head.counts },
    added,
    fixed,
    existing: open(head).length - added.length,
  };
}

/** Exit 1 only when a *new* finding is at or above the threshold. */
export function compareExitCode(c: Comparison, failOn: ScanConfig["failOn"]): 0 | 1 {
  if (failOn === "none") return 0;
  return c.added.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}
