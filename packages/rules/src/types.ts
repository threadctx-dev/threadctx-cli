import type { Catalog, ParsedArtifact } from "@threadctx/adapters";
import type { EffectiveContext, FsView, ToolId } from "@threadctx/core";
import type { McpServerEntry, ProjectFacts } from "@threadctx/discovery";
import type { ScanConfig } from "./config.js";
import type { Family, RuleMeta, Severity } from "./registry.js";

export interface TextEdit {
  path: string;
  /** 1-based inclusive line range replaced by `replacement` (which may span several lines). */
  startLine: number;
  endLine: number;
  replacement: string;
}

export interface Fix {
  kind: "safe" | "suggested";
  description: string;
  edits: TextEdit[];
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  family: Family;
  title: string;
  message: string;
  /** Repo-relative path; "" for repository-level findings. */
  path: string;
  line?: number;
  endLine?: number;
  /** Quoted evidence, with secrets redacted. Never more than one line of ~200 chars. */
  evidence?: string;
  /** hash(rule, path, normalised evidence): stable across line moves, used by the net-new ratchet. */
  fingerprint: string;
  fix?: Fix;
  related?: { path: string; line?: number; message?: string }[];
  tool?: ToolId;
  suppressed?: { reason: string; source: "inline" | "config"; expires?: string };
  /** Rule came from a third-party pack. */
  community?: boolean;
  /** Estimated tokens per session this finding wastes (duplicated or boilerplate text). */
  wasteTokens?: number;
}

export interface Diagnostic {
  level: "error" | "warning" | "info";
  message: string;
  path?: string;
  line?: number;
}

/** Optional git history, used only by heuristic drift checks; absent in shallow or non-git checkouts. */
export interface HistoryProvider {
  /** Unix seconds of the last commit touching `path`, or undefined. */
  lastCommitTime(path: string): number | undefined;
  /** Commits touching any of `paths` after `since` (unix seconds). */
  commitsSince(paths: string[], since: number): number | undefined;
}

export interface RuleContext {
  fs: FsView;
  catalog: Catalog;
  /** Context artifacts that agents read (instructions, rules, skills, subagents, commands). */
  artifacts: ParsedArtifact[];
  facts: ProjectFacts;
  mcp: McpServerEntry[];
  config: ScanConfig;
  /** Effective context for a file at the repo root, per tool. */
  rootContexts: EffectiveContext[];
  history?: HistoryProvider;
  now: Date;
}

export interface FindingInput {
  path: string;
  line?: number;
  endLine?: number;
  message: string;
  evidence?: string;
  fix?: Fix;
  related?: Finding["related"];
  tool?: ToolId;
  /** Overrides the evidence used for the fingerprint (e.g. to ignore volatile parts). */
  fingerprintKey?: string;
  wasteTokens?: number;
}

export interface Check {
  ruleId: string;
  run(ctx: RuleContext, report: (f: FindingInput) => void): void;
}

export type { RuleMeta };
