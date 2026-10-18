import type { Finding } from "./types.js";

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface GradeResult {
  grade: Grade;
  score: number;
  counts: { blocker: number; warning: number; info: number; suppressed: number };
}

const ORDER: Grade[] = ["A", "B", "C", "D", "F"];

/**
 * Spec §7.3, published on /methodology: start at 100; −25 per blocker, −5 per warning,
 * −1 per info; floor 0. A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F. Any open blocker caps the
 * grade at D; any open security blocker caps it at F. Suppressed findings do not count.
 */
export function grade(findings: Finding[]): GradeResult {
  const open = findings.filter((f) => !f.suppressed);
  const counts = {
    blocker: open.filter((f) => f.severity === "blocker").length,
    warning: open.filter((f) => f.severity === "warning").length,
    info: open.filter((f) => f.severity === "info").length,
    suppressed: findings.length - open.length,
  };
  const score = Math.max(0, 100 - 25 * counts.blocker - 5 * counts.warning - counts.info);
  let g: Grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  if (counts.blocker > 0 && ORDER.indexOf(g) < ORDER.indexOf("D")) g = "D";
  if (open.some((f) => f.severity === "blocker" && f.family === "security")) g = "F";
  return { grade: g, score, counts };
}
