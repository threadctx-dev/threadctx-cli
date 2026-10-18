import { agentsMd } from "./tools/agents-md.js";
import { claudeCode } from "./tools/claude-code.js";
import { copilot } from "./tools/copilot.js";
import { cursor } from "./tools/cursor.js";
import { gemini } from "./tools/gemini.js";
import type { ToolAdapter } from "./types.js";

/** The single list of adapters. Docs, `threadctx tools` and /tools pages render from it. */
export const ADAPTERS: readonly ToolAdapter[] = [agentsMd, claudeCode, cursor, copilot, gemini];

export function getAdapter(id: string): ToolAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
