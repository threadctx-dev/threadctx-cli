import { createTwoFilesPatch } from "diff";
import type { FsView } from "@threadctx/core";
import type { Finding, TextEdit } from "@threadctx/rules";

export interface FixPlan {
  /** New content per path. */
  files: Map<string, { before: string; after: string }>;
  applied: Finding[];
  skipped: { finding: Finding; reason: string }[];
  patch: string;
}

/**
 * Apply line-based edits from safe fixes. Edits to the same file are applied bottom-up;
 * an edit overlapping one already taken is skipped and reported, never merged.
 * `endLine < startLine` means insert before `startLine`.
 */
export function planFixes(fs: FsView, findings: Finding[], kinds: ("safe" | "suggested")[] = ["safe"]): FixPlan {
  const candidates = findings.filter((f) => !f.suppressed && f.fix && kinds.includes(f.fix.kind) && f.fix.edits.length > 0);
  const byPath = new Map<string, { finding: Finding; edit: TextEdit }[]>();
  const skipped: FixPlan["skipped"] = [];
  for (const finding of candidates) {
    for (const edit of finding.fix!.edits) {
      const list = byPath.get(edit.path) ?? [];
      list.push({ finding, edit });
      byPath.set(edit.path, list);
    }
  }
  const files = new Map<string, { before: string; after: string }>();
  const applied = new Set<Finding>();
  for (const [path, edits] of [...byPath.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const before = fs.readFile(path);
    if (before === undefined) {
      for (const e of edits) skipped.push({ finding: e.finding, reason: `${path} could not be read` });
      continue;
    }
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    const bom = before.startsWith("﻿") ? "﻿" : "";
    const lines = before.replace(/^﻿/, "").split(/\r?\n/);
    const taken: [number, number][] = [];
    const sorted = [...edits].sort((a, b) => b.edit.startLine - a.edit.startLine || b.edit.endLine - a.edit.endLine);
    for (const { finding, edit } of sorted) {
      const insert = edit.endLine < edit.startLine;
      const range: [number, number] = insert ? [edit.startLine - 0.5, edit.startLine - 0.5] : [edit.startLine, edit.endLine];
      if (edit.startLine < 1 || (!insert && edit.endLine > lines.length)) {
        skipped.push({ finding, reason: "edit is outside the file" });
        continue;
      }
      if (taken.some(([s, e]) => range[0] <= e && range[1] >= s)) {
        skipped.push({ finding, reason: "overlaps another fix; run fix again after applying" });
        continue;
      }
      taken.push(range);
      const replacement = edit.replacement.replace(/\r?\n$/, "").split(/\r?\n/);
      if (insert) lines.splice(edit.startLine - 1, 0, ...replacement);
      else lines.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...replacement);
      applied.add(finding);
    }
    const after = bom + lines.join(eol);
    if (after !== before) files.set(path, { before, after });
  }
  const patch = [...files.entries()].map(([p, { before, after }]) => createTwoFilesPatch(`a/${p}`, `b/${p}`, before, after, "", "", { context: 3 })).join("");
  return { files, applied: [...applied], skipped, patch };
}
