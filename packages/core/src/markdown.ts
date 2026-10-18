// Markdown structure for context files. Deliberately small and line-based: we need
// code-fence awareness, frontmatter, headings, list items, tables and imports with exact
// line numbers, not a full CommonMark AST.
import { parseDocument } from "yaml";
import { FILE_EXT } from "./claims.js";
import type { DirectiveKind } from "./types.js";

export interface Frontmatter {
  /** Parsed mapping. When strict YAML fails, the lenient line-based reading (see `lenient`). */
  data?: Record<string, unknown>;
  /** True when strict YAML failed and `data` comes from the lenient `key: value` reading tools use. */
  lenient?: boolean;
  /** Raw YAML text between the delimiters. */
  raw?: string;
  /** Parse error with a 1-based line number in the original file. */
  error?: { message: string; line: number };
  /** Markdown body after the frontmatter. */
  body: string;
  /** 1-based line number in the original file where the body starts. */
  bodyStartLine: number;
  present: boolean;
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized, bodyStartLine: 1, present: false };
  }
  const lines = normalized.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {
      body: normalized,
      bodyStartLine: 1,
      present: true,
      error: { message: "Frontmatter opened with '---' but never closed", line: 1 },
    };
  }
  const raw = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  const bodyStartLine = end + 2;
  const doc = parseDocument(raw, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const err = doc.errors[0]!;
    const line = (err.linePos?.[0]?.line ?? 1) + 1;
    return { raw, data: lenientFrontmatter(raw), lenient: true, body, bodyStartLine, present: true, error: { message: err.message.split("\n")[0]!, line } };
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch (e) {
    // e.g. `globs: *.ts` — YAML reads `*` as an alias. Point at the first line that uses one.
    const rawLines = raw.split("\n");
    const idx = rawLines.findIndex((l) => /(^|[:\-,[]\s*)\*/.test(l));
    const message = e instanceof Error ? e.message : String(e);
    return { raw, data: lenientFrontmatter(raw), lenient: true, body, bodyStartLine, present: true, error: { message, line: (idx === -1 ? 0 : idx) + 2 } };
  }
  if (data === null || data === undefined) return { raw, data: {}, body, bodyStartLine, present: true };
  if (typeof data !== "object" || Array.isArray(data)) {
    return { raw, body, bodyStartLine, present: true, error: { message: "Frontmatter must be a YAML mapping", line: 2 } };
  }
  return { raw, data: data as Record<string, unknown>, body, bodyStartLine, present: true };
}

/**
 * Line-based `key: value` reading, as agent tools do in practice: Claude Code subagents with
 * colons in their description and Cursor's own unquoted `globs: *.ts` both work despite being
 * invalid YAML. Returns undefined when even this reading finds no keys.
 */
export function lenientFrontmatter(raw: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let listKey: string | undefined;
  let lastKey: string | undefined;
  for (const line of raw.split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s?(.*)$/);
    if (kv) {
      const [, key, rawValue] = kv as unknown as [string, string, string];
      const v = rawValue.trim();
      lastKey = key;
      listKey = v === "" ? key : undefined;
      out[key] = v === "" ? [] : v === "true" ? true : v === "false" ? false : v.replace(/^(["'])(.*)\1$/, "$2");
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey && Array.isArray(out[listKey])) {
      (out[listKey] as string[]).push(item[1]!.trim().replace(/^(["'])(.*)\1$/, "$2"));
      continue;
    }
    if (/^\s+\S/.test(line) && lastKey && typeof out[lastKey] === "string") {
      out[lastKey] = `${out[lastKey]} ${line.trim()}`; // folded continuation
      continue;
    }
  }
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && v.length === 0) out[k] = "";
  return Object.keys(out).length ? out : undefined;
}

export interface MdLine {
  /** 1-based line number in the original file. */
  n: number;
  text: string;
  inFence: boolean;
  fenceDelimiter: boolean;
  fenceLang?: string;
  /** Inside a block-level HTML comment. */
  inComment: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;

export function scanLines(text: string, startLine = 1): MdLine[] {
  const out: MdLine[] = [];
  let fence: { char: string; len: number; lang: string } | undefined;
  let inComment = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const n = startLine + i;
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.len) {
        out.push({ n, text: line, inFence: true, fenceDelimiter: true, fenceLang: fence.lang, inComment: false });
        fence = undefined;
      } else {
        out.push({ n, text: line, inFence: true, fenceDelimiter: false, fenceLang: fence.lang, inComment: false });
      }
      continue;
    }
    if (inComment) {
      out.push({ n, text: line, inFence: false, fenceDelimiter: false, inComment: true });
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      fence = { char: open[1]![0]!, len: open[1]!.length, lang: (open[2] ?? "").toLowerCase() };
      out.push({ n, text: line, inFence: true, fenceDelimiter: true, fenceLang: fence.lang, inComment: false });
      continue;
    }
    if (/^\s*<!--/.test(line) && !line.includes("-->")) {
      inComment = true;
      out.push({ n, text: line, inFence: false, fenceDelimiter: false, inComment: true });
      continue;
    }
    const wholeLineComment = /^\s*<!--.*-->\s*$/.test(line);
    out.push({ n, text: line, inFence: false, fenceDelimiter: false, inComment: wholeLineComment });
  }
  return out;
}

/** Replace inline code spans with spaces, preserving column positions. */
export function maskCodeSpans(line: string): string {
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m) => " ".repeat(m.length));
}

export function codeSpans(line: string): string[] {
  const spans: string[] = [];
  for (const m of line.matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/g)) spans.push(m[2]!.trim());
  return spans;
}

export interface ImportRef {
  /** The path as written, with escaped spaces resolved. */
  path: string;
  line: number;
  /** True when the token unambiguously names a file (extension or explicit relative/absolute prefix). */
  certain: boolean;
}

/**
 * `@path` imports as Claude Code and Gemini CLI parse them: outside fenced code and inline
 * code spans, preceded by start-of-line or whitespace. Uncertain tokens such as `@types/node`
 * or `@someone` are returned with certain=false so callers never report them as broken.
 */
export function extractImports(text: string, startLine = 1): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const line of scanLines(text, startLine)) {
    if (line.inFence || line.inComment) continue;
    const masked = maskCodeSpans(line.text);
    for (const m of masked.matchAll(/(?:^|\s)@((?:\\ |[^\s`"'<>()[\]])+)/g)) {
      let path = m[1]!.replace(/\\ /g, " ");
      path = path.replace(/[.,;:!?]+$/, "");
      if (!path || path.startsWith("@")) continue;
      const explicit = /^(\.{1,2}\/|~\/|\/)/.test(path);
      const last = path.split("/").pop() ?? "";
      // An extension must contain a letter ("@v2.1" is a version) and a bare domain is not a file.
      // Certain only with a real file extension: "@v2.1", "@example.com" and "@me.bsky.social" are not files.
      const hasExt = FILE_EXT.test(last);
      // Email-like tokens and npm versions ("pkg@1.2") are preceded by non-space, so never match here.
      refs.push({ path, line: line.n, certain: explicit || hasExt });
    }
  }
  return refs;
}

export interface Section {
  title: string;
  level: number;
  line: number;
  /** Body lines (excluding the heading), trimmed of surrounding blank lines. */
  body: string;
  bodyStartLine: number;
}

export function extractSections(text: string, startLine = 1): Section[] {
  const lines = scanLines(text, startLine);
  const sections: Section[] = [];
  let current: { title: string; level: number; line: number; body: string[]; bodyStartLine: number } | undefined;
  const flush = () => {
    if (current) {
      sections.push({
        title: current.title,
        level: current.level,
        line: current.line,
        body: current.body.join("\n").trim(),
        bodyStartLine: current.bodyStartLine,
      });
    }
  };
  for (const l of lines) {
    const h = !l.inFence && !l.inComment ? l.text.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
    if (h) {
      flush();
      current = { title: h[2]!.trim(), level: h[1]!.length, line: l.n, body: [], bodyStartLine: l.n + 1 };
    } else if (current) {
      current.body.push(l.text);
    }
  }
  flush();
  return sections;
}

export interface Block {
  span: { startLine: number; endLine: number };
  text: string;
  kind: DirectiveKind;
  section?: string;
  /** Present for fenced code blocks. */
  fenceLang?: string;
  isCode: boolean;
}

const SHELL_LANGS = new Set(["", "sh", "bash", "shell", "zsh", "console", "shell-session", "fish", "powershell", "ps1", "pwsh", "cmd", "bat"]);

export function isShellLang(lang: string | undefined): boolean {
  return SHELL_LANGS.has(lang ?? "");
}

const PROHIBITION = /\b(never|don't|do not|must not|mustn't|should not|shouldn't|avoid|no longer|forbidden|not allowed)\b/i;
const REQUIREMENT = /\b(must|always|required|require|ensure|make sure|only use|shall)\b/i;

export function classifyText(text: string): DirectiveKind {
  if (PROHIBITION.test(text)) return "prohibition";
  if (REQUIREMENT.test(text)) return "requirement";
  return "prose";
}

/**
 * Split markdown into directive-sized blocks: one per list item, paragraph, table row or
 * fenced code block. Headings become the `section` of the blocks below them.
 */
export function extractBlocks(text: string, startLine = 1): Block[] {
  const lines = scanLines(text, startLine);
  const blocks: Block[] = [];
  const headings: string[] = [];
  let buf: MdLine[] = [];
  let bufKind: "para" | "list" | undefined;
  let fenceBuf: MdLine[] = [];

  const section = () => (headings.length ? headings.filter(Boolean).join(" > ") : undefined);
  const flush = () => {
    if (buf.length) {
      const body = buf.map((l) => l.text).join("\n").trim();
      if (body) {
        blocks.push({
          span: { startLine: buf[0]!.n, endLine: buf[buf.length - 1]!.n },
          text: body,
          kind: classifyText(maskCodeSpans(body)),
          section: section(),
          isCode: false,
        });
      }
    }
    buf = [];
    bufKind = undefined;
  };

  const isSeparator = (t: string | undefined) => t !== undefined && /^\s*\|?\s*:?-{2,}/.test(t);
  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx]!;
    if (l.inFence) {
      if (l.fenceDelimiter && fenceBuf.length === 0) {
        flush();
        fenceBuf.push(l);
        continue;
      }
      if (l.fenceDelimiter) {
        const content = fenceBuf.slice(1).map((x) => x.text).join("\n");
        const lang = fenceBuf[0]!.fenceLang;
        blocks.push({
          span: { startLine: fenceBuf[0]!.n, endLine: l.n },
          text: content,
          kind: isShellLang(lang) ? "command" : "prose",
          section: section(),
          fenceLang: lang,
          isCode: true,
        });
        fenceBuf = [];
        continue;
      }
      fenceBuf.push(l);
      continue;
    }
    if (l.inComment) {
      flush();
      continue;
    }
    const heading = l.text.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      headings.length = level - 1;
      headings[level - 1] = heading[2]!.trim();
      continue;
    }
    if (!l.text.trim()) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(l.text)) {
      flush();
      if (isSeparator(l.text)) continue;
      if (isSeparator(lines[idx + 1]?.text)) continue; // header row: labels, not instructions
      blocks.push({
        span: { startLine: l.n, endLine: l.n },
        text: l.text.trim(),
        kind: classifyText(maskCodeSpans(l.text)),
        section: section(),
        isCode: false,
      });
      continue;
    }
    const listStart = /^\s*([-*+]|\d+[.)])\s+/.test(l.text);
    if (listStart) {
      flush();
      buf = [l];
      bufKind = "list";
      continue;
    }
    if (bufKind === "list" && /^\s{2,}\S/.test(l.text)) {
      buf.push(l);
      continue;
    }
    if (bufKind === "list") flush();
    bufKind = "para";
    buf.push(l);
  }
  flush();
  // An unterminated fence runs to end of file, as in CommonMark.
  if (fenceBuf.length) {
    const lang = fenceBuf[0]!.fenceLang;
    blocks.push({
      span: { startLine: fenceBuf[0]!.n, endLine: fenceBuf[fenceBuf.length - 1]!.n },
      text: fenceBuf.slice(1).map((x) => x.text).join("\n"),
      kind: isShellLang(lang) ? "command" : "prose",
      section: section(),
      fenceLang: lang,
      isCode: true,
    });
  }
  return blocks;
}
