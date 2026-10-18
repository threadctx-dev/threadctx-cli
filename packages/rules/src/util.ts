import type { ParsedArtifact } from "@threadctx/adapters";
import { sha256 } from "@threadctx/core";
import type { Directive } from "@threadctx/core";

/** One line of evidence, trimmed to ~200 chars. */
export function quote(text: string, max = 200): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function lineText(a: ParsedArtifact, line: number): string {
  return a.text.split("\n")[line - 1] ?? "";
}

/** Redact a secret to a short prefix plus a hash, the only form that ever leaves the engine. */
export function redact(secret: string): string {
  const prefix = secret.slice(0, Math.min(4, Math.max(0, secret.length - 8)));
  return `${prefix}…[redacted sha256:${sha256(secret).slice(0, 8)}]`;
}

const NEGATION = /\b(never|don't|do not|must not|mustn't|should not|shouldn't|avoid|not|no)\b[^.!?\n]{0,40}$/i;

/** True when the text before `index` negates what follows ("never run X"). */
export function negatedAt(text: string, index: number): boolean {
  return NEGATION.test(text.slice(Math.max(0, index - 60), index));
}

// "e.g." ends in punctuation, so it cannot sit inside a trailing \b.
const EXAMPLE = /(?:\be\.g\.|\beg\.|\b(?:for example|for instance|example|such as|placeholder|sample|template|hypothetical)\b)/i;

/** Directives that talk about examples are not claims about this repository. */
export function isExampleContext(d: Directive): boolean {
  return EXAMPLE.test(d.text) || EXAMPLE.test(d.section ?? "");
}

/** Context artifacts that agents read as instructions (skills and subagents excluded). */
export function isInstructional(a: ParsedArtifact): boolean {
  return a.artifact.kind === "instructions" || a.artifact.kind === "rule";
}

export function displayTool(tool: string): string {
  return (
    { "agents-md": "AGENTS.md readers", "claude-code": "Claude Code", cursor: "Cursor", copilot: "Copilot", gemini: "Gemini CLI", neutral: "every AGENTS.md reader" } as Record<string, string>
  )[tool] ?? tool;
}

/** Example, template and fixture trees describe other projects, not this repository. */
const TEMPLATE_PATH = /(^|\/)(examples?|templates?|template-[^/]+|starters?|starter-[^/]+|boilerplates?|fixtures?|__fixtures__|testdata|samples?|scaffolds?|create-[^/]+\/src\/templates?|tests?\/resources|__tests__)\//i;

export function isTemplatePath(path: string): boolean {
  return TEMPLATE_PATH.test(path);
}

/** Drift and conflict rules only judge this repository's own instructions. */
export function isOwnInstruction(a: ParsedArtifact): boolean {
  return isInstructional(a) && !isTemplatePath(a.artifact.path);
}

export function isAncestorDir(ancestor: string, dir: string): boolean {
  return ancestor === "" ? dir !== "" : dir.startsWith(`${ancestor}/`);
}
