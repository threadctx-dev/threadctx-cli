import type { EffectiveContext, FsView, ToolId } from "@threadctx/core";
import type { ArtifactSpec, ParsedArtifact, Target } from "./common.js";

/**
 * Tool adapter contract (spec §6.2).
 * @experimental Unstable until after the day-45 gate; third-party code adapters are not loaded.
 */
export interface ToolAdapter {
  id: ToolId;
  label: string;
  /** `ga` only once oracle fixtures recorded from the real tool pass (spec §6.5). */
  status: "ga" | "beta" | "planned";
  /** Dated fact (spec §4 principle 9): the docs this adapter models and when they were checked. */
  verifiedAgainst: { docsUrl: string; date: string; toolVersion?: string };
  /** One-line description of what the tool reads, for `threadctx tools` and /tools pages. */
  summary: string;
  /** Behaviour the docs leave ambiguous, shown wherever this adapter's output appears. */
  caveats: string[];
  /** Files this tool owns. Shared files (AGENTS.md) are owned by the neutral adapter. */
  discover(fs: FsView): ArtifactSpec[];
  /** What this tool loads for a file or directory, in precedence order. */
  resolve(target: Target, catalog: Catalog): EffectiveContext;
}

export interface Catalog {
  fs: FsView;
  /** Every discovered context artifact, sorted by path. */
  artifacts: ParsedArtifact[];
  /** Look up an artifact by path, parsing imported files on first use. */
  get(path: string): ParsedArtifact | undefined;
}

export const STALE_AFTER_DAYS = 60;

/** Days since an adapter was last verified against the tool's docs. */
export function adapterAgeDays(adapter: ToolAdapter, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(adapter.verifiedAgainst.date)) / 86_400_000);
}
