import { describe, expect, it } from "vitest";
import {
  buildDirectives, commandTopic, contentHash, extractImports, normalizeCommand, parseCommand,
  parseFrontmatter, pathShape, stripBlockHtmlComments,
} from "./index.js";

describe("frontmatter", () => {
  it("parses a mapping and reports the body start line", () => {
    const fm = parseFrontmatter("---\ndescription: x\nalwaysApply: true\n---\n# Body\n");
    expect(fm.data).toEqual({ description: "x", alwaysApply: true });
    expect(fm.bodyStartLine).toBe(5);
  });
  it("reports the classic unquoted glob error with a file line number", () => {
    const fm = parseFrontmatter("---\ndescription: x\nglobs: *.ts\n---\nbody");
    expect(fm.error).toBeDefined();
    expect(fm.error!.line).toBe(3);
  });
  it("reports an unclosed block", () => {
    expect(parseFrontmatter("---\na: 1\n").error?.message).toMatch(/never closed/);
  });
  it("treats files without frontmatter as body only", () => {
    expect(parseFrontmatter("# Hi").present).toBe(false);
  });
});

describe("imports", () => {
  it("finds imports outside code and ignores code spans and fences", () => {
    const text = "See @AGENTS.md and `@README.md`.\n```\n@docs/x.md\n```\n@./rules/a.md, ok";
    expect(extractImports(text).map((i) => [i.path, i.line, i.certain])).toEqual([
      ["AGENTS.md", 1, true],
      ["./rules/a.md", 5, true],
    ]);
  });
  it("marks npm scopes and handles as uncertain and skips emails", () => {
    const refs = extractImports("Install @types/node, ping @sam, mail a@b.com");
    expect(refs.every((r) => !r.certain)).toBe(true);
    expect(refs.map((r) => r.path)).toEqual(["types/node", "sam"]);
  });
  it("supports escaped spaces", () => {
    expect(extractImports("@my\\ notes.md")[0]!.path).toBe("my notes.md");
  });
});

describe("path shapes", () => {
  it.each([
    ["src/index.ts", "path"], ["docs/", "path"], ["package.json", "path"], ["Makefile", "path"],
    ["src/**/*.ts", "glob"], ["Next.js", undefined], ["and/or", undefined], ["<file>", undefined],
    ["$HOME/x", undefined], ["1.2.3", undefined], ["@scope/pkg", undefined], ["https://x.dev/a", undefined],
    ["pnpm test", undefined], [".env", "path"], [".foo", undefined], ["node:fs", undefined],
  ])("%s -> %s", (input, shape) => expect(pathShape(input)).toBe(shape));
});

describe("commands", () => {
  it("normalises equivalent forms", () => {
    expect(normalizeCommand("$ npm run test")).toBe("npm test");
    expect(normalizeCommand("pnpm run build")).toBe("pnpm build");
  });
  it("parses scripts and builtins", () => {
    expect(parseCommand("pnpm build").script).toBe("build");
    expect(parseCommand("pnpm install").script).toBeUndefined();
    expect(parseCommand("npm run lint:fix").script).toBe("lint:fix");
    expect(parseCommand("pnpm --filter web dev")).toMatchObject({ script: "dev", workspaceScoped: true });
    expect(parseCommand("make test").script).toBe("test");
    expect(parseCommand("bun test").script).toBeUndefined();
  });
  it.each([
    ["pnpm test", "cmd.test"], ["npm run test:unit", "cmd.test"], ["uv run pytest -q", "cmd.test"],
    ["cargo test", "cmd.test"], ["go test ./...", "cmd.test"], ["pnpm lint", "cmd.lint"],
    ["ruff format .", "cmd.format"], ["tsc --noEmit", "cmd.typecheck"], ["pnpm build", "cmd.build"],
    ["pnpm install", "cmd.install"], ["bun test", "cmd.test"], ["python -m pytest", "cmd.test"],
    ["docker compose up", undefined],
  ])("%s -> %s", (cmd, topic) => expect(commandTopic(cmd)).toBe(topic));
});

describe("directives", () => {
  const md = [
    "# Dev",
    "",
    "- Run tests with `pnpm test`",
    "- Use pnpm, never npm.",
    "- Requires Node 20 and React 18.",
    "",
    "```bash",
    "$ pnpm install && pnpm build",
    "```",
    "",
    "| Task | Command |",
    "|---|---|",
    "| Lint | `pnpm lint` |",
  ].join("\n");
  const ds = buildDirectives("a1", md);

  it("splits list items, fences and table rows with exact lines", () => {
    expect(ds.map((d) => d.span.startLine)).toEqual([3, 4, 5, 7, 13]);
    expect(ds[0]!.section).toBe("Dev");
  });
  it("extracts facts", () => {
    expect(ds[0]!.facts).toContainEqual(expect.objectContaining({ topicKey: "cmd.test", value: "pnpm test" }));
    expect(ds[1]!.facts).toContainEqual(expect.objectContaining({ topicKey: "pkg.manager", value: "pnpm", derived: false }));
    expect(ds[1]!.facts.some((f) => f.value === "npm")).toBe(false);
    expect(ds[2]!.facts.map((f) => [f.topicKey, f.value])).toEqual([["lang.node.version", "20"], ["dep.react.version", "18"]]);
    expect(ds[3]!.facts.map((f) => f.topicKey)).toEqual(["cmd.install", "pkg.manager", "cmd.build"]);
    expect(ds[3]!.claims[0]!.line).toBe(8);
    expect(ds[4]!.facts[0]).toMatchObject({ topicKey: "cmd.lint", value: "pnpm lint" });
  });
  it("classifies prohibitions", () => {
    expect(ds[1]!.kind).toBe("prohibition");
  });
});

describe("hashing and comments", () => {
  it("ignores CRLF and BOM differences", () => {
    expect(contentHash("﻿a\r\nb")).toBe(contentHash("a\nb"));
  });
  it("strips block HTML comments", () => {
    expect(stripBlockHtmlComments("a\n<!-- note -->\nb")).toBe("a\nb");
  });
});

describe("precision guards", () => {
  it("does not treat versions or domains as imports", () => {
    expect(extractImports("Pin @v2.1 and email @example.com, see @docs/a.md").map((i) => [i.path, i.certain])).toEqual([
      ["v2.1", false], ["example.com", false], ["docs/a.md", true],
    ]);
  });
  it("marks lower-bound versions", () => {
    const ds = buildDirectives("x", "- Node 18+ and Python 3.11 or later; React 18.\n");
    expect(ds[0]!.facts.map((f) => f.value)).toEqual(["18+", "3.11+", "18"]);
  });
});
