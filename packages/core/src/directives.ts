import { extractClaims } from "./claims.js";
import { sha256 } from "./hash.js";
import { extractBlocks } from "./markdown.js";
import { factsFromClaims } from "./topics.js";
import type { Directive } from "./types.js";

/** Parse a markdown body into directives with claims and facts. */
export function buildDirectives(artifactId: string, body: string, startLine = 1): Directive[] {
  return extractBlocks(body, startLine).map((block) => {
    const claims = extractClaims(block);
    const facts = factsFromClaims(claims);
    const kind = block.kind === "prose" && claims.some((c) => c.type === "command") ? "command" : block.kind;
    return {
      id: sha256(`${artifactId}:${block.span.startLine}:${block.text}`).slice(0, 16),
      artifactId,
      span: block.span,
      text: block.text,
      kind,
      topicKey: facts.find((f) => !f.derived)?.topicKey ?? facts[0]?.topicKey,
      facts,
      claims,
      section: block.section,
      fenceLang: block.fenceLang,
    };
  });
}
