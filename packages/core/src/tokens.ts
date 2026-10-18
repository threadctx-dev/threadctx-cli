// Deterministic token *estimate*. Every user-facing number derived from this must say "estimate".
// Heuristic: ~4 characters per token for English prose and code, which tracks the BPE tokenizers
// used by current models to within roughly ±15% on markdown instruction files.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Claude Code strips block-level HTML comments before injecting CLAUDE.md content. */
export function stripBlockHtmlComments(text: string): string {
  return text.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(\r?\n|$)/gm, "");
}
