// `threadctx init`: the GitHub Action workflow and the README badge, so a repository keeps its grade.

/** Pinned by commit so a moved tag can never change what runs in CI. Updated by scripts/release.sh. */
export const ACTION_PIN = { sha: "0fcf8348d004ae084b5e557dddd381da25a6db6a", tag: "v1.4.1" };
const CHECKOUT_PIN = { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", tag: "v7.0.1" };

export const WORKFLOW_PATH = ".github/workflows/agent-context.yml";

export function workflowYaml(): string {
  return `# Grades what AI coding agents are told (AGENTS.md, CLAUDE.md, Cursor, Copilot, Gemini, MCP).
# Only problems a pull request introduces can fail it. https://threadctx.dev
name: Agent context
on:
  pull_request:
  push:
    branches: [main, master]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  agent-context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${CHECKOUT_PIN.sha} # ${CHECKOUT_PIN.tag}
      - uses: threadctx-dev/action@${ACTION_PIN.sha} # ${ACTION_PIN.tag}
`;
}

const BADGE_LINE = /\[!\[agent context[^\]]*\]\([^)]*\)\]\([^)]*\)/i;

/** README with the badge after the first heading (or at the top). Unchanged if a badge is already there. */
export function withBadge(readme: string, markdown: string): string {
  if (BADGE_LINE.test(readme) || readme.includes("img.shields.io/badge/agent%20context-") || readme.includes("threadctx.dev%2Fbadge%2F")) return readme;
  const lines = readme.split("\n");
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  if (h1 === -1) return `${markdown}\n\n${readme}`;
  const next = lines[h1 + 1];
  lines.splice(h1 + 1, 0, "", markdown, ...(next === undefined || next === "" ? [] : [""]));
  return lines.join("\n");
}
